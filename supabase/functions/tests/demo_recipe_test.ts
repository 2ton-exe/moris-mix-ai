import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { handler } from "../demo-recipe/index.ts";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import { DemoRecipeResponseSchema } from "../_shared/schemas.ts";

Deno.test("CORS preflight returns 204 with CORS headers and nosniff", async () => {
  const req = new Request("http://localhost/functions/v1/demo-recipe", {
    method: "OPTIONS",
  });
  const res = await handler(req);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assertEquals(
    res.headers.get("access-control-allow-headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  const text = await res.text();
  assertEquals(text, "");
});

Deno.test("Non-GET and non-OPTIONS methods return 405 with Allow, nosniff, and no-store", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const req = new Request("http://localhost/functions/v1/demo-recipe", {
      method,
    });
    const res = await handler(req);
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("allow"), "GET, OPTIONS");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("cache-control"), "no-store");

    const body = await res.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
    assertEquals(typeof body.error?.message, "string");
  }
});

Deno.test("Missing environment variables return 500 error envelope with nosniff and no-store", async () => {
  const req = new Request("http://localhost/functions/v1/demo-recipe", {
    method: "GET",
  });
  const res = await handler(req, {
    supabaseUrl: "",
    supabaseServiceRoleKey: "",
  });
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("cache-control"), "no-store");

  const body = await res.json();
  assertEquals(body.error?.code, "INTERNAL_ERROR");
  assertEquals(body.error?.message, "Internal server error.");
});

Deno.test("Dynamic ALLOWED_ORIGIN configuration scopes origin and sets Vary", async () => {
  const originalOrigin = Deno.env.get("ALLOWED_ORIGIN");
  try {
    Deno.env.set("ALLOWED_ORIGIN", "https://frontend.morisscraps.com");
    const preflight = handleCorsPreflight();
    assertEquals(preflight.headers.get("access-control-allow-origin"), "https://frontend.morisscraps.com");
    assertEquals(preflight.headers.get("vary"), "Origin");
    assertEquals(preflight.headers.get("x-content-type-options"), "nosniff");

    const jsonRes = jsonResponse({ ok: true });
    assertEquals(jsonRes.headers.get("access-control-allow-origin"), "https://frontend.morisscraps.com");
    assertEquals(jsonRes.headers.get("vary"), "Origin");

    Deno.env.delete("ALLOWED_ORIGIN");
    const fallback = handleCorsPreflight();
    assertEquals(fallback.headers.get("access-control-allow-origin"), "*");
    assertEquals(fallback.headers.get("vary"), null);
  } finally {
    if (originalOrigin) {
      Deno.env.set("ALLOWED_ORIGIN", originalOrigin);
    } else {
      Deno.env.delete("ALLOWED_ORIGIN");
    }
  }
});

Deno.test("Shared CORS utilities default to no-store and allow cache header overrides", async () => {
  const defaultJson = jsonResponse({ data: 123 }, { status: 404 });
  assertEquals(defaultJson.status, 404);
  assertEquals(defaultJson.headers.get("x-content-type-options"), "nosniff");
  assertEquals(defaultJson.headers.get("cache-control"), "no-store");

  const overriddenJson = jsonResponse(
    { data: 123 },
    { status: 200, headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
  );
  assertEquals(overriddenJson.status, 200);
  assertEquals(overriddenJson.headers.get("cache-control"), "public, max-age=60, s-maxage=300");
  assertEquals(overriddenJson.headers.get("x-content-type-options"), "nosniff");
});

Deno.test("DemoRecipeResponseSchema validates demo-recipe.json fixture", async () => {
  const fixtureText = await Deno.readTextFile("fixtures/demo-recipe.json");
  const fixtureJson = JSON.parse(fixtureText);
  const result = DemoRecipeResponseSchema.safeParse(fixtureJson);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.recipe.id, "11111111-1111-1111-1111-111111111111");
    assertEquals(result.data.recipe.title, "Classic Tomato Scraps Pasta");
    assertEquals(result.data.recipe.ingredients.length, 4);
    assertEquals(result.data.recipe.instructions.length, 3);
  }
});

