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
import type {
  AIProvider,
  ExtractedRecipe,
  GeneratedRecipe,
} from "../_shared/ai/AIProvider.ts";
import { AIError } from "../_shared/ai/GeminiAdapter.ts";
import {
  MOCK_EXTRACTED_RECIPE,
  MOCK_GENERATED_RECIPE,
  MOCK_MALFORMED_GENERATED_RECIPE,
  MOCK_MALFORMED_RECIPE,
} from "../_shared/ai/mocks.ts";
import type { ChefRecipeContextResult } from "../_shared/ai/schemas.ts";
import type { QuotaCheck } from "../_shared/ai/quota.ts";

const SUPABASE_URL = "https://mock.supabase.co";
const ANON_KEY = "mock-anon-public-key-value";
const USER_ID = "99999999-9999-9999-9999-999999999999";
const USER_EMAIL = "verified@morisscraps.local";
const USER_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6InZlcmlmaWVkQG1vcmlzc2NyYXBzLmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_segment_ok";
const CANDIDATE_TOKEN_SECRET = "test-candidate-token-secret-0123456789abcdef";
const PARENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const SECOND_PARENT_ID = "22222222-2222-4222-8222-222222222222";
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
  }, {
    id: SECOND_PARENT_ID,
    title: "Egg Pancake",
    ingredients: [{ name: "eggs", quantity: 2, unit: null, inferred: false }],
    instructions: [{ step: 1, text: "Cook the eggs." }],
    flavor_scores: null,
    star_rating: 4,
    created_at: "2026-10-02T00:00:00.000Z",
    overlap_ratio: 1,
    matched_ingredients: ["eggs"],
  }],
  totalCandidateCount: 2,
  matchedCandidateCount: 2,
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
): RecipeRow {
  return {
    id,
    user_id: USER_ID,
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
  const writes: string[] = [];

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
    if (
      method !== "GET" &&
      (url.pathname === "/rest/v1/recipes" ||
        url.pathname === "/rest/v1/recipe_lineage")
    ) writes.push(`${method} ${url.pathname}`);

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

  return { fetchImpl, writes };
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

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    extractRecipe: () => Promise.resolve(MOCK_EXTRACTED_RECIPE),
    generateRecipe: () => Promise.resolve(MOCK_GENERATED_RECIPE),
    testConnection: () => Promise.resolve("mock provider"),
    ...overrides,
  };
}

async function runAiHandler(
  operation: "extract" | "generate",
  fetchImpl: typeof fetch,
  aiProvider: AIProvider,
  quotaCheck: QuotaCheck = allowedQuota,
): Promise<Response> {
  const deps = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: ANON_KEY,
    candidateTokenSecret: CANDIDATE_TOKEN_SECRET,
    fetch: fetchImpl,
    provider: aiProvider,
    quotaCheck,
  };

  if (operation === "extract") {
    return await withEnabled(EXTRACT_ENABLED_ENV, () =>
      extractRecipeHandler(
        request("/functions/v1/extract-recipe", "POST", {
          notes: "Chicken, garlic, and soy sauce.",
        }),
        deps,
      ));
  }

  return await withEnabled(GENERATE_ENABLED_ENV, () =>
    generateRecipeHandler(
      request("/functions/v1/generate-recipe", "POST", {
        pantryItems: ["rice", "eggs"],
      }),
      {
        ...deps,
        buildContext: () => Promise.resolve(MATCHED_CONTEXT),
      },
    ));
}

Deno.test("Extraction stays a preview until the user explicitly creates a recipe", async () => {
  const db = createPostgrestMock(EXTRACTED_RECIPE_ID);
  const providerDouble = provider();
  const recipesDeps = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: ANON_KEY,
    fetch: db.fetchImpl,
  };

  const previewResponse = await runAiHandler(
    "extract",
    db.fetchImpl,
    providerDouble,
  );
  const preview = await previewResponse.json();

  assertEquals(previewResponse.status, 200);
  assertEquals(preview.recipe.title, MOCK_EXTRACTED_RECIPE.title);
  assertEquals(db.writes, []);
  const recipesBeforeSaveResponse = await recipesHandler(
    request("/functions/v1/recipes", "GET"),
    recipesDeps,
  );
  assertEquals((await recipesBeforeSaveResponse.json()).recipes, []);

  const saveResponse = await recipesHandler(
    request(
      "/functions/v1/recipes",
      "POST",
      recipeSavePayload(preview.recipe, "Chicken, garlic, and soy sauce."),
    ),
    recipesDeps,
  );
  const saved = await saveResponse.json();
  const recipesAfterSaveResponse = await recipesHandler(
    request("/functions/v1/recipes", "GET"),
    recipesDeps,
  );
  const savedRecipes = await recipesAfterSaveResponse.json();

  assertEquals(saveResponse.status, 201);
  assertEquals(db.writes, ["POST /rest/v1/recipes"]);
  assertEquals(saved.recipe.title, preview.recipe.title);
  assertEquals(
    savedRecipes.recipes.map((recipe: { id: string }) => recipe.id),
    [EXTRACTED_RECIPE_ID],
  );
  assertEquals(savedRecipes.recipes[0].user_id, USER_ID);
});

