import { assertEquals } from "jsr:@std/assert@1";
import {
  EXTRACT_ENABLED_ENV,
  handler as extractRecipeHandler,
} from "../extract-recipe/index.ts";
import {
  GENERATE_ENABLED_ENV,
  handler as generateRecipeHandler,
} from "../generate-recipe/index.ts";
import { handler as recipesHandler } from "../recipes/index.ts";
import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import {
  MOCK_EXTRACTED_RECIPE,
  MOCK_GENERATED_RECIPE,
} from "../_shared/ai/mocks.ts";
import type { ChefRecipeContextResult } from "../_shared/ai/schemas.ts";

const SUPABASE_URL = "https://mock.supabase.co";
const ANON_KEY = "mock-anon-public-key-value";
const USER_ID = "99999999-9999-9999-9999-999999999999";
const USER_EMAIL = "verified@morisscraps.local";
const USER_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6InZlcmlmaWVkQG1vcmlzc2NyYXBzLmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_segment_ok";
const CANDIDATE_TOKEN_SECRET = "test-candidate-token-secret-0123456789abcdef";
const PARENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const EXTRACTED_RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const CHEF_RECIPE_ID = "44444444-4444-4444-8444-444444444444";
const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";

type RecipeRow = Record<string, unknown> & { id: string; user_id: string };
type LineageRow = {
  id: string;
  parent_recipe_id: string;
  child_recipe_id: string;
  created_at: string;
};

const MATCHED_CONTEXT: ChefRecipeContextResult = {
  status: "MATCHED",
  pantryItems: ["rice", "eggs"],
  preferences: "quick weeknight dinner",
  recipes: [{
    id: PARENT_ID,
    title: "Garlic Fried Rice",
    ingredients: [{ name: "rice", quantity: 2, unit: "cups", inferred: false }],
    instructions: [{ step: 1, text: "Fry the rice." }],
    flavor_scores: null,
    star_rating: 5,
    created_at: "2026-10-01T00:00:00.000Z",
    overlap_ratio: 1,
    matched_ingredients: ["rice"],
  }],
  totalCandidateCount: 1,
  matchedCandidateCount: 1,
  truncated: false,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recipeRow(
  id: string,
  recipe: Record<string, unknown>,
  userId = USER_ID,
): RecipeRow {
  return {
    id,
    user_id: userId,
    title: recipe.title,
    raw_input: recipe.raw_input ?? null,
    notes: recipe.notes ?? null,
    ingredients: recipe.ingredients ?? [],
    instructions: recipe.instructions ?? [],
    flavor_scores: recipe.flavor_scores ?? null,
    star_rating: recipe.star_rating ?? null,
    cooked_at: recipe.cooked_at ?? null,
    image_url: null,
    created_at: "2026-11-14T00:00:00.000Z",
    updated_at: "2026-11-14T00:00:00.000Z",
  };
}

function createPostgrestMock(
  recipeId: string,
  initialRecipes: RecipeRow[] = [],
) {
  const recipes = [...initialRecipes];
  const lineage: LineageRow[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);

    if (url.pathname === "/auth/v1/user") {
      return jsonResponse({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: USER_EMAIL,
      });
    }

    if (url.pathname === "/rest/v1/recipes" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "")) as Record<
        string,
        unknown
      >;
      const row = recipeRow(recipeId, body);
      recipes.push(row);
      return jsonResponse(row, 201);
    }

    if (url.pathname === "/rest/v1/recipes" && method === "GET") {
      const idFilter = url.searchParams.get("id") ?? "";
      const userFilter = url.searchParams.get("user_id") ?? "";
      const ids = idFilter.startsWith("eq.")
        ? new Set([idFilter.slice(3)])
        : idFilter.startsWith("in.(")
        ? new Set(idFilter.slice(4, -1).split(","))
        : null;
      const owner = userFilter.startsWith("eq.") ? userFilter.slice(3) : null;
      const matches = recipes.filter((recipe) =>
        (!ids || ids.has(recipe.id)) && (!owner || recipe.user_id === owner)
      );
      return jsonResponse(
        headers.get("accept")?.includes("application/vnd.pgrst.object+json")
          ? matches[0] ?? null
          : matches,
      );
    }

    if (url.pathname === "/rest/v1/recipe_lineage" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "")) as Record<
        string,
        unknown
      >[];
      const inserted = body.map((row) => ({
        id: LINEAGE_ID,
        parent_recipe_id: String(row.parent_recipe_id),
        child_recipe_id: String(row.child_recipe_id),
        created_at: "2026-11-14T00:00:00.000Z",
      }));
      lineage.push(...inserted);
      return jsonResponse(inserted, 201);
    }

    if (url.pathname === "/rest/v1/recipe_lineage" && method === "GET") {
      const childFilter = url.searchParams.get("child_recipe_id") ?? "";
      const childId = childFilter.startsWith("eq.")
        ? childFilter.slice(3)
        : null;
      return jsonResponse(
        lineage.filter((row) => !childId || row.child_recipe_id === childId),
      );
    }

    return new Response(null, { status: 404 });
  };

  return { fetchImpl };
}

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${USER_JWT}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function recipeSavePayload(recipe: Record<string, unknown>, rawInput: string) {
  return {
    title: recipe.title,
    raw_input: rawInput,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    flavor_scores: recipe.flavor_scores,
  };
}

