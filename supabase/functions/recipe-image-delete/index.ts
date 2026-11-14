import { type AuthDeps, authenticateRequest } from "../_shared/auth.ts";
import {
  getCorsHeaders,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  createLifecycleRpc,
  type LifecycleDeps,
} from "../_shared/recipe-images/lifecycle.ts";
import { RecipeImageRecipeRequestSchema } from "../_shared/recipe-images/schemas.ts";

const METHODS = "POST, OPTIONS";
export type DeleteDeps = AuthDeps & LifecycleDeps;

function respond(body: unknown, status: number): Response {
  return jsonResponse(body, {
    status,
    headers: {
      ...getCorsHeaders(METHODS),
      ...(status === 405 ? { Allow: METHODS } : {}),
    },
  });
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
  deps: DeleteDeps = {},
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
    const result = await createLifecycleRpc(deps)(
      "delete_recipe_image_association",
      { p_user_id: auth.context.user.id, p_recipe_id: recipeId },
    );
    if (result.error) throw new Error("Recipe image deletion failed.");
    if (result.data === "not_found") {
      return failure("RECIPE_NOT_FOUND", "Recipe not found.", 404);
    }
    if (result.data !== "deleted") {
      throw new Error("Recipe image deletion result is invalid.");
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...getCorsHeaders(METHODS),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return failure("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
