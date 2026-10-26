import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import {
  CreateRecipeRequestSchema,
  RecipeCursorSchema,
  RecipeListResponseSchema,
  RecipeParamsSchema,
  RecipeResponseSchema,
  UpdateRecipeRequestSchema,
  type RecipeCursor,
} from "../_shared/schemas.ts";

export type RecipesHandlerDeps = AuthDeps;

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const DEFAULT_CURSOR_PAGE_LIMIT = 20;
const MAX_CURSOR_PAGE_LIMIT = 100;
const DEFAULT_OFFSET_PAGE_LIMIT = 1000;
const MAX_OFFSET_PAGE_LIMIT = 1000;

type RouteMatch =
  | { kind: "COLLECTION" }
  | { kind: "MEMBER"; id: string }
  | { kind: "NOT_FOUND" };

function parseRoute(pathname: string): RouteMatch {
  let path = pathname;
  if (path === "/functions/v1/recipes" || path.startsWith("/functions/v1/recipes/")) {
    path = path.slice("/functions/v1/recipes".length);
  } else if (path === "/recipes" || path.startsWith("/recipes/")) {
    path = path.slice("/recipes".length);
  } else if (path !== "/") {
    return { kind: "NOT_FOUND" };
  }

  const parts = path.split("/").filter((segment) => segment.length > 0);
  if (parts.length === 0) {
    return { kind: "COLLECTION" };
  }
  if (parts.length === 1) {
    return { kind: "MEMBER", id: parts[0] };
  }
  return { kind: "NOT_FOUND" };
}

function decodeCursor(encoded: string): { ok: true; cursor: RecipeCursor } | { ok: false } {
  try {
    const raw = atob(encoded);
    const parsed = JSON.parse(raw);
    const validated = RecipeCursorSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false };
    }
    return { ok: true, cursor: validated.data };
  } catch {
    return { ok: false };
  }
}

function encodeCursor(cursor: RecipeCursor): string {
  return btoa(JSON.stringify(cursor));
}

type RecipeListParams =
  | {
      mode: "cursor";
      title: string | null;
      ingredient: string | null;
      sort: "newest" | "rating";
      limit: number;
      cursor: RecipeCursor | null;
    }
  | {
      mode: "offset";
      title: string | null;
      ingredient: string | null;
      sort: "newest" | "rating";
      limit: number;
      offset: number;
    };

type ParseListParamsResult =
  | { ok: true; params: RecipeListParams }
  | { ok: false; errorStatus: number; errorResponse: unknown };

