import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { handler } from "../recipes/index.ts";
import {
  CreateLineageRequestSchema,
  CreateRecipeRequestSchema,
  DemoRecipeResponseSchema,
  ExtractedRecipeSchema,
  LineageRecordSchema,
  LineageResponseSchema,
  MAX_PARENT_RECIPE_IDS,
  RecipeIdParamSchema,
  RecipeListResponseSchema,
  RecipeParamsSchema,
  RecipeResponseSchema,
  UpdateRecipeRequestSchema,
} from "../_shared/schemas.ts";
import {
  evaluateHostedRlsPrerequisites,
  isLoopbackHost,
  isLegacyServiceRoleJwt,
  isModernPublishableKey,
  isModernSecretKey,
  KNOWN_PRODUCTION_REF,
  passesRlsTargetSafetyPrecheck,
} from "../../../run-local-tests.mjs";

const VALID_TEST_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6InZlcmlmaWVkQG1vcmlzc2NyYXBzLmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_segment_ok";
const FORGED_TEST_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoic2VydmljZV9yb2xlIn0.forged_unverified_sig";
const EXPIRED_TEST_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJleHAiOjF9.expired_signature_seg";
const TEST_SUPABASE_URL = "https://mock.supabase.co";
const TEST_ANON_KEY = "mock-anon-public-key-value";
const VERIFIED_USER_ID = "99999999-9999-9999-9999-999999999999";
const VERIFIED_USER_EMAIL = "verified@morisscraps.local";
const CREATED_RECIPE_ID = "33333333-3333-4333-8333-333333333333";

function validRecipePayload() {
  return {
    title: "Crispy Garlic Shallot Rice",
    raw_input: "Leftover jasmine rice, shallots, garlic, soy sauce.",
    ingredients: [
      { name: "jasmine rice", quantity: 2, unit: "cups", inferred: false },
      { name: "shallots", quantity: null, unit: null, quantityText: "2 small", inferred: true },
    ],
    instructions: [
      { step: 1, text: "Slice shallots and garlic thinly." },
      { step: 2, text: "Crisp in oil and toss with rice." },
    ],
    flavor_scores: {
      sweet: 1,
      salty: 4,
      sour: 0,
      bitter: 1,
      umami: 5,
      spicy: 2,
    },
    star_rating: 5,
    cooked_at: "2026-10-19",
  };
}

function persistedRecipeRow(overrides: Record<string, unknown> = {}) {
  const payload = validRecipePayload();
  return {
    id: CREATED_RECIPE_ID,
    user_id: VERIFIED_USER_ID,
    title: payload.title,
    raw_input: payload.raw_input,
    notes: null,
    ingredients: payload.ingredients,
    instructions: payload.instructions,
    flavor_scores: payload.flavor_scores,
    star_rating: payload.star_rating,
    cooked_at: payload.cooked_at,
    image_url: null,
    created_at: "2026-10-20T06:00:00.000Z",
    updated_at: "2026-10-20T06:00:00.000Z",
    ...overrides,
  };
}

Deno.test("CreateRecipeRequestSchema and RecipeResponseSchema validate valid payloads and preserve existing shared schemas", () => {
  const fullResult = CreateRecipeRequestSchema.safeParse({
    ...validRecipePayload(),
    title: "  Crispy Garlic Shallot Rice  ",
  });
  assertEquals(fullResult.success, true);
  if (fullResult.success) {
    assertEquals(fullResult.data.title, "Crispy Garlic Shallot Rice");
    assertEquals(fullResult.data.ingredients.length, 2);
    assertEquals(fullResult.data.instructions.length, 2);
    assertEquals(fullResult.data.star_rating, 5);
    assertEquals(fullResult.data.cooked_at, "2026-10-19");
  }

  const minimalResult = CreateRecipeRequestSchema.safeParse({
    title: "Simple Toast",
    ingredients: [{ name: "bread", quantity: 1, unit: "slice" }],
    instructions: [{ step: 1, text: "Toast bread." }],
  });
  assertEquals(minimalResult.success, true);
  if (minimalResult.success) {
    assertEquals(minimalResult.data.ingredients[0].inferred, false);
    assertEquals(minimalResult.data.raw_input, undefined);
    assertEquals(minimalResult.data.notes, undefined);
    assertEquals(minimalResult.data.flavor_scores, undefined);
    assertEquals(minimalResult.data.star_rating, undefined);
    assertEquals(minimalResult.data.cooked_at, undefined);
  }

  const withNotesResult = CreateRecipeRequestSchema.safeParse({
    ...validRecipePayload(),
    notes: "Chef special notes",
  });
  assertEquals(withNotesResult.success, true);
  if (withNotesResult.success) {
    assertEquals(withNotesResult.data.notes, "Chef special notes");
  }

  const withNullNotesResult = CreateRecipeRequestSchema.safeParse({
    ...validRecipePayload(),
    notes: null,
  });
  assertEquals(withNullNotesResult.success, true);
  if (withNullNotesResult.success) {
    assertEquals(withNullNotesResult.data.notes, null);
  }

  const fe05DraftResult = CreateRecipeRequestSchema.safeParse({
    title: "A bowl of ginger rice",
    ingredients: [
      { name: "rice", quantity: 2, unit: "cups", inferred: false },
      { name: "ginger", quantity: null, unit: null, quantityText: "A small piece", inferred: true },
    ],
    instructions: [
      { step: 1, text: "Prepare the rice." },
      { step: 2, text: "Add ginger.\nCook until tender." },
    ],
    star_rating: 4,
    cooked_at: "2026-10-19",
  });
  assertEquals(fe05DraftResult.success, true);

  const responseResult = RecipeResponseSchema.safeParse({
    recipe: persistedRecipeRow(),
  });
  assertEquals(responseResult.success, true);

  assertEquals(RecipeResponseSchema.safeParse({ recipe: persistedRecipeRow({ notes: "Saved notes" }) }).success, true);
  assertEquals(RecipeResponseSchema.safeParse({ recipe: persistedRecipeRow({ notes: null }) }).success, true);
  assertEquals(RecipeResponseSchema.safeParse({ recipe: persistedRecipeRow({ notes: 12345 }) }).success, false);

  const demoCompat = DemoRecipeResponseSchema.safeParse({
    recipe: persistedRecipeRow(),
  });
  assertEquals(demoCompat.success, true);

  const extractedCompat = ExtractedRecipeSchema.safeParse({
    title: "Extracted Soup",
    ingredients: [{ name: "water", quantity: 1, unit: "cup" }],
    instructions: [{ step: 1, text: "Boil." }],
  });
  assertEquals(extractedCompat.success, true);
});

Deno.test("CORS OPTIONS preflight on /recipes returns 204 with POST, OPTIONS allowed and does not require authentication", async () => {
  const req = new Request("http://localhost/functions/v1/recipes", {
    method: "OPTIONS",
  });
  const res = await handler(req);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
  assertEquals(
    res.headers.get("access-control-allow-headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(await res.text(), "");
});

Deno.test("Dynamic ALLOWED_ORIGIN configuration scopes origin and sets Vary on recipes preflight and responses", async () => {
  const originalOrigin = Deno.env.get("ALLOWED_ORIGIN");
  try {
    Deno.env.set("ALLOWED_ORIGIN", "https://frontend.morisscraps.com");
    const preflightRes = await handler(
      new Request("http://localhost/functions/v1/recipes", { method: "OPTIONS" }),
    );
    assertEquals(preflightRes.status, 204);
    assertEquals(
      preflightRes.headers.get("access-control-allow-origin"),
      "https://frontend.morisscraps.com",
    );
    assertEquals(preflightRes.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(preflightRes.headers.get("vary"), "Origin");

    const unauthRes = await handler(
      new Request("http://localhost/functions/v1/recipes", { method: "POST" }),
    );
    assertEquals(unauthRes.status, 401);
    assertEquals(
      unauthRes.headers.get("access-control-allow-origin"),
      "https://frontend.morisscraps.com",
    );
    assertEquals(unauthRes.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(unauthRes.headers.get("vary"), "Origin");
  } finally {
    if (originalOrigin) {
      Deno.env.set("ALLOWED_ORIGIN", originalOrigin);
    } else {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  }
});

Deno.test("Unsupported HTTP methods on collection route return 405 METHOD_NOT_ALLOWED with Allow: GET, POST, OPTIONS and zero network calls", async () => {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = () => {
    fetchCalls++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
    const req = new Request("http://localhost/functions/v1/recipes", {
      method,
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("allow"), "GET, POST, OPTIONS");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    const body = await res.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
    assertEquals(typeof body.error?.message, "string");
  }

  assertEquals(fetchCalls, 0);
});

Deno.test("Unsupported sub-paths on /recipes return 404 NOT_FOUND without calling Auth or database", async () => {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = () => {
    fetchCalls++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (const path of ["/functions/v1/recipes/123/edit", "/recipes/123/edit", "/functions/v1/recipes/a/b/c"]) {
    const req = new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validRecipePayload()),
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    const body = await res.json();
    assertEquals(body.error?.code, "NOT_FOUND");
  }

  assertEquals(fetchCalls, 0);
});

Deno.test("Authenticated POST /recipes persists a valid recipe with verified owner and is_public=false and returns 201 Created", async () => {
  let capturedPostgrestUrl: URL | null = null;
  let capturedPostgrestMethod: string | null = null;
  let capturedPostgrestHeaders: Headers | null = null;
  let capturedInsertBody: Record<string, unknown> | null = null;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: VERIFIED_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: VERIFIED_USER_EMAIL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      capturedPostgrestUrl = url;
      capturedPostgrestMethod = init?.method ?? "GET";
      capturedPostgrestHeaders = new Headers(init?.headers);
      const rawText = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(rawText);
      capturedInsertBody = Array.isArray(parsed) ? parsed[0] : parsed;

      return new Response(
        JSON.stringify(persistedRecipeRow()),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(null, { status: 404 });
  };

  for (const endpointPath of ["/functions/v1/recipes", "/recipes"]) {
    const req = new Request(`http://localhost${endpointPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validRecipePayload()),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 201);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");

    assertNotEquals(capturedPostgrestUrl, null);
    assertEquals(capturedPostgrestUrl!.pathname, "/rest/v1/recipes");
    assertEquals(
      capturedPostgrestUrl!.searchParams.get("select"),
      "id,user_id,title,raw_input,notes,ingredients,instructions,flavor_scores,star_rating,cooked_at,image_url,created_at,updated_at",
    );
    assertEquals(capturedPostgrestMethod, "POST");

    assertNotEquals(capturedPostgrestHeaders, null);
    assertEquals(capturedPostgrestHeaders!.get("authorization"), `Bearer ${VALID_TEST_JWT}`);
    assertEquals(capturedPostgrestHeaders!.get("apikey"), TEST_ANON_KEY);

    assertNotEquals(capturedInsertBody, null);
    assertEquals(capturedInsertBody!.user_id, VERIFIED_USER_ID);
    assertEquals(capturedInsertBody!.is_public, false);
    assertEquals(capturedInsertBody!.title, "Crispy Garlic Shallot Rice");
    assertEquals(capturedInsertBody!.star_rating, 5);
    assertEquals(capturedInsertBody!.cooked_at, "2026-10-19");

    const body = await res.json();
    const parsedResponse = RecipeResponseSchema.safeParse(body);
    assertEquals(parsedResponse.success, true);
    assertEquals(body.recipe.id, CREATED_RECIPE_ID);
    assertEquals(body.recipe.user_id, VERIFIED_USER_ID);
    assertEquals(body.recipe.title, "Crispy Garlic Shallot Rice");
    assertEquals(body.recipe.ingredients.length, 2);
    assertEquals(body.recipe.instructions.length, 2);
    assertEquals(body.recipe.star_rating, 5);
    assertEquals(body.recipe.cooked_at, "2026-10-19");
    assertEquals((body.recipe as Record<string, unknown>).is_public, undefined);
    assertEquals((body.recipe as Record<string, unknown>).image_path, undefined);
  }
});

Deno.test("Authenticated POST /recipes persists personal notes independently of raw_input and returns notes in response", async () => {
  let capturedInsertBody: Record<string, unknown> | null = null;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: VERIFIED_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: VERIFIED_USER_EMAIL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const rawText = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(rawText);
      capturedInsertBody = Array.isArray(parsed) ? parsed[0] : parsed;

      return new Response(
        JSON.stringify(
          persistedRecipeRow({
            title: capturedInsertBody?.title,
            raw_input: capturedInsertBody?.raw_input,
            notes: capturedInsertBody?.notes,
          }),
        ),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(null, { status: 404 });
  };

  const req = new Request("http://localhost/functions/v1/recipes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...validRecipePayload(),
      raw_input: "Original raw ingredients list",
      notes: "Chef note: add crispy chili oil at the end",
    }),
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 201);
  assertNotEquals(capturedInsertBody, null);
  assertEquals(capturedInsertBody!.raw_input, "Original raw ingredients list");
  assertEquals(capturedInsertBody!.notes, "Chef note: add crispy chili oil at the end");

  const body = await res.json();
  assertEquals(body.recipe.raw_input, "Original raw ingredients list");
  assertEquals(body.recipe.notes, "Chef note: add crispy chili oil at the end");
});

Deno.test("Authenticated POST /recipes accepts minimal payload with optional fields omitted or null and defaults nullable columns to null", async () => {
  let capturedInsertBody: Record<string, unknown> | null = null;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: VERIFIED_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: VERIFIED_USER_EMAIL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const rawText = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(rawText);
      capturedInsertBody = Array.isArray(parsed) ? parsed[0] : parsed;

      return new Response(
        JSON.stringify(
          persistedRecipeRow({
            title: "Quick Broth",
            raw_input: null,
            ingredients: [],
            instructions: [],
            flavor_scores: null,
            star_rating: null,
            cooked_at: null,
          }),
        ),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(null, { status: 404 });
  };

  const req = new Request("http://localhost/functions/v1/recipes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "  Quick Broth  ",
      ingredients: [],
      instructions: [],
    }),
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 201);
  assertNotEquals(capturedInsertBody, null);
  assertEquals(capturedInsertBody!.user_id, VERIFIED_USER_ID);
  assertEquals(capturedInsertBody!.title, "Quick Broth");
  assertEquals(capturedInsertBody!.raw_input, null);
  assertEquals(capturedInsertBody!.ingredients, []);
  assertEquals(capturedInsertBody!.instructions, []);
  assertEquals(capturedInsertBody!.flavor_scores, null);
  assertEquals(capturedInsertBody!.star_rating, null);
  assertEquals(capturedInsertBody!.cooked_at, null);
  assertEquals(capturedInsertBody!.is_public, false);
});

Deno.test("Malformed JSON and non-object JSON bodies return 400 INVALID_JSON without calling PostgREST", async () => {
  let postgrestCalled = false;

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalled = true;
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const malformedBodies = [
    "",
    "   ",
    "{not-valid-json",
    '{"title": "Unclosed',
    "null",
    "true",
    "123",
    '"just a string"',
    "[]",
    '[{"title": "Array not object"}]',
  ];

  for (const rawBody of malformedBodies) {
    const req = new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: rawBody,
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 400);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(postgrestCalled, false);

    const body = await res.json();
    assertEquals(body.error?.code, "INVALID_JSON");
    assertEquals(typeof body.error?.message, "string");
  }
});

Deno.test("Invalid recipe payloads fail shared Zod validation with 400 VALIDATION_ERROR and never execute database insert", async () => {
  let postgrestCalled = false;

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalled = true;
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const invalidCases: Array<{ payload: Record<string, unknown>; expectedPathPrefix: string }> = [
    {
      payload: { ingredients: [], instructions: [] },
      expectedPathPrefix: "title",
    },
    {
      payload: { ...validRecipePayload(), title: "" },
      expectedPathPrefix: "title",
    },
    {
      payload: { ...validRecipePayload(), title: "    " },
      expectedPathPrefix: "title",
    },
    {
      payload: { title: "Missing ingredients", instructions: [] },
      expectedPathPrefix: "ingredients",
    },
    {
      payload: { title: "Missing instructions", ingredients: [] },
      expectedPathPrefix: "instructions",
    },
    {
      payload: {
        ...validRecipePayload(),
        ingredients: [{ name: "garlic", quantity: "two", unit: "cloves" }],
      },
      expectedPathPrefix: "ingredients.0.quantity",
    },
    {
      payload: {
        ...validRecipePayload(),
        instructions: [{ step: "first", text: "Chop" }],
      },
      expectedPathPrefix: "instructions.0.step",
    },
    {
      payload: {
        ...validRecipePayload(),
        flavor_scores: { sweet: 6, salty: 1, sour: 1, bitter: 1, umami: 1, spicy: 1 },
      },
      expectedPathPrefix: "flavor_scores.sweet",
    },
    {
      payload: {
        ...validRecipePayload(),
        flavor_scores: { sweet: -1, salty: 1, sour: 1, bitter: 1, umami: 1, spicy: 1 },
      },
      expectedPathPrefix: "flavor_scores.sweet",
    },
    {
      payload: { ...validRecipePayload(), star_rating: 0 },
      expectedPathPrefix: "star_rating",
    },
    {
      payload: { ...validRecipePayload(), star_rating: 6 },
      expectedPathPrefix: "star_rating",
    },
    {
      payload: { ...validRecipePayload(), star_rating: 3.5 },
      expectedPathPrefix: "star_rating",
    },
    {
      payload: { ...validRecipePayload(), cooked_at: "2026-02-30" },
      expectedPathPrefix: "cooked_at",
    },
    {
      payload: { ...validRecipePayload(), cooked_at: "2026-13-01" },
      expectedPathPrefix: "cooked_at",
    },
    {
      payload: { ...validRecipePayload(), cooked_at: "19/10/2026" },
      expectedPathPrefix: "cooked_at",
    },
  ];

  for (const testCase of invalidCases) {
    const req = new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testCase.payload),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 400);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(postgrestCalled, false);

    const rawText = await res.text();
    assertEquals(rawText.includes(VALID_TEST_JWT), false);
    assertEquals(rawText.includes(TEST_ANON_KEY), false);
    assertEquals(rawText.includes("file://"), false);
    assertEquals(/\bat\s+\S+\s*\(/.test(rawText), false);

    const body = JSON.parse(rawText);
    assertEquals(body.error?.code, "VALIDATION_ERROR");
    assertEquals(typeof body.error?.message, "string");
    assertEquals(Array.isArray(body.error?.details), true);
    const matchingIssue = body.error.details.some(
      (issue: { path?: string; code?: string; message?: string }) =>
        typeof issue.path === "string" &&
        issue.path.startsWith(testCase.expectedPathPrefix) &&
        typeof issue.code === "string" &&
        typeof issue.message === "string",
    );
    assertEquals(matchingIssue, true);
  }
});

Deno.test("Missing, malformed, invalid, or expired Bearer tokens are rejected with 401 UNAUTHORIZED before any database operation", async () => {
  let postgrestCalled = false;

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 401,
            error_code: "bad_jwt",
            msg: "invalid JWT: signature is invalid or token is expired",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalled = true;
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const unauthorizedRequests = [
    new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRecipePayload()),
    }),
    new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: {
        Authorization: "Bearer not-a-compact-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validRecipePayload()),
    }),
    new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FORGED_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validRecipePayload()),
    }),
    new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EXPIRED_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validRecipePayload()),
    }),
  ];

  for (const req of unauthorizedRequests) {
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 401);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(postgrestCalled, false);

    const body = await res.json();
    assertEquals(body.error?.code, "UNAUTHORIZED");
    assertEquals(typeof body.error?.message, "string");
  }
});

Deno.test("Client attempts to override ownership, id, or is_public in body, query, or headers are ignored and server enforces verified user_id and is_public=false", async () => {
  const attackerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const attackerRecipeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let capturedInsertBody: Record<string, unknown> | null = null;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: VERIFIED_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: VERIFIED_USER_EMAIL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const rawText = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(rawText);
      capturedInsertBody = Array.isArray(parsed) ? parsed[0] : parsed;

      return new Response(
        JSON.stringify(persistedRecipeRow()),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(null, { status: 404 });
  };

  const req = new Request(
    `http://localhost/functions/v1/recipes?user_id=${attackerId}&userId=${attackerId}&id=${attackerRecipeId}&is_public=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
        "X-User-Id": attackerId,
        "X-Forwarded-User": attackerId,
      },
      body: JSON.stringify({
        ...validRecipePayload(),
        id: attackerRecipeId,
        user_id: attackerId,
        userId: attackerId,
        owner_id: attackerId,
        ownerId: attackerId,
        is_public: true,
        image_url: "https://evil.example.com/spoof.png",
        image_path: "private/evil.png",
        created_at: "1999-01-01T00:00:00Z",
        updated_at: "1999-01-01T00:00:00Z",
      }),
    },
  );

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 201);
  assertNotEquals(capturedInsertBody, null);
  assertEquals(capturedInsertBody!.user_id, VERIFIED_USER_ID);
  assertEquals(capturedInsertBody!.is_public, false);
  assertEquals("id" in capturedInsertBody!, false);
  assertEquals("userId" in capturedInsertBody!, false);
  assertEquals("owner_id" in capturedInsertBody!, false);
  assertEquals("image_url" in capturedInsertBody!, false);
  assertEquals("image_path" in capturedInsertBody!, false);
  assertEquals("created_at" in capturedInsertBody!, false);
  assertEquals("updated_at" in capturedInsertBody!, false);

  const body = await res.json();
  assertEquals(body.recipe.user_id, VERIFIED_USER_ID);
  assertEquals(body.recipe.id, CREATED_RECIPE_ID);
});

Deno.test("Database insert failures, RLS rejections, ownership mismatches, and invalid DB payloads return safe 500 INTERNAL_ERROR without leaking details", async () => {
  const sensitiveDetail = "postgres_secret_password_or_rls_internal_detail_98765";

  const failureScenarios: Array<(url: URL) => Response> = [
    () =>
      new Response(
        JSON.stringify({
          code: "42501",
          message: `new row violates row-level security policy for table "recipes" (${sensitiveDetail})`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    () =>
      new Response(
        JSON.stringify({
          code: "PGRST301",
          message: `Database connection error: ${sensitiveDetail}`,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    () =>
      new Response(
        JSON.stringify(
          persistedRecipeRow({
            user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          }),
        ),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    () =>
      new Response(
        JSON.stringify({
          id: "not-a-uuid",
          user_id: VERIFIED_USER_ID,
          title: "",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
  ];

  for (const buildPostgrestResponse of failureScenarios) {
    const mockFetch: typeof fetch = (input) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      );

      if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: VERIFIED_USER_ID,
              aud: "authenticated",
              role: "authenticated",
              email: VERIFIED_USER_EMAIL,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.pathname === "/rest/v1/recipes") {
        return Promise.resolve(buildPostgrestResponse(url));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    };

    const req = new Request("http://localhost/functions/v1/recipes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validRecipePayload()),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 500);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");

    const rawText = await res.text();
    assertEquals(rawText.includes(sensitiveDetail), false);
    assertEquals(rawText.includes(VALID_TEST_JWT), false);
    assertEquals(rawText.includes(TEST_ANON_KEY), false);
    assertEquals(rawText.includes("42501"), false);
    assertEquals(rawText.includes("at "), false);

    const body = JSON.parse(rawText);
    assertEquals(body, {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    });
  }
});

Deno.test("RecipeIdParamSchema, RecipeParamsSchema, RecipeListResponseSchema, and UpdateRecipeRequestSchema validate valid payloads and reject invalid inputs", () => {
  assertEquals(RecipeIdParamSchema.safeParse(CREATED_RECIPE_ID).success, true);
  assertEquals(RecipeIdParamSchema.safeParse("not-a-uuid").success, false);
  assertEquals(RecipeIdParamSchema.safeParse("").success, false);

  assertEquals(RecipeParamsSchema.safeParse({ id: CREATED_RECIPE_ID }).success, true);
  assertEquals(RecipeParamsSchema.safeParse({ id: "123" }).success, false);

  assertEquals(
    RecipeListResponseSchema.safeParse({ recipes: [persistedRecipeRow()] }).success,
    true,
  );
  assertEquals(RecipeListResponseSchema.safeParse({ recipes: [] }).success, true);
  assertEquals(RecipeListResponseSchema.safeParse({ recipes: [{ title: "No id" }] }).success, false);

  assertEquals(UpdateRecipeRequestSchema.safeParse({ star_rating: 4 }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ star_rating: null }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ star_rating: 6 }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ star_rating: 0 }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ star_rating: 3.5 }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ star_rating: "5" }).success, false);

  assertEquals(UpdateRecipeRequestSchema.safeParse({ cooked_at: "2026-10-21" }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ cooked_at: null }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ cooked_at: "2026-02-31" }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ cooked_at: "invalid" }).success, false);

  assertEquals(UpdateRecipeRequestSchema.safeParse({ notes: "Some notes" }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ notes: null }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ raw_input: "rice", notes: "custom" }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ raw_input: "Valid raw input" }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ raw_input: null }).success, true);

  for (const nullableField of [
    { raw_input: null },
    { notes: null },
    { flavor_scores: null },
    { star_rating: null },
    { cooked_at: null },
  ]) {
    assertEquals(UpdateRecipeRequestSchema.safeParse(nullableField).success, true);
  }

  for (const nonNullableField of [
    { title: null },
    { ingredients: null },
    { instructions: null },
  ]) {
    assertEquals(UpdateRecipeRequestSchema.safeParse(nonNullableField).success, false);
  }

  assertEquals(UpdateRecipeRequestSchema.safeParse({ title: "Updated Title" }).success, true);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ title: "   " }).success, false);

  assertEquals(UpdateRecipeRequestSchema.safeParse({}).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ user_id: VERIFIED_USER_ID }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ id: CREATED_RECIPE_ID }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ is_public: true }).success, false);
  assertEquals(UpdateRecipeRequestSchema.safeParse({ unexpected: true }).success, false);
});