Deno.test("DemoRecipeResponseSchema rejects invalid payload shapes", () => {
  const invalidPayloads = [
    {},
    { recipe: null },
    { recipe: { id: "not-a-uuid", title: "Test" } },
    {
      recipe: {
        id: "11111111-1111-1111-1111-111111111111",
        title: "",
        ingredients: [],
        instructions: [],
        flavor_scores: null,
        star_rating: null,
        cooked_at: null,
      },
    },
    {
      recipe: {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Test",
        ingredients: [],
        instructions: [],
        flavor_scores: { sweet: 99, salty: 0, sour: 0, bitter: 0, umami: 0, spicy: 0 },
        star_rating: 6,
        cooked_at: "invalid-date",
      },
    },
  ];

  for (const payload of invalidPayloads) {
    const result = DemoRecipeResponseSchema.safeParse(payload);
    assertEquals(result.success, false);
  }
});

Deno.test("GET queries database with strict recipe ID, owner ID, and is_public filters ignoring caller parameters", async () => {
  let capturedUrl: URL | null = null;
  let capturedHeaders: Headers | null = null;

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    capturedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify([
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: "Classic Tomato Scraps Pasta",
          ingredients: [
            { name: "spaghetti", quantity: 200, unit: "g", inferred: false },
            { name: "tomato paste", quantity: 2, unit: "tbsp", inferred: false },
            { name: "garlic", quantity: 2, unit: "cloves", inferred: false },
            { name: "Fresh basil", quantity: null, unit: null, inferred: false },
          ],
          instructions: [
            { step: 1, text: "Boil pasta in salted water." },
            { step: 2, text: "Saute minced garlic and tomato paste." },
            { step: 3, text: "Toss pasta with sauce and torn basil." },
          ],
          flavor_scores: { sweet: 2, salty: 3, sour: 3, bitter: 1, umami: 4, spicy: 0 },
          star_rating: 4,
          cooked_at: "2026-10-14",
        },
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const req = new Request(
    "http://localhost/functions/v1/demo-recipe?id=attacker-recipe-id&user_id=attacker-user-id&is_public=false&limit=100&offset=5",
    { method: "GET" },
  );
  const res = await handler(req, {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-service-role-key",
    fetch: mockFetch,
  });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("cache-control"), "public, max-age=60, s-maxage=300");

  assertNotEquals(capturedUrl, null);
  assertEquals(capturedUrl!.pathname, "/rest/v1/recipes");
  assertEquals(capturedUrl!.searchParams.get("id"), "eq.11111111-1111-1111-1111-111111111111");
  assertEquals(capturedUrl!.searchParams.get("user_id"), "eq.d0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f");
  assertEquals(capturedUrl!.searchParams.get("is_public"), "eq.true");
  assertEquals(capturedUrl!.searchParams.get("select"), "id,title,ingredients,instructions,flavor_scores,star_rating,cooked_at");
  assertEquals(capturedUrl!.searchParams.get("limit"), null);
  assertEquals(capturedUrl!.searchParams.get("offset"), null);

  assertNotEquals(capturedHeaders, null);
  assertEquals(capturedHeaders!.get("apikey"), "mock-service-role-key");
  assertEquals(capturedHeaders!.get("authorization"), "Bearer mock-service-role-key");

  const body = await res.json();
  assertEquals(typeof body.recipe, "object");
  assertEquals(body.recipe.id, "11111111-1111-1111-1111-111111111111");
  assertEquals(body.recipe.title, "Classic Tomato Scraps Pasta");
  assertNotEquals(body.recipe.ingredients, undefined);
  assertNotEquals(body.recipe.instructions, undefined);
  assertNotEquals(body.recipe.flavor_scores, undefined);
  assertEquals(body.recipe.star_rating, 4);
  assertEquals(typeof body.recipe.cooked_at, "string");

  assertEquals((body.recipe as Record<string, unknown>).user_id, undefined);
  assertEquals((body.recipe as Record<string, unknown>).raw_input, undefined);
  assertEquals((body.recipe as Record<string, unknown>).image_url, undefined);
  assertEquals((body.recipe as Record<string, unknown>).image_path, undefined);
  assertEquals((body.recipe as Record<string, unknown>).is_public, undefined);
  assertEquals((body.recipe as Record<string, unknown>).created_at, undefined);
  assertEquals((body.recipe as Record<string, unknown>).updated_at, undefined);
});

