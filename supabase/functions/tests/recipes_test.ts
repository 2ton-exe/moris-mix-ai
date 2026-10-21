import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { handler } from "../recipes/index.ts";
import {
  CreateRecipeRequestSchema,
  DemoRecipeResponseSchema,
  ExtractedRecipeSchema,
  RecipeResponseSchema,
} from "../_shared/schemas.ts";

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
    assertEquals(minimalResult.data.flavor_scores, undefined);
    assertEquals(minimalResult.data.star_rating, undefined);
    assertEquals(minimalResult.data.cooked_at, undefined);
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
  assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
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
    assertEquals(preflightRes.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assertEquals(preflightRes.headers.get("vary"), "Origin");

    const unauthRes = await handler(
      new Request("http://localhost/functions/v1/recipes", { method: "POST" }),
    );
    assertEquals(unauthRes.status, 401);
    assertEquals(
      unauthRes.headers.get("access-control-allow-origin"),
      "https://frontend.morisscraps.com",
    );
    assertEquals(unauthRes.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assertEquals(unauthRes.headers.get("vary"), "Origin");
  } finally {
    if (originalOrigin) {
      Deno.env.set("ALLOWED_ORIGIN", originalOrigin);
    } else {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  }
});

Deno.test("Unsupported HTTP methods return 405 METHOD_NOT_ALLOWED with Allow: POST, OPTIONS and zero network calls", async () => {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = () => {
    fetchCalls++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
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
    assertEquals(res.headers.get("allow"), "POST, OPTIONS");
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
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

  for (const path of ["/functions/v1/recipes/123", "/recipes/123", "/functions/v1/recipes/123/edit"]) {
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
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
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
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");

    assertNotEquals(capturedPostgrestUrl, null);
    assertEquals(capturedPostgrestUrl!.pathname, "/rest/v1/recipes");
    assertEquals(
      capturedPostgrestUrl!.searchParams.get("select"),
      "id,user_id,title,raw_input,ingredients,instructions,flavor_scores,star_rating,cooked_at,image_url,created_at,updated_at",
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
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
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
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
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
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");

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

const LINKED_PRODUCTION_PROJECT_REF = "gtbwblxskctpsqhbpebg";
const optInEnabled = (Deno.env.get("RUN_BE04_RLS_INTEGRATION") ?? "").trim() === "true";
const testSupabaseUrl = (Deno.env.get("BE04_RLS_TEST_SUPABASE_URL") ?? "").trim();
const testAnonKey = (
  Deno.env.get("BE04_RLS_TEST_SUPABASE_ANON_KEY") ??
  Deno.env.get("BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY") ??
  ""
).trim();
const testServiceRoleKey = (Deno.env.get("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

const canRunLiveRlsIntegration =
  optInEnabled &&
  testSupabaseUrl.length > 0 &&
  testAnonKey.length > 0 &&
  testServiceRoleKey.length > 0;

function redactSecrets(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }
  return sanitized;
}

function validateDedicatedTestTarget(url: string, anonKey: string, serviceRoleKey: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("BE04_RLS_TEST_SUPABASE_URL must use http or https protocol.");
  }
  if (parsed.hostname.includes(LINKED_PRODUCTION_PROJECT_REF)) {
    throw new Error(
      "Safety guard rejected BE04_RLS_TEST_SUPABASE_URL: refuses to run against the primary linked project.",
    );
  }
  const regularAppUrl = (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL") ?? "").trim();
  if (regularAppUrl) {
    try {
      const parsedRegular = new URL(regularAppUrl);
      if (parsedRegular.origin === parsed.origin) {
        throw new Error(
          "Safety guard rejected BE04_RLS_TEST_SUPABASE_URL: must target a dedicated test project distinct from SUPABASE_URL/VITE_SUPABASE_URL.",
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
      "Safety guard rejected test keys: BE04_RLS_TEST_SUPABASE_ANON_KEY must not equal BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

Deno.test({
  name: "Live PostgreSQL persistence and RLS enforcement for POST /recipes (hosted integration)",
  ignore: !canRunLiveRlsIntegration,
  fn: async () => {
    const knownSecrets = [testAnonKey, testServiceRoleKey];
    validateDedicatedTestTarget(testSupabaseUrl, testAnonKey, testServiceRoleKey);

    const adminClient = createClient(testSupabaseUrl, testServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

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

      const anonClientA = createClient(testSupabaseUrl, testAnonKey, {
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

      const anonClientB = createClient(testSupabaseUrl, testAnonKey, {
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

      const rlsClientB = createClient(testSupabaseUrl, testAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${userBAccessToken}` } },
      });
      const { data: crossReadRows, error: crossReadError } = await rlsClientB
        .from("recipes")
        .select("id")
        .eq("id", createdId);
      assertEquals(crossReadError, null);
      assertEquals(crossReadRows, []);
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
      in: (column: string, values: string[]) => PromiseLike<unknown>;
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

  if (createdRecipeIds.length > 0) {
    await adminClient.from("recipes").delete().in("id", createdRecipeIds);
  }
  if (createdUserIds.length > 0) {
    await adminClient.from("recipes").delete().in("user_id", createdUserIds);
    await adminClient.from("profiles").delete().in("id", createdUserIds);
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

Deno.test("RLS test cleanup succeeds when all admin.deleteUser calls succeed, fails and redacts secrets on deleteUser error, attempts all users when one fails, and preserves primary test failures alongside cleanup failures", async () => {
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

  const attemptedUsersOnFailure: string[] = [];
  const failingAdminClient: RlsCleanupAdminClient = {
    from: () => ({
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
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
