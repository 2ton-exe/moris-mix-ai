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
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  try {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

    const req = new Request("http://localhost/functions/v1/demo-recipe", {
      method: "GET",
    });
    const res = await handler(req);
    assertEquals(res.status, 500);
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("cache-control"), "no-store");

    const body = await res.json();
    assertEquals(body.error?.code, "INTERNAL_ERROR");
    assertEquals(body.error?.message, "Internal server error.");
  } finally {
    if (originalUrl) Deno.env.set("SUPABASE_URL", originalUrl);
    if (originalKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalKey);
  }
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

Deno.test("GET returns 200 with approved contract columns, nosniff, and public Cache-Control", async () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return;
  }

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
  assertEquals((body.recipe as Record<string, unknown>).created_at, undefined);
  assertEquals((body.recipe as Record<string, unknown>).updated_at, undefined);
});