async function withEnabled<T>(name: string, run: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get(name);
  Deno.env.set(name, "true");
  try {
    return await run();
  } finally {
    if (previous === undefined) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
}

const allowedQuota = () =>
  Promise.resolve({ status: "allowed" as const, limit: 20, used: 0 });

function provider(): AIProvider {
  return {
    extractRecipe: () => Promise.resolve(MOCK_EXTRACTED_RECIPE),
    generateRecipe: () => Promise.resolve(MOCK_GENERATED_RECIPE),
    testConnection: () =>
      Promise.reject(new Error("Not used in journey tests")),
  };
}

Deno.test("Extraction stays a preview until the user explicitly creates a recipe", async () => {
  const db = createPostgrestMock(EXTRACTED_RECIPE_ID);
  const providerDouble = provider();

  const previewResponse = await withEnabled(
    EXTRACT_ENABLED_ENV,
    () =>
      extractRecipeHandler(
        request("/functions/v1/extract-recipe", "POST", {
          notes: "Chicken, garlic, and soy sauce.",
        }),
        {
          supabaseUrl: SUPABASE_URL,
          supabaseAnonKey: ANON_KEY,
          fetch: db.fetchImpl,
          provider: providerDouble,
          quotaCheck: allowedQuota,
        },
      ),
  );
  const preview = await previewResponse.json();

  assertEquals(previewResponse.status, 200);
  assertEquals(preview.recipe.title, MOCK_EXTRACTED_RECIPE.title);
  const recipesBeforeSaveResponse = await recipesHandler(
    request("/functions/v1/recipes", "GET"),
    {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
    },
  );
  assertEquals((await recipesBeforeSaveResponse.json()).recipes, []);

  const saveResponse = await recipesHandler(
    request(
      "/functions/v1/recipes",
      "POST",
      recipeSavePayload(preview.recipe, "Chicken, garlic, and soy sauce."),
    ),
    {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
    },
  );
  const saved = await saveResponse.json();
  const recipesAfterSaveResponse = await recipesHandler(
    request("/functions/v1/recipes", "GET"),
    {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
    },
  );
  const savedRecipes = await recipesAfterSaveResponse.json();

  assertEquals(saveResponse.status, 201);
  assertEquals(saved.recipe.title, preview.recipe.title);
  assertEquals(
    savedRecipes.recipes.map((recipe: { id: string }) => recipe.id),
    [EXTRACTED_RECIPE_ID],
  );
  assertEquals(savedRecipes.recipes[0].user_id, USER_ID);
});

Deno.test("Chef stays a preview until separate recipe and reviewed-lineage requests", async () => {
  const parent = recipeRow(PARENT_ID, { title: "Garlic Fried Rice" });
  const db = createPostgrestMock(CHEF_RECIPE_ID, [parent]);
  const providerDouble = provider();
  const recipesDeps = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: ANON_KEY,
    candidateTokenSecret: CANDIDATE_TOKEN_SECRET,
    fetch: db.fetchImpl,
  };

  const previewResponse = await withEnabled(
    GENERATE_ENABLED_ENV,
    () =>
      generateRecipeHandler(
        request("/functions/v1/generate-recipe", "POST", {
          pantryItems: ["rice", "eggs"],
        }),
        {
          ...recipesDeps,
          provider: providerDouble,
          buildContext: () => Promise.resolve(MATCHED_CONTEXT),
          quotaCheck: allowedQuota,
        },
      ),
  );
  const preview = await previewResponse.json();

  assertEquals(previewResponse.status, 200);
  assertEquals(preview.recipe.title, MOCK_GENERATED_RECIPE.recipe.title);
  assertEquals(
    preview.parents.map((candidate: { id: string }) => candidate.id),
    [PARENT_ID],
  );
  assertEquals(typeof preview.candidate_token, "string");
  const recipesBeforeSaveResponse = await recipesHandler(
    request("/functions/v1/recipes", "GET"),
    recipesDeps,
  );
  assertEquals(
    (await recipesBeforeSaveResponse.json()).recipes.map((
      recipe: { id: string },
    ) => recipe.id),
    [PARENT_ID],
  );

  const saveResponse = await recipesHandler(
    request(
      "/functions/v1/recipes",
      "POST",
      recipeSavePayload(
        preview.recipe,
        "Rice and eggs; quick weeknight dinner.",
      ),
    ),
    recipesDeps,
  );
  const saved = await saveResponse.json();
  const lineageBeforeSaveResponse = await recipesHandler(
    request(`/functions/v1/recipes/${saved.recipe.id}/lineage`, "GET"),
    recipesDeps,
  );

  assertEquals(saveResponse.status, 201);
  assertEquals(saved.recipe.id, CHEF_RECIPE_ID);
  assertEquals(saved.recipe.title, preview.recipe.title);
  assertEquals(lineageBeforeSaveResponse.status, 200);
  assertEquals((await lineageBeforeSaveResponse.json()).lineage, []);

  const selectedParentIds = [preview.parents[0].id];
  const lineageResponse = await recipesHandler(
    request(`/functions/v1/recipes/${saved.recipe.id}/lineage`, "POST", {
      parent_recipe_ids: selectedParentIds,
      candidate_token: preview.candidate_token,
    }),
    recipesDeps,
  );
  const savedLineage = await lineageResponse.json();
  const lineageAfterSaveResponse = await recipesHandler(
    request(`/functions/v1/recipes/${saved.recipe.id}/lineage`, "GET"),
    recipesDeps,
  );
  const savedLineageRead = await lineageAfterSaveResponse.json();

  assertEquals(lineageResponse.status, 201);
  assertEquals(
    savedLineage.lineage.map((row: LineageRow) => row.parent_recipe_id),
    selectedParentIds,
  );
  assertEquals(savedLineage.lineage[0].child_recipe_id, saved.recipe.id);
  assertEquals(
    savedLineageRead.lineage.map((row: LineageRow) => row.parent_recipe_id),
    selectedParentIds,
  );
  assertEquals(savedLineageRead.lineage[0].child_recipe_id, saved.recipe.id);
});
