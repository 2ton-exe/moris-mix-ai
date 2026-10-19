import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

export type AuthSessionHandlerDeps = AuthDeps;

export async function handler(
  req: Request,
  deps?: AuthSessionHandlerDeps,
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
            message: "Only GET and OPTIONS methods are supported.",
          },
        },
        {
          status: 405,
          headers: {
            Allow: "GET, OPTIONS",
          },
        },
      );
    }

    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      return auth.response;
    }

    const { user, supabase } = auth.context;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Database query failed", error.code ? `code: ${error.code}` : "");
      return jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        },
        { status: 500 },
      );
    }

    if (profile && profile.id !== user.id) {
      console.error("Profile ownership mismatch detected");
      return jsonResponse(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        },
        { status: 500 },
      );
    }

    return jsonResponse(
      {
        user: {
          id: user.id,
          email: user.email,
          display_name: typeof profile?.display_name === "string" ? profile.display_name : null,
          avatar_url: typeof profile?.avatar_url === "string" ? profile.avatar_url : null,
        },
      },
      { status: 200 },
    );
  } catch {
    console.error("Unhandled exception in auth-session handler");
    return jsonResponse(
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