Deno.test("Chef stays a preview until separate recipe and reviewed-lineage requests", async () => {
  const parent = recipeRow(PARENT_ID, { title: "Garlic Fried Rice" });
  const secondParent = recipeRow(SECOND_PARENT_ID, { title: "Egg Pancake" });
  const db = createPostgrestMock(CHEF_RECIPE_ID, [parent, secondParent]);
  const providerDouble = provider({
    generateRecipe: () =>
      Promise.resolve({
        ...MOCK_GENERATED_RECIPE,
        parentRecipeIds: [PARENT_ID, SECOND_PARENT_ID],
      }),
  });
  const recipesDeps = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: ANON_KEY,
    candidateTokenSecret: CANDIDATE_TOKEN_SECRET,
    fetch: db.fetchImpl,
  };

  const previewResponse = await runAiHandler(
    "generate",
    db.fetchImpl,
    providerDouble,
  );
  const preview = await previewResponse.json();

  assertEquals(previewResponse.status, 200);
  assertEquals(preview.recipe.title, MOCK_GENERATED_RECIPE.recipe.title);
  assertEquals(
    preview.parents.map((candidate: { id: string }) => candidate.id),
    [PARENT_ID, SECOND_PARENT_ID],
  );
  assertEquals(typeof preview.candidate_token, "string");
  assertEquals(db.writes, []);
  const recipesBeforeSaveResponse = await recipesHandler(
    request("/functions/v1/recipes", "GET"),
    recipesDeps,
  );
  assertEquals(
    (await recipesBeforeSaveResponse.json()).recipes.map((
      recipe: { id: string },
    ) => recipe.id),
    [PARENT_ID, SECOND_PARENT_ID],
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
  assertEquals(db.writes, ["POST /rest/v1/recipes"]);
  assertEquals(saved.recipe.id, CHEF_RECIPE_ID);
  assertEquals(saved.recipe.title, preview.recipe.title);
  assertEquals(lineageBeforeSaveResponse.status, 200);
  assertEquals((await lineageBeforeSaveResponse.json()).lineage, []);

  const selectedParentIds = [PARENT_ID];
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
  assertEquals(db.writes, [
    "POST /rest/v1/recipes",
    "POST /rest/v1/recipe_lineage",
  ]);
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

Deno.test("Malformed output, provider failure, and quota exhaustion never persist a recipe or lineage", async () => {
  const failureCases: Array<{
    operation: "extract" | "generate";
    aiProvider: AIProvider;
    quotaCheck?: QuotaCheck;
    expectedStatus: number;
    expectedCode: string;
    expectedRetryAfter?: string;
  }> = [
    {
      operation: "extract",
      aiProvider: provider({
        extractRecipe: () =>
          Promise.resolve(MOCK_MALFORMED_RECIPE as unknown as ExtractedRecipe),
      }),
      expectedStatus: 502,
      expectedCode: "AI_OUTPUT_INVALID",
    },
    {
      operation: "generate",
      aiProvider: provider({
        generateRecipe: () =>
          Promise.resolve(
            MOCK_MALFORMED_GENERATED_RECIPE as unknown as GeneratedRecipe,
          ),
      }),
      expectedStatus: 502,
      expectedCode: "AI_OUTPUT_INVALID",
    },
    ...(["extract", "generate"] as const).map((operation) => ({
      operation,
      aiProvider: provider({
        [operation === "extract" ? "extractRecipe" : "generateRecipe"]: () =>
          Promise.reject(
            new AIError(
              "provider_unavailable",
              operation,
              "private provider detail",
            ),
          ),
      }),
      expectedStatus: 503,
      expectedCode: "AI_UNAVAILABLE",
    })),
    ...(["extract", "generate"] as const).map((operation) => ({
      operation,
      aiProvider: provider({
        [operation === "extract" ? "extractRecipe" : "generateRecipe"]: () =>
          Promise.reject(new Error("quota should stop provider work")),
      }),
      quotaCheck: () =>
        Promise.resolve({
          status: "exceeded" as const,
          limit: 20,
          used: 20,
          retryAfterSeconds: 123,
        }),
      expectedStatus: 429,
      expectedCode: "QUOTA_EXCEEDED",
      expectedRetryAfter: "123",
    })),
  ];

  for (const failureCase of failureCases) {
    const parent = recipeRow(PARENT_ID, { title: "Garlic Fried Rice" });
    const db = createPostgrestMock(
      failureCase.operation === "extract"
        ? EXTRACTED_RECIPE_ID
        : CHEF_RECIPE_ID,
      failureCase.operation === "generate" ? [parent] : [],
    );
    const response = await runAiHandler(
      failureCase.operation,
      db.fetchImpl,
      failureCase.aiProvider,
      failureCase.quotaCheck,
    );
    const body = await response.json();

    assertEquals(response.status, failureCase.expectedStatus);
    assertEquals(body.error?.code, failureCase.expectedCode);
    assertEquals(
      JSON.stringify(body).includes("private provider detail"),
      false,
    );
    assertEquals(
      response.headers.get("retry-after"),
      failureCase.expectedRetryAfter ?? null,
    );
    assertEquals(db.writes, []);
  }
});