Deno.test("Private or unapproved recipe (is_public=false or not found) is rejected with 404 and no-store", async () => {
  let capturedUrl: URL | null = null;
  const mockFetchEmpty = async (input: RequestInfo | URL, _init?: RequestInit) => {
    capturedUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const req = new Request("http://localhost/functions/v1/demo-recipe", {
    method: "GET",
  });
  const res = await handler(req, {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    fetch: mockFetchEmpty,
  });

  assertEquals(res.status, 404);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertNotEquals(capturedUrl, null);
  assertEquals(capturedUrl!.searchParams.get("is_public"), "eq.true");

  const body = await res.json();
  assertEquals(body.error?.code, "DEMO_RECIPE_NOT_FOUND");
  assertEquals(body.error?.message, "Demo recipe is unavailable.");
  assertEquals(body.recipe, undefined);
});

Deno.test("Record with unexpected ID is rejected by public invariant check returning 404 and no-store", async () => {
  const mockFetchUnexpectedId = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(
      JSON.stringify([
        {
          id: "22222222-2222-2222-2222-222222222222",
          title: "Spicy Tomato Scraps Pasta",
          ingredients: [
            { name: "spaghetti", quantity: 200, unit: "g", inferred: false },
          ],
          instructions: [
            { step: 1, text: "Boil pasta." },
          ],
          flavor_scores: { sweet: 2, salty: 4, sour: 3, bitter: 1, umami: 5, spicy: 4 },
          star_rating: 5,
          cooked_at: "2026-10-15",
        },
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const req = new Request("http://localhost/functions/v1/demo-recipe", {
    method: "GET",
  });
  const res = await handler(req, {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    fetch: mockFetchUnexpectedId,
  });

  assertEquals(res.status, 404);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  const body = await res.json();
  assertEquals(body.error?.code, "DEMO_RECIPE_NOT_FOUND");
  assertEquals(body.error?.message, "Demo recipe is unavailable.");
  assertEquals(body.recipe, undefined);
});

Deno.test("Database query error returns 500 with internal error envelope and no-store", async () => {
  const mockFetchError = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        message: "Database connection failed",
        code: "PGRST000",
        details: "internal",
        hint: "",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const req = new Request("http://localhost/functions/v1/demo-recipe", {
    method: "GET",
  });
  const res = await handler(req, {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    fetch: mockFetchError,
  });

  assertEquals(res.status, 500);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  const body = await res.json();
  assertEquals(body.error?.code, "INTERNAL_ERROR");
  assertEquals(body.error?.message, "Internal server error.");
  assertEquals(body.recipe, undefined);
});

const hasDbEnv = Boolean(
  Deno.env.get("SUPABASE_URL") &&
    (Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
);

Deno.test({
  name: "GET returns 200 from live PostgreSQL with approved columns and headers (live integration)",
  ignore: !hasDbEnv,
  fn: async () => {
    const req = new Request("http://localhost/functions/v1/demo-recipe?malicious_param=1", {
      method: "GET",
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("cache-control"), "public, max-age=60, s-maxage=300");

    const body = await res.json();
    assertEquals(typeof body.recipe, "object");
    assertEquals(body.recipe.id, "11111111-1111-1111-1111-111111111111");
    assertEquals(body.recipe.title, "Classic Tomato Scraps Pasta");
    assertNotEquals(body.recipe.ingredients, undefined);
    assertNotEquals(body.recipe.instructions, undefined);
    assertNotEquals(body.recipe.flavor_scores, undefined);
    assertEquals(body.recipe.star_rating, 4);
    assertEquals(typeof body.recipe.cooked_at, "string");

    assertEquals((body.recipe as Record<string, unknown>).user_id, undefined);
    assertEquals((body.recipe as Record<string, unknown>).raw_input, undefined);
    assertEquals((body.recipe as Record<string, unknown>).image_url, undefined);
    assertEquals((body.recipe as Record<string, unknown>).image_path, undefined);
    assertEquals((body.recipe as Record<string, unknown>).is_public, undefined);
    assertEquals((body.recipe as Record<string, unknown>).created_at, undefined);
    assertEquals((body.recipe as Record<string, unknown>).updated_at, undefined);
  },
});
