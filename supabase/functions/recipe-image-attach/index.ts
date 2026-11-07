import { type AuthDeps, authenticateRequest } from "../_shared/auth.ts";
import {
  getCorsHeaders,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  createLifecycleRpc,
  isRecord,
  type LifecycleDeps,
} from "../_shared/recipe-images/lifecycle.ts";
import {
  RecipeImageAttachRequestSchema,
  RecipeImageMetadataSchema,
} from "../_shared/recipe-images/schemas.ts";
import {
  copyVerifiedRecipeImage,
  type R2Config,
  readAndVerifyRecipeImage,
  resolveR2Config,
} from "../_shared/recipe-images/r2.ts";

const METHODS = "POST, OPTIONS";
const FINAL_KEY =
  /^recipe-images\/final\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
export type AttachDeps = AuthDeps & LifecycleDeps & {
  r2Config?: R2Config;
  r2Fetch?: typeof fetch;
  now?: () => Date;
};

function respond(body: unknown, status: number): Response {
  return jsonResponse(body, { status, headers: getCorsHeaders(METHODS) });
}
function failure(code: string, message: string, status: number): Response {
  return respond({ error: { code, message } }, status);
}
function authFailure(response: Response): Response {
  if (response.status === 401) {
    return failure(
      "UNAUTHORIZED",
      "Missing or invalid authentication credentials.",
      401,
    );
  }
  const headers = new Headers(response.headers);
  Object.entries(getCorsHeaders(METHODS)).forEach(([key, value]) =>
    headers.set(key, value)
  );
  return new Response(response.body, { status: response.status, headers });
}
async function readBody(req: Request): Promise<unknown | null> {
  try {
    const body = await req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : null;
  } catch {
    return null;
  }
}

