import { type AuthDeps, authenticateRequest } from "../_shared/auth.ts";
import {
  getCorsHeaders,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/cors.ts";
import { RecipeImageUploadRequestSchema } from "../_shared/recipe-images/schemas.ts";
import {
  type R2Config,
  resolveR2Config,
  signRecipeImageUpload,
} from "../_shared/recipe-images/r2.ts";
import {
  createUploadIntent,
  persistUploadIntent,
} from "../_shared/recipe-images/uploadIntents.ts";

const ALLOWED_METHODS = "POST, OPTIONS";

export type UploadHandlerDeps = AuthDeps & {
  r2Config?: R2Config;
  supabaseServiceRoleKey?: string;
  now?: () => Date;
  signUpload?: typeof signRecipeImageUpload;
};

function respond(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(body, {
    status,
    headers: { ...getCorsHeaders(ALLOWED_METHODS), ...headers },
  });
}

function error(code: string, message: string, status: number): Response {
  return respond({ error: { code, message } }, status);
}

export async function handler(
  req: Request,
  deps: UploadHandlerDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCorsPreflight(ALLOWED_METHODS);
  if (req.method !== "POST") {
    return respond(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only POST and OPTIONS methods are supported.",
        },
      },
      405,
      { Allow: ALLOWED_METHODS },
    );
  }
  try {
    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      if (auth.response.status === 401) {
        return error(
          "UNAUTHORIZED",
          "Missing or invalid authentication credentials.",
          401,
        );
      }
      const headers = new Headers(auth.response.headers);
      Object.entries(getCorsHeaders(ALLOWED_METHODS)).forEach(([key, value]) =>
        headers.set(key, value)
      );
      return new Response(auth.response.body, {
        status: auth.response.status,
        headers,
      });
    }
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return error(
        "INVALID_JSON",
        "Request body must be a valid JSON object.",
        400,
      );
    }
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      return error(
        "INVALID_JSON",
        "Request body must be a valid JSON object.",
        400,
      );
    }
    const validation = RecipeImageUploadRequestSchema.safeParse(parsed);
    if (!validation.success || new URL(req.url).search !== "") {
      return error("VALIDATION_ERROR", "Invalid recipe image request.", 400);
    }
    const { user, supabase } = auth.context;
    const request = {
      ...validation.data,
      recipe_id: validation.data.recipe_id.toLowerCase(),
    };
    const { data, error: queryError } = await supabase.from("recipes")
      .select("id, user_id")
      .eq("id", request.recipe_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (queryError) throw new Error("Recipe ownership lookup failed.");
    if (!data || data.id !== request.recipe_id || data.user_id !== user.id) {
      return error("RECIPE_NOT_FOUND", "Recipe not found.", 404);
    }
    const config = resolveR2Config(deps.r2Config);
    const intent = createUploadIntent(request, user.id, deps.now?.());
    const upload = await (deps.signUpload ?? signRecipeImageUpload)(
      intent,
      config,
    );
    await persistUploadIntent(intent, deps);
    return respond({ upload }, 200);
  } catch {
    console.error("Recipe image upload signing failed");
    return error("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
