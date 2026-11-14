import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import {
  type R2Config,
  resolveR2Config,
  signRecipeImageStagingDelete,
  signRecipeImageStagingList,
} from "./r2.ts";

const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGING_KEY =
  /^recipe-images\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LISTING_BYTES = 32_768;
const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

type CleanupItem = { id: string; staging_key: string };
type ReconciliationItem = { staging_key: string };
type StagingListing = {
  keys: string[];
  hasMore: boolean;
  nextToken: string | null;
};
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
  listObjects?: (
    continuationToken: string | null,
  ) => Promise<StagingListing | CleanupFailure>;
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
  return async (name: string, args: Record<string, unknown>) =>
    await client.rpc(name, args);
}

function decodeXmlText(value: string): string | null {
  let invalid = false;
  const decoded = value.replace(/&([^;]+);/g, (_entity, name: string) => {
    if (Object.hasOwn(XML_ENTITIES, name)) return XML_ENTITIES[name];
    const numeric = name.startsWith("#x") || name.startsWith("#X")
      ? Number.parseInt(name.slice(2), 16)
      : name.startsWith("#")
      ? Number.parseInt(name.slice(1), 10)
      : Number.NaN;
    if (
      Number.isInteger(numeric) && numeric > 0 && numeric <= 0x10ffff &&
      !(numeric >= 0xd800 && numeric <= 0xdfff)
    ) return String.fromCodePoint(numeric);
    invalid = true;
    return "";
  });
  return invalid ? null : decoded;
}