function parseRecipeListParams(url: URL): ParseListParamsResult {
  const sortValues = url.searchParams.getAll("sort");
  if (sortValues.length > 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid sort parameter.",
          details: [{
            path: "sort",
            code: "invalid_value",
            message: "Duplicate sort parameter.",
          }],
        },
      },
    };
  }

  let sort: "newest" | "rating" = "newest";
  if (sortValues.length === 1) {
    if (sortValues[0] !== "newest" && sortValues[0] !== "rating") {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid sort parameter.",
            details: [{
              path: "sort",
              code: "invalid_value",
              message: "Supported sort values are 'newest' and 'rating'.",
            }],
          },
        },
      };
    }
    sort = sortValues[0];
  }

  const titleValues = url.searchParams.getAll("title");
  if (titleValues.length > 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid search parameter.",
          details: [{
            path: "title",
            code: "invalid_value",
            message: "Duplicate title parameter.",
          }],
        },
      },
    };
  }

  let title: string | null = null;
  if (titleValues.length === 1) {
    const trimmed = titleValues[0].trim();
    if (trimmed.length > 0) {
      title = trimmed;
    }
  }

  const ingredientValues = url.searchParams.getAll("ingredient");
  if (ingredientValues.length > 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid search parameter.",
          details: [{
            path: "ingredient",
            code: "invalid_value",
            message: "Duplicate ingredient parameter.",
          }],
        },
      },
    };
  }

  let ingredient: string | null = null;
  if (ingredientValues.length === 1) {
    const trimmed = ingredientValues[0].trim();
    if (trimmed.length > 0) {
      ingredient = trimmed;
    }
  }

  const cursorValues = url.searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid pagination cursor.",
          details: [{
            path: "cursor",
            code: "invalid_value",
            message: "Duplicate cursor parameter.",
          }],
        },
      },
    };
  }

  const offsetValues = url.searchParams.getAll("offset");
  if (offsetValues.length > 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid pagination parameters.",
          details: [{
            path: "offset",
            code: "invalid_value",
            message: "Duplicate offset parameter.",
          }],
        },
      },
    };
  }

  if (cursorValues.length === 1 && offsetValues.length === 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid pagination parameters.",
          details: [{
            path: "query",
            code: "invalid_union",
            message: "Cannot combine cursor and offset pagination.",
          }],
        },
      },
    };
  }

  const limitValues = url.searchParams.getAll("limit");
  if (limitValues.length > 1) {
    return {
      ok: false,
      errorStatus: 400,
      errorResponse: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid pagination parameters.",
          details: [{
            path: "limit",
            code: "invalid_value",
            message: "Duplicate limit parameter.",
          }],
        },
      },
    };
  }

  if (offsetValues.length === 1) {
    if (!/^(0|[1-9]\d*)$/.test(offsetValues[0])) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination parameters.",
            details: [{
              path: "query",
              code: "invalid_value",
              message: "Use limit 1–1000 and a non-negative safe-integer offset.",
            }],
          },
        },
      };
    }
    const offset = Number(offsetValues[0]);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination parameters.",
            details: [{
              path: "query",
              code: "invalid_value",
              message: "Use limit 1–1000 and a non-negative safe-integer offset.",
            }],
          },
        },
      };
    }

    let limit = DEFAULT_OFFSET_PAGE_LIMIT;
    if (limitValues.length === 1) {
      if (!/^(0|[1-9]\d*)$/.test(limitValues[0])) {
        return {
          ok: false,
          errorStatus: 400,
          errorResponse: {
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid pagination parameters.",
              details: [{
                path: "query",
                code: "invalid_value",
                message: "Use limit 1–1000 and a non-negative safe-integer offset.",
              }],
            },
          },
        };
      }
      const limitNum = Number(limitValues[0]);
      if (!Number.isSafeInteger(limitNum) || limitNum < 1 || limitNum > MAX_OFFSET_PAGE_LIMIT) {
        return {
          ok: false,
          errorStatus: 400,
          errorResponse: {
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid pagination parameters.",
              details: [{
                path: "query",
                code: "invalid_value",
                message: "Use limit 1–1000 and a non-negative safe-integer offset.",
              }],
            },
          },
        };
      }
      limit = limitNum;
    }

    if (offset > Number.MAX_SAFE_INTEGER - limit + 1) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination parameters.",
            details: [{
              path: "query",
              code: "invalid_value",
              message: "Use limit 1–1000 and a non-negative safe-integer offset.",
            }],
          },
        },
      };
    }

    return {
      ok: true,
      params: {
        mode: "offset",
        title,
        ingredient,
        sort,
        limit,
        offset,
      },
    };
  }

  let cursor: RecipeCursor | null = null;
  if (cursorValues.length === 1) {
    const decoded = decodeCursor(cursorValues[0]);
    if (!decoded.ok) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination cursor.",
            details: [{
              path: "cursor",
              code: "invalid_value",
              message: "The provided pagination cursor is invalid or malformed.",
            }],
          },
        },
      };
    }

    if (
      decoded.cursor.sort !== sort ||
      (decoded.cursor.title ?? null) !== title ||
      (decoded.cursor.ingredient ?? null) !== ingredient
    ) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination cursor.",
            details: [{
              path: "cursor",
              code: "custom",
              message: "Pagination cursor is incompatible with active search filters or sort mode.",
            }],
          },
        },
      };
    }

    cursor = decoded.cursor;
  }

  let limit = DEFAULT_CURSOR_PAGE_LIMIT;
  if (limitValues.length === 1) {
    if (!/^(0|[1-9]\d*)$/.test(limitValues[0])) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination parameters.",
            details: [{
              path: "query",
              code: "invalid_value",
              message: "Use limit 1–100.",
            }],
          },
        },
      };
    }
    const limitNum = Number(limitValues[0]);
    if (!Number.isSafeInteger(limitNum) || limitNum < 1 || limitNum > MAX_CURSOR_PAGE_LIMIT) {
      return {
        ok: false,
        errorStatus: 400,
        errorResponse: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid pagination parameters.",
            details: [{
              path: "query",
              code: "invalid_value",
              message: "Use limit 1–100.",
            }],
          },
        },
      };
    }
    limit = limitNum;
  }

  return {
    ok: true,
    params: {
      mode: "cursor",
      title,
      ingredient,
      sort,
      limit,
      cursor,
    },
  };
}

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

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }
    const first = value[0];
    return isPlainObject(first) ? first : null;
  }
  return isPlainObject(value) ? value : null;
}