Deno.test("Authenticated GET /recipes lists owned recipes ordered by created_at descending and validates schema envelope", async () => {
  let capturedPostgrestUrl: URL | null = null;
  let capturedPostgrestMethod: string | null = null;
  let capturedPostgrestHeaders: Headers | null = null;

  const secondRow = {
    ...persistedRecipeRow(),
    id: "44444444-4444-4444-8444-444444444444",
    title: "Garlic Fried Noodles",
    created_at: "2026-10-19T06:00:00.000Z",
  };

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      capturedPostgrestUrl = url;
      capturedPostgrestMethod = init?.method ?? "GET";
      capturedPostgrestHeaders = new Headers(init?.headers);

      return Promise.resolve(
        new Response(
          JSON.stringify([persistedRecipeRow(), secondRow]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const { endpointPath, expectedLimit, expectedOffset } of [
    { endpointPath: "/functions/v1/recipes?limit=1000&offset=0", expectedLimit: "1001", expectedOffset: "0" },
    { endpointPath: "/recipes?limit=25&offset=50", expectedLimit: "26", expectedOffset: "50" },
  ]) {
    const req = new Request(`http://localhost${endpointPath}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
      },
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");

    assertNotEquals(capturedPostgrestUrl, null);
    assertEquals(capturedPostgrestUrl!.pathname, "/rest/v1/recipes");
    assertEquals(
      capturedPostgrestUrl!.searchParams.get("select"),
      "id,user_id,title,raw_input,notes,ingredients,instructions,flavor_scores,star_rating,cooked_at,image_url,created_at,updated_at",
    );
    assertEquals(capturedPostgrestUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
    assertEquals(capturedPostgrestUrl!.searchParams.get("order"), "created_at.desc,id.asc");
    assertEquals(capturedPostgrestMethod, "GET");

    assertNotEquals(capturedPostgrestHeaders, null);
    assertEquals(capturedPostgrestHeaders!.get("authorization"), `Bearer ${VALID_TEST_JWT}`);
    assertEquals(capturedPostgrestHeaders!.get("apikey"), TEST_ANON_KEY);
    assertEquals(capturedPostgrestUrl!.searchParams.get("limit"), expectedLimit);
    assertEquals(capturedPostgrestUrl!.searchParams.get("offset"), expectedOffset);

    const body = await res.json();
    const parsed = RecipeListResponseSchema.safeParse(body);
    assertEquals(parsed.success, true);
    assertEquals(body.recipes.length, 2);
    assertEquals(body.recipes[0].id, CREATED_RECIPE_ID);
    assertEquals(body.recipes[0].user_id, VERIFIED_USER_ID);
    assertEquals(body.recipes[1].id, "44444444-4444-4444-8444-444444444444");
    assertEquals(body.recipes[0].is_public, undefined);
    assertEquals(body.recipes[0].image_path, undefined);
  }
});

Deno.test("Authenticated GET /recipes rejects invalid pagination before querying recipes", async () => {
  let recipeQueryCount = 0;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") recipeQueryCount += 1;
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const query of [
    "?limit=0",
    "?limit=1001",
    "?offset=-1",
    "?offset=1.5",
    "?limit=1000&offset=9007199254740991",
    "?limit=10&limit=20",
  ]) {
    const res = await handler(
      new Request(`http://localhost/functions/v1/recipes${query}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
      }),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: mockFetch,
      },
    );

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
    assertEquals(body.error?.message, "Invalid pagination parameters.");
  }

  assertEquals(recipeQueryCount, 0);
});

