import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";
import { handler } from "../recipes/index.ts";
import {
  CreateRecipeRequestSchema,
  RecipeListResponseSchema,
  RecipeResponseSchema,
} from "../_shared/schemas.ts";

const KNOWN_PRODUCTION_REF = "gtbwblxskctpsqhbpebg";
const TEST_SUPABASE_URL = "https://mock-test.supabase.co";
const TEST_ANON_KEY = "mock-anon-public-key-value";

const USER_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A_EMAIL = "user-a@morisscraps.test";
const USER_A_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYWFhYWFhYS1hYWFhLTRhYWEtOGFhYS1hYWFhYWFhYWFhYWEiLCJlbWFpbCI6InVzZXItYUBtb3Jpc3NjcmFwcy50ZXN0Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_user_a";

const USER_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_B_EMAIL = "user-b@morisscraps.test";
const USER_B_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYmJiYmJmYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJmYmJiYmIiLCJlbWFpbCI6InVzZXItYkBtb3Jpc3NjcmFwcy50ZXN0Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_user_b";

const INVALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ.invalid_signature";

type RecipeRecord = {
  id: string;
  user_id: string;
  title: string;
  raw_input: string | null;
  notes: string | null;
  ingredients: Array<{ name: string; quantity: number | null; unit: string | null; inferred?: boolean }>;
  instructions: Array<{ step: number; text: string }>;
  flavor_scores: { sweet: number; salty: number; sour: number; bitter: number; umami: number; spicy: number } | null;
  star_rating: number | null;
  cooked_at: string | null;
  image_url: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type LineageRecord = {
  id: string;
  parent_recipe_id: string;
  child_recipe_id: string;
  created_at: string;
};

function sampleRecipeData(title: string, overrides: Partial<RecipeRecord> = {}): Omit<RecipeRecord, "id" | "user_id" | "created_at" | "updated_at"> {
  return {
    title,
    raw_input: "Sample ingredients text",
    notes: "Sample notes",
    ingredients: [{ name: "rice", quantity: 1, unit: "cup", inferred: false }],
    instructions: [{ step: 1, text: "Cook rice." }],
    flavor_scores: { sweet: 1, salty: 2, sour: 0, bitter: 0, umami: 3, spicy: 1 },
    star_rating: 4,
    cooked_at: "2026-10-24",
    image_url: null,
    is_public: false,
    ...overrides,
  };
}

function extractSupabaseProjectRef(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.supabase\.(?:co|net)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const norm = hostname.trim().toLowerCase();
  return norm === "localhost" || norm === "127.0.0.1" || norm === "::1" || norm === "[::1]";
}

function validateDedicatedTestTarget(
  targetUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  expectedProjectRef: string,
): void {
  if (!targetUrl || !targetUrl.trim()) {
    throw new Error("Safety guard rejected test target: missing target URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    throw new Error("Safety guard rejected test target: target URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Safety guard rejected test target: hosted RLS tests must use HTTPS.");
  }
  if (isLoopbackHost(parsed.hostname)) {
    throw new Error("Safety guard rejected test target: hosted RLS tests must not target localhost/loopback.");
  }
  const derivedRef = extractSupabaseProjectRef(targetUrl);
  if (!derivedRef) {
    throw new Error("Safety guard rejected test target: unable to extract project reference from target URL.");
  }
  if (!expectedProjectRef || !expectedProjectRef.trim()) {
    throw new Error("Safety guard rejected test target: expected project reference must be configured.");
  }
  if (derivedRef.toLowerCase() !== expectedProjectRef.trim().toLowerCase()) {
    throw new Error(
      `Safety guard rejected test target: derived reference '${derivedRef}' does not match expected reference '${expectedProjectRef}'.`,
    );
  }
  if (
    derivedRef.toLowerCase() === KNOWN_PRODUCTION_REF.toLowerCase() ||
    targetUrl.toLowerCase().includes(KNOWN_PRODUCTION_REF.toLowerCase())
  ) {
    throw new Error("Safety guard rejected test target: refuses to run against primary production project.");
  }
  if (anonKey.trim() === serviceRoleKey.trim()) {
    throw new Error("Safety guard rejected test keys: anon key must not match service role key.");
  }
}

type RlsConfigResult =
  | { shouldRun: false; isOptedIn: false; error?: undefined }
  | { shouldRun: true; isOptedIn: true; error?: string; url: string; anonKey: string; serviceRoleKey: string; expectedProjectRef: string; prefix: "BE07" | "BE06" | "BE04" };

function resolveCredentialStateMachine(getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k)): RlsConfigResult {
  const be07Flag = (getEnv("RUN_BE07_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const be07Enabled = be07Flag === "true" || be07Flag === "1";
  if (be07Enabled) {
    const url = (getEnv("BE07_RLS_TEST_SUPABASE_URL") ?? "").trim();
    const anon = (getEnv("BE07_RLS_TEST_SUPABASE_ANON_KEY") ?? getEnv("BE07_RLS_TEST_SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
    const service = (getEnv("BE07_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY") ?? getEnv("BE07_RLS_TEST_SUPABASE_SECRET_KEY") ?? "").trim();
    const expected = (getEnv("BE07_RLS_TEST_EXPECTED_PROJECT_REF") ?? getEnv("BE07_RLS_TEST_PROJECT_REF") ?? "").trim();
    const missing: string[] = [];
    if (!url) missing.push("BE07_RLS_TEST_SUPABASE_URL");
    if (!anon) missing.push("BE07_RLS_TEST_SUPABASE_ANON_KEY");
    if (!service) missing.push("BE07_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY");
    if (!expected) missing.push("BE07_RLS_TEST_EXPECTED_PROJECT_REF");
    if (missing.length > 0) {
      return {
        shouldRun: true,
        isOptedIn: true,
        prefix: "BE07",
        error: `RUN_BE07_RLS_INTEGRATION locked prefix BE07 but credentials are incomplete: missing ${missing.join(", ")}.`,
        url,
        anonKey: anon,
        serviceRoleKey: service,
        expectedProjectRef: expected,
      };
    }
    return { shouldRun: true, isOptedIn: true, prefix: "BE07", url, anonKey: anon, serviceRoleKey: service, expectedProjectRef: expected };
  }

  const be06Flag = (getEnv("RUN_BE06_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const be06Enabled = be06Flag === "true" || be06Flag === "1";
  if (be06Enabled) {
    const url = (getEnv("BE06_RLS_TEST_SUPABASE_URL") ?? "").trim();
    const anon = (getEnv("BE06_RLS_TEST_SUPABASE_ANON_KEY") ?? getEnv("BE06_RLS_TEST_SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
    const service = (getEnv("BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY") ?? getEnv("BE06_RLS_TEST_SUPABASE_SECRET_KEY") ?? "").trim();
    const expected = (getEnv("BE06_RLS_TEST_EXPECTED_PROJECT_REF") ?? getEnv("BE06_RLS_TEST_PROJECT_REF") ?? "").trim();
    const missing: string[] = [];
    if (!url) missing.push("BE06_RLS_TEST_SUPABASE_URL");
    if (!anon) missing.push("BE06_RLS_TEST_SUPABASE_ANON_KEY");
    if (!service) missing.push("BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY");
    if (!expected) missing.push("BE06_RLS_TEST_EXPECTED_PROJECT_REF");
    if (missing.length > 0) {
      return {
        shouldRun: true,
        isOptedIn: true,
        prefix: "BE06",
        error: `RUN_BE06_RLS_INTEGRATION locked prefix BE06 but credentials are incomplete: missing ${missing.join(", ")}.`,
        url,
        anonKey: anon,
        serviceRoleKey: service,
        expectedProjectRef: expected,
      };
    }
    return { shouldRun: true, isOptedIn: true, prefix: "BE06", url, anonKey: anon, serviceRoleKey: service, expectedProjectRef: expected };
  }

  const be04Flag = (getEnv("RUN_BE04_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const be04Enabled = be04Flag === "true" || be04Flag === "1";
  if (be04Enabled) {
    const url = (getEnv("BE04_RLS_TEST_SUPABASE_URL") ?? "").trim();
    const anon = (getEnv("BE04_RLS_TEST_SUPABASE_ANON_KEY") ?? getEnv("BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
    const service = (getEnv("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY") ?? getEnv("BE04_RLS_TEST_SUPABASE_SECRET_KEY") ?? "").trim();
    const expected = (getEnv("BE04_RLS_TEST_EXPECTED_PROJECT_REF") ?? getEnv("BE04_RLS_TEST_PROJECT_REF") ?? "").trim();
    const missing: string[] = [];
    if (!url) missing.push("BE04_RLS_TEST_SUPABASE_URL");
    if (!anon) missing.push("BE04_RLS_TEST_SUPABASE_ANON_KEY");
    if (!service) missing.push("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY");
    if (!expected) missing.push("BE04_RLS_TEST_EXPECTED_PROJECT_REF");
    if (missing.length > 0) {
      return {
        shouldRun: true,
        isOptedIn: true,
        prefix: "BE04",
        error: `RUN_BE04_RLS_INTEGRATION locked prefix BE04 but credentials are incomplete: missing ${missing.join(", ")}.`,
        url,
        anonKey: anon,
        serviceRoleKey: service,
        expectedProjectRef: expected,
      };
    }
    return { shouldRun: true, isOptedIn: true, prefix: "BE04", url, anonKey: anon, serviceRoleKey: service, expectedProjectRef: expected };
  }

  return { shouldRun: false, isOptedIn: false };
}

function sanitizeSecrets(message: string, secrets: string[]): string {
  let result = message;
  for (const s of secrets) {
    if (s && s.length > 0) {
      result = result.split(s).join("[REDACTED]");
    }
  }
  return result;
}

function createScopedTestClient(url: string, key: string, token?: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  });
}

function createMockFetch(initialRecipes: RecipeRecord[] = []) {
  const store = new Map<string, RecipeRecord>(initialRecipes.map((r) => [r.id, { ...r }]));

  const mockFetch: typeof fetch = (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl);
    const headers = new Headers(init?.headers);
    const authHeader = headers.get("authorization") ?? "";

    if (url.pathname === "/auth/v1/user") {
      if (authHeader === `Bearer ${USER_A_JWT}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: USER_A_ID, aud: "authenticated", role: "authenticated", email: USER_A_EMAIL }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (authHeader === `Bearer ${USER_B_JWT}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: USER_B_ID, aud: "authenticated", role: "authenticated", email: USER_B_EMAIL }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "Invalid JWT", error_code: "invalid_jwt" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const method = init?.method ?? "GET";
      const filterUserId = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      const filterId = url.searchParams.get("id")?.replace(/^eq\./, "");

      if (method === "GET") {
        let matching = Array.from(store.values());
        if (filterUserId) {
          matching = matching.filter((r) => r.user_id === filterUserId);
        }
        if (filterId) {
          matching = matching.filter((r) => r.id === filterId);
        }
        return Promise.resolve(
          new Response(JSON.stringify(matching), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (method === "PATCH") {
        const matching = Array.from(store.values()).filter((r) => {
          if (filterUserId && r.user_id !== filterUserId) return false;
          if (filterId && r.id !== filterId) return false;
          return true;
        });
        if (matching.length === 0) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        const body = JSON.parse(String(init?.body ?? "{}"));
        const target = matching[0];
        const updated: RecipeRecord = {
          ...target,
          ...body,
          updated_at: "2026-10-24T12:00:00.000Z",
        };
        store.set(target.id, updated);
        return Promise.resolve(
          new Response(JSON.stringify([updated]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (method === "DELETE") {
        const matching = Array.from(store.values()).filter((r) => {
          if (filterUserId && r.user_id !== filterUserId) return false;
          if (filterId && r.id !== filterId) return false;
          return true;
        });
        if (matching.length === 0) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        const target = matching[0];
        store.delete(target.id);
        return Promise.resolve(
          new Response(JSON.stringify([{ id: target.id }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  return { mockFetch, store };
}

Deno.test("Target safety guard strictly validates HTTPS, non-loopback, non-production ref, and matching project references", () => {
  validateDedicatedTestTarget(
    "https://valid-target-ref.supabase.co",
    "anon-valid-key",
    "service-valid-key",
    "valid-target-ref",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "http://valid-target-ref.supabase.co",
        "anon-valid-key",
        "service-valid-key",
        "valid-target-ref",
      ),
    Error,
    "HTTPS",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://127.0.0.1:54321",
        "anon-valid-key",
        "service-valid-key",
        "valid-target-ref",
      ),
    Error,
    "localhost/loopback",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        `https://${KNOWN_PRODUCTION_REF}.supabase.co`,
        "anon-valid-key",
        "service-valid-key",
        KNOWN_PRODUCTION_REF,
      ),
    Error,
    "primary production project",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://different-ref.supabase.co",
        "anon-valid-key",
        "service-valid-key",
        "expected-ref",
      ),
    Error,
    "does not match expected reference",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://valid-target-ref.supabase.co",
        "shared-key",
        "shared-key",
        "valid-target-ref",
      ),
    Error,
    "must not match",
  );
});

Deno.test("Credential state machine enforces strict prefix locking without cross-prefix fallback and fails closed on incomplete sets", () => {
  const envEmpty: Record<string, string> = {};
  assertEquals(resolveCredentialStateMachine((k) => envEmpty[k]).shouldRun, false);

  const envBe07Incomplete: Record<string, string> = {
    RUN_BE07_RLS_INTEGRATION: "true",
    BE07_RLS_TEST_SUPABASE_URL: "https://be07-test.supabase.co",
    BE04_RLS_TEST_SUPABASE_ANON_KEY: "be04-anon",
    BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be04-service",
    BE04_RLS_TEST_EXPECTED_PROJECT_REF: "be07-test",
  };
  const be07IncompleteResult = resolveCredentialStateMachine((k) => envBe07Incomplete[k]);
  assertEquals(be07IncompleteResult.shouldRun, true);
  if (be07IncompleteResult.shouldRun) {
    assertEquals(be07IncompleteResult.prefix, "BE07");
    assertNotEquals(be07IncompleteResult.error, undefined);
  }

  const envBe07Complete: Record<string, string> = {
    RUN_BE07_RLS_INTEGRATION: "true",
    BE07_RLS_TEST_SUPABASE_URL: "https://be07-test.supabase.co",
    BE07_RLS_TEST_SUPABASE_ANON_KEY: "be07-anon",
    BE07_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be07-service",
    BE07_RLS_TEST_EXPECTED_PROJECT_REF: "be07-test",
    RUN_BE04_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
  };
  const be07CompleteResult = resolveCredentialStateMachine((k) => envBe07Complete[k]);
  assertEquals(be07CompleteResult.shouldRun, true);
  if (be07CompleteResult.shouldRun) {
    assertEquals(be07CompleteResult.prefix, "BE07");
    assertEquals(be07CompleteResult.error, undefined);
    assertEquals(be07CompleteResult.url, "https://be07-test.supabase.co");
  }

  const envBe04Fallback: Record<string, string> = {
    RUN_BE04_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
    BE04_RLS_TEST_SUPABASE_ANON_KEY: "be04-anon",
    BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be04-service",
    BE04_RLS_TEST_EXPECTED_PROJECT_REF: "be04-test",
  };
  const be04FallbackResult = resolveCredentialStateMachine((k) => envBe04Fallback[k]);
  assertEquals(be04FallbackResult.shouldRun, true);
  if (be04FallbackResult.shouldRun) {
    assertEquals(be04FallbackResult.prefix, "BE04");
    assertEquals(be04FallbackResult.error, undefined);
  }
});

Deno.test("Layer 1: Deterministic mock - GET /recipes collection is scoped to caller and excludes other user recipes", async () => {
  const recipeA: RecipeRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Soup"),
  };
  const recipeB: RecipeRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:05:00.000Z",
    updated_at: "2026-10-24T10:05:00.000Z",
    ...sampleRecipeData("User B Roast"),
  };

  const { mockFetch } = createMockFetch([recipeA, recipeB]);

  const reqA = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resA = await handler(reqA, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resA.status, 200);
  const bodyA = await resA.json();
  const parsedA = RecipeListResponseSchema.safeParse(bodyA);
  assertEquals(parsedA.success, true);
  assertEquals(bodyA.recipes.length, 1);
  assertEquals(bodyA.recipes[0].id, recipeA.id);
  assertEquals(bodyA.recipes[0].user_id, USER_A_ID);

  const reqB = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_B_JWT}` },
  });
  const resB = await handler(reqB, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resB.status, 200);
  const bodyB = await resB.json();
  const parsedB = RecipeListResponseSchema.safeParse(bodyB);
  assertEquals(parsedB.success, true);
  assertEquals(bodyB.recipes.length, 1);
  assertEquals(bodyB.recipes[0].id, recipeB.id);
  assertEquals(bodyB.recipes[0].user_id, USER_B_ID);
});

Deno.test("Layer 1: Deterministic mock - GET /recipes/:id retrieves own recipe and returns 404 for other user recipe UUID", async () => {
  const recipeA: RecipeRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Bread"),
  };
  const recipeB: RecipeRecord = {
    id: "44444444-4444-4444-8444-444444444444",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Salad"),
  };

  const { mockFetch } = createMockFetch([recipeA, recipeB]);

  const reqOwn = new Request(`http://localhost/functions/v1/recipes/${recipeA.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resOwn = await handler(reqOwn, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resOwn.status, 200);
  const bodyOwn = await resOwn.json();
  const parsedOwn = RecipeResponseSchema.safeParse(bodyOwn);
  assertEquals(parsedOwn.success, true);
  assertEquals(bodyOwn.recipe.id, recipeA.id);

  const reqCross = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resCross = await handler(reqCross, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resCross.status, 404);
  const bodyCross = await resCross.json();
  assertEquals(bodyCross.error.code, "NOT_FOUND");
  assertEquals(bodyCross.error.message, "Recipe not found.");
  assertEquals(bodyCross.recipe, undefined);
});

Deno.test("Layer 1: Deterministic mock - PATCH /recipes/:id updates own recipe and returns 404 leaving other user recipe untouched", async () => {
  const recipeA: RecipeRecord = {
    id: "55555555-5555-4555-8555-555555555555",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Stew"),
  };
  const recipeB: RecipeRecord = {
    id: "66666666-6666-4666-8666-666666666666",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Tart"),
  };

  const { mockFetch, store } = createMockFetch([recipeA, recipeB]);

  const reqOwn = new Request(`http://localhost/functions/v1/recipes/${recipeA.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${USER_A_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "User A Stew Renovated", star_rating: 5 }),
  });
  const resOwn = await handler(reqOwn, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resOwn.status, 200);
  const bodyOwn = await resOwn.json();
  assertEquals(bodyOwn.recipe.title, "User A Stew Renovated");
  assertEquals(bodyOwn.recipe.star_rating, 5);
  assertEquals(store.get(recipeA.id)?.title, "User A Stew Renovated");

  const reqCross = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${USER_A_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Attacker Malicious Override", star_rating: 1 }),
  });
  const resCross = await handler(reqCross, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resCross.status, 404);
  const bodyCross = await resCross.json();
  assertEquals(bodyCross.error.code, "NOT_FOUND");
  assertEquals(store.get(recipeB.id)?.title, "User B Tart");
  assertEquals(store.get(recipeB.id)?.star_rating, 4);
});

Deno.test("Layer 1: Deterministic mock - DELETE /recipes/:id deletes own recipe and returns 404 leaving other user recipe intact", async () => {
  const recipeA: RecipeRecord = {
    id: "77777777-7777-4777-8777-777777777777",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Pasta"),
  };
  const recipeB: RecipeRecord = {
    id: "88888888-8888-4888-8888-888888888888",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Pizza"),
  };

  const { mockFetch, store } = createMockFetch([recipeA, recipeB]);

  const reqCross = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resCross = await handler(reqCross, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resCross.status, 404);
  assertEquals(store.has(recipeB.id), true);

  const reqOwn = new Request(`http://localhost/functions/v1/recipes/${recipeA.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resOwn = await handler(reqOwn, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resOwn.status, 204);
  assertEquals(store.has(recipeA.id), false);
  assertEquals(store.has(recipeB.id), true);
});

Deno.test("Layer 1: Deterministic mock - Missing and invalid authentication return 401 UNAUTHORIZED before any database operation", async () => {
  const { mockFetch, store } = createMockFetch();

  const reqMissing = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
  });
  const resMissing = await handler(reqMissing, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resMissing.status, 401);
  const bodyMissing = await resMissing.json();
  assertEquals(bodyMissing.error.code, "UNAUTHORIZED");

  const reqInvalid = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${INVALID_JWT}` },
  });
  const resInvalid = await handler(reqInvalid, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resInvalid.status, 401);
  const bodyInvalid = await resInvalid.json();
  assertEquals(bodyInvalid.error.code, "UNAUTHORIZED");
  assertEquals(store.size, 0);
});

const activeRlsConfig = resolveCredentialStateMachine();

Deno.test({
  name: "Live PostgreSQL cross-user authorization, PostgREST RLS, and recipe lineage enforcement (hosted integration)",
  ignore: !activeRlsConfig.shouldRun,
  fn: async () => {
    if (!activeRlsConfig.shouldRun) return;
    if (activeRlsConfig.error) {
      throw new Error(activeRlsConfig.error);
    }

    validateDedicatedTestTarget(
      activeRlsConfig.url,
      activeRlsConfig.anonKey,
      activeRlsConfig.serviceRoleKey,
      activeRlsConfig.expectedProjectRef,
    );

    const knownSecrets: string[] = [activeRlsConfig.anonKey, activeRlsConfig.serviceRoleKey];
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const userAEmail = `be07-a-${runId}@morisscraps.test`;
    const userBEmail = `be07-b-${runId}@morisscraps.test`;
    const userAPassword = `PassA!${crypto.randomUUID()}9`;
    const userBPassword = `PassB!${crypto.randomUUID()}9`;
    knownSecrets.push(userAPassword, userBPassword);

    const adminClient = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.serviceRoleKey);
    const createdUserIds: string[] = [];
    const createdRecipeIds: string[] = [];
    let primaryError: Error | null = null;

    try {
      const { data: userARes, error: errCreateA } = await adminClient.auth.admin.createUser({
        email: userAEmail,
        password: userAPassword,
        email_confirm: true,
      });
      if (errCreateA || !userARes?.user?.id) {
        throw new Error(`Failed to create test user A: ${errCreateA?.message}`);
      }
      const userAId = userARes.user.id;
      createdUserIds.push(userAId);

      const { data: userBRes, error: errCreateB } = await adminClient.auth.admin.createUser({
        email: userBEmail,
        password: userBPassword,
        email_confirm: true,
      });
      if (errCreateB || !userBRes?.user?.id) {
        throw new Error(`Failed to create test user B: ${errCreateB?.message}`);
      }
      const userBId = userBRes.user.id;
      createdUserIds.push(userBId);

      const anonClient = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.anonKey);
      const { data: signInA, error: errSignA } = await anonClient.auth.signInWithPassword({
        email: userAEmail,
        password: userAPassword,
      });
      if (errSignA || !signInA?.session?.access_token) {
        throw new Error(`Failed to sign in user A: ${errSignA?.message}`);
      }
      const userAJwt = signInA.session.access_token;
      knownSecrets.push(userAJwt);

      const { data: signInB, error: errSignB } = await anonClient.auth.signInWithPassword({
        email: userBEmail,
        password: userBPassword,
      });
      if (errSignB || !signInB?.session?.access_token) {
        throw new Error(`Failed to sign in user B: ${errSignB?.message}`);
      }
      const userBJwt = signInB.session.access_token;
      knownSecrets.push(userBJwt);

      const rlsClientA = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.anonKey, userAJwt);
      const rlsClientB = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.anonKey, userBJwt);

      const createRecipe = async (client: SupabaseClient, ownerId: string, title: string): Promise<string> => {
        const payload = sampleRecipeData(title);
        const { data, error } = await client
          .from("recipes")
          .insert({ ...payload, user_id: ownerId })
          .select("id")
          .single();
        if (error || !data?.id) {
          throw new Error(`Failed to insert test recipe '${title}': ${error?.message}`);
        }
        createdRecipeIds.push(data.id);
        return data.id;
      };

      const handlerRecipeA = await createRecipe(rlsClientA, userAId, "Live Handler Recipe A");
      const handlerRecipeB = await createRecipe(rlsClientB, userBId, "Live Handler Recipe B");

      const reqListA = new Request("http://localhost/functions/v1/recipes", {
        method: "GET",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resListA = await handler(reqListA, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resListA.status, 200);
      const bodyListA = await resListA.json();
      const idsListA = (bodyListA.recipes as Array<{ id: string }>).map((r) => r.id);
      assertEquals(idsListA.includes(handlerRecipeA), true);
      assertEquals(idsListA.includes(handlerRecipeB), false);

      const reqCrossGet = new Request(`http://localhost/functions/v1/recipes/${handlerRecipeB}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resCrossGet = await handler(reqCrossGet, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resCrossGet.status, 404);
      const bodyCrossGet = await resCrossGet.json();
      assertEquals(bodyCrossGet.error.code, "NOT_FOUND");
      assertEquals(bodyCrossGet.recipe, undefined);

      const reqCrossPatch = new Request(`http://localhost/functions/v1/recipes/${handlerRecipeB}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${userAJwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Attacker Malicious Live Title", star_rating: 1 }),
      });
      const resCrossPatch = await handler(reqCrossPatch, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resCrossPatch.status, 404);

      const { data: verifyRowB } = await adminClient.from("recipes").select("title, star_rating").eq("id", handlerRecipeB).single();
      assertEquals(verifyRowB?.title, "Live Handler Recipe B");
      assertEquals(verifyRowB?.star_rating, 4);

      const reqCrossDelete = new Request(`http://localhost/functions/v1/recipes/${handlerRecipeB}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resCrossDelete = await handler(reqCrossDelete, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resCrossDelete.status, 404);

      const { data: verifyStillPresentB } = await adminClient.from("recipes").select("id").eq("id", handlerRecipeB).single();
      assertEquals(verifyStillPresentB?.id, handlerRecipeB);

      const directRecipeA = await createRecipe(rlsClientA, userAId, "Direct Recipe A");
      const directRecipeB = await createRecipe(rlsClientB, userBId, "Direct Recipe B");

      const { data: readCrossData, error: readCrossErr } = await rlsClientA
        .from("recipes")
        .select("id")
        .eq("id", directRecipeB)
        .maybeSingle();
      assertEquals(readCrossErr, null);
      assertEquals(readCrossData, null);

      const { data: readAllA, error: readAllAErr } = await rlsClientA.from("recipes").select("id, user_id");
      assertEquals(readAllAErr, null);
      const returnedIds = (readAllA ?? []).map((r: { id: string }) => r.id);
      assertEquals(returnedIds.includes(directRecipeA), true);
      assertEquals(returnedIds.includes(directRecipeB), false);

      const { data: updateCrossData, error: updateCrossErr } = await rlsClientA
        .from("recipes")
        .update({ title: "Attacker Bypass Title" })
        .eq("id", directRecipeB)
        .select("id");
      assertEquals(updateCrossErr, null);
      assertEquals(updateCrossData, []);

      const { data: verifyDirectB } = await adminClient.from("recipes").select("title").eq("id", directRecipeB).single();
      assertEquals(verifyDirectB?.title, "Direct Recipe B");

      const { data: deleteCrossData, error: deleteCrossErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", directRecipeB)
        .select("id");
      assertEquals(deleteCrossErr, null);
      assertEquals(deleteCrossData, []);

      const { data: verifyStillExistsDirectB } = await adminClient.from("recipes").select("id").eq("id", directRecipeB).single();
      assertEquals(verifyStillExistsDirectB?.id, directRecipeB);

      const forgedRecipeId = crypto.randomUUID();
      const { data: forgedData, error: forgedErr } = await rlsClientA
        .from("recipes")
        .insert({ ...sampleRecipeData("Forged Owner Recipe"), id: forgedRecipeId, user_id: userBId })
        .select("id");
      assertEquals(forgedData, null);
      assertNotEquals(forgedErr, null);
      assertEquals(forgedErr?.code, "42501");

      const { data: verifyForged } = await adminClient.from("recipes").select("id").eq("id", forgedRecipeId).maybeSingle();
      assertEquals(verifyForged, null);

      const { data: transferData, error: transferErr } = await rlsClientA
        .from("recipes")
        .update({ user_id: userBId })
        .eq("id", directRecipeA)
        .select("id");
      assertEquals(transferData, null);
      assertNotEquals(transferErr, null);
      assertEquals(transferErr?.code, "42501");

      const { data: verifyTransfer } = await adminClient.from("recipes").select("user_id").eq("id", directRecipeA).single();
      assertEquals(verifyTransfer?.user_id, userAId);

      const s1Parent = await createRecipe(rlsClientA, userAId, "Scenario 1 Parent");
      const s1Child = await createRecipe(rlsClientA, userAId, "Scenario 1 Child");
      const { data: s1Lineage, error: s1LineageErr } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s1Parent, child_recipe_id: s1Child })
        .select("id, parent_recipe_id, child_recipe_id")
        .single();
      assertEquals(s1LineageErr, null);
      assertEquals(s1Lineage?.parent_recipe_id, s1Parent);
      assertEquals(s1Lineage?.child_recipe_id, s1Child);

      const { data: s1Query, error: s1QueryErr } = await rlsClientA
        .from("recipe_lineage")
        .select("id, parent_recipe_id, child_recipe_id")
        .eq("parent_recipe_id", s1Parent);
      assertEquals(s1QueryErr, null);
      assertEquals(s1Query?.length, 1);
      assertEquals(s1Query?.[0].child_recipe_id, s1Child);

      const s2ParentA = await createRecipe(rlsClientA, userAId, "Scenario 2 Parent A");
      const s2ChildB = await createRecipe(rlsClientB, userBId, "Scenario 2 Child B");
      const { data: s2Data, error: s2Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s2ParentA, child_recipe_id: s2ChildB })
        .select("id");
      assertEquals(s2Data, null);
      assertNotEquals(s2Err, null);
      assertEquals(s2Err?.code, "42501");

      const { data: verifyS2 } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s2ParentA)
        .eq("child_recipe_id", s2ChildB);
      assertEquals(verifyS2?.length, 0);

      const s3ParentB = await createRecipe(rlsClientB, userBId, "Scenario 3 Parent B");
      const s3ChildA = await createRecipe(rlsClientA, userAId, "Scenario 3 Child A");
      const { data: s3Data, error: s3Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s3ParentB, child_recipe_id: s3ChildA })
        .select("id");
      assertEquals(s3Data, null);
      assertNotEquals(s3Err, null);
      assertEquals(s3Err?.code, "42501");

      const { data: verifyS3 } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s3ParentB)
        .eq("child_recipe_id", s3ChildA);
      assertEquals(verifyS3?.length, 0);

      const s4ParentB = await createRecipe(rlsClientB, userBId, "Scenario 4 Parent B");
      const s4ChildB = await createRecipe(rlsClientB, userBId, "Scenario 4 Child B");
      const { data: s4Data, error: s4Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s4ParentB, child_recipe_id: s4ChildB })
        .select("id");
      assertEquals(s4Data, null);
      assertNotEquals(s4Err, null);
      assertEquals(s4Err?.code, "42501");

      const { data: verifyS4 } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s4ParentB)
        .eq("child_recipe_id", s4ChildB);
      assertEquals(verifyS4?.length, 0);

      const s5RecipeA = await createRecipe(rlsClientA, userAId, "Scenario 5 Recipe A");
      const { data: s5Data, error: s5Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s5RecipeA, child_recipe_id: s5RecipeA })
        .select("id");
      assertEquals(s5Data, null);
      assertNotEquals(s5Err, null);
      assertEquals(s5Err?.code, "23514");

      const { data: verifyS5 } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s5RecipeA)
        .eq("child_recipe_id", s5RecipeA);
      assertEquals(verifyS5?.length, 0);

      const s6ParentA = await createRecipe(rlsClientA, userAId, "Scenario 6 Parent A");
      const s6ChildA = await createRecipe(rlsClientA, userAId, "Scenario 6 Child A");
      const { data: s6FirstData, error: s6FirstErr } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s6ParentA, child_recipe_id: s6ChildA })
        .select("id");
      assertEquals(s6FirstErr, null);
      assertNotEquals(s6FirstData?.[0]?.id, undefined);

      const { data: s6DuplicateData, error: s6DuplicateErr } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s6ParentA, child_recipe_id: s6ChildA })
        .select("id");
      assertEquals(s6DuplicateData, null);
      assertNotEquals(s6DuplicateErr, null);
      assertEquals(s6DuplicateErr?.code, "23505");

      const { data: verifyS6 } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s6ParentA)
        .eq("child_recipe_id", s6ChildA);
      assertEquals(verifyS6?.length, 1);

      const s7ParentA = await createRecipe(rlsClientA, userAId, "Scenario 7 Parent A");
      const s7ChildA = await createRecipe(rlsClientA, userAId, "Scenario 7 Child A");
      await rlsClientA.from("recipe_lineage").insert({ parent_recipe_id: s7ParentA, child_recipe_id: s7ChildA });
      const { data: s7DeleteParentData, error: s7DeleteParentErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", s7ParentA)
        .select("id");
      assertEquals(s7DeleteParentErr, null);
      assertEquals(s7DeleteParentData?.length, 1);

      const { data: verifyS7Lineage } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s7ParentA);
      assertEquals(verifyS7Lineage?.length, 0);

      const { data: verifyS7Child } = await adminClient
        .from("recipes")
        .select("id")
        .eq("id", s7ChildA)
        .single();
      assertEquals(verifyS7Child?.id, s7ChildA);

      const s8ParentA = await createRecipe(rlsClientA, userAId, "Scenario 8 Parent A");
      const s8ChildA = await createRecipe(rlsClientA, userAId, "Scenario 8 Child A");
      await rlsClientA.from("recipe_lineage").insert({ parent_recipe_id: s8ParentA, child_recipe_id: s8ChildA });
      const { data: s8DeleteChildData, error: s8DeleteChildErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", s8ChildA)
        .select("id");
      assertEquals(s8DeleteChildErr, null);
      assertEquals(s8DeleteChildData?.length, 1);

      const { data: verifyS8Lineage } = await adminClient
        .from("recipe_lineage")
        .select("id")
        .eq("child_recipe_id", s8ChildA);
      assertEquals(verifyS8Lineage?.length, 0);

      const { data: verifyS8Parent } = await adminClient
        .from("recipes")
        .select("id")
        .eq("id", s8ParentA)
        .single();
      assertEquals(verifyS8Parent?.id, s8ParentA);

      const s9ParentB = await createRecipe(rlsClientB, userBId, "Scenario 9 Parent B");
      const s9ChildB = await createRecipe(rlsClientB, userBId, "Scenario 9 Child B");
      const { data: s9LineageRow } = await rlsClientB
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s9ParentB, child_recipe_id: s9ChildB })
        .select("id")
        .single();
      const s9LineageId = s9LineageRow?.id;
      assertNotEquals(s9LineageId, undefined);

      const { data: s9AttackLineageData, error: s9AttackLineageErr } = await rlsClientA
        .from("recipe_lineage")
        .delete()
        .eq("id", s9LineageId)
        .select("id");
      assertEquals(s9AttackLineageErr, null);
      assertEquals(s9AttackLineageData, []);

      const { data: s9AttackRecipeData, error: s9AttackRecipeErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", s9ParentB)
        .select("id");
      assertEquals(s9AttackRecipeErr, null);
      assertEquals(s9AttackRecipeData, []);

      const { data: verifyS9Parent } = await adminClient.from("recipes").select("id").eq("id", s9ParentB).single();
      assertEquals(verifyS9Parent?.id, s9ParentB);

      const { data: verifyS9Child } = await adminClient.from("recipes").select("id").eq("id", s9ChildB).single();
      assertEquals(verifyS9Child?.id, s9ChildB);

      const { data: verifyS9Lineage } = await adminClient.from("recipe_lineage").select("id").eq("id", s9LineageId).single();
      assertEquals(verifyS9Lineage?.id, s9LineageId);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      primaryError = new Error(sanitizeSecrets(raw, knownSecrets));
    } finally {
      const cleanupErrors: string[] = [];

      if (createdUserIds.length > 0) {
        try {
          await adminClient.from("recipe_lineage").delete().filter("parent_recipe_id", "in", `(select id from recipes where user_id in (${createdUserIds.join(",")}))`);
        } catch (e) {
          cleanupErrors.push(`Failed cleaning recipe_lineage by parent: ${String(e)}`);
        }
        try {
          await adminClient.from("recipe_lineage").delete().filter("child_recipe_id", "in", `(select id from recipes where user_id in (${createdUserIds.join(",")}))`);
        } catch (e) {
          cleanupErrors.push(`Failed cleaning recipe_lineage by child: ${String(e)}`);
        }
      }

      if (createdRecipeIds.length > 0) {
        try {
          await adminClient.from("recipes").delete().in("id", createdRecipeIds);
        } catch (e) {
          cleanupErrors.push(`Failed cleaning recipes: ${String(e)}`);
        }
      }

      for (const uid of createdUserIds) {
        try {
          await adminClient.from("profiles").delete().eq("id", uid);
        } catch (e) {
          cleanupErrors.push(`Failed cleaning profile ${uid}: ${String(e)}`);
        }
        try {
          await adminClient.auth.admin.deleteUser(uid);
        } catch (e) {
          cleanupErrors.push(`Failed deleting user ${uid}: ${String(e)}`);
        }
      }

      if (primaryError && cleanupErrors.length > 0) {
        throw new Error(`${primaryError.message} | Cleanup errors: ${cleanupErrors.join("; ")}`, { cause: primaryError });
      }
      if (primaryError) {
        throw primaryError;
      }
      if (cleanupErrors.length > 0) {
        throw new Error(`Cleanup failed: ${cleanupErrors.join("; ")}`);
      }
    }
  },
});