export async function handler(
  req: Request,
  deps?: RecipesHandlerDeps,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const route = parseRoute(url.pathname);

    if (route.kind === "NOT_FOUND") {
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

    if (route.kind === "COLLECTION") {
      if (req.method !== "GET" && req.method !== "POST") {
        return recipesJsonResponse(
          {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Only GET, POST, and OPTIONS methods are supported.",
            },
          },
          {
            status: 405,
            headers: {
              Allow: "GET, POST, OPTIONS",
            },
          },
        );
      }
    } else {
      if (req.method !== "GET" && req.method !== "PATCH" && req.method !== "DELETE") {
        return recipesJsonResponse(
          {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Only GET, PATCH, DELETE, and OPTIONS methods are supported.",
            },
          },
          {
            status: 405,
            headers: {
              Allow: "GET, PATCH, DELETE, OPTIONS",
            },
          },
        );
      }
    }

    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      return withRecipesCorsMethods(auth.response);
    }

    const { user, supabase } = auth.context;

    if (route.kind === "COLLECTION") {
      if (req.method === "GET") {
        const parsed = parseRecipeListParams(url);
        if (!parsed.ok) {
          return recipesJsonResponse(parsed.errorResponse, { status: parsed.errorStatus });
        }

        const params = parsed.params;
        let listQuery = supabase
          .from("recipes")
          .select(
            "id, user_id, title, raw_input, notes, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at",
          )
          .eq("user_id", user.id);

        if (params.title) {
          listQuery = listQuery.ilike("title", `%${params.title}%`);
        }

        if (params.ingredient) {
          listQuery = listQuery.filter("ingredients::text", "ilike", `%${params.ingredient}%`);
        }

        if (params.mode === "cursor") {
          const { sort, limit, cursor } = params;
          if (cursor) {
            if (sort === "newest") {
              listQuery = listQuery.or(
                `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
              );
            } else {
              if (cursor.starRating !== null && cursor.starRating !== undefined) {
                listQuery = listQuery.or(
                  `star_rating.lt.${cursor.starRating},star_rating.is.null,and(star_rating.eq.${cursor.starRating},created_at.lt.${cursor.createdAt}),and(star_rating.eq.${cursor.starRating},created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
                );
              } else {
                listQuery = listQuery.or(
                  `and(star_rating.is.null,created_at.lt.${cursor.createdAt}),and(star_rating.is.null,created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
                );
              }
            }
          }

          if (sort === "rating") {
            listQuery = listQuery
              .order("star_rating", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false })
              .order("id", { ascending: true });
          } else {
            listQuery = listQuery
              .order("created_at", { ascending: false })
              .order("id", { ascending: true });
          }

          listQuery = listQuery.limit(limit + 1);
        } else {
          const { sort, limit, offset } = params;
          if (sort === "rating") {
            listQuery = listQuery
              .order("star_rating", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false })
              .order("id", { ascending: true });
          } else {
            listQuery = listQuery
              .order("created_at", { ascending: false })
              .order("id", { ascending: true });
          }

          listQuery = listQuery.range(offset, offset + limit - 1);
        }

        const { data, error } = await listQuery;

        if (error || !data || !Array.isArray(data)) {
          console.error("Database list query failed", error?.code ? `code: ${error.code}` : "");
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

        if (data.some((item: { user_id: string }) => item.user_id !== user.id)) {
          console.error("Recipe ownership mismatch detected in list");
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

        let recipesData: typeof data;
        let nextCursor: string | null = null;
        let hasMore = false;

        if (params.mode === "cursor") {
          hasMore = data.length > params.limit;
          recipesData = hasMore ? data.slice(0, params.limit) : data;
          if (hasMore && recipesData.length > 0) {
            const lastItem = recipesData[recipesData.length - 1];
            nextCursor = encodeCursor({
              sort: params.sort,
              ...(params.title ? { title: params.title } : {}),
              ...(params.ingredient ? { ingredient: params.ingredient } : {}),
              id: lastItem.id,
              createdAt: lastItem.created_at,
              starRating: lastItem.star_rating,
            });
          }
        } else {
          recipesData = data;
          hasMore = recipesData.length === params.limit;
        }

        const listValidation = RecipeListResponseSchema.safeParse({
          recipes: recipesData,
          next_cursor: nextCursor,
          has_more: hasMore,
        });
        if (!listValidation.success) {
          const invalidPaths = listValidation.error.issues.map((issue) => issue.path.join(".")).join(", ");
          console.error("Recipe list response validation failed on paths:", invalidPaths);
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

        return recipesJsonResponse(listValidation.data, { status: 200 });
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

      const validated = validation.data;

      const insertPayload = {
        user_id: user.id,
        title: validated.title,
        raw_input: validated.raw_input ?? null,
        notes: validated.notes ?? null,
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
          "id, user_id, title, raw_input, notes, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at",
        )
        .single();

      const record = normalizeRecord(data);
      if (error || !record) {
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

      if (record.user_id !== user.id) {
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

      const responseValidation = RecipeResponseSchema.safeParse({ recipe: record });
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
    }

    const paramValidation = RecipeParamsSchema.safeParse({ id: route.id });
    if (!paramValidation.success) {
      const details = paramValidation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      }));
      return recipesJsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid recipe ID.",
            details,
          },
        },
        { status: 400 },
      );
    }

    const recipeId = paramValidation.data.id;

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("recipes")
        .select(
          "id, user_id, title, raw_input, notes, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at",
        )
        .eq("id", recipeId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Database detail query failed", error?.code ? `code: ${error.code}` : "");
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

      const record = normalizeRecord(data);
      if (!record) {
        return recipesJsonResponse(
          {
            error: {
              code: "NOT_FOUND",
              message: "Recipe not found.",
            },
          },
          { status: 404 },
        );
      }

      if (record.user_id !== user.id) {
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

      const detailValidation = RecipeResponseSchema.safeParse({ recipe: record });
      if (!detailValidation.success) {
        const invalidPaths = detailValidation.error.issues.map((issue) => issue.path.join(".")).join(", ");
        console.error("Recipe detail response validation failed on paths:", invalidPaths);
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

      return recipesJsonResponse(detailValidation.data, { status: 200 });
    }

    if (req.method === "PATCH") {
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

      const validation = UpdateRecipeRequestSchema.safeParse(parsedBody);
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

      const validated = validation.data;
      const updatePayload: Record<string, unknown> = {};

      if (validated.title !== undefined) {
        updatePayload.title = validated.title;
      }
      if (validated.raw_input !== undefined) {
        updatePayload.raw_input = validated.raw_input;
      }
      if (validated.notes !== undefined) {
        updatePayload.notes = validated.notes;
      }
      if (validated.ingredients !== undefined) {
        updatePayload.ingredients = validated.ingredients;
      }
      if (validated.instructions !== undefined) {
        updatePayload.instructions = validated.instructions;
      }
      if (validated.flavor_scores !== undefined) {
        updatePayload.flavor_scores = validated.flavor_scores;
      }
      if (validated.star_rating !== undefined) {
        updatePayload.star_rating = validated.star_rating;
      }
      if (validated.cooked_at !== undefined) {
        updatePayload.cooked_at = validated.cooked_at;
      }

      const { data, error } = await supabase
        .from("recipes")
        .update(updatePayload)
        .eq("id", recipeId)
        .eq("user_id", user.id)
        .select(
          "id, user_id, title, raw_input, notes, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at",
        )
        .maybeSingle();

      if (error) {
        console.error("Database update failed", error?.code ? `code: ${error.code}` : "");
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

      const record = normalizeRecord(data);
      if (!record) {
        return recipesJsonResponse(
          {
            error: {
              code: "NOT_FOUND",
              message: "Recipe not found.",
            },
          },
          { status: 404 },
        );
      }

      if (record.user_id !== user.id) {
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

      const patchValidation = RecipeResponseSchema.safeParse({ recipe: record });
      if (!patchValidation.success) {
        const invalidPaths = patchValidation.error.issues.map((issue) => issue.path.join(".")).join(", ");
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

      return recipesJsonResponse(patchValidation.data, { status: 200 });
    }

    if (req.method === "DELETE") {
      const { data, error } = await supabase
        .from("recipes")
        .delete()
        .eq("id", recipeId)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("Database delete failed", error?.code ? `code: ${error.code}` : "");
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

      const record = normalizeRecord(data);
      if (!record) {
        return recipesJsonResponse(
          {
            error: {
              code: "NOT_FOUND",
              message: "Recipe not found.",
            },
          },
          { status: 404 },
        );
      }

      const deleteHeaders = new Headers(getCorsHeaders(ALLOWED_METHODS));
      deleteHeaders.set("Cache-Control", "no-store");
      deleteHeaders.set("X-Content-Type-Options", "nosniff");
      return new Response(null, {
        status: 204,
        headers: deleteHeaders,
      });
    }

    return recipesJsonResponse(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only GET, PATCH, DELETE, and OPTIONS methods are supported.",
        },
      },
      {
        status: 405,
        headers: {
          Allow: "GET, PATCH, DELETE, OPTIONS",
        },
      },
    );
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
