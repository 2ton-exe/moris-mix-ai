import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { CreateRecipeRequestSchema, RecipeResponseSchema } from "../_shared/schemas.ts";

export type RecipesHandlerDeps = AuthDeps;

const ALLOWED_METHODS = "POST, OPTIONS";

const VALID_ROUTE_PATHS = new Set([
  "/",
  "/recipes",
  "/recipes/",
  "/functions/v1/recipes",
  "/functions/v1/recipes/",
]);

function recipesJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  return jsonResponse(body, {
    ...init,
    headers,
  });
}

function withRecipesCorsMethods(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handler(
  req: Request,
  deps?: RecipesHandlerDeps,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    if (!VALID_ROUTE_PATHS.has(url.pathname)) {
      return recipesJsonResponse(
        {
          error: {
            code: "NOT_FOUND",
            message: "Route not found.",
          },
        },
        { status: 404 },
      );
    }

    if (req.method === "OPTIONS") {
      return handleCorsPreflight(ALLOWED_METHODS);
    }

    if (req.method !== "POST") {
      return recipesJsonResponse(
        {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Only POST and OPTIONS methods are supported.",
          },
        },
        {
          status: 405,
          headers: {
            Allow: ALLOWED_METHODS,
          },
        },
      );
    }

    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      return withRecipesCorsMethods(auth.response);
    }

    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return recipesJsonResponse(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be a valid JSON object.",
          },
        },
        { status: 400 },
      );
    }

    if (!rawBody || rawBody.trim().length === 0) {
      return recipesJsonResponse(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be a valid JSON object.",
          },
        },
        { status: 400 },
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return recipesJsonResponse(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be a valid JSON object.",
          },
        },
        { status: 400 },
      );
    }

    if (!isPlainObject(parsedBody)) {
      return recipesJsonResponse(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be a valid JSON object.",
          },
        },
        { status: 400 },
      );
    }

    const validation = CreateRecipeRequestSchema.safeParse(parsedBody);
    if (!validation.success) {
      const details = validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      }));
      return recipesJsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid recipe payload.",
            details,
          },
        },
        { status: 400 },
      );
    }

    const { user, supabase } = auth.context;
    const validated = validation.data;

    const insertPayload = {
      user_id: user.id,
      title: validated.title,
      raw_input: validated.raw_input ?? null,
      ingredients: validated.ingredients,
      instructions: validated.instructions,
      flavor_scores: validated.flavor_scores ?? null,
      star_rating: validated.star_rating ?? null,
      cooked_at: validated.cooked_at ?? null,
      is_public: false,
    };

    const { data, error } = await supabase
      .from("recipes")
      .insert(insertPayload)
      .select(
        "id, user_id, title, raw_input, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at",
      )
      .single();

    if (error || !data) {
      console.error("Database insert failed", error?.code ? `code: ${error.code}` : "");
      return recipesJsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        },
        { status: 500 },
      );
    }

    if (data.user_id !== user.id) {
      console.error("Recipe ownership mismatch detected");
      return recipesJsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        },
        { status: 500 },
      );
    }

    const responseValidation = RecipeResponseSchema.safeParse({ recipe: data });
    if (!responseValidation.success) {
      const invalidPaths = responseValidation.error.issues.map((issue) => issue.path.join(".")).join(", ");
      console.error("Recipe response validation failed on paths:", invalidPaths);
      return recipesJsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        },
        { status: 500 },
      );
    }

    return recipesJsonResponse(responseValidation.data, { status: 201 });
  } catch {
    console.error("Unhandled exception in recipes handler");
    return recipesJsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error.",
        },
      },
      { status: 500 },
    );
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