Deno.test("Authenticated GET /recipes returns empty list when user has no recipes", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(
          JSON.stringify([]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  const parsed = RecipeListResponseSchema.safeParse(body);
  assertEquals(parsed.success, true);
  assertEquals(body.recipes, []);
});

Deno.test("Authenticated GET /recipes/:id retrieves single owned recipe", async () => {
  let capturedPostgrestUrl: URL | null = null;
  let capturedPostgrestMethod: string | null = null;

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      capturedPostgrestUrl = url;
      capturedPostgrestMethod = init?.method ?? "GET";

      return Promise.resolve(
        new Response(
          JSON.stringify([persistedRecipeRow()]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const endpointPath of [
    `/functions/v1/recipes/${CREATED_RECIPE_ID}`,
    `/recipes/${CREATED_RECIPE_ID}`,
  ]) {
    const req = new Request(`http://localhost${endpointPath}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");

    assertNotEquals(capturedPostgrestUrl, null);
    assertEquals(capturedPostgrestUrl!.pathname, "/rest/v1/recipes");
    assertEquals(capturedPostgrestUrl!.searchParams.get("id"), `eq.${CREATED_RECIPE_ID}`);
    assertEquals(capturedPostgrestUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
    assertEquals(capturedPostgrestMethod, "GET");

    const body = await res.json();
    const parsed = RecipeResponseSchema.safeParse(body);
    assertEquals(parsed.success, true);
    assertEquals(body.recipe.id, CREATED_RECIPE_ID);
    assertEquals(body.recipe.user_id, VERIFIED_USER_ID);
    assertEquals(body.recipe.title, "Crispy Garlic Shallot Rice");
    assertEquals(body.recipe.star_rating, 5);
    assertEquals(body.recipe.is_public, undefined);
    assertEquals(body.recipe.image_path, undefined);
  }
});

Deno.test("Authenticated GET /recipes and GET /recipes/:id retrieve recipes with populated notes and null notes", async () => {
  const rowWithNotes = persistedRecipeRow({
    id: CREATED_RECIPE_ID,
    notes: "Populated notes content",
    raw_input: "Populated raw input",
  });
  const rowWithoutNotes = persistedRecipeRow({
    id: "44444444-4444-4444-8444-444444444444",
    notes: null,
    raw_input: null,
  });

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const idParam = url.searchParams.get("id");
      if (idParam === `eq.${CREATED_RECIPE_ID}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify([rowWithNotes]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([rowWithNotes, rowWithoutNotes]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const listReq = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });
  const listRes = await handler(listReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(listRes.status, 200);
  const listBody = await listRes.json();
  assertEquals(listBody.recipes.length, 2);
  assertEquals(listBody.recipes[0].notes, "Populated notes content");
  assertEquals(listBody.recipes[0].raw_input, "Populated raw input");
  assertEquals(listBody.recipes[1].notes, null);
  assertEquals(listBody.recipes[1].raw_input, null);

  const detailReq = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });
  const detailRes = await handler(detailReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(detailRes.status, 200);
  const detailBody = await detailRes.json();
  assertEquals(detailBody.recipe.notes, "Populated notes content");
  assertEquals(detailBody.recipe.raw_input, "Populated raw input");
});

Deno.test("Authenticated GET /recipes/:id returns 404 NOT_FOUND for missing recipe or another user recipe", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(
          JSON.stringify([]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const missingId = "88888888-8888-4888-8888-888888888888";
  const req = new Request(`http://localhost/functions/v1/recipes/${missingId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 404);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  const body = await res.json();
  assertEquals(body.error?.code, "NOT_FOUND");
  assertEquals(body.error?.message, "Recipe not found.");
});

Deno.test("Malformed recipe ID on detail, update, and delete returns 400 VALIDATION_ERROR with field details", async () => {
  let postgrestCalls = 0;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalls++;
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const malformedIds = ["not-a-uuid", "123", "33333333-3333-4333-8333", "undefined"];

  for (const id of malformedIds) {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const req = new Request(`http://localhost/functions/v1/recipes/${id}`, {
        method,
        headers: {
          Authorization: `Bearer ${VALID_TEST_JWT}`,
          ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "PATCH" ? { body: JSON.stringify({ star_rating: 4 }) } : {}),
      });

      const res = await handler(req, {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: mockFetch,
      });

      assertEquals(res.status, 400);
      assertEquals(res.headers.get("cache-control"), "no-store");
      assertEquals(res.headers.get("x-content-type-options"), "nosniff");
      const body = await res.json();
      assertEquals(body.error?.code, "VALIDATION_ERROR");
      assertEquals(body.error?.message, "Invalid recipe ID.");
      assertEquals(Array.isArray(body.error?.details), true);
      assertEquals(body.error.details[0].path, "id");
    }
  }

  assertEquals(postgrestCalls, 0);
});

Deno.test("Authenticated PATCH /recipes/:id updates allowed fields and persists rating", async () => {
  let capturedPostgrestUrl: URL | null = null;
  let capturedPostgrestMethod: string | null = null;
  let capturedUpdateBody: Record<string, unknown> | null = null;

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      capturedPostgrestUrl = url;
      capturedPostgrestMethod = init?.method ?? "GET";
      const rawText = typeof init?.body === "string" ? init.body : "";
      capturedUpdateBody = rawText ? JSON.parse(rawText) : null;

      const updatedRow = persistedRecipeRow({
        title: capturedUpdateBody?.title ?? "Crispy Garlic Shallot Rice",
        star_rating: capturedUpdateBody?.star_rating ?? 5,
        raw_input: capturedUpdateBody?.raw_input ?? "Leftover jasmine rice, shallots, garlic, soy sauce.",
        cooked_at: capturedUpdateBody?.cooked_at ?? "2026-10-19",
      });

      return Promise.resolve(
        new Response(
          JSON.stringify([updatedRow]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Updated Garlic Shallot Rice",
      star_rating: 4,
    }),
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 200);
  assertNotEquals(capturedPostgrestUrl, null);
  assertEquals(capturedPostgrestUrl!.pathname, "/rest/v1/recipes");
  assertEquals(capturedPostgrestUrl!.searchParams.get("id"), `eq.${CREATED_RECIPE_ID}`);
  assertEquals(capturedPostgrestUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
  assertEquals(capturedPostgrestMethod, "PATCH");

  assertNotEquals(capturedUpdateBody, null);
  assertEquals(capturedUpdateBody!.title, "Updated Garlic Shallot Rice");
  assertEquals(capturedUpdateBody!.star_rating, 4);
  assertEquals(capturedUpdateBody!.ingredients, undefined);
  assertEquals(capturedUpdateBody!.instructions, undefined);
  assertEquals(capturedUpdateBody!.raw_input, undefined);
  assertEquals(capturedUpdateBody!.notes, undefined);

  const body = await res.json();
  const parsed = RecipeResponseSchema.safeParse(body);
  assertEquals(parsed.success, true);
  assertEquals(body.recipe.title, "Updated Garlic Shallot Rice");
  assertEquals(body.recipe.star_rating, 4);

  const rawInputReq = new Request(`http://localhost/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw_input: "Custom chef raw input",
      star_rating: null,
      cooked_at: null,
    }),
  });

  const rawInputRes = await handler(rawInputReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(rawInputRes.status, 200);
  assertNotEquals(capturedUpdateBody, null);
  assertEquals(capturedUpdateBody!.raw_input, "Custom chef raw input");
  assertEquals(capturedUpdateBody!.star_rating, null);
  assertEquals(capturedUpdateBody!.cooked_at, null);
  assertEquals(capturedUpdateBody!.notes, undefined);
});

Deno.test("Authenticated PATCH /recipes/:id updates notes without modifying raw_input and preserves omitted fields", async () => {
  let capturedUpdateBody: Record<string, unknown> | null = null;
  let currentRecipe = persistedRecipeRow({
    raw_input: "Unmodified raw input",
    notes: "Initial note",
  });

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const rawText = typeof init?.body === "string" ? init.body : "";
      capturedUpdateBody = rawText ? JSON.parse(rawText) : null;

      currentRecipe = {
        ...currentRecipe,
        ...capturedUpdateBody,
      };

      return Promise.resolve(
        new Response(
          JSON.stringify([currentRecipe]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const patchNotesReq = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notes: "Updated secret garlic glaze note",
    }),
  });

  const patchNotesRes = await handler(patchNotesReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(patchNotesRes.status, 200);
  assertNotEquals(capturedUpdateBody, null);
  assertEquals(capturedUpdateBody!.notes, "Updated secret garlic glaze note");
  assertEquals(capturedUpdateBody!.raw_input, undefined);
  assertEquals(capturedUpdateBody!.title, undefined);
  assertEquals(capturedUpdateBody!.ingredients, undefined);
  assertEquals(capturedUpdateBody!.instructions, undefined);
  assertEquals(capturedUpdateBody!.star_rating, undefined);
  assertEquals(capturedUpdateBody!.flavor_scores, undefined);
  assertEquals(capturedUpdateBody!.cooked_at, undefined);

  const notesBody = await patchNotesRes.json();
  assertEquals(notesBody.recipe.notes, "Updated secret garlic glaze note");
  assertEquals(notesBody.recipe.raw_input, "Unmodified raw input");

  const patchRawInputReq = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw_input: "New separate raw input prompt",
    }),
  });

  const patchRawInputRes = await handler(patchRawInputReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(patchRawInputRes.status, 200);
  assertNotEquals(capturedUpdateBody, null);
  assertEquals(capturedUpdateBody!.raw_input, "New separate raw input prompt");
  assertEquals(capturedUpdateBody!.notes, undefined);

  const rawInputBody = await patchRawInputRes.json();
  assertEquals(rawInputBody.recipe.raw_input, "New separate raw input prompt");
  assertEquals(rawInputBody.recipe.notes, "Updated secret garlic glaze note");
});

Deno.test("Authenticated PATCH /recipes/:id clears notes with explicit null while preserving raw_input and vice versa", async () => {
  let capturedUpdateBody: Record<string, unknown> | null = null;
  let currentRecipe = persistedRecipeRow({
    raw_input: "Persistent raw input text",
    notes: "Persistent notes text",
  });

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const rawText = typeof init?.body === "string" ? init.body : "";
      capturedUpdateBody = rawText ? JSON.parse(rawText) : null;

      currentRecipe = {
        ...currentRecipe,
        ...capturedUpdateBody,
      };

      return Promise.resolve(
        new Response(
          JSON.stringify([currentRecipe]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const clearNotesReq = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notes: null,
    }),
  });

  const clearNotesRes = await handler(clearNotesReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(clearNotesRes.status, 200);
  assertNotEquals(capturedUpdateBody, null);
  assertEquals(capturedUpdateBody!.notes, null);
  assertEquals(capturedUpdateBody!.raw_input, undefined);

  const clearNotesBody = await clearNotesRes.json();
  assertEquals(clearNotesBody.recipe.notes, null);
  assertEquals(clearNotesBody.recipe.raw_input, "Persistent raw input text");

  currentRecipe = persistedRecipeRow({
    raw_input: "Persistent raw input text",
    notes: "Persistent notes text",
  });

  const clearRawInputReq = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw_input: null,
    }),
  });

  const clearRawInputRes = await handler(clearRawInputReq, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(clearRawInputRes.status, 200);
  assertNotEquals(capturedUpdateBody, null);
  assertEquals(capturedUpdateBody!.raw_input, null);
  assertEquals(capturedUpdateBody!.notes, undefined);

  const clearRawInputBody = await clearRawInputRes.json();
  assertEquals(clearRawInputBody.recipe.raw_input, null);
  assertEquals(clearRawInputBody.recipe.notes, "Persistent notes text");
});

Deno.test("Authenticated PATCH /recipes/:id accepts every valid rating 1 to 5 and rejects invalid ratings before database update", async () => {
  let postgrestUpdateCalls = 0;

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      postgrestUpdateCalls++;
      const rawText = typeof init?.body === "string" ? init.body : "";
      const parsedBody = rawText ? JSON.parse(rawText) : {};
      return Promise.resolve(
        new Response(
          JSON.stringify([persistedRecipeRow({ star_rating: parsedBody.star_rating })]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const rating of [1, 2, 3, 4, 5]) {
    const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ star_rating: rating }),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.recipe.star_rating, rating);
  }
  assertEquals(postgrestUpdateCalls, 5);

  const invalidRatings = [0, 6, -1, 3.5, "five", true, {}];
  for (const badRating of invalidRatings) {
    const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ star_rating: badRating }),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }

  assertEquals(postgrestUpdateCalls, 5);
});

Deno.test("Authenticated PATCH /recipes/:id with empty object body fails validation with 400 VALIDATION_ERROR and zero database calls", async () => {
  let postgrestCalls = 0;

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalls++;
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 400);
  assertEquals(postgrestCalls, 0);
  const body = await res.json();
  assertEquals(body.error?.code, "VALIDATION_ERROR");
});

Deno.test("Authenticated PATCH /recipes/:id rejects invalid JSON, non-object JSON, and unsupported or protected fields", async () => {
  let postgrestCalls = 0;

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalls++;
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const invalidJsonBodies = ["", "   ", "{broken", "[]", "[1, 2, 3]", "\"string\"", "123", "null"];
  for (const rawBody of invalidJsonBodies) {
    const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: rawBody,
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "INVALID_JSON");
  }

  const unsupportedPayloads = [
    { user_id: "00000000-0000-0000-0000-000000000000" },
    { id: "11111111-1111-1111-1111-111111111111" },
    { is_public: true },
    { unknown_field: "hacked" },
    { image_path: "secret.png" },
    { created_at: "2020-01-01T00:00:00Z" },
    { updated_at: "2020-01-01T00:00:00Z" },
  ];

  for (const payload of unsupportedPayloads) {
    const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }

  assertEquals(postgrestCalls, 0);
});

Deno.test("Authenticated PATCH /recipes/:id returns 404 NOT_FOUND for missing recipe or another user recipe", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(
          JSON.stringify([]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ star_rating: 4 }),
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error?.code, "NOT_FOUND");
  assertEquals(body.error?.message, "Recipe not found.");
});

Deno.test("Authenticated DELETE /recipes/:id deletes owned recipe and returns 204 No Content", async () => {
  let capturedPostgrestUrl: URL | null = null;
  let capturedPostgrestMethod: string | null = null;

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      capturedPostgrestUrl = url;
      capturedPostgrestMethod = init?.method ?? "GET";

      return Promise.resolve(
        new Response(
          JSON.stringify([{ id: CREATED_RECIPE_ID }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const endpointPath of [
    `/functions/v1/recipes/${CREATED_RECIPE_ID}`,
    `/recipes/${CREATED_RECIPE_ID}`,
  ]) {
    const req = new Request(`http://localhost${endpointPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 204);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(await res.text(), "");

    assertNotEquals(capturedPostgrestUrl, null);
    assertEquals(capturedPostgrestUrl!.pathname, "/rest/v1/recipes");
    assertEquals(capturedPostgrestUrl!.searchParams.get("id"), `eq.${CREATED_RECIPE_ID}`);
    assertEquals(capturedPostgrestUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
    assertEquals(capturedPostgrestMethod, "DELETE");
  }
});

Deno.test("Authenticated DELETE /recipes/:id returns 404 NOT_FOUND for missing recipe or another user recipe", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(
          JSON.stringify([]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error?.code, "NOT_FOUND");
  assertEquals(body.error?.message, "Recipe not found.");
});

Deno.test("Member routes reject unsupported HTTP methods with 405 and Allow: GET, PATCH, DELETE, OPTIONS", async () => {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = () => {
    fetchCalls++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (const method of ["POST", "PUT", "HEAD"]) {
    const req = new Request(`http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, {
      method,
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(res.status, 405);
    assertEquals(res.headers.get("allow"), "GET, PATCH, DELETE, OPTIONS");
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    const body = await res.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
  }

  assertEquals(fetchCalls, 0);
});

Deno.test("Unauthenticated requests across GET list, GET detail, PATCH, and DELETE return 401 UNAUTHORIZED", async () => {
  let postgrestCalls = 0;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 401,
            error_code: "bad_jwt",
            msg: "invalid JWT",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalls++;
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const endpoints = [
    { url: "http://localhost/functions/v1/recipes", method: "GET" },
    { url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, method: "GET" },
    {
      url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`,
      method: "PATCH",
      body: JSON.stringify({ star_rating: 4 }),
    },
    { url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, method: "DELETE" },
  ];

  for (const endpoint of endpoints) {
    const noAuthReq = new Request(endpoint.url, {
      method: endpoint.method,
      headers: endpoint.body ? { "Content-Type": "application/json" } : {},
      ...(endpoint.body ? { body: endpoint.body } : {}),
    });

    const noAuthRes = await handler(noAuthReq, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(noAuthRes.status, 401);
    const noAuthBody = await noAuthRes.json();
    assertEquals(noAuthBody.error?.code, "UNAUTHORIZED");

    const badAuthReq = new Request(endpoint.url, {
      method: endpoint.method,
      headers: {
        Authorization: "Bearer invalid-token",
        ...(endpoint.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(endpoint.body ? { body: endpoint.body } : {}),
    });

    const badAuthRes = await handler(badAuthReq, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(badAuthRes.status, 401);
    const badAuthBody = await badAuthRes.json();
    assertEquals(badAuthBody.error?.code, "UNAUTHORIZED");
  }

  assertEquals(postgrestCalls, 0);
});

Deno.test("Database failures and ownership mismatches on list, detail, update, and delete return safe 500 INTERNAL_ERROR", async () => {
  const sensitiveSecret = "SECRET_DATABASE_FAILURE_TOKEN_XYZ";

  const errorFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: `Fatal error in postgres: ${sensitiveSecret}`,
            code: "42501",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const mismatchFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );

    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            persistedRecipeRow({ user_id: "00000000-0000-0000-0000-000000000000" }),
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const failureRequests = [
    { url: "http://localhost/functions/v1/recipes", method: "GET", fetchImpl: errorFetch },
    { url: "http://localhost/functions/v1/recipes", method: "GET", fetchImpl: mismatchFetch },
    { url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, method: "GET", fetchImpl: errorFetch },
    { url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, method: "GET", fetchImpl: mismatchFetch },
    {
      url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`,
      method: "PATCH",
      body: JSON.stringify({ star_rating: 4 }),
      fetchImpl: errorFetch,
    },
    {
      url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`,
      method: "PATCH",
      body: JSON.stringify({ star_rating: 4 }),
      fetchImpl: mismatchFetch,
    },
    { url: `http://localhost/functions/v1/recipes/${CREATED_RECIPE_ID}`, method: "DELETE", fetchImpl: errorFetch },
  ];

  for (const item of failureRequests) {
    const req = new Request(item.url, {
      method: item.method,
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        ...(item.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(item.body ? { body: item.body } : {}),
    });

    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: item.fetchImpl,
    });

    assertEquals(res.status, 500);
    const rawText = await res.text();
    assertEquals(rawText.includes(sensitiveSecret), false);
    assertEquals(rawText.includes("42501"), false);
    const body = JSON.parse(rawText);
    assertEquals(body.error?.code, "INTERNAL_ERROR");
  }
});

const LINKED_PRODUCTION_PROJECT_REF = "gtbwblxskctpsqhbpebg";

type RlsResolvedConfig = {
  isOptedIn: boolean;
  shouldRun: boolean;
  error?: string;
  source?: "BE-06" | "NON_PRODUCTION_TEST_DATABASE";
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  expectedProjectRef: string;
  databaseUrl?: string;
};

function extractSupabaseProjectRef(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    return host.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function extractProjectRefFromKey(key: string): string | null {
  if (!key || typeof key !== "string") return null;
  const parts = key.trim().split(".");
  if (parts.length === 3 && parts[1]) {
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
      const decoded = JSON.parse(atob(padded));
      if (decoded && typeof decoded.ref === "string" && decoded.ref.trim()) {
        return decoded.ref.trim();
      }
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeDatabaseUrl(url: string | undefined): string {
  if (!url || typeof url !== "string") return "";
  let str = url.trim();
  while (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'")) ||
    (str.startsWith("`") && str.endsWith("`"))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

function resolveRlsConfiguration(
  getEnv: (key: string) => string | undefined = (k) => Deno.env.get(k),
): RlsResolvedConfig {
  const be06OptIn = (getEnv("RUN_BE06_RLS_INTEGRATION") ?? "").trim();
  const be06Url = (getEnv("BE06_RLS_TEST_SUPABASE_URL") ?? "").trim();
  const be06DbUrl = sanitizeDatabaseUrl(getEnv("BE06_RLS_TEST_DATABASE_URL"));
  const be06Anon = (
    getEnv("BE06_RLS_TEST_SUPABASE_ANON_KEY")?.trim() ||
    getEnv("BE06_RLS_TEST_SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    ""
  );
  const be06Service = (
    getEnv("BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    getEnv("BE06_RLS_TEST_SUPABASE_SECRET_KEY")?.trim() ||
    ""
  );
  const be06ExpectedRef = (
    getEnv("BE06_RLS_TEST_EXPECTED_PROJECT_REF")?.trim() ||
    getEnv("BE06_RLS_TEST_PROJECT_REF")?.trim() ||
    ""
  );

  const hasAnyBe06 = Boolean(
    be06OptIn || be06Url || be06DbUrl || be06Anon || be06Service || be06ExpectedRef,
  );

  if (hasAnyBe06) {
    const isOptedIn = be06OptIn.toLowerCase() === "true" || be06OptIn === "1";
    if (!isOptedIn) {
      const nonProdOptIn = (getEnv("RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION") ?? "").trim();
      const isLegacyOptedIn = nonProdOptIn.toLowerCase() === "true" || nonProdOptIn === "1";
      if (isLegacyOptedIn) {
        return {
          isOptedIn: true,
          shouldRun: true,
          source: "BE-06",
          error: "Inconsistent RLS test configuration: RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION is enabled but BE-06 variables are present without RUN_BE06_RLS_INTEGRATION=true. BE-06 credentials cannot be mixed with NON_PRODUCTION_TEST_DATABASE.",
          url: be06Url,
          anonKey: be06Anon,
          serviceRoleKey: be06Service,
          expectedProjectRef: be06ExpectedRef,
        };
      }
      return {
        isOptedIn: false,
        shouldRun: false,
        url: "",
        anonKey: "",
        serviceRoleKey: "",
        expectedProjectRef: "",
      };
    }
    const missing: string[] = [];
    if (!be06Url) missing.push("BE06_RLS_TEST_SUPABASE_URL");
    if (!be06Anon) missing.push("BE06_RLS_TEST_SUPABASE_ANON_KEY (or BE06_RLS_TEST_SUPABASE_PUBLISHABLE_KEY)");
    if (!be06Service) missing.push("BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY (or BE06_RLS_TEST_SUPABASE_SECRET_KEY)");
    if (!be06ExpectedRef) missing.push("BE06_RLS_TEST_EXPECTED_PROJECT_REF");

    if (missing.length > 0) {
      return {
        isOptedIn: true,
        shouldRun: true,
        source: "BE-06",
        error: `BE-06 live RLS integration test enabled but configuration is incomplete: missing ${missing.join(", ")} (never falling back to NON_PRODUCTION_TEST_DATABASE variables when BE-06 is configured).`,
        url: be06Url,
        anonKey: be06Anon,
        serviceRoleKey: be06Service,
        expectedProjectRef: be06ExpectedRef,
      };
    }

    return {
      isOptedIn: true,
      shouldRun: true,
      source: "BE-06",
      url: be06Url,
      anonKey: be06Anon,
      serviceRoleKey: be06Service,
      expectedProjectRef: be06ExpectedRef,
      databaseUrl: be06DbUrl || undefined,
    };
  }

  const nonProdOptIn = (getEnv("RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION") ?? "").trim();
  const isLegacyOptedIn = nonProdOptIn.toLowerCase() === "true" || nonProdOptIn === "1";
  if (!isLegacyOptedIn) {
    return {
      isOptedIn: false,
      shouldRun: false,
      url: "",
      anonKey: "",
      serviceRoleKey: "",
      expectedProjectRef: "",
    };
  }

  const nonProdUrl = (getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL") ?? "").trim();
  const nonProdDbUrl = sanitizeDatabaseUrl(getEnv("NON_PRODUCTION_TEST_DATABASE_URL"));
  const nonProdAnon = (
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY")?.trim() ||
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    ""
  );
  const nonProdService = (
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY")?.trim() ||
    ""
  );
  const nonProdExpectedRef = (
    getEnv("NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF")?.trim() ||
    getEnv("NON_PRODUCTION_TEST_DATABASE_PROJECT_REF")?.trim() ||
    extractProjectRefFromKey(nonProdAnon) ||
    extractProjectRefFromKey(nonProdService) ||
    ""
  );

  const missingLegacy: string[] = [];
  if (!nonProdUrl) missingLegacy.push("NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL");
  if (!nonProdAnon) missingLegacy.push("NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY (or NON_PRODUCTION_TEST_DATABASE_SUPABASE_PUBLISHABLE_KEY)");
  if (!nonProdService) missingLegacy.push("NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY (or NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY)");
  if (!nonProdExpectedRef) {
    missingLegacy.push("NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF");
  }

  if (missingLegacy.length > 0) {
    return {
      isOptedIn: true,
      shouldRun: true,
      source: "NON_PRODUCTION_TEST_DATABASE",
      error: `Non-production test database live RLS integration test enabled but configuration is incomplete: missing ${missingLegacy.join(", ")}.`,
      url: nonProdUrl,
      anonKey: nonProdAnon,
      serviceRoleKey: nonProdService,
      expectedProjectRef: nonProdExpectedRef,
    };
  }

  return {
    isOptedIn: true,
    shouldRun: true,
    source: "NON_PRODUCTION_TEST_DATABASE",
    url: nonProdUrl,
    anonKey: nonProdAnon,
    serviceRoleKey: nonProdService,
    expectedProjectRef: nonProdExpectedRef,
    databaseUrl: nonProdDbUrl || undefined,
  };
}

const rlsConfig = resolveRlsConfiguration();
const testSupabaseUrl = rlsConfig.url;
const testAnonKey = rlsConfig.anonKey;
const testServiceRoleKey = rlsConfig.serviceRoleKey;
const testExpectedProjectRef = rlsConfig.expectedProjectRef;
const testDatabaseUrl = rlsConfig.databaseUrl;

if (!rlsConfig.shouldRun) {
  console.warn(
    "[BE-06 RLS Integration] Skipping live hosted PostgreSQL RLS integration test for recipes (opt-in RUN_BE06_RLS_INTEGRATION=true not set).",
  );
}

function redactSecrets(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }
  return sanitized;
}

function isModernApiKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.startsWith("sb_secret_") || trimmed.startsWith("sb_publishable_");
}

function createRlsClientFetch(apiKey: string, baseFetch: typeof fetch = fetch): typeof fetch {
  const trimmedKey = apiKey.trim();
  if (!isModernApiKey(trimmedKey)) {
    return baseFetch;
  }
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    if (auth && auth.trim().toLowerCase() === `bearer ${trimmedKey.toLowerCase()}`) {
      headers.delete("authorization");
    }
    return baseFetch(input, { ...init, headers });
  };
}

function createRlsTestClient(
  url: string,
  key: string,
  options?: Parameters<typeof createClient>[2],
): ReturnType<typeof createClient> {
  const trimmedKey = key.trim();
  const baseFetch = options?.global?.fetch ?? fetch;

  return createClient(url, trimmedKey, {
    ...options,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      ...options?.auth,
    },
    global: {
      ...options?.global,
      fetch: createRlsClientFetch(trimmedKey, baseFetch),
    },
  });
}

function validateDedicatedTestTarget(
  url: string,
  anonKey: string,
  serviceRoleKey: string,
  expectedProjectRef: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("RLS test target URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("RLS test target URL must use HTTPS.");
  }
  if (isLoopbackHost(parsed.hostname) && (parsed.port || "443") === "54321") {
    throw new Error(
      "Safety guard rejected test target: hosted RLS tests must not target the local Supabase API.",
    );
  }
  const extractedRef = extractSupabaseProjectRef(url);
  if (!extractedRef) {
    throw new Error(
      `Safety guard rejected test target: unable to extract valid Supabase project reference from target URL '${url}'.`,
    );
  }
  if (!expectedProjectRef || !expectedProjectRef.trim()) {
    throw new Error(
      "Safety guard rejected test target: expected test-project reference must be explicitly configured.",
    );
  }
  if (extractedRef.toLowerCase() !== expectedProjectRef.trim().toLowerCase()) {
    throw new Error(
      `Safety guard rejected test target: expected project reference '${expectedProjectRef}' does not match target URL project reference '${extractedRef}'.`,
    );
  }
  if (
    extractedRef.toLowerCase() === LINKED_PRODUCTION_PROJECT_REF.toLowerCase() ||
    extractedRef.toLowerCase() === KNOWN_PRODUCTION_REF.toLowerCase() ||
    parsed.hostname.includes(LINKED_PRODUCTION_PROJECT_REF) ||
    parsed.hostname.includes(KNOWN_PRODUCTION_REF)
  ) {
    throw new Error(
      "Safety guard rejected test target: refuses to run against the primary linked production project.",
    );
  }
  const regularAppUrl = (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL") ?? "").trim();
  if (regularAppUrl) {
    try {
      const parsedRegular = new URL(regularAppUrl);
      if (parsedRegular.origin === parsed.origin) {
        throw new Error(
          "Safety guard rejected test target: must target a dedicated test project distinct from SUPABASE_URL/VITE_SUPABASE_URL.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Safety guard")) {
        throw err;
      }
    }
  }
  if (anonKey === serviceRoleKey) {
    throw new Error(
      "Safety guard rejected test keys: anon key must not equal service role key.",
    );
  }
}

function extractProjectRefFromDatabaseUrl(connectionString: string): string | null {
  const sanitized = sanitizeDatabaseUrl(connectionString);
  if (!sanitized) return null;
  try {
    const parsed = new URL(sanitized);
    const host = parsed.hostname.toLowerCase();
    const hostMatch = host.match(/^db\.([a-z0-9-]+)\.supabase\.co$/);
    if (hostMatch && hostMatch[1]) {
      return hostMatch[1];
    }
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
      return parsed.username.match(/^[^.]+\.([a-z0-9-]+)$/)?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function validateTestDatabaseTarget(connectionString: string, expectedProjectRef: string): void {
  const sanitized = sanitizeDatabaseUrl(connectionString);
  if (!sanitized) {
    throw new Error("Test database connection string is missing.");
  }
  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    throw new Error("Test database connection string is invalid.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Test database connection string must use postgresql: protocol.");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "[::1]";
  if (isLocal) {
    throw new Error("Safety guard rejected test database target: hosted test database must not target localhost/loopback.");
  }
  if (!expectedProjectRef || typeof expectedProjectRef !== "string" || !expectedProjectRef.trim()) {
    throw new Error("Safety guard rejected test database target: expected test-project reference must be explicitly configured.");
  }
  const extractedRef = extractProjectRefFromDatabaseUrl(sanitized);
  if (!extractedRef) {
    throw new Error("Safety guard rejected test database target: unable to extract Supabase project reference from connection string.");
  }
  if (extractedRef.toLowerCase() !== expectedProjectRef.trim().toLowerCase()) {
    throw new Error(`Safety guard rejected test database target: expected project reference '${expectedProjectRef.trim()}' does not match database URL project reference '${extractedRef}'.`);
  }
  const configuredMainRef = (Deno.env.get("RLS_EXPECTED_PROJECT_REF") || "").trim().toLowerCase();
  const knownProductionRef = "gtbwblxskctpsqhbpebg";
  if (
    extractedRef.toLowerCase() === knownProductionRef ||
    (configuredMainRef && extractedRef.toLowerCase() === configuredMainRef) ||
    parsed.hostname.toLowerCase().includes(knownProductionRef) ||
    parsed.username.toLowerCase().includes(knownProductionRef) ||
    (configuredMainRef && (parsed.hostname.toLowerCase().includes(configuredMainRef) || parsed.username.toLowerCase().includes(configuredMainRef)))
  ) {
    throw new Error("Safety guard rejected test database target: refuses to target the primary linked production project (gtbwblxskctpsqhbpebg).");
  }
}

Deno.test("Hosted recipe CRUD RLS target safety guards enforce HTTPS, non-local, non-production, distinct keys, project ref verification, and credential isolation", () => {
  const anonKey = "sb_publishable_test_valid_key_1234567890";
  const serviceRoleKey = "sb_secret_test_valid_key_1234567890";
  const expectedRef = "recipes-https-guard";

  validateDedicatedTestTarget(
    "https://recipes-https-guard.supabase.co",
    anonKey,
    serviceRoleKey,
    expectedRef,
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://recipes-https-guard.supabase.co",
        anonKey,
        serviceRoleKey,
        "different-ref",
      ),
    Error,
    "does not match target URL project reference",
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://recipes-https-guard.supabase.co",
        anonKey,
        serviceRoleKey,
        "",
      ),
    Error,
    "expected test-project reference must be explicitly configured",
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://expected-ref.supabase.attacker.example",
        anonKey,
        serviceRoleKey,
        "expected-ref",
      ),
    Error,
    "unable to extract valid Supabase project reference",
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "http://recipes-https-guard.supabase.co",
        anonKey,
        serviceRoleKey,
        expectedRef,
      ),
    Error,
    "must use HTTPS",
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://127.0.0.1:54321",
        anonKey,
        serviceRoleKey,
        "local",
      ),
    Error,
    "must not target the local Supabase API",
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        `https://${LINKED_PRODUCTION_PROJECT_REF}.supabase.co`,
        anonKey,
        serviceRoleKey,
        LINKED_PRODUCTION_PROJECT_REF,
      ),
    Error,
    "refuses to run against the primary linked production project",
  );
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://recipes-https-guard.supabase.co",
        anonKey,
        anonKey,
        expectedRef,
      ),
    Error,
    "must not equal",
  );

  const envNeither: Record<string, string> = {};
  assertEquals(resolveRlsConfiguration((k) => envNeither[k]).shouldRun, false);

  const envBe06OptOut: Record<string, string> = { RUN_BE06_RLS_INTEGRATION: "false" };
  assertEquals(resolveRlsConfiguration((k) => envBe06OptOut[k]).shouldRun, false);

  const envBe06Incomplete: Record<string, string> = {
    RUN_BE06_RLS_INTEGRATION: "true",
    BE06_RLS_TEST_SUPABASE_URL: "https://be06-test.supabase.co",
  };
  const be06IncompleteResult = resolveRlsConfiguration((k) => envBe06Incomplete[k]);
  assertEquals(be06IncompleteResult.shouldRun, true);
  assertEquals(be06IncompleteResult.source, "BE-06");
  assertNotEquals(be06IncompleteResult.error, undefined);

  const envMixingAttempt: Record<string, string> = {
    RUN_BE06_RLS_INTEGRATION: "true",
    BE06_RLS_TEST_SUPABASE_URL: "https://be06-test.supabase.co",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY: anonKey,
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF: "be06-test",
  };
  const mixingResult = resolveRlsConfiguration((k) => envMixingAttempt[k]);
  assertEquals(mixingResult.shouldRun, true);
  assertEquals(mixingResult.source, "BE-06");
  assertNotEquals(mixingResult.error, undefined);
  assertEquals(mixingResult.anonKey, "");

  const envBe06Complete: Record<string, string> = {
    RUN_BE06_RLS_INTEGRATION: "true",
    BE06_RLS_TEST_SUPABASE_URL: "https://be06-test.supabase.co",
    BE06_RLS_TEST_SUPABASE_ANON_KEY: anonKey,
    BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    BE06_RLS_TEST_EXPECTED_PROJECT_REF: "be06-test",
  };
  const be06CompleteResult = resolveRlsConfiguration((k) => envBe06Complete[k]);
  assertEquals(be06CompleteResult.shouldRun, true);
  assertEquals(be06CompleteResult.source, "BE-06");
  assertEquals(be06CompleteResult.error, undefined);
  assertEquals(be06CompleteResult.expectedProjectRef, "be06-test");

  const envLegacyComplete: Record<string, string> = {
    RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: "true",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: "https://non-prod-test.supabase.co",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY: anonKey,
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF: "non-prod-test",
  };
  const legacyCompleteResult = resolveRlsConfiguration((k) => envLegacyComplete[k]);
  assertEquals(legacyCompleteResult.shouldRun, true);
  assertEquals(legacyCompleteResult.source, "NON_PRODUCTION_TEST_DATABASE");
  assertEquals(legacyCompleteResult.error, undefined);
  assertEquals(legacyCompleteResult.expectedProjectRef, "non-prod-test");

  const envLegacyIncomplete: Record<string, string> = {
    RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: "true",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: "https://non-prod-test.supabase.co",
  };
  const legacyIncompleteResult = resolveRlsConfiguration((k) => envLegacyIncomplete[k]);
  assertEquals(legacyIncompleteResult.shouldRun, true);
  assertEquals(legacyIncompleteResult.source, "NON_PRODUCTION_TEST_DATABASE");
  assertNotEquals(legacyIncompleteResult.error, undefined);

  const envLegacyMissingRef: Record<string, string> = {
    RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: "true",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: "https://non-prod-test.supabase.co",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY: anonKey,
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
  const legacyMissingRefResult = resolveRlsConfiguration((k) => envLegacyMissingRef[k]);
  assertEquals(legacyMissingRefResult.shouldRun, true);
  assertEquals(legacyMissingRefResult.source, "NON_PRODUCTION_TEST_DATABASE");
  assertEquals(
    legacyMissingRefResult.error,
    "Non-production test database live RLS integration test enabled but configuration is incomplete: missing NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF.",
  );

  const envLegacyProjectRefAlias: Record<string, string> = {
    RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: "true",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: "https://non-prod-test.supabase.co",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY: anonKey,
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NON_PRODUCTION_TEST_DATABASE_PROJECT_REF: "non-prod-test",
  };
  const legacyAliasResult = resolveRlsConfiguration((k) => envLegacyProjectRefAlias[k]);
  assertEquals(legacyAliasResult.shouldRun, true);
  assertEquals(legacyAliasResult.source, "NON_PRODUCTION_TEST_DATABASE");
  assertEquals(legacyAliasResult.error, undefined);
  assertEquals(legacyAliasResult.expectedProjectRef, "non-prod-test");

  const envInconsistentMixedOptIn: Record<string, string> = {
    RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: "true",
    BE06_RLS_TEST_SUPABASE_URL: "https://be06-test.supabase.co",
  };
  const inconsistentResult = resolveRlsConfiguration((k) => envInconsistentMixedOptIn[k]);
  assertEquals(inconsistentResult.shouldRun, true);
  assertEquals(inconsistentResult.source, "BE-06");
  assertNotEquals(inconsistentResult.error, undefined);

  const legacyJwtAnon =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJyZWYiOiJqd3QtcHJvaiIsInJvbGUiOiJhbm9uIn0.valid_anon_sig";
  const envLegacyJwt: Record<string, string> = {
    RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: "true",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: "https://jwt-proj.supabase.co",
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY: legacyJwtAnon,
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
  const legacyJwtResult = resolveRlsConfiguration((k) => envLegacyJwt[k]);
  assertEquals(legacyJwtResult.shouldRun, true);
  assertEquals(legacyJwtResult.source, "NON_PRODUCTION_TEST_DATABASE");
  assertEquals(legacyJwtResult.error, undefined);
  assertEquals(legacyJwtResult.expectedProjectRef, "jwt-proj");

  assertEquals(
    sanitizeDatabaseUrl('"postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres"'),
    "postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres",
  );
  assertEquals(
    sanitizeDatabaseUrl("'postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres'"),
    "postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres",
  );
  assertEquals(
    extractProjectRefFromDatabaseUrl("postgresql://postgres.my-test-proj:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"),
    "my-test-proj",
  );
  assertEquals(
    extractProjectRefFromDatabaseUrl('"postgresql://postgres.my-test-proj:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"'),
    "my-test-proj",
  );
  assertEquals(
    extractProjectRefFromDatabaseUrl("'postgresql://postgres.my-test-proj:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres'"),
    "my-test-proj",
  );
  assertEquals(
    extractProjectRefFromDatabaseUrl("postgresql://postgres:secret@db.my-test-proj.supabase.co:5432/postgres"),
    "my-test-proj",
  );
  assertEquals(
    extractProjectRefFromDatabaseUrl("postgresql://postgres:secret@127.0.0.1:5432/postgres"),
    null,
  );

  assertThrows(
    () => validateTestDatabaseTarget("", "my-test-proj"),
    Error,
    "Test database connection string is missing.",
  );
  assertThrows(
    () => validateTestDatabaseTarget("http://my-host:5432/postgres", "my-test-proj"),
    Error,
    "Test database connection string must use postgresql: protocol.",
  );
  assertThrows(
    () => validateTestDatabaseTarget("postgresql://postgres:pass@127.0.0.1:5432/postgres", "my-test-proj"),
    Error,
    "Safety guard rejected test database target: hosted test database must not target localhost/loopback.",
  );
  assertThrows(
    () => validateTestDatabaseTarget("postgresql://postgres.other-proj:pass@aws-0.pooler.supabase.com:5432/postgres", "my-test-proj"),
    Error,
    "expected project reference 'my-test-proj' does not match database URL project reference 'other-proj'",
  );
  assertThrows(
    () => validateTestDatabaseTarget("postgresql://postgres.gtbwblxskctpsqhbpebg:pass@aws-0.pooler.supabase.com:5432/postgres", "gtbwblxskctpsqhbpebg"),
    Error,
    "refuses to target the primary linked production project",
  );

  validateTestDatabaseTarget(
    '"postgresql://postgres.my-test-proj:pass@aws-0.pooler.supabase.com:5432/postgres"',
    "my-test-proj",
  );
  validateTestDatabaseTarget(
    "'postgresql://postgres:pass@db.my-test-proj.supabase.co:5432/postgres'",
    "my-test-proj",
  );

  const envBe06WithDbUrl: Record<string, string> = {
    ...envBe06Complete,
    BE06_RLS_TEST_DATABASE_URL: "postgresql://postgres.be06-test:pass@aws-0.pooler.supabase.com:5432/postgres",
  };
  const be06WithDbUrlResult = resolveRlsConfiguration((k) => envBe06WithDbUrl[k]);
  assertEquals(be06WithDbUrlResult.shouldRun, true);
  assertEquals(be06WithDbUrlResult.databaseUrl, "postgresql://postgres.be06-test:pass@aws-0.pooler.supabase.com:5432/postgres");

  const envLegacyWithDbUrl: Record<string, string> = {
    ...envLegacyComplete,
    NON_PRODUCTION_TEST_DATABASE_URL: "postgresql://postgres.non-prod-test:pass@aws-0.pooler.supabase.com:5432/postgres",
  };
  const legacyWithDbUrlResult = resolveRlsConfiguration((k) => envLegacyWithDbUrl[k]);
  assertEquals(legacyWithDbUrlResult.shouldRun, true);
  assertEquals(legacyWithDbUrlResult.databaseUrl, "postgresql://postgres.non-prod-test:pass@aws-0.pooler.supabase.com:5432/postgres");
});

Deno.test({
  name: "Live PostgreSQL schema preflight: public.recipes.notes is present and queryable as nullable text (hosted integration)",
  ignore: !rlsConfig.shouldRun,
  fn: async () => {
    if (rlsConfig.error) {
      throw new Error(rlsConfig.error);
    }
    validateDedicatedTestTarget(
      testSupabaseUrl,
      testAnonKey,
      testServiceRoleKey,
      testExpectedProjectRef,
    );
    if (testDatabaseUrl) {
      validateTestDatabaseTarget(testDatabaseUrl, testExpectedProjectRef);
    }

    const adminClient = createRlsTestClient(testSupabaseUrl, testServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { error: probeError } = await adminClient
      .from("recipes")
      .select("notes")
      .limit(0);

    if (probeError) {
      if (probeError.code === "PGRST204" || probeError.message?.includes("notes")) {
        throw new Error(
          `Preflight verification failed: PostgREST returned PGRST204 for column 'notes' in schema cache. Migration '20261023000002_add_notes_to_recipes.sql' must be applied to the test database and PostgREST schema cache reloaded. Set BE06_RLS_TEST_DATABASE_URL (or NON_PRODUCTION_TEST_DATABASE_URL) to apply test database migrations.`,
        );
      }
      throw new Error(`Preflight verification failed: ${probeError.message}`);
    }
  },
});

Deno.test({
  name: "Live PostgreSQL persistence and RLS enforcement for recipe CRUD (hosted integration)",
  ignore: !rlsConfig.shouldRun,
  fn: async () => {
    if (rlsConfig.error) {
      throw new Error(rlsConfig.error);
    }
    const knownSecrets = [testAnonKey, testServiceRoleKey];
    validateDedicatedTestTarget(
      testSupabaseUrl,
      testAnonKey,
      testServiceRoleKey,
      testExpectedProjectRef,
    );

    const adminClient = createRlsTestClient(testSupabaseUrl, testServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { error: preflightError } = await adminClient
      .from("recipes")
      .select("notes")
      .limit(0);
    if (preflightError) {
      if (preflightError.code === "PGRST204" || preflightError.message?.includes("notes")) {
        throw new Error(
          `Preflight verification failed: PostgREST returned PGRST204 for column 'notes'. Migration '20261023000002_add_notes_to_recipes.sql' must be applied to the dedicated test database before running hosted CRUD tests. Set BE06_RLS_TEST_DATABASE_URL (or NON_PRODUCTION_TEST_DATABASE_URL).`,
        );
      }
      throw new Error(`Preflight verification failed: ${preflightError.message}`);
    }

    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const userAEmail = `be05-rls-a-${runId}@morisscraps.test`;
    const userBEmail = `be05-rls-b-${runId}@morisscraps.test`;
    const userAPassword = `PassA!${crypto.randomUUID()}9`;
    const userBPassword = `PassB!${crypto.randomUUID()}9`;
    knownSecrets.push(userAPassword, userBPassword);

    const createdUserIds: string[] = [];
    const createdRecipeIds: string[] = [];
    let primaryError: Error | null = null;

    try {
      const { data: createdA, error: createErrorA } = await adminClient.auth.admin.createUser({
        email: userAEmail,
        password: userAPassword,
        email_confirm: true,
      });
      if (createErrorA || !createdA?.user?.id) {
        throw new Error(
          `Failed to create test User A: ${redactSecrets(createErrorA?.message ?? "missing user id", knownSecrets)}`,
        );
      }
      const userAId = createdA.user.id;
      createdUserIds.push(userAId);

      const { data: createdB, error: createErrorB } = await adminClient.auth.admin.createUser({
        email: userBEmail,
        password: userBPassword,
        email_confirm: true,
      });
      if (createErrorB || !createdB?.user?.id) {
        throw new Error(
          `Failed to create test User B: ${redactSecrets(createErrorB?.message ?? "missing user id", knownSecrets)}`,
        );
      }
      const userBId = createdB.user.id;
      createdUserIds.push(userBId);

      const anonClientA = createRlsTestClient(testSupabaseUrl, testAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: signInA, error: signInErrorA } = await anonClientA.auth.signInWithPassword({
        email: userAEmail,
        password: userAPassword,
      });
      if (signInErrorA || !signInA?.session?.access_token) {
        throw new Error(
          `Failed to sign in User A: ${redactSecrets(signInErrorA?.message ?? "missing token", knownSecrets)}`,
        );
      }
      const userAAccessToken = signInA.session.access_token;
      knownSecrets.push(userAAccessToken);

      const anonClientB = createRlsTestClient(testSupabaseUrl, testAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: signInB, error: signInErrorB } = await anonClientB.auth.signInWithPassword({
        email: userBEmail,
        password: userBPassword,
      });
      if (signInErrorB || !signInB?.session?.access_token) {
        throw new Error(
          `Failed to sign in User B: ${redactSecrets(signInErrorB?.message ?? "missing token", knownSecrets)}`,
        );
      }
      const userBAccessToken = signInB.session.access_token;
      knownSecrets.push(userBAccessToken);

      const createReq = new Request("http://localhost/functions/v1/recipes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validRecipePayload(),
          user_id: userBId,
          is_public: true,
        }),
      });

      const createRes = await handler(createReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(createRes.status, 201);
      const createBody = await createRes.json();
      const createdId = createBody.recipe?.id;
      assertEquals(typeof createdId, "string");
      createdRecipeIds.push(createdId);
      assertEquals(createBody.recipe.user_id, userAId);

      const { data: persistedRow, error: verifyError } = await adminClient
        .from("recipes")
        .select("id, user_id, title, is_public")
        .eq("id", createdId)
        .single();
      assertEquals(verifyError, null);
      assertEquals(persistedRow?.id, createdId);
      assertEquals(persistedRow?.user_id, userAId);
      assertEquals(persistedRow?.is_public, false);

      const rlsClientB = createRlsTestClient(testSupabaseUrl, testAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${userBAccessToken}` } },
      });
      const { data: crossReadRows, error: crossReadError } = await rlsClientB
        .from("recipes")
        .select("id")
        .eq("id", createdId);
      assertEquals(crossReadError, null);
      assertEquals(crossReadRows, []);

      const listReq = new Request("http://localhost/functions/v1/recipes", {
        method: "GET",
        headers: { Authorization: `Bearer ${userAAccessToken}` },
      });
      const listRes = await handler(listReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(listRes.status, 200);
      const listBody = await listRes.json();
      assertEquals(Array.isArray(listBody.recipes), true);
      assertEquals(listBody.recipes.some((r: { id: string }) => r.id === createdId), true);

      const detailReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${userAAccessToken}` },
      });
      const detailRes = await handler(detailReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(detailRes.status, 200);
      const detailBody = await detailRes.json();
      assertEquals(detailBody.recipe?.id, createdId);
      assertEquals(detailBody.recipe?.user_id, userAId);

      const patchReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userAAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          star_rating: 4,
          cooked_at: "2026-10-22",
          raw_input: "Chef test prompt",
        }),
      });
      const patchRes = await handler(patchReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(patchRes.status, 200);
      const patchBody = await patchRes.json();
      assertEquals(patchBody.recipe?.star_rating, 4);
      assertEquals(patchBody.recipe?.cooked_at, "2026-10-22");
      assertEquals(patchBody.recipe?.raw_input, "Chef test prompt");

      const readAfterPatchRes = await handler(detailReq.clone(), {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(readAfterPatchRes.status, 200);
      const readAfterPatchBody = await readAfterPatchRes.json();
      assertEquals(readAfterPatchBody.recipe?.star_rating, 4);
      assertEquals(readAfterPatchBody.recipe?.raw_input, "Chef test prompt");

      const patchEmptyReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userAAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const patchEmptyRes = await handler(patchEmptyReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(patchEmptyRes.status, 400);

      const patchNotesReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userAAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: "personal notes" }),
      });
      const patchNotesRes = await handler(patchNotesReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(patchNotesRes.status, 200);
      const patchNotesBody = await patchNotesRes.json();
      assertEquals(patchNotesBody.recipe?.notes, "personal notes");
      assertEquals(patchNotesBody.recipe?.raw_input, "Chef test prompt");

      const patchNullReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userAAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ star_rating: null, raw_input: null, notes: null }),
      });
      const patchNullRes = await handler(patchNullReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(patchNullRes.status, 200);
      const patchNullBody = await patchNullRes.json();
      assertEquals(patchNullBody.recipe?.star_rating, null);
      assertEquals(patchNullBody.recipe?.raw_input, null);
      assertEquals(patchNullBody.recipe?.notes, null);

      const readAfterNullRes = await handler(detailReq.clone(), {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(readAfterNullRes.status, 200);
      const readAfterNullBody = await readAfterNullRes.json();
      assertEquals(readAfterNullBody.recipe?.star_rating, null);
      assertEquals(readAfterNullBody.recipe?.raw_input, null);
      assertEquals(readAfterNullBody.recipe?.notes, null);

      const crossGetReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${userBAccessToken}` },
      });
      const crossGetRes = await handler(crossGetReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(crossGetRes.status, 404);

      const crossPatchReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userBAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Attacker Title" }),
      });
      const crossPatchRes = await handler(crossPatchReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(crossPatchRes.status, 404);

      const crossDeleteReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userBAccessToken}` },
      });
      const crossDeleteRes = await handler(crossDeleteReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(crossDeleteRes.status, 404);

      const deleteReq = new Request(`http://localhost/functions/v1/recipes/${createdId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userAAccessToken}` },
      });
      const deleteRes = await handler(deleteReq, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(deleteRes.status, 204);

      const readAfterDeleteRes = await handler(detailReq.clone(), {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
      });
      assertEquals(readAfterDeleteRes.status, 404);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      primaryError = new Error(redactSecrets(rawMessage, knownSecrets));
    } finally {
      await cleanupRlsTestResources(
        adminClient,
        createdRecipeIds,
        createdUserIds,
        knownSecrets,
        primaryError,
      );
    }
  },
});

type RlsCleanupAdminClient = {
  from: (table: string) => {
    delete: () => {
      in: (column: string, values: string[]) => PromiseLike<{ error: { message?: string } | null }>;
    };
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => PromiseLike<{ data: Array<{ id: string }> | null; error: { message?: string } | null }>;
    };
  };
  auth: {
    admin: {
      deleteUser: (id: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

async function cleanupRlsTestResources(
  adminClient: RlsCleanupAdminClient,
  createdRecipeIds: string[],
  createdUserIds: string[],
  knownSecrets: string[],
  primaryError: Error | null,
): Promise<void> {
  const cleanupErrors: string[] = [];
  const deleteRows = async (table: string, column: string, values: string[], label: string) => {
    try {
      const { error } = await adminClient.from(table).delete().in(column, values);
      if (error) {
        cleanupErrors.push(
          `Failed to delete test ${label}: ${redactSecrets(error.message || "unknown error", knownSecrets)}`,
        );
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      cleanupErrors.push(
        `Failed to delete test ${label}: ${redactSecrets(rawMessage, knownSecrets)}`,
      );
    }
  };

  if (createdRecipeIds.length > 0) {
    await deleteRows("recipes", "id", createdRecipeIds, "recipe rows");
  }
  if (createdUserIds.length > 0) {
    await deleteRows("recipes", "user_id", createdUserIds, "user recipe rows");
    await deleteRows("profiles", "id", createdUserIds, "profile rows");
    for (const uid of createdUserIds) {
      try {
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);
        if (deleteError) {
          cleanupErrors.push(
            `Failed to delete test user ${uid}: ${redactSecrets(deleteError.message || "unknown error", knownSecrets)}`,
          );
        }
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        cleanupErrors.push(
          `Failed to delete test user ${uid}: ${redactSecrets(rawMessage, knownSecrets)}`,
        );
      }
    }

    try {
      const { data: remainingRecipes, error: verifyError } = await adminClient
        .from("recipes")
        .select("id")
        .in("user_id", createdUserIds);
      if (verifyError) {
        cleanupErrors.push(
          `Failed to verify recipe cleanup: ${redactSecrets(verifyError.message || "unknown error", knownSecrets)}`,
        );
      } else if (remainingRecipes === null) {
        cleanupErrors.push("Failed to verify recipe cleanup: no rows were returned.");
      } else if (remainingRecipes.length > 0) {
        cleanupErrors.push(
          `Cleanup incomplete: ${remainingRecipes.length} test recipe row(s) still present.`,
        );
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      cleanupErrors.push(
        `Failed to verify recipe cleanup: ${redactSecrets(rawMessage, knownSecrets)}`,
      );
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new Error(
      `${redactSecrets(primaryError.message, knownSecrets)} | Cleanup failed: ${cleanupErrors.join("; ")}`,
      { cause: primaryError },
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Cleanup failed: ${cleanupErrors.join("; ")}`);
  }
}

Deno.test("RLS test cleanup reports table and auth-user failures, redacts secrets, attempts all users, and preserves primary failures", async () => {
  const mockServiceRoleKey = "secret-service-role-key-value";
  const mockAnonKey = "secret-anon-key-value";
  const knownSecrets = [mockAnonKey, mockServiceRoleKey];

  const deletedTables: Array<{ table: string; column: string; values: string[] }> = [];
  const deletedUsersSuccess: string[] = [];

  const successAdminClient: RlsCleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string, values: string[]) => {
          deletedTables.push({ table, column, values });
          return Promise.resolve({ error: null });
        },
      }),
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          deletedUsersSuccess.push(id);
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  await cleanupRlsTestResources(
    successAdminClient,
    ["recipe-1"],
    ["user-a", "user-b"],
    knownSecrets,
    null,
  );

  assertEquals(deletedTables, [
    { table: "recipes", column: "id", values: ["recipe-1"] },
    { table: "recipes", column: "user_id", values: ["user-a", "user-b"] },
    { table: "profiles", column: "id", values: ["user-a", "user-b"] },
  ]);
  assertEquals(deletedUsersSuccess, ["user-a", "user-b"]);

  const attemptedUsersAfterTableError: string[] = [];
  const tableFailureAdminClient: RlsCleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string) =>
          Promise.resolve({
            error:
              table === "recipes" && column === "id"
                ? { message: `Recipe deletion failed with ${mockServiceRoleKey}` }
                : null,
          }),
      }),
      select: () => ({
        in: () => Promise.resolve({ data: [{ id: "leftover-recipe" }], error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          attemptedUsersAfterTableError.push(id);
          return Promise.resolve({ error: null });
        },
      },
    },
  };
  const tableCleanupError = await assertRejects(
    () =>
      cleanupRlsTestResources(
        tableFailureAdminClient,
        ["recipe-1"],
        ["user-a"],
        knownSecrets,
        null,
      ),
    Error,
  );
  assertEquals(attemptedUsersAfterTableError, ["user-a"]);
  assertEquals(
    tableCleanupError.message.includes(
      "Failed to delete test recipe rows: Recipe deletion failed with [REDACTED]",
    ),
    true,
  );
  assertEquals(
    tableCleanupError.message.includes("Cleanup incomplete: 1 test recipe row(s) still present."),
    true,
  );
  assertEquals(tableCleanupError.message.includes(mockServiceRoleKey), false);

  const attemptedUsersOnFailure: string[] = [];
  const failingAdminClient: RlsCleanupAdminClient = {
    from: () => ({
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
      }),
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          attemptedUsersOnFailure.push(id);
          if (id === "user-a") {
            return Promise.resolve({
              error: {
                message: `Auth delete failed using key ${mockServiceRoleKey}`,
              },
            });
          }
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  const cleanupOnlyError = await assertRejects(
    () =>
      cleanupRlsTestResources(
        failingAdminClient,
        ["recipe-1"],
        ["user-a", "user-b"],
        knownSecrets,
        null,
      ),
    Error,
  );

  assertEquals(attemptedUsersOnFailure, ["user-a", "user-b"]);
  assertEquals(
    cleanupOnlyError.message.includes(
      "Failed to delete test user user-a: Auth delete failed using key [REDACTED]",
    ),
    true,
  );
  assertEquals(cleanupOnlyError.message.includes(mockServiceRoleKey), false);
  assertEquals(cleanupOnlyError.message.includes(mockAnonKey), false);

  const attemptedUsersWithPrimaryError: string[] = [];
  const bothFailAdminClient: RlsCleanupAdminClient = {
    from: () => ({
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
      }),
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          attemptedUsersWithPrimaryError.push(id);
          return Promise.resolve({
            error: {
              message: `Delete rejected for ${id} (${mockAnonKey})`,
            },
          });
        },
      },
    },
  };

  const earlierError = new Error("Primary RLS assertion failed: expected 201 to equal 500");
  const combinedError = await assertRejects(
    () =>
      cleanupRlsTestResources(
        bothFailAdminClient,
        [],
        ["user-a", "user-b"],
        knownSecrets,
        earlierError,
      ),
    Error,
  );

  assertEquals(attemptedUsersWithPrimaryError, ["user-a", "user-b"]);
  assertEquals(
    combinedError.message.includes("Primary RLS assertion failed: expected 201 to equal 500"),
    true,
  );
  assertEquals(
    combinedError.message.includes(
      "Failed to delete test user user-a: Delete rejected for user-a ([REDACTED])",
    ),
    true,
  );
  assertEquals(
    combinedError.message.includes(
      "Failed to delete test user user-b: Delete rejected for user-b ([REDACTED])",
    ),
    true,
  );
  assertEquals(combinedError.message.includes(mockServiceRoleKey), false);
  assertEquals(combinedError.message.includes(mockAnonKey), false);
  assertEquals(combinedError.cause, earlierError);
});

Deno.test("cleanupRlsTestResources handles thrown deleteUser exceptions by failing, attempting remaining users, preserving primary errors, and redacting secrets", async () => {
  const mockServiceRoleKey = "secret-service-role-key-value";
  const mockAnonKey = "secret-anon-key-value";
  const knownSecrets = [mockAnonKey, mockServiceRoleKey];

  const attemptedUsers: string[] = [];
  const throwingAdminClient: RlsCleanupAdminClient = {
    from: () => ({
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
      }),
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          attemptedUsers.push(id);
          if (id === "user-a") {
            return Promise.reject(
              new Error(`Network exception during deleteUser with ${mockServiceRoleKey}`),
            );
          }
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  const thrownCleanupError = await assertRejects(
    () =>
      cleanupRlsTestResources(
        throwingAdminClient,
        ["recipe-1"],
        ["user-a", "user-b"],
        knownSecrets,
        null,
      ),
    Error,
  );

  assertEquals(attemptedUsers, ["user-a", "user-b"]);
  assertEquals(
    thrownCleanupError.message.includes(
      "Failed to delete test user user-a: Network exception during deleteUser with [REDACTED]",
    ),
    true,
  );
  assertEquals(thrownCleanupError.message.includes(mockServiceRoleKey), false);
  assertEquals(thrownCleanupError.message.includes(mockAnonKey), false);

  const attemptedUsersWithPrimary: string[] = [];
  const throwingWithPrimaryAdminClient: RlsCleanupAdminClient = {
    from: () => ({
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
      }),
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          attemptedUsersWithPrimary.push(id);
          if (id === "user-a") {
            throw new Error(`Thrown sync error for ${id} (${mockAnonKey})`);
          }
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  const earlierError = new Error(
    `Primary test failure before thrown cleanup (${mockServiceRoleKey})`,
  );
  const combinedThrownError = await assertRejects(
    () =>
      cleanupRlsTestResources(
        throwingWithPrimaryAdminClient,
        [],
        ["user-a", "user-b"],
        knownSecrets,
        earlierError,
      ),
    Error,
  );

  assertEquals(attemptedUsersWithPrimary, ["user-a", "user-b"]);
  assertEquals(
    combinedThrownError.message.includes("Primary test failure before thrown cleanup ([REDACTED])"),
    true,
  );
  assertEquals(
    combinedThrownError.message.includes(
      "Failed to delete test user user-a: Thrown sync error for user-a ([REDACTED])",
    ),
    true,
  );
  assertEquals(combinedThrownError.message.includes(mockServiceRoleKey), false);
  assertEquals(combinedThrownError.message.includes(mockAnonKey), false);
  assertEquals(combinedThrownError.cause, earlierError);
});

Deno.test("Authenticated GET /recipes search filters match title, ingredient, trimmed whitespace, and empty values", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const cases = [
    { query: "?title=Garlic", check: () => assertEquals(capturedUrl!.searchParams.get("title"), 'ilike."%Garlic%"') },
    { query: "?title=garlic+rice", check: () => assertEquals(capturedUrl!.searchParams.get("title"), 'ilike."%garlic rice%"') },
    { query: "?title=%20%20crispy%20%20", check: () => assertEquals(capturedUrl!.searchParams.get("title"), 'ilike."%crispy%"') },
    { query: "?ingredient=shallots", check: () => assertEquals(capturedUrl!.searchParams.get("ingredients_text"), 'ilike."%shallots%"') },
    { query: "?ingredient=%20%20jasmine%20%20", check: () => assertEquals(capturedUrl!.searchParams.get("ingredients_text"), 'ilike."%jasmine%"') },
    {
      query: "?title=rice&ingredient=shallots",
      check: () => {
        assertEquals(capturedUrl!.searchParams.get("title"), 'ilike."%rice%"');
        assertEquals(capturedUrl!.searchParams.get("ingredients_text"), 'ilike."%shallots%"');
      },
    },
    {
      query: "?title=%20%20&ingredient=",
      check: () => {
        assertEquals(capturedUrl!.searchParams.has("title"), false);
        assertEquals(capturedUrl!.searchParams.has("ingredients_text"), false);
      },
    },
  ];

  for (const { query, check } of cases) {
    const res = await handler(new Request(`http://localhost/functions/v1/recipes${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(res.status, 200);
    check();
  }
});

Deno.test("Authenticated GET /recipes search returns empty collection when no recipes match query", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const res = await handler(new Request("http://localhost/functions/v1/recipes?title=nonexistent&ingredient=nonexistent", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.recipes, []);
  assertEquals(body.has_more, false);
  assertEquals(body.next_cursor, null);
});

Deno.test("Authenticated GET /recipes rejects duplicate and invalid search and sort query parameters", async () => {
  let recipeCalls = 0;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      recipeCalls++;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const invalidQueries = [
    "?sort=invalid",
    "?sort=newest&sort=rating",
    "?title=a&title=b",
    "?ingredient=x&ingredient=y",
    "?cursor=a&cursor=b",
    "?offset=0&offset=10",
    "?cursor=xyz&offset=0",
    "?pagination=cursor&offset=0",
    "?pagination=offset&cursor=xyz",
    "?pagination=invalid",
    "?pagination=cursor&pagination=offset",
    "?pagination=cursor&limit=101",
    "?limit=1001",
    "?limit=0",
    "?limit=-1",
    "?limit=abc",
  ];

  for (const query of invalidQueries) {
    const res = await handler(new Request(`http://localhost/functions/v1/recipes${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }

  assertEquals(recipeCalls, 0);
});

Deno.test("Authenticated GET /recipes sorting applies newest and rating modes at database query layer", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const defaultSortRes = await handler(new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(defaultSortRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("order"), "created_at.desc,id.asc");

  const newestSortRes = await handler(new Request("http://localhost/functions/v1/recipes?sort=newest", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(newestSortRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("order"), "created_at.desc,id.asc");

  const ratingSortRes = await handler(new Request("http://localhost/functions/v1/recipes?sort=rating", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(ratingSortRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("order"), "star_rating.desc.nullslast,created_at.desc,id.asc");
});

Deno.test("Authenticated GET /recipes pagination supports first page, custom limits, next_cursor continuation, and final page", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      const rows = [];
      const requestedLimit = Number(url.searchParams.get("limit") ?? "21");
      for (let i = 0; i < requestedLimit; i++) {
        const idNum = String(i + 1).padStart(12, "0");
        rows.push({
          ...persistedRecipeRow(),
          id: `00000000-0000-0000-0000-${idNum}`,
          title: `Recipe ${i + 1}`,
          star_rating: 5,
          created_at: `2026-10-20T${String(23 - (i % 24)).padStart(2, "0")}:00:00.000Z`,
        });
      }
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const page1Res = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(page1Res.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "21");
  const page1Body = await page1Res.json();
  assertEquals(page1Body.recipes.length, 20);
  assertEquals(page1Body.has_more, true);
  assertNotEquals(page1Body.next_cursor, null);

  const continuationRes = await handler(new Request(`http://localhost/functions/v1/recipes?cursor=${encodeURIComponent(page1Body.next_cursor)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(continuationRes.status, 200);
  assertNotEquals(capturedUrl!.searchParams.get("or"), null);
  const lastPage1Row = page1Body.recipes[19];
  assertEquals(
    capturedUrl!.searchParams.get("or"),
    `(created_at.lt.${lastPage1Row.created_at},and(created_at.eq.${lastPage1Row.created_at},id.gt.${lastPage1Row.id}))`,
  );

  const customLimitRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&limit=5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(customLimitRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "6");
  const customLimitBody = await customLimitRes.json();
  assertEquals(customLimitBody.recipes.length, 5);
  assertEquals(customLimitBody.has_more, true);

  const finalPageFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const finalPageRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&limit=20", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: finalPageFetch });
  assertEquals(finalPageRes.status, 200);
  const finalPageBody = await finalPageRes.json();
  assertEquals(finalPageBody.recipes.length, 1);
  assertEquals(finalPageBody.has_more, false);
  assertEquals(finalPageBody.next_cursor, null);
});

Deno.test("Authenticated GET /recipes pagination supports rating sort keyset continuation with nullable ratings", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([
        persistedRecipeRow({ star_rating: 4, id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-20T00:00:00.000Z" }),
        persistedRecipeRow({ star_rating: 4, id: "22222222-2222-4222-8222-222222222222", created_at: "2026-10-19T00:00:00.000Z" }),
        persistedRecipeRow({ star_rating: null, id: "33333333-3333-4333-8333-333333333333", created_at: "2026-10-18T00:00:00.000Z" }),
      ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const page1Res = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&sort=rating&limit=2", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(page1Res.status, 200);
  const page1Body = await page1Res.json();
  assertEquals(page1Body.recipes.length, 2);
  assertEquals(page1Body.has_more, true);
  assertNotEquals(page1Body.next_cursor, null);

  const ratedContinuationRes = await handler(new Request(`http://localhost/functions/v1/recipes?sort=rating&limit=2&cursor=${encodeURIComponent(page1Body.next_cursor)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(ratedContinuationRes.status, 200);
  assertEquals(
    capturedUrl!.searchParams.get("or"),
    "(star_rating.lt.4,star_rating.is.null,and(star_rating.eq.4,created_at.lt.2026-10-19T00:00:00.000Z),and(star_rating.eq.4,created_at.eq.2026-10-19T00:00:00.000Z,id.gt.22222222-2222-4222-8222-222222222222))",
  );

  const unratedCursorObj = {
    sort: "rating",
    id: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-10-18T00:00:00.000Z",
    starRating: null,
  };
  const unratedCursor = btoa(JSON.stringify(unratedCursorObj));

  const unratedContinuationRes = await handler(new Request(`http://localhost/functions/v1/recipes?sort=rating&limit=2&cursor=${encodeURIComponent(unratedCursor)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(unratedContinuationRes.status, 200);
  assertEquals(
    capturedUrl!.searchParams.get("or"),
    "(and(star_rating.is.null,created_at.lt.2026-10-18T00:00:00.000Z),and(star_rating.is.null,created_at.eq.2026-10-18T00:00:00.000Z,id.gt.33333333-3333-4333-8333-333333333333))",
  );
});

Deno.test("Authenticated GET /recipes rejects malformed cursors and cursors incompatible with filters or sort mode", async () => {
  let recipeCalls = 0;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      recipeCalls++;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const malformedCursors = [
    "not-base-64",
    btoa("not json"),
    btoa(JSON.stringify({ unknown: true })),
    btoa(JSON.stringify({ sort: "newest", id: "not-a-uuid", createdAt: "2026-10-20" })),
  ];

  for (const cursor of malformedCursors) {
    const res = await handler(new Request(`http://localhost/functions/v1/recipes?cursor=${encodeURIComponent(cursor)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }

  const newestCursor = btoa(JSON.stringify({
    sort: "newest",
    id: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-10-20T00:00:00.000Z",
  }));

  const sortMismatchRes = await handler(new Request(`http://localhost/functions/v1/recipes?sort=rating&cursor=${encodeURIComponent(newestCursor)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(sortMismatchRes.status, 400);
  const sortMismatchBody = await sortMismatchRes.json();
  assertEquals(sortMismatchBody.error?.code, "VALIDATION_ERROR");

  const filterCursor = btoa(JSON.stringify({
    sort: "newest",
    title: "garlic",
    id: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-10-20T00:00:00.000Z",
  }));

  const filterMismatchRes = await handler(new Request(`http://localhost/functions/v1/recipes?title=onion&cursor=${encodeURIComponent(filterCursor)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(filterMismatchRes.status, 400);
  const filterMismatchBody = await filterMismatchRes.json();
  assertEquals(filterMismatchBody.error?.code, "VALIDATION_ERROR");

  assertEquals(recipeCalls, 0);
});

Deno.test("Authenticated GET /recipes owner isolation is enforced across search, sorting, and cursor pagination", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const queries = [
    "?title=Garlic",
    "?ingredient=shallots",
    "?sort=rating",
    "?sort=newest&limit=5",
  ];

  for (const q of queries) {
    const res = await handler(new Request(`http://localhost/functions/v1/recipes${q}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(res.status, 200);
    assertEquals(capturedUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
  }

  const foreignCursor = btoa(JSON.stringify({
    sort: "newest",
    id: "99999999-9999-4999-8999-999999999999",
    createdAt: "2026-10-20T00:00:00.000Z",
  }));

  const foreignCursorRes = await handler(new Request(`http://localhost/functions/v1/recipes?cursor=${encodeURIComponent(foreignCursor)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(foreignCursorRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);

  const mockLeakFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(JSON.stringify([
        persistedRecipeRow({ user_id: "77777777-7777-4777-8777-777777777777" }),
      ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const leakedRes = await handler(new Request("http://localhost/functions/v1/recipes?title=test", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockLeakFetch });
  assertEquals(leakedRes.status, 500);
  const leakedBody = await leakedRes.json();
  assertEquals(leakedBody.error?.code, "INTERNAL_ERROR");
});
Deno.test("Regression BE-08 Task 1: Authenticated GET /recipes ingredient search uses ingredients_text and handles Unicode and isolation", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      const ingFilter = url.searchParams.get("ingredients_text");
      if (ingFilter && ingFilter.includes("nonexistent")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const matchingRes = await handler(new Request("http://localhost/functions/v1/recipes?ingredient=ginger", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(matchingRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("ingredients_text"), 'ilike."%ginger%"');
  assertEquals(capturedUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
  const matchingBody = await matchingRes.json();
  assertEquals(matchingBody.recipes.length, 1);

  const nonMatchingRes = await handler(new Request("http://localhost/functions/v1/recipes?ingredient=nonexistent", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(nonMatchingRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("ingredients_text"), 'ilike."%nonexistent%"');
  const nonMatchingBody = await nonMatchingRes.json();
  assertEquals(nonMatchingBody.recipes.length, 0);
  assertEquals(nonMatchingBody.has_more, false);

  for (const unicodeTerm of ["🍵", "生姜", "чеснок"]) {
    const unicodeRes = await handler(new Request(`http://localhost/functions/v1/recipes?ingredient=${encodeURIComponent(unicodeTerm)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(unicodeRes.status, 200);
    assertEquals(capturedUrl!.searchParams.get("ingredients_text"), `ilike."%${unicodeTerm}%"`);
    assertEquals(capturedUrl!.searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
  }

  const combinedRes = await handler(new Request("http://localhost/functions/v1/recipes?title=Matcha&ingredient=%F0%9F%8D%B5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(combinedRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("title"), 'ilike."%Matcha%"');
  assertEquals(capturedUrl!.searchParams.get("ingredients_text"), 'ilike."%🍵%"');
});

Deno.test("Regression BE-08 Task 2: Authenticated GET /recipes preserves BE-06 list contract and opt-in cursor mode", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const noParamsRes = await handler(new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(noParamsRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "1001");
  assertEquals(capturedUrl!.searchParams.get("offset"), "0");
  const noParamsBody = await noParamsRes.json();
  assertEquals(noParamsBody.next_cursor, null);

  const limit200Res = await handler(new Request("http://localhost/functions/v1/recipes?limit=200", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(limit200Res.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "201");
  assertEquals(capturedUrl!.searchParams.get("offset"), "0");
  const limit200Body = await limit200Res.json();
  assertEquals(limit200Body.next_cursor, null);

  const offsetOnlyRes = await handler(new Request("http://localhost/functions/v1/recipes?offset=50", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(offsetOnlyRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "1001");
  assertEquals(capturedUrl!.searchParams.get("offset"), "50");

  const limitAndOffsetRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=100&offset=50", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(limitAndOffsetRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "101");
  assertEquals(capturedUrl!.searchParams.get("offset"), "50");

  const maxLegacyLimitRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=1000", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(maxLegacyLimitRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "1001");

  const exceedingLimitRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=1001", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(exceedingLimitRes.status, 400);

  const optInCursorRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(optInCursorRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "21");
  assertEquals(capturedUrl!.searchParams.has("offset"), false);

  const optInCursorLimitRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&limit=50", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(optInCursorLimitRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "51");

  const optInCursorMaxLimitRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&limit=100", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(optInCursorMaxLimitRes.status, 200);
  assertEquals(capturedUrl!.searchParams.get("limit"), "101");

  const optInCursorExceedingRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&limit=101", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(optInCursorExceedingRes.status, 400);

  const conflictCursorOffsetRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&offset=10", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(conflictCursorOffsetRes.status, 400);

  const conflictOffsetCursorRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=offset&cursor=somecursor", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(conflictOffsetCursorRes.status, 400);

  const invalidPaginationRes = await handler(new Request("http://localhost/functions/v1/recipes?pagination=unknown", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(invalidPaginationRes.status, 400);
});

Deno.test("Regression BE-08 Task 3: Authenticated GET /recipes cursor encoding is Unicode-safe, URL-safe, and validated", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      const rows = [
        persistedRecipeRow({ id: "11111111-1111-4111-8111-111111111111", title: "Matcha 🍵", created_at: "2026-10-20T12:00:00.000Z" }),
        persistedRecipeRow({ id: "22222222-2222-4222-8222-222222222222", title: "Matcha 🍵 II", created_at: "2026-10-20T11:00:00.000Z" }),
      ];
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const unicodePage1Res = await handler(new Request("http://localhost/functions/v1/recipes?pagination=cursor&title=Matcha%20%F0%9F%8D%B5&ingredient=%E7%94%9F%E5%A7%9C&limit=1", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(unicodePage1Res.status, 200);
  const page1Body = await unicodePage1Res.json();
  assertEquals(page1Body.has_more, true);
  assertNotEquals(page1Body.next_cursor, null);
  const generatedCursor = page1Body.next_cursor as string;
  assertEquals(generatedCursor.includes("+"), false);
  assertEquals(generatedCursor.includes("/"), false);
  assertEquals(generatedCursor.includes("="), false);

  const continuationRes = await handler(new Request(`http://localhost/functions/v1/recipes?title=Matcha%20%F0%9F%8D%B5&ingredient=%E7%94%9F%E5%A7%9C&limit=1&cursor=${generatedCursor}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(continuationRes.status, 200);
  assertNotEquals(capturedUrl!.searchParams.get("or"), null);

  for (const badCursor of ["not-valid-base64!!!", "", "e30=", "abc", "eyJzb3J0Ijoibm90X3ZhbGlkIn0="]) {
    const badRes = await handler(new Request(`http://localhost/functions/v1/recipes?cursor=${encodeURIComponent(badCursor)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(badRes.status, 400);
    const badBody = await badRes.json();
    assertEquals(badBody.error?.code, "VALIDATION_ERROR");
  }

  const incompatibleFilterRes = await handler(new Request(`http://localhost/functions/v1/recipes?title=DifferentTitle&ingredient=%E7%94%9F%E5%A7%9C&cursor=${generatedCursor}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(incompatibleFilterRes.status, 400);
  const incompatibleFilterBody = await incompatibleFilterRes.json();
  assertEquals(incompatibleFilterBody.error?.code, "VALIDATION_ERROR");

  const incompatibleSortRes = await handler(new Request(`http://localhost/functions/v1/recipes?sort=rating&title=Matcha%20%F0%9F%8D%B5&ingredient=%E7%94%9F%E5%A7%9C&cursor=${generatedCursor}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(incompatibleSortRes.status, 400);
  const incompatibleSortBody = await incompatibleSortRes.json();
  assertEquals(incompatibleSortBody.error?.code, "VALIDATION_ERROR");
});

Deno.test("Regression BE-08 Task 4: Authenticated GET /recipes offset pagination correctly evaluates has_more across boundaries", async () => {
  let capturedOffset = "";
  let capturedLimit = "";

  function makeMockFetch(rowCount: number): typeof fetch {
    return (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.pathname === "/rest/v1/recipes") {
        capturedOffset = url.searchParams.get("offset") ?? "";
        capturedLimit = url.searchParams.get("limit") ?? "";
        const rows = [];
        for (let i = 0; i < rowCount; i++) {
          rows.push(persistedRecipeRow({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
        }
        return Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    };
  }

  const zeroRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: makeMockFetch(0) });
  assertEquals(zeroRes.status, 200);
  assertEquals(capturedOffset, "0");
  assertEquals(capturedLimit, "6");
  const zeroBody = await zeroRes.json();
  assertEquals(zeroBody.recipes.length, 0);
  assertEquals(zeroBody.has_more, false);

  const fewerRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: makeMockFetch(3) });
  assertEquals(fewerRes.status, 200);
  const fewerBody = await fewerRes.json();
  assertEquals(fewerBody.recipes.length, 3);
  assertEquals(fewerBody.has_more, false);

  const exactLimitRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: makeMockFetch(5) });
  assertEquals(exactLimitRes.status, 200);
  const exactLimitBody = await exactLimitRes.json();
  assertEquals(exactLimitBody.recipes.length, 5);
  assertEquals(exactLimitBody.has_more, false);

  const exactLimitPlusOneRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: makeMockFetch(6) });
  assertEquals(exactLimitPlusOneRes.status, 200);
  const exactLimitPlusOneBody = await exactLimitPlusOneRes.json();
  assertEquals(exactLimitPlusOneBody.recipes.length, 5);
  assertEquals(exactLimitPlusOneBody.has_more, true);

  const page1Res = await handler(new Request("http://localhost/functions/v1/recipes?limit=5&offset=0", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: makeMockFetch(6) });
  assertEquals(page1Res.status, 200);
  assertEquals(capturedOffset, "0");
  assertEquals(capturedLimit, "6");
  const page1ResBody = await page1Res.json();
  assertEquals(page1ResBody.recipes.length, 5);
  assertEquals(page1ResBody.has_more, true);

  const page2Res = await handler(new Request("http://localhost/functions/v1/recipes?limit=5&offset=5", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: makeMockFetch(2) });
  assertEquals(page2Res.status, 200);
  assertEquals(capturedOffset, "5");
  assertEquals(capturedLimit, "6");
  const page2ResBody = await page2Res.json();
  assertEquals(page2ResBody.recipes.length, 2);
  assertEquals(page2ResBody.has_more, false);
});

Deno.test("Regression BE-08: Offset pagination probes beyond Supabase's 1000-row cap", async () => {
  const requestedUrls: URL[] = [];
  let hasContinuation = true;
  const cappedRows = Array.from({ length: 1000 }, (_, i) =>
    persistedRecipeRow({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` })
  );
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      requestedUrls.push(url);
      let rows: unknown[] = cappedRows;
      if (url.searchParams.get("select") === "id") {
        rows = hasContinuation ? [{ id: "44444444-4444-4444-8444-444444444444" }] : [];
      }
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const res = await handler(new Request("http://localhost/functions/v1/recipes?limit=1000&title=Rice&ingredient=Ginger&sort=rating", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.recipes.length, 1000);
  assertEquals(body.has_more, true);
  assertEquals(requestedUrls.length, 2);
  assertEquals(requestedUrls[0].searchParams.get("limit"), "1001");
  assertEquals(requestedUrls[1].searchParams.get("select"), "id");
  assertEquals(requestedUrls[1].searchParams.get("offset"), "1000");
  assertEquals(requestedUrls[1].searchParams.get("limit"), "1");
  assertEquals(requestedUrls[1].searchParams.get("user_id"), `eq.${VERIFIED_USER_ID}`);
  assertEquals(requestedUrls[1].searchParams.get("title"), 'ilike."%Rice%"');
  assertEquals(requestedUrls[1].searchParams.get("ingredients_text"), 'ilike."%Ginger%"');
  assertEquals(requestedUrls[1].searchParams.get("order"), "star_rating.desc.nullslast,created_at.desc,id.asc");

  hasContinuation = false;
  requestedUrls.length = 0;
  const finalPageRes = await handler(new Request("http://localhost/functions/v1/recipes?limit=1000&title=Rice&ingredient=Ginger&sort=rating", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(finalPageRes.status, 200);
  const finalPageBody = await finalPageRes.json();
  assertEquals(finalPageBody.recipes.length, 1000);
  assertEquals(finalPageBody.has_more, false);
  assertEquals(requestedUrls.length, 2);
});
Deno.test("Regression BE-08 Follow-Up: Search safely handles reserved characters and escapes SQL wildcards", async () => {
  let capturedUrl: URL | null = null;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const testCases = [
    { param: "title", value: "garlic, shallots", expected: 'ilike."%garlic, shallots%"' },
    { param: "title", value: "soup (hot)", expected: 'ilike."%soup (hot)%"' },
    { param: "title", value: 'sauce "special"', expected: 'ilike."%sauce \\\"special\\\"%"' },
    { param: "title", value: "oil\\vinegar", expected: 'ilike."%oil\\\\vinegar%"' },
    { param: "title", value: "100%", expected: 'ilike."%100\\%%"' },
    { param: "title", value: "salt_pepper", expected: 'ilike."%salt\\_pepper%"' },
    { param: "ingredient", value: "garlic, shallots", expected: 'ilike."%garlic, shallots%"' },
    { param: "ingredient", value: "soup (hot)", expected: 'ilike."%soup (hot)%"' },
    { param: "ingredient", value: "100%", expected: 'ilike."%100\\%%"' },
    { param: "ingredient", value: "salt_pepper", expected: 'ilike."%salt\\_pepper%"' },
  ];

  for (const tc of testCases) {
    const res = await handler(new Request(`http://localhost/functions/v1/recipes?${tc.param}=${encodeURIComponent(tc.value)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(res.status, 200);
    const key = tc.param === "ingredient" ? "ingredients_text" : "title";
    assertEquals(capturedUrl!.searchParams.get(key), tc.expected);
  }
});

Deno.test("Regression BE-08 Follow-Up: Ingredient search matches names only and does not match JSON metadata", async () => {
  const recipeWithMetadata = persistedRecipeRow({
    title: "Garlic Bread",
    ingredients: [{ name: "Garlic", unit: "cloves", quantity: 2, inferred: false }],
  });

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      const ingFilter = url.searchParams.get("ingredients_text") ?? "";
      const namesArray = JSON.stringify(recipeWithMetadata.ingredients.map((i: { name: string }) => i.name));
      const termMatch = ingFilter.match(/ilike\."%(.*)%"/);
      const term = termMatch ? termMatch[1].toLowerCase() : "";
      const matches = namesArray.toLowerCase().includes(term);
      return Promise.resolve(new Response(JSON.stringify(matches ? [recipeWithMetadata] : []), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const nameRes = await handler(new Request("http://localhost/functions/v1/recipes?ingredient=Garlic", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(nameRes.status, 200);
  const nameBody = await nameRes.json();
  assertEquals(nameBody.recipes.length, 1);

  for (const metadataKey of ["unit", "quantity", "inferred", "cloves", "false"]) {
    const metaRes = await handler(new Request(`http://localhost/functions/v1/recipes?ingredient=${metadataKey}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(metaRes.status, 200);
    const metaBody = await metaRes.json();
    assertEquals(metaBody.recipes.length, 0);
  }
});

Deno.test("Regression BE-08 Follow-Up: Validates cursor timestamps and rejects injection or non-ISO dates", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(JSON.stringify([persistedRecipeRow()]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  function makeCursor(createdAt: string): string {
    const obj = {
      sort: "newest",
      id: "11111111-1111-4111-8111-111111111111",
      createdAt,
    };
    return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const badTimestamps = [
    "not-a-date",
    "2026-10-20 00:00:00",
    "2026-10-20T00:00:00Z),and(id.gt.00000000-0000-0000-0000-000000000000",
    "2026/10/20",
    "9999999999",
    "",
  ];

  for (const badTs of badTimestamps) {
    const cursor = makeCursor(badTs);
    const res = await handler(new Request(`http://localhost/functions/v1/recipes?cursor=${cursor}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }

  const validTimestamps = [
    "2026-10-20T00:00:00.000Z",
    "2026-10-20T12:30:00Z",
    "2026-10-20T15:00:00+08:00",
  ];

  for (const validTs of validTimestamps) {
    const cursor = makeCursor(validTs);
    const res = await handler(new Request(`http://localhost/functions/v1/recipes?cursor=${cursor}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
    assertEquals(res.status, 200);
  }
});

Deno.test("Regression BE-08 Follow-Up: Supports large recipe persistence without index row size failure", async () => {
  let capturedInsertBody: Record<string, unknown> | null = null;
  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipes" && init?.method === "POST") {
      capturedInsertBody = JSON.parse(init.body as string);
      return Promise.resolve(new Response(JSON.stringify({
        ...persistedRecipeRow(),
        ingredients: (capturedInsertBody as any).ingredients,
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const largeIngredients = [];
  for (let i = 0; i < 40; i++) {
    largeIngredients.push({
      name: `Special Organic Locally Sourced Herb or Spice Item Number ${i + 1}`,
      quantity: i + 1,
      unit: "tablespoons",
      quantityText: `${i + 1} fresh tablespoons finely ground`,
      inferred: false,
    });
  }

  const payload = {
    title: "Massive Degustation Recipe",
    ingredients: largeIngredients,
    instructions: [{ step: 1, text: "Mix everything together." }],
  };

  const res = await handler(new Request("http://localhost/functions/v1/recipes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }), { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });

  assertEquals(res.status, 201);
  assertEquals((capturedInsertBody!.ingredients as any[]).length, 40);
  const jsonSize = JSON.stringify(capturedInsertBody!.ingredients).length;
  assertEquals(jsonSize > 3000, true);
});


const LINEAGE_CHILD_ID = "11111111-1111-4111-8111-111111111111";
const LINEAGE_PARENT_ID_1 = "22222222-2222-4222-8222-222222222222";
const LINEAGE_PARENT_ID_2 = "33333333-3333-4333-8333-333333333333";
const LINEAGE_PARENT_ID_3 = "44444444-4444-4444-8444-444444444444";
const FOREIGN_RECIPE_ID = "55555555-5555-4555-8555-555555555555";

Deno.test("CreateLineageRequestSchema and LineageResponseSchema validate valid lineage payloads", () => {
  const singleParentResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: [LINEAGE_PARENT_ID_1],
  });
  assertEquals(singleParentResult.success, true);
  if (singleParentResult.success) {
    assertEquals(singleParentResult.data.parent_recipe_ids.length, 1);
    assertEquals(singleParentResult.data.parent_recipe_ids[0], LINEAGE_PARENT_ID_1);
  }

  const multiParentResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: [LINEAGE_PARENT_ID_1, LINEAGE_PARENT_ID_2, LINEAGE_PARENT_ID_3],
  });
  assertEquals(multiParentResult.success, true);
  if (multiParentResult.success) {
    assertEquals(multiParentResult.data.parent_recipe_ids.length, 3);
  }

  const maxParentsResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
  });
  assertEquals(maxParentsResult.success, true);

  const responseResult = LineageResponseSchema.safeParse({
    lineage: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        parent_recipe_id: LINEAGE_PARENT_ID_1,
        child_recipe_id: LINEAGE_CHILD_ID,
        created_at: "2026-10-30T10:00:00.000Z",
      },
    ],
  });
  assertEquals(responseResult.success, true);
});

Deno.test("CreateLineageRequestSchema rejects empty, oversized, duplicate, non-UUID, and extra properties", () => {
  const emptyResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: [],
  });
  assertEquals(emptyResult.success, false);

  const oversizedResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
  });
  assertEquals(oversizedResult.success, false);

  const duplicateResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: [LINEAGE_PARENT_ID_1, LINEAGE_PARENT_ID_1],
  });
  assertEquals(duplicateResult.success, false);
  if (!duplicateResult.success) {
    assertEquals(duplicateResult.error.issues[0].message, "Duplicate parent recipe ID in request.");
  }

  const invalidUuidResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: ["not-a-valid-uuid"],
  });
  assertEquals(invalidUuidResult.success, false);

  const extraPropsResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: [LINEAGE_PARENT_ID_1],
    child_recipe_id: LINEAGE_CHILD_ID,
  });
  assertEquals(extraPropsResult.success, false);

  const nonArrayResult = CreateLineageRequestSchema.safeParse({
    parent_recipe_ids: LINEAGE_PARENT_ID_1,
  });
  assertEquals(nonArrayResult.success, false);
});

Deno.test("CORS preflight OPTIONS on /recipes/:id/lineage returns 204 with Allow GET, POST, OPTIONS", async () => {
  for (const endpointPath of [
    `/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`,
    `/recipes/${LINEAGE_CHILD_ID}/lineage`,
  ]) {
    const req = new Request(`http://localhost${endpointPath}`, {
      method: "OPTIONS",
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
    });
    assertEquals(res.status, 204);
    assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
  }
});

Deno.test("Unsupported HTTP methods on /recipes/:id/lineage return 405 METHOD_NOT_ALLOWED with Allow GET, POST, OPTIONS", async () => {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = () => {
    fetchCalls++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
    const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
      method,
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("allow"), "GET, POST, OPTIONS");
    const body = await res.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
  }
  assertEquals(fetchCalls, 0);
});

Deno.test("Unauthenticated requests to /recipes/:id/lineage return 401 UNAUTHORIZED", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 401,
            error_code: "bad_jwt",
            msg: "invalid JWT: signature is invalid or token is expired",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const method of ["GET", "POST"]) {
    const unauthReq = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }) : undefined,
    });
    const unauthRes = await handler(unauthReq, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(unauthRes.status, 401);
    const unauthBody = await unauthRes.json();
    assertEquals(unauthBody.error?.code, "UNAUTHORIZED");

    const forgedReq = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
      method,
      headers: {
        Authorization: `Bearer ${FORGED_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }) : undefined,
    });
    const forgedRes = await handler(forgedReq, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(forgedRes.status, 401);
    const forgedBody = await forgedRes.json();
    assertEquals(forgedBody.error?.code, "UNAUTHORIZED");

    const expiredReq = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
      method,
      headers: {
        Authorization: `Bearer ${EXPIRED_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }) : undefined,
    });
    const expiredRes = await handler(expiredReq, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(expiredRes.status, 401);
    const expiredBody = await expiredRes.json();
    assertEquals(expiredBody.error?.code, "UNAUTHORIZED");
  }
});

Deno.test("Auth rate limit on /recipes/:id/lineage returns 503 AUTH_SERVICE_RATE_LIMITED", async () => {
  const rateLimitFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(JSON.stringify({ error: "rate limit exceeded" }), { status: 429 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: rateLimitFetch,
  });
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error?.code, "AUTH_SERVICE_RATE_LIMITED");
});

Deno.test("Invalid child ID on /recipes/:id/lineage returns 400 VALIDATION_ERROR without calling database", async () => {
  let dbCalled = false;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    dbCalled = true;
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  for (const method of ["GET", "POST"]) {
    const req = new Request("http://localhost/functions/v1/recipes/not-a-valid-uuid/lineage", {
      method,
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }) : undefined,
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }
  assertEquals(dbCalled, false);
});

Deno.test("POST /recipes/:id/lineage rejects malformed JSON, empty bodies, duplicate parents, and limits without database calls", async () => {
  let dbCalled = false;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    dbCalled = true;
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const malformedBodies = ["", "   ", "{invalid-json", "[]", "123", '"plain string"'];
  for (const bodyStr of malformedBodies) {
    const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "INVALID_JSON");
  }

  const invalidPayloads = [
    { parent_recipe_ids: [] },
    { parent_recipe_ids: [LINEAGE_PARENT_ID_1, LINEAGE_PARENT_ID_1] },
    { parent_recipe_ids: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) },
    { parent_recipe_ids: ["not-a-uuid"] },
    { parent_recipe_ids: [LINEAGE_PARENT_ID_1], user_id: VERIFIED_USER_ID },
  ];

  for (const payload of invalidPayloads) {
    const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error?.code, "VALIDATION_ERROR");
  }

  assertEquals(dbCalled, false);
});

Deno.test("POST /recipes/:id/lineage rejects self-referencing relationship with 400 VALIDATION_ERROR before database calls", async () => {
  let dbCalled = false;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    dbCalled = true;
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_CHILD_ID] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error?.code, "VALIDATION_ERROR");
  assertEquals(body.error?.message, "A recipe cannot be its own parent.");
  assertEquals(dbCalled, false);
});

Deno.test("POST /recipes/:id/lineage returns 404 NOT_FOUND when child recipe does not exist or belongs to another user", async () => {
  let lineageInsertCalled = false;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      lineageInsertCalled = true;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 201 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error?.code, "NOT_FOUND");
  assertEquals(lineageInsertCalled, false);
});

Deno.test("POST /recipes/:id/lineage returns 404 NOT_FOUND when any parent recipe does not exist or is foreign", async () => {
  let lineageInsertCalled = false;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      if (url.searchParams.get("id") === `eq.${LINEAGE_CHILD_ID}`) {
        return Promise.resolve(new Response(
          JSON.stringify({ id: LINEAGE_CHILD_ID, user_id: VERIFIED_USER_ID }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify([{ id: LINEAGE_PARENT_ID_1, user_id: VERIFIED_USER_ID }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      lineageInsertCalled = true;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 201 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1, FOREIGN_RECIPE_ID] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error?.code, "NOT_FOUND");
  assertEquals(lineageInsertCalled, false);
});

Deno.test("POST /recipes/:id/lineage persists single parent and returns 201 Created", async () => {
  let capturedInsertBody: unknown = null;
  const expectedLineageRecord = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parent_recipe_id: LINEAGE_PARENT_ID_1,
    child_recipe_id: LINEAGE_CHILD_ID,
    created_at: "2026-10-30T10:00:00.000Z",
  };

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      if (url.searchParams.get("id") === `eq.${LINEAGE_CHILD_ID}`) {
        return Promise.resolve(new Response(
          JSON.stringify({ id: LINEAGE_CHILD_ID, user_id: VERIFIED_USER_ID }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify([{ id: LINEAGE_PARENT_ID_1, user_id: VERIFIED_USER_ID }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      capturedInsertBody = JSON.parse(typeof init?.body === "string" ? init.body : "[]");
      return Promise.resolve(new Response(
        JSON.stringify([expectedLineageRecord]),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.lineage.length, 1);
  assertEquals(body.lineage[0].parent_recipe_id, LINEAGE_PARENT_ID_1);
  assertEquals(body.lineage[0].child_recipe_id, LINEAGE_CHILD_ID);
  assertEquals(Array.isArray(capturedInsertBody), true);
  assertEquals((capturedInsertBody as any[]).length, 1);
  assertEquals((capturedInsertBody as any[])[0].parent_recipe_id, LINEAGE_PARENT_ID_1);
  assertEquals((capturedInsertBody as any[])[0].child_recipe_id, LINEAGE_CHILD_ID);
});

Deno.test("POST /recipes/:id/lineage persists multiple parents atomically and returns 201 Created", async () => {
  let capturedInsertBody: unknown = null;
  const expectedLineageRecords = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parent_recipe_id: LINEAGE_PARENT_ID_1,
      child_recipe_id: LINEAGE_CHILD_ID,
      created_at: "2026-10-30T10:00:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      parent_recipe_id: LINEAGE_PARENT_ID_2,
      child_recipe_id: LINEAGE_CHILD_ID,
      created_at: "2026-10-30T10:00:01.000Z",
    },
  ];

  const mockFetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      if (url.searchParams.get("id") === `eq.${LINEAGE_CHILD_ID}`) {
        return Promise.resolve(new Response(
          JSON.stringify({ id: LINEAGE_CHILD_ID, user_id: VERIFIED_USER_ID }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify([
          { id: LINEAGE_PARENT_ID_1, user_id: VERIFIED_USER_ID },
          { id: LINEAGE_PARENT_ID_2, user_id: VERIFIED_USER_ID },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      capturedInsertBody = JSON.parse(typeof init?.body === "string" ? init.body : "[]");
      return Promise.resolve(new Response(
        JSON.stringify(expectedLineageRecords),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1, LINEAGE_PARENT_ID_2] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.lineage.length, 2);
  assertEquals((capturedInsertBody as any[]).length, 2);
  assertEquals((capturedInsertBody as any[])[0].parent_recipe_id, LINEAGE_PARENT_ID_1);
  assertEquals((capturedInsertBody as any[])[1].parent_recipe_id, LINEAGE_PARENT_ID_2);
});

Deno.test("POST /recipes/:id/lineage maps database unique conflict 23505 to 409 CONFLICT", async () => {
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      if (url.searchParams.get("id") === `eq.${LINEAGE_CHILD_ID}`) {
        return Promise.resolve(new Response(
          JSON.stringify({ id: LINEAGE_CHILD_ID, user_id: VERIFIED_USER_ID }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(
        JSON.stringify([{ id: LINEAGE_PARENT_ID_1, user_id: VERIFIED_USER_ID }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      return Promise.resolve(new Response(
        JSON.stringify({ code: "23505", message: "duplicate key value violates unique constraint" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }),
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error?.code, "CONFLICT");
});

Deno.test("POST /recipes/:id/lineage maps database check violation 23514 to 400 VALIDATION_ERROR and RLS 42501 to 404 NOT_FOUND", async () => {
  const makeFetch = (dbError: { code: string; message: string }, status: number): typeof fetch => {
    return (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(new Response(
          JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      if (url.pathname === "/rest/v1/recipes") {
        if (url.searchParams.get("id") === `eq.${LINEAGE_CHILD_ID}`) {
          return Promise.resolve(new Response(
            JSON.stringify({ id: LINEAGE_CHILD_ID, user_id: VERIFIED_USER_ID }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ));
        }
        return Promise.resolve(new Response(
          JSON.stringify([{ id: LINEAGE_PARENT_ID_1, user_id: VERIFIED_USER_ID }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      if (url.pathname === "/rest/v1/recipe_lineage") {
        return Promise.resolve(new Response(JSON.stringify(dbError), { status, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    };
  };

  const reqCheck = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }),
  });
  const resCheck = await handler(reqCheck, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: makeFetch({ code: "23514", message: "check_parent_child_distinct" }, 400),
  });
  assertEquals(resCheck.status, 400);
  const bodyCheck = await resCheck.json();
  assertEquals(bodyCheck.error?.code, "VALIDATION_ERROR");

  const reqRls = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VALID_TEST_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent_recipe_ids: [LINEAGE_PARENT_ID_1] }),
  });
  const resRls = await handler(reqRls, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: makeFetch({ code: "42501", message: "new row violates row-level security policy" }, 403),
  });
  assertEquals(resRls.status, 404);
  const bodyRls = await resRls.json();
  assertEquals(bodyRls.error?.code, "NOT_FOUND");
});

Deno.test("GET /recipes/:id/lineage returns 200 OK with ordered lineage records for owned child recipe", async () => {
  let capturedQueryUrl: URL | null = null;
  const mockLineageRecords = [
    {
      id: "11111111-2222-3333-4444-555555555555",
      parent_recipe_id: LINEAGE_PARENT_ID_1,
      child_recipe_id: LINEAGE_CHILD_ID,
      created_at: "2026-10-20T01:00:00.000Z",
    },
    {
      id: "22222222-3333-4444-5555-666666666666",
      parent_recipe_id: LINEAGE_PARENT_ID_2,
      child_recipe_id: LINEAGE_CHILD_ID,
      created_at: "2026-10-21T02:00:00.000Z",
    },
  ];

  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: LINEAGE_CHILD_ID, user_id: VERIFIED_USER_ID }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      capturedQueryUrl = url;
      return Promise.resolve(new Response(
        JSON.stringify(mockLineageRecords),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.lineage.length, 2);
  assertEquals(body.lineage[0].parent_recipe_id, LINEAGE_PARENT_ID_1);
  assertEquals(body.lineage[1].parent_recipe_id, LINEAGE_PARENT_ID_2);
  assertNotEquals(capturedQueryUrl, null);
  assertEquals(capturedQueryUrl!.pathname, "/rest/v1/recipe_lineage");
  assertEquals(capturedQueryUrl!.searchParams.get("child_recipe_id"), `eq.${LINEAGE_CHILD_ID}`);
  assertEquals(capturedQueryUrl!.searchParams.get("order"), "created_at.asc,id.asc");
});

Deno.test("GET /recipes/:id/lineage returns 404 NOT_FOUND when child recipe does not belong to user", async () => {
  let lineageQueryCalled = false;
  const mockFetch: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(new Response(
        JSON.stringify({ id: VERIFIED_USER_ID, aud: "authenticated", role: "authenticated", email: VERIFIED_USER_EMAIL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.pathname === "/rest/v1/recipe_lineage") {
      lineageQueryCalled = true;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request(`http://localhost/functions/v1/recipes/${LINEAGE_CHILD_ID}/lineage`, {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });
  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error?.code, "NOT_FOUND");
  assertEquals(lineageQueryCalled, false);
});
