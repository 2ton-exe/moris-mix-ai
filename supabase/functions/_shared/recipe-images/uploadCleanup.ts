import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import {
  type R2Config,
  resolveR2Config,
  signRecipeImageStagingDelete,
} from "./r2.ts";

const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGING_KEY =
  /^recipe-images\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type CleanupItem = { id: string; staging_key: string };
type CleanupFailure =
  | "configuration"
  | "network"
  | "r2_rejected"
  | "r2_unavailable"
  | "unexpected";

export type UploadCleanupDeps = {
  cleanupToken?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  r2Config?: R2Config;
  fetch?: typeof fetch;
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  deleteObject?: (
    stagingKey: string,
  ) => Promise<"deleted" | "missing" | CleanupFailure>;
};

function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function response(
  status: number,
  body: Record<string, number | string>,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function createRpc(deps: UploadCleanupDeps) {
  if (deps.rpc) return deps.rpc;
  const url = deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const key = deps.supabaseServiceRoleKey ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url?.trim() || !key?.trim()) {
    throw new Error("Missing cleanup database configuration.");
  }
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { ...(deps.fetch ? { fetch: deps.fetch } : {}) },
  });
  return (name: string, args: Record<string, unknown>) =>
    client.rpc(name, args);
}

async function deleteStagingObject(
  stagingKey: string,
  deps: UploadCleanupDeps,
): Promise<"deleted" | "missing" | CleanupFailure> {
  if (deps.deleteObject) return await deps.deleteObject(stagingKey);
  if (!STAGING_KEY.test(stagingKey)) return "unexpected";
  let config: R2Config;
  try {
    config = resolveR2Config(deps.r2Config);
  } catch {
    return "configuration";
  }
  try {
    const url = await signRecipeImageStagingDelete(stagingKey, config);
    const result = await (deps.fetch ?? fetch)(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(8_000),
    });
    if (result.ok) return "deleted";
    if (result.status === 404) return "missing";
    return result.status >= 500 ? "r2_unavailable" : "r2_rejected";
  } catch {
    return "network";
  }
}

export async function handler(
  req: Request,
  deps: UploadCleanupDeps = {},
): Promise<Response> {
  if (req.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }
  const token = deps.cleanupToken ?? Deno.env.get("RECIPE_IMAGE_CLEANUP_TOKEN");
  if (!token || token.length < 32) {
    return response(503, { error: "cleanup_unavailable" });
  }
  const authorization = req.headers.get("Authorization") ?? "";
  if (!constantTimeEqual(authorization, `Bearer ${token}`)) {
    return response(401, { error: "unauthorized" });
  }

  try {
    const rpc = createRpc(deps);
    const claimed = await rpc("claim_expired_recipe_image_uploads", {
      p_limit: 25,
    });
    if (claimed.error || !Array.isArray(claimed.data)) {
      throw new Error("Cleanup claim failed.");
    }
    let cleaned = 0;
    let failed = 0;
    const items = claimed.data as CleanupItem[];
    for (let offset = 0; offset < items.length; offset += 5) {
      const outcomes = await Promise.all(
        items.slice(offset, offset + 5).map(async (item) => {
          if (!UUID.test(item.id) || !STAGING_KEY.test(item.staging_key)) {
            throw new Error("Invalid cleanup item.");
          }
          const outcome = await deleteStagingObject(item.staging_key, deps);
          const succeeded = outcome === "deleted" || outcome === "missing";
          const finished = await rpc("finish_recipe_image_upload_cleanup", {
            p_id: item.id,
            p_success: succeeded,
            p_failure: succeeded ? null : outcome,
          });
          if (
            finished.error ||
            (succeeded && finished.data !== "complete") ||
            (!succeeded && finished.data !== "retry" &&
              finished.data !== "failed")
          ) {
            throw new Error("Cleanup result persistence failed.");
          }
          return succeeded;
        }),
      );
      cleaned += outcomes.filter(Boolean).length;
      failed += outcomes.filter((outcome) => !outcome).length;
    }
    const health = await rpc("recipe_image_upload_cleanup_health", {});
    if (health.error || !health.data || typeof health.data !== "object") {
      throw new Error("Cleanup health check failed.");
    }
    const result = health.data as { pending: number; failed: number };
    if (!Number.isInteger(result.pending) || !Number.isInteger(result.failed)) {
      throw new Error("Cleanup health response is invalid.");
    }
    if (failed > 0 || result.failed > 0 || result.pending > 0) {
      console.error("Recipe image cleanup requires attention");
      return response(503, {
        processed: claimed.data.length,
        cleaned,
        pending: result.pending,
        failures: failed + result.failed,
      });
    }
    return response(200, {
      processed: claimed.data.length,
      cleaned,
      pending: result.pending,
    });
  } catch {
    console.error("Recipe image cleanup failed");
    return response(500, { error: "cleanup_failed" });
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
