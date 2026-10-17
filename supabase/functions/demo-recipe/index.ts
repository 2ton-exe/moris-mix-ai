import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { DemoRecipeResponseSchema } from "../_shared/schemas.ts";

const DEMO_RECIPE_ID = "11111111-1111-1111-1111-111111111111";
const DEMO_USER_ID = "d0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f";

export type DemoRecipeHandlerDeps = {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  fetch?: typeof fetch;
};

export async function handler(
  req: Request,
  deps?: DemoRecipeHandlerDeps,
): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return handleCorsPreflight();
    }

    if (req.method !== "GET") {
      return jsonResponse(
        {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Only GET and OPTIONS methods are supported."
          }
        },
        {
          status: 405,
          headers: {
            Allow: "GET, OPTIONS"
          }
        }
      );
    }

    const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = deps?.supabaseServiceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("Missing required Supabase configuration");
      return jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error."
          }
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      ...(deps?.fetch ? { global: { fetch: deps.fetch } } : {})
    });

    const { data, error } = await supabase
      .from("recipes")
      .select("id, title, ingredients, instructions, flavor_scores, star_rating, cooked_at")
      .eq("id", DEMO_RECIPE_ID)
      .eq("user_id", DEMO_USER_ID)
      .eq("is_public", true)
      .maybeSingle();

    if (error) {
      console.error("Database query failed", error.code ? `code: ${error.code}` : "");
      return jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error."
          }
        },
        { status: 500 }
      );
    }

    if (!data || data.id !== DEMO_RECIPE_ID) {
      return jsonResponse(
        {
          error: {
            code: "DEMO_RECIPE_NOT_FOUND",
            message: "Demo recipe is unavailable."
          }
        },
        { status: 404 }
      );
    }

    const validation = DemoRecipeResponseSchema.safeParse({ recipe: data });
    if (!validation.success) {
      const invalidPaths = validation.error.issues.map((issue) => issue.path.join(".")).join(", ");
      console.error("Recipe schema validation failed on paths:", invalidPaths);
      return jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error."
          }
        },
        { status: 500 }
      );
    }

    return jsonResponse(validation.data, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300"
      }
    });
  } catch (_error) {
    console.error("Unhandled exception in demo-recipe handler");
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error."
        }
      },
      { status: 500 }
    );
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
