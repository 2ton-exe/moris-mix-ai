import { type AuthDeps, authenticateRequest } from "../_shared/auth.ts";
import {
  getCorsHeaders,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/cors.ts";

const METHODS = "GET, OPTIONS";
const PAGE_SIZE = 100;
const MAX_ROWS = 10000;
const MAX_BYTES = 10 * 1024 * 1024;
const RECIPE_FIELDS =
  "id,user_id,title,raw_input,ingredients,instructions,flavor_scores,star_rating,cooked_at,notes,is_public,created_at,updated_at";

function failure(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, {
    status,
    headers: { ...getCorsHeaders(METHODS), "Cache-Control": "no-store" },
  });
}

export async function handler(
  req: Request,
  deps: AuthDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCorsPreflight(METHODS);
  if (req.method !== "GET") {
    return failure(
      "METHOD_NOT_ALLOWED",
      "Only GET and OPTIONS are supported.",
      405,
    );
  }
  try {
    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      const headers = new Headers(auth.response.headers);
      Object.entries(getCorsHeaders(METHODS)).forEach(([name, value]) =>
        headers.set(name, value)
      );
      headers.set("Cache-Control", "no-store");
      return new Response(auth.response.body, {
        status: auth.response.status,
        headers,
      });
    }
    if (new URL(req.url).search) {
      return failure(
        "VALIDATION_ERROR",
        "Query parameters are not supported.",
        400,
      );
    }
    const { supabase, user } = auth.context;
    const recipes: Record<string, unknown>[] = [];
    const lineage: Record<string, unknown>[] = [];
    const encoder = new TextEncoder();
    let bytes = 0;
    for (let offset = 0; offset <= MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await supabase.from("recipes").select(
        RECIPE_FIELDS,
      )
        .eq("user_id", user.id).order("id").range(
          offset,
          offset + PAGE_SIZE - 1,
        );
      if (
        error || !Array.isArray(data) ||
        data.some((row) => row.user_id !== user.id)
      ) throw new Error();
      bytes += encoder.encode(JSON.stringify(data)).byteLength;
      if (offset + data.length > MAX_ROWS || bytes > MAX_BYTES) {
        return failure(
          "EXPORT_TOO_LARGE",
          "Export exceeds the supported limit.",
          413,
        );
      }
      recipes.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    const ids = new Set(recipes.map((recipe) => recipe.id));
    for (let offset = 0; ids.size && offset <= MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await supabase.from("recipe_lineage")
        .select("id,parent_recipe_id,child_recipe_id,created_at").order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !Array.isArray(data)) throw new Error();
      bytes += encoder.encode(JSON.stringify(data)).byteLength;
      if (offset + data.length > MAX_ROWS || bytes > MAX_BYTES) {
        return failure(
          "EXPORT_TOO_LARGE",
          "Export exceeds the supported limit.",
          413,
        );
      }
      lineage.push(
        ...data.filter((row) =>
          ids.has(row.parent_recipe_id) && ids.has(row.child_recipe_id)
        ),
      );
      if (data.length < PAGE_SIZE) break;
    }
    const body = JSON.stringify({
      version: 1,
      exported_at: new Date().toISOString(),
      recipes,
      lineage,
    });
    if (encoder.encode(body).byteLength > MAX_BYTES) {
      return failure(
        "EXPORT_TOO_LARGE",
        "Export exceeds the supported limit.",
        413,
      );
    }
    return new Response(body, {
      headers: {
        ...getCorsHeaders(METHODS),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="recipe-data.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return failure(
      "EXPORT_UNAVAILABLE",
      "Recipe data export is temporarily unavailable.",
      503,
    );
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