export async function handler(
  req: Request,
  deps: AttachDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCorsPreflight(METHODS);
  if (req.method !== "POST") {
    return respond({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Only POST and OPTIONS methods are supported.",
      },
    }, 405);
  }
  const auth = await authenticateRequest(req, deps);
  if (!auth.ok) {
    return authFailure(auth.response);
  }
  const body = await readBody(req);
  if (!body) {
    return failure(
      "INVALID_JSON",
      "Request body must be a valid JSON object.",
      400,
    );
  }
  const parsed = RecipeImageAttachRequestSchema.safeParse(body);
  if (!parsed.success || new URL(req.url).search !== "") {
    return failure("VALIDATION_ERROR", "Invalid recipe image request.", 400);
  }
  const recipeId = parsed.data.recipe_id.toLowerCase();
  const uploadId = parsed.data.upload_id.toLowerCase();
  try {
    const { data: recipe, error: recipeError } = await auth.context.supabase
      .from("recipes").select("id,user_id").eq("id", recipeId).eq(
        "user_id",
        auth.context.user.id,
      ).maybeSingle();
    if (recipeError) throw new Error("Recipe lookup failed.");
    if (
      !recipe || recipe.id !== recipeId ||
      recipe.user_id !== auth.context.user.id
    ) return failure("RECIPE_NOT_FOUND", "Recipe not found.", 404);
    const rpc = createLifecycleRpc(deps);
    const attemptToken = crypto.randomUUID();
    const claimed = await rpc("claim_recipe_image_finalization", {
      p_user_id: auth.context.user.id,
      p_recipe_id: recipeId,
      p_upload_id: uploadId,
      p_attempt_token: attemptToken,
    });
    if (
      claimed.error || !isRecord(claimed.data) ||
      typeof claimed.data.status !== "string"
    ) throw new Error("Finalization claim failed.");
    if (claimed.data.status === "not_found") {
      return failure("UPLOAD_NOT_FOUND", "Upload not found.", 404);
    }
    if (claimed.data.status === "conflict") {
      return failure("UPLOAD_NOT_READY", "Upload is not ready to attach.", 409);
    }
    if (claimed.data.status === "attached") {
      const metadata = RecipeImageMetadataSchema.safeParse({
        recipe_id: recipeId,
        content_type: claimed.data.content_type,
        byte_size: claimed.data.byte_size,
        uploaded_at: claimed.data.uploaded_at,
      });
      if (!metadata.success) {
        throw new Error("Stored attachment result is invalid.");
      }
      return respond({ image: metadata.data }, 200);
    }
    if (
      claimed.data.status !== "claimed" ||
      typeof claimed.data.staging_key !== "string" ||
      typeof claimed.data.object_key !== "string" ||
      !FINAL_KEY.test(claimed.data.object_key) ||
      typeof claimed.data.content_type !== "string" ||
      typeof claimed.data.byte_size !== "number"
    ) throw new Error("Finalization claim is invalid.");
    let released = false;
    let copyOutcome: "not_started" | "complete" | "uncertain" = "not_started";
    const release = async () => {
      if (released) return;
      released = true;
      await rpc("release_recipe_image_finalization", {
        p_upload_id: uploadId,
        p_attempt_token: attemptToken,
        p_copy_outcome: copyOutcome,
      });
    };
    try {
      const r2Config = resolveR2Config(deps.r2Config);
      const stored = await readAndVerifyRecipeImage(
        claimed.data.staging_key,
        claimed.data.content_type,
        claimed.data.byte_size,
        r2Config,
        deps.r2Fetch ?? fetch,
      );
      if (!stored) {
        await release();
        return failure("UPLOAD_NOT_FOUND", "Uploaded image not found.", 404);
      }
      const copyClaim = await rpc("start_recipe_image_final_copy", {
        p_upload_id: uploadId,
        p_attempt_token: attemptToken,
      });
      if (copyClaim.error || copyClaim.data !== "started") {
        await release();
        return failure(
          "UPLOAD_NOT_READY",
          "Upload is not ready to attach.",
          409,
        );
      }
      copyOutcome = "uncertain";
      const copied = await copyVerifiedRecipeImage(
        claimed.data.staging_key,
        claimed.data.object_key,
        stored.contentType,
        stored.byteSize,
        stored.etag,
        r2Config,
        deps.r2Fetch ?? fetch,
      );
      copyOutcome = "complete";
      if (!copied) {
        await release();
        return failure(
          "IMAGE_VERIFICATION_FAILED",
          "Uploaded image could not be verified.",
          422,
        );
      }
      const copyVerified = await rpc("finish_recipe_image_final_copy", {
        p_upload_id: uploadId,
        p_attempt_token: attemptToken,
        p_content_type: stored.contentType,
        p_byte_size: stored.byteSize,
      });
      if (copyVerified.error || copyVerified.data !== "verified") {
        await release();
        return failure(
          "UPLOAD_NOT_READY",
          "Upload is not ready to attach.",
          409,
        );
      }
      const committed = await rpc("finish_recipe_image_finalization", {
        p_user_id: auth.context.user.id,
        p_recipe_id: recipeId,
        p_upload_id: uploadId,
        p_attempt_token: attemptToken,
        p_content_type: stored.contentType,
        p_byte_size: stored.byteSize,
      });
      if (
        committed.error || !isRecord(committed.data) ||
        typeof committed.data.status !== "string"
      ) throw new Error("Attachment transaction failed.");
      if (committed.data.status === "stale") {
        await release();
        return failure(
          "UPLOAD_NOT_READY",
          "Upload is not ready to attach.",
          409,
        );
      }
      if (committed.data.status === "not_found") {
        await release();
        return failure("RECIPE_NOT_FOUND", "Recipe not found.", 404);
      }
      const metadata = RecipeImageMetadataSchema.safeParse({
        recipe_id: recipeId,
        content_type: committed.data.content_type,
        byte_size: committed.data.byte_size,
        uploaded_at: committed.data.uploaded_at,
      });
      if (committed.data.status !== "attached" || !metadata.success) {
        throw new Error("Attachment result is invalid.");
      }
      return respond({ image: metadata.data }, 200);
    } catch (error) {
      await release().catch(() => undefined);
      if (
        error instanceof Error &&
        /does not match|structurally invalid|size is invalid|object changed|source changed/i
          .test(error.message)
      ) {
        return failure(
          "IMAGE_VERIFICATION_FAILED",
          "Uploaded image could not be verified.",
          422,
        );
      }
      if (error instanceof Error && /configuration/i.test(error.message)) {
        return failure("INTERNAL_ERROR", "Internal server error.", 500);
      }
      if (
        error instanceof Error &&
        /transaction|database|rpc/i.test(error.message)
      ) {
        return failure("INTERNAL_ERROR", "Internal server error.", 500);
      }
      return failure(
        "STORAGE_UNAVAILABLE",
        "Image storage is temporarily unavailable.",
        503,
      );
    }
  } catch {
    return failure("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