function parseStagingListing(xml: string): StagingListing | null {
  if (!/<(?:[A-Za-z0-9_]+:)?ListBucketResult(?:\s|>)/.test(xml)) return null;
  const truncatedValues = [...xml.matchAll(
    /<(?:[A-Za-z0-9_]+:)?IsTruncated>(true|false)<\/(?:[A-Za-z0-9_]+:)?IsTruncated>/g,
  )];
  if (truncatedValues.length !== 1) return null;
  const hasMore = truncatedValues[0][1] === "true";
  const tokenValues = [...xml.matchAll(
    /<(?:[A-Za-z0-9_]+:)?NextContinuationToken>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?NextContinuationToken>/g,
  )];
  if (tokenValues.length > 1) return null;
  const nextToken = tokenValues.length === 1
    ? decodeXmlText(tokenValues[0][1])
    : null;
  if (
    (hasMore && (!nextToken || nextToken.length > 4096)) ||
    (!hasMore && nextToken !== null)
  ) return null;
  const keys: string[] = [];
  for (
    const content of xml.matchAll(
      /<(?:[A-Za-z0-9_]+:)?Contents(?:\s|>)((?:(?!<(?:[A-Za-z0-9_]+:)?Contents(?:\s|>))[\s\S])*?)<\/(?:[A-Za-z0-9_]+:)?Contents>/g,
    )
  ) {
    const keyValue = content[1].match(
      /<(?:[A-Za-z0-9_]+:)?Key>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?Key>/,
    )?.[1];
    if (keyValue === undefined) return null;
    const key = decodeXmlText(keyValue);
    if (key === null) return null;
    if (STAGING_KEY.test(key)) keys.push(key);
  }
  if (keys.length > 25) return null;
  return { keys, hasMore, nextToken };
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

async function listStagingObjects(
  continuationToken: string | null,
  deps: UploadCleanupDeps,
): Promise<StagingListing | CleanupFailure> {
  if (deps.listObjects) return await deps.listObjects(continuationToken);
  let config: R2Config;
  try {
    config = resolveR2Config(deps.r2Config);
  } catch {
    return "configuration";
  }
  try {
    const url = await signRecipeImageStagingList(continuationToken, config);
    const result = await (deps.fetch ?? fetch)(url, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) {
      return result.status >= 500 ? "r2_unavailable" : "r2_rejected";
    }
    if (!result.body) return "unexpected";
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_LISTING_BYTES) {
        await reader.cancel();
        return "unexpected";
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const listing = parseStagingListing(new TextDecoder().decode(body));
    return listing ?? "unexpected";
  } catch {
    return "network";
  }
}

async function reconcileStagingPage(
  rpc: NonNullable<UploadCleanupDeps["rpc"]>,
  deps: UploadCleanupDeps,
): Promise<number> {
  const leaseId = crypto.randomUUID();
  const claimedPage = await rpc(
    "claim_recipe_image_staging_reconciliation_page",
    { p_lease_id: leaseId },
  );
  if (claimedPage.error || !Array.isArray(claimedPage.data)) {
    throw new Error("Reconciliation page claim failed.");
  }
  if (claimedPage.data.length === 0) return 0;
  if (claimedPage.data.length !== 1) {
    throw new Error("Reconciliation page claim is invalid.");
  }
  const continuationToken =
    (claimedPage.data[0] as { continuation_token: string | null })
      .continuation_token;
  if (continuationToken !== null && typeof continuationToken !== "string") {
    throw new Error("Reconciliation page cursor is invalid.");
  }
  const listing = await listStagingObjects(continuationToken, deps);
  if (typeof listing === "string") {
    const finished = await rpc(
      "finish_recipe_image_staging_reconciliation_page",
      {
        p_lease_id: leaseId,
        p_next_token: null,
        p_has_more: false,
        p_failure: listing,
      },
    );
    if (
      finished.error ||
      (finished.data !== "retry" && finished.data !== "failed")
    ) {
      throw new Error("Reconciliation failure persistence failed.");
    }
    return 1;
  }
  if (listing.hasMore && listing.nextToken === continuationToken) {
    const finished = await rpc(
      "finish_recipe_image_staging_reconciliation_page",
      {
        p_lease_id: leaseId,
        p_next_token: null,
        p_has_more: false,
        p_failure: "unexpected",
      },
    );
    if (
      finished.error ||
      (finished.data !== "retry" && finished.data !== "failed")
    ) {
      throw new Error("R2 reconciliation cursor failure persistence failed.");
    }
    return 1;
  }

  const candidates = await rpc(
    "claim_recipe_image_staging_reconciliation_objects",
    { p_page_lease_id: leaseId, p_staging_keys: listing.keys },
  );
  if (candidates.error || !Array.isArray(candidates.data)) {
    throw new Error("Reconciliation object claim failed.");
  }
  let failed = 0;
  const items = candidates.data as ReconciliationItem[];
  for (let offset = 0; offset < items.length; offset += 5) {
    const outcomes = await Promise.all(
      items.slice(offset, offset + 5).map(async (item) => {
        if (!STAGING_KEY.test(item.staging_key)) {
          throw new Error("Invalid reconciliation object.");
        }
        const outcome = await deleteStagingObject(item.staging_key, deps);
        const succeeded = outcome === "deleted" || outcome === "missing";
        const finished = await rpc(
          "finish_recipe_image_staging_reconciliation_object",
          {
            p_page_lease_id: leaseId,
            p_staging_key: item.staging_key,
            p_success: succeeded,
            p_failure: succeeded ? null : outcome,
          },
        );
        if (
          finished.error ||
          (succeeded && finished.data !== "complete") ||
          (!succeeded && finished.data !== "retry" &&
            finished.data !== "failed")
        ) {
          throw new Error("Reconciliation result persistence failed.");
        }
        return succeeded;
      }),
    );
    failed += outcomes.filter((outcome) => !outcome).length;
  }

  const finishedPage = await rpc(
    "finish_recipe_image_staging_reconciliation_page",
    {
      p_lease_id: leaseId,
      p_next_token: listing.nextToken,
      p_has_more: listing.hasMore,
      p_failure: null,
    },
  );
  if (finishedPage.error || finishedPage.data !== "complete") {
    throw new Error("Reconciliation page progress persistence failed.");
  }
  return failed;
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
    const reconciliationFailures = await reconcileStagingPage(rpc, deps);
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
    const reconciliationHealth = await rpc(
      "recipe_image_staging_reconciliation_health",
      {},
    );
    if (
      reconciliationHealth.error || !reconciliationHealth.data ||
      typeof reconciliationHealth.data !== "object"
    ) {
      throw new Error("Reconciliation health check failed.");
    }
    const reconciliationResult = reconciliationHealth.data as {
      pending: number;
      failed: number;
    };
    if (
      !Number.isInteger(reconciliationResult.pending) ||
      !Number.isInteger(reconciliationResult.failed)
    ) {
      throw new Error("Reconciliation health response is invalid.");
    }
    const pending = result.pending + reconciliationResult.pending;
    const failures = failed + result.failed + reconciliationFailures +
      reconciliationResult.failed;
    if (failures > 0 || pending > 0) {
      console.error("Recipe image cleanup requires attention");
      return response(503, {
        processed: claimed.data.length,
        cleaned,
        pending,
        failures,
      });
    }
    return response(200, {
      processed: claimed.data.length,
      cleaned,
      pending,
    });
  } catch {
    console.error("Recipe image cleanup failed");
    return response(500, { error: "cleanup_failed" });
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
