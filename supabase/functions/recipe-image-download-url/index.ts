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
  RecipeImageDownloadResponseSchema,
  RecipeImageRecipeRequestSchema,
} from "../_shared/recipe-images/schemas.ts";
import {
  type R2Config,
  resolveR2Config,
  signRecipeImageFinalGet,
} from "../_shared/recipe-images/r2.ts";

const METHODS = "POST, OPTIONS";
const FINAL_KEY =
  /^recipe-images\/final\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type DownloadDeps = AuthDeps & LifecycleDeps & {
  r2Config?: R2Config;
  now?: () => Date;
  signGet?: typeof signRecipeImageFinalGet;
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

export async function handler(
  req: Request,
  deps: DownloadDeps = {},
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failure(
      "INVALID_JSON",
      "Request body must be a valid JSON object.",
      400,
    );
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return failure(
      "INVALID_JSON",
      "Request body must be a valid JSON object.",
      400,
    );
  }
  const parsed = RecipeImageRecipeRequestSchema.safeParse(body);
  if (!parsed.success || new URL(req.url).search !== "") {
    return failure("VALIDATION_ERROR", "Invalid recipe image request.", 400);
  }
  try {
    const recipeId = parsed.data.recipe_id.toLowerCase();
    const { data: recipe, error } = await auth.context.supabase.from("recipes")
      .select("id,user_id").eq("id", recipeId).eq(
        "user_id",
        auth.context.user.id,
      ).maybeSingle();
    if (error) throw new Error("Recipe lookup failed.");
    if (
      !recipe || recipe.id !== recipeId ||
      recipe.user_id !== auth.context.user.id
    ) return failure("RECIPE_NOT_FOUND", "Recipe not found.", 404);
    const resolved = await createLifecycleRpc(deps)(
      "resolve_recipe_image_download",
      { p_user_id: auth.context.user.id, p_recipe_id: recipeId },
    );
    if (
      resolved.error || !isRecord(resolved.data) ||
      typeof resolved.data.status !== "string"
    ) throw new Error("Recipe image resolution failed.");
    if (
      resolved.data.status !== "found" ||
      typeof resolved.data.object_key !== "string" ||
      typeof resolved.data.content_type !== "string" ||
      !["image/jpeg", "image/png", "image/webp"].includes(
        resolved.data.content_type,
      ) ||
      !FINAL_KEY.test(resolved.data.object_key)
    ) return failure("IMAGE_NOT_FOUND", "Recipe image not found.", 404);
    const now = deps.now?.() ?? new Date();
    const url = await (deps.signGet ?? signRecipeImageFinalGet)(
      resolved.data.object_key,
      resolved.data.content_type,
      resolveR2Config(deps.r2Config),
      now,
    );
    const result = RecipeImageDownloadResponseSchema.safeParse({
      url,
      expires_at: new Date(Math.floor(now.getTime() / 1000) * 1000 + 60_000)
        .toISOString(),
    });
    if (!result.success) throw new Error("Signed URL response is invalid.");
    return respond(result.data, 200);
  } catch {
    return failure("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
