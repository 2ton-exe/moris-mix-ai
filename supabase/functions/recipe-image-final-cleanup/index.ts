import {
  createLifecycleRpc,
  isRecord,
  type LifecycleDeps,
} from "../_shared/recipe-images/lifecycle.ts";
import {
  deleteRecipeImageFinalObject,
  type R2Config,
  resolveR2Config,
} from "../_shared/recipe-images/r2.ts";

const encoder = new TextEncoder();
export type FinalCleanupDeps = LifecycleDeps & {
  cleanupToken?: string;
  r2Config?: R2Config;
  r2Fetch?: typeof fetch;
};

function equalSecret(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
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

export async function handler(
  req: Request,
  deps: FinalCleanupDeps = {},
): Promise<Response> {
  if (req.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }
  const token = deps.cleanupToken ??
    Deno.env.get("RECIPE_IMAGE_FINAL_CLEANUP_TOKEN");
  if (!token || token.length < 32) {
    return response(503, { error: "cleanup_unavailable" });
  }
  if (!equalSecret(req.headers.get("Authorization") ?? "", `Bearer ${token}`)) {
    return response(401, { error: "unauthorized" });
  }
  try {
    const rpc = createLifecycleRpc(deps);
    const claimed = await rpc("claim_recipe_image_final_cleanup", {
      p_limit: 25,
    });
    if (claimed.error || !Array.isArray(claimed.data)) {
      throw new Error("Final cleanup claim failed.");
    }
    let cleaned = 0;
    let failed = 0;
    for (let offset = 0; offset < claimed.data.length; offset += 5) {
      const outcomes = await Promise.all(
        claimed.data.slice(offset, offset + 5).map(async (item: unknown) => {
          if (
            !isRecord(item) || typeof item.object_key !== "string" ||
            typeof item.lease_token !== "string"
          ) throw new Error("Invalid cleanup claim.");
          let failure = "r2_rejected";
          let succeeded = false;
          try {
            const outcome = await deleteRecipeImageFinalObject(
              item.object_key,
              resolveR2Config(deps.r2Config),
              deps.r2Fetch ?? fetch,
            );
            succeeded = outcome === "deleted" || outcome === "missing";
            if (outcome === "failed") failure = "r2_rejected";
          } catch (error) {
            failure =
              error instanceof Error && /configuration/i.test(error.message)
                ? "configuration"
                : "network";
          }
          const finished = await rpc("finish_recipe_image_final_cleanup", {
            p_object_key: item.object_key,
            p_lease_token: item.lease_token,
            p_success: succeeded,
            p_failure: succeeded ? null : failure,
          });
          if (
            finished.error || (succeeded && finished.data !== "complete" &&
              finished.data !== "watching") ||
            (!succeeded && finished.data !== "retry" &&
              finished.data !== "failed" && finished.data !== "watching")
          ) throw new Error("Final cleanup result persistence failed.");
          return succeeded;
        }),
      );
      cleaned += outcomes.filter(Boolean).length;
      failed += outcomes.filter((item) => !item).length;
    }
    return response(failed ? 503 : 200, {
      processed: claimed.data.length,
      cleaned,
      failed,
    });
  } catch {
    console.error("Recipe finalized image cleanup failed");
    return response(500, { error: "cleanup_failed" });
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
