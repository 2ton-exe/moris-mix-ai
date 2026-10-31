import { assertEquals } from "jsr:@std/assert@1";
import {
  GoogleGenerativeAIResponseError,
  type GoogleGenerativeAI,
} from "npm:@google/generative-ai@0.21.0";
import {
  GENERATE_DISABLED_ENV,
  GENERATE_ENABLED_ENV,
  handler as generateRecipeHandler,
  MAX_REQUEST_BYTES,
} from "../generate-recipe/index.ts";
import {
  AI_ENVIRONMENT_ENV,
  ALLOW_FAILURE_DRILLS_ENV,
  SIMULATE_BAD_OUTPUT_ENV,
  SIMULATE_OUTAGE_ENV,
} from "../_shared/ai/drills.ts";
import { MOCK_EXTRACTED_RECIPE, MOCK_GENERATED_RECIPE } from "../_shared/ai/mocks.ts";
import { AIError, type AIErrorCode, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import type {
  AIProvider,
  GenerateRecipeContext,
  GenerateRecipeInput,
  GeneratedRecipe,
} from "../_shared/ai/AIProvider.ts";
import type { AuthContext } from "../_shared/auth.ts";
import type { ChefRecipeContextResult } from "../_shared/ai/schemas.ts";
import { GenerateRecipeResponseSchema } from "../_shared/ai/schemas.ts";
import { DEFAULT_AI_DAILY_LIMIT } from "../_shared/ai/quota.ts";
import {
  CANDIDATE_TOKEN_AUDIENCE,
  verifyCandidateToken,
} from "../_shared/ai/candidateToken.ts";

/** AI-07: every generation test runs with a fixed signing secret. */
const TEST_CANDIDATE_TOKEN_SECRET = "test-candidate-token-secret-0123456789abcdef";
Deno.env.set("AI_CANDIDATE_TOKEN_SECRET", TEST_CANDIDATE_TOKEN_SECRET);

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
const ENDPOINT_PATHS = ["/functions/v1/generate-recipe", "/generate-recipe"];
const PARENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const FOREIGN_PARENT_ID = "22222222-2222-4222-8222-222222222222";

/** Existing endpoint contracts are exercised with the operator opt-in explicitly set. */
async function handler(...args: Parameters<typeof generateRecipeHandler>): Promise<Response> {
  const previous = Deno.env.get(GENERATE_ENABLED_ENV);
  try {
    Deno.env.set(GENERATE_ENABLED_ENV, "true");
    return await generateRecipeHandler(...args);
  } finally {
    if (previous === undefined) Deno.env.delete(GENERATE_ENABLED_ENV);
    else Deno.env.set(GENERATE_ENABLED_ENV, previous);
  }
}

type RecordedRequest = {
  method: string;
  path: string;
  authorization: string | null;
  apikey: string | null;
};

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

/**
 * Auth + quota fetch mock. It answers only the endpoints this function may
 * touch and records every call so tests can prove no write happens. `recipes`
 * optionally feeds BE-10's retrieval with owner-scoped rows.
 */
function createFetchMock(
  options: {
    auth?: "ok" | "unauthorized" | "rate_limited";
    authRetryAfter?: string;
    usageCount?: number;
    usageError?: boolean;
    usageRow?: unknown;
    recipes?: unknown;
  } = {},
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];

  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );
    const headers = new Headers(init?.headers);

    requests.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
    });

    if (url.pathname === "/auth/v1/user") {
      if (options.auth === "unauthorized") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 401,
              error_code: "bad_jwt",
              msg: "invalid JWT: signature is invalid or token is expired",
            }),
            { status: 401, headers: jsonHeaders() },
          ),
        );
      }
      if (options.auth === "rate_limited") {
        const headers = jsonHeaders();
        if (options.authRetryAfter) headers["Retry-After"] = options.authRetryAfter;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 429,
              error_code: "over_request_rate_limit",
              msg: "Too many requests. Please try again later.",
            }),
            { status: 429, headers },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          { status: 200, headers: jsonHeaders() },
        ),
      );
    }

    if (url.pathname === "/rest/v1/ai_usage_daily") {
      if (options.usageError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "PGRST500", message: "database is down" }),
            { status: 500, headers: jsonHeaders() },
          ),
        );
      }
      const count = options.usageCount ?? 0;
      const payload = options.usageRow !== undefined
        ? options.usageRow
        : count > 0
        ? [{ operation_count: count }]
        : [];
      return Promise.resolve(
        new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders() }),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      return Promise.resolve(
        new Response(JSON.stringify(options.recipes ?? []), {
          status: 200,
          headers: jsonHeaders(),
        }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  return { fetchImpl, requests };
}

const MATCHED_CONTEXT: ChefRecipeContextResult = {
  status: "MATCHED",
  pantryItems: ["rice", "eggs"],
  preferences: "quick weeknight dinner",
  recipes: [{
    id: PARENT_ID,
    title: "Garlic Fried Rice",
    ingredients: [
      { name: "rice", quantity: 2, unit: "cups", inferred: false },
      { name: "garlic", quantity: 2, unit: "cloves", inferred: false },
    ],
    instructions: [
      { step: 1, text: "Fry the garlic." },
      { step: 2, text: "Toss in the rice." },
    ],
    flavor_scores: null,
    star_rating: 5,
    created_at: "2026-10-01T00:00:00.000Z",
    // BE-10: 1 matched ingredient (rice) / 2 unique recipe ingredients.
    overlap_ratio: 0.5,
    matched_ingredients: ["rice"],
  }],
  totalCandidateCount: 4,
  matchedCandidateCount: 1,
  truncated: false,
};

const COLD_START_CONTEXT: ChefRecipeContextResult = {
  status: "NO_SAVED_RECIPES",
  pantryItems: ["rice", "eggs"],
  recipes: [],
  totalCandidateCount: 0,
  matchedCandidateCount: 0,
  truncated: false,
};

const NO_OVERLAP_CONTEXT: ChefRecipeContextResult = {
  status: "NO_PANTRY_OVERLAP",
  pantryItems: ["rice", "eggs"],
  recipes: [],
  totalCandidateCount: 3,
  matchedCandidateCount: 0,
  truncated: false,
};

const COLD_START_GENERATED: GeneratedRecipe = {
  ...MOCK_GENERATED_RECIPE,
  parentRecipeIds: [],
};

function contextReturning(
  context: ChefRecipeContextResult,
  onCall?: (auth: AuthContext, input: GenerateRecipeInput) => void,
): (auth: AuthContext, input: GenerateRecipeInput) => Promise<ChefRecipeContextResult> {
  return (auth, input) => {
    onCall?.(auth, input);
    return Promise.resolve(context);
  };
}

function providerReturning(
  generated: GeneratedRecipe,
  onCall?: (input: GenerateRecipeInput, context: GenerateRecipeContext) => void,
): AIProvider {
  return {
    extractRecipe: () => Promise.reject(new Error("extractRecipe is not used here")),
    generateRecipe: (input, context) => {
      onCall?.(input, context);
      return Promise.resolve(generated);
    },
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };
}

function providerThrowing(error: unknown, onCall?: () => void): AIProvider {
  return {
    extractRecipe: () => Promise.reject(new Error("extractRecipe is not used here")),
    generateRecipe: () => {
      onCall?.();
      return Promise.reject(error);
    },
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };
}

/** Builds a JSON request with configurable routing and method, omitting auth when the token is null. */
function generateRequest(
  body: string,
  path = ENDPOINT_PATHS[0],
  method = "POST",
  token: string | null = VALID_TEST_JWT,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, { method, headers, body });
}

function validBody(
  pantryItems: unknown = ["  rice  ", "eggs"],
  preferences?: unknown,
): string {
  return JSON.stringify({
    pantryItems,
    ...(preferences === undefined ? {} : { preferences }),
  });
}

/**
 * Builds a well-formed request body of an exact byte length. The padding lives
 * in an ignored `junk` field so the contract itself stays valid; `a` is one
 * byte, making the arithmetic exact.
 */
function bodyOfExactByteLength(targetBytes: number): string {
  const prefix = '{"pantryItems":["x"],"junk":"';
  const suffix = '"}';
  const overhead = prefix.length + suffix.length;
  return prefix + "a".repeat(Math.max(0, targetBytes - overhead)) + suffix;
}

function assertNoDatabaseWrites(requests: RecordedRequest[]): void {
  const writes = requests.filter(
    (request) => request.path.startsWith("/rest/") && request.method !== "GET",
  );
  assertEquals(writes, []);
}

function assertNoRecipeOrLineageAccess(requests: RecordedRequest[]): void {
  const touched = requests.filter(
    (request) =>
      request.path.startsWith("/rest/v1/recipes") ||
      request.path.startsWith("/rest/v1/recipe_lineage"),
  );
  assertEquals(touched, []);
}

/**
 * AI-09: retrieval GETs are legitimate, but a failed generation must never
 * create or mutate a recipe or lineage row.
 */
function assertNoRecipeOrLineageWrites(requests: RecordedRequest[]): void {
  const writes = requests.filter(
    (request) =>
      (request.path.startsWith("/rest/v1/recipes") ||
        request.path.startsWith("/rest/v1/recipe_lineage")) &&
      request.method !== "GET",
  );
  assertEquals(writes, []);
}

Deno.test("The generate contract defaults to 20 AI operations per day", () => {
  assertEquals(DEFAULT_AI_DAILY_LIMIT, 20);
});

Deno.test("CORS OPTIONS preflight on /generate-recipe returns 204 without authentication and scopes ALLOWED_ORIGIN", async () => {
  const preflight = await handler(
    new Request("http://localhost/functions/v1/generate-recipe", { method: "OPTIONS" }),
  );
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("access-control-allow-origin"), "*");
  assertEquals(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assertEquals(
    preflight.headers.get("access-control-allow-headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(preflight.headers.get("x-content-type-options"), "nosniff");
  assertEquals(await preflight.text(), "");

  const originalOrigin = Deno.env.get("ALLOWED_ORIGIN");
  try {
    Deno.env.set("ALLOWED_ORIGIN", "https://frontend.morisscraps.com");
    const scoped = await handler(
      new Request("http://localhost/generate-recipe", { method: "OPTIONS" }),
    );
    assertEquals(scoped.status, 204);
    assertEquals(
      scoped.headers.get("access-control-allow-origin"),
      "https://frontend.morisscraps.com",
    );
    assertEquals(scoped.headers.get("vary"), "Origin");
  } finally {
    if (originalOrigin) Deno.env.set("ALLOWED_ORIGIN", originalOrigin);
    else Deno.env.delete("ALLOWED_ORIGIN");
  }
});

Deno.test("Unsupported methods return 405 with Allow: POST, OPTIONS and never authenticate or call the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;

  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
    const res = await handler(
      new Request("http://localhost/functions/v1/generate-recipe", {
        method,
        headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
      }),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run"), () => {
          providerCalled = true;
        }),
      },
    );

    assertEquals(res.status, 405);
    assertEquals(res.headers.get("allow"), "POST, OPTIONS");
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assertEquals(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
  }

  assertEquals(providerCalled, false);
  assertEquals(requests, []);
});

Deno.test("Unknown paths return 404 NOT_FOUND without authenticating", async () => {
  const { fetchImpl, requests } = createFetchMock();

  for (const path of [
    "/functions/v1/generate-recipe/extra",
    "/generate-recipe/extra",
    "/functions/v1/other",
    "/",
  ]) {
    const res = await handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VALID_TEST_JWT}`, "Content-Type": "application/json" },
        body: validBody(),
      }),
      { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: fetchImpl },
    );

    assertEquals(res.status, 404);
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assertEquals((await res.json()).error?.code, "NOT_FOUND");
  }

  assertEquals(requests, []);
});

Deno.test("Unauthenticated requests return 401 UNAUTHORIZED before quota, retrieval or provider", async () => {
  const { fetchImpl, requests } = createFetchMock({ auth: "unauthorized" });
  let providerCalled = false;
  let contextCalled = false;

  const unauthorized: Array<Request> = [
    new Request("http://localhost/functions/v1/generate-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody(),
    }),
    generateRequest(validBody(), ENDPOINT_PATHS[0], "POST", "not-a-compact-jwt"),
    generateRequest(validBody(), ENDPOINT_PATHS[0], "POST", FORGED_TEST_JWT),
    generateRequest(validBody(), ENDPOINT_PATHS[0], "POST", EXPIRED_TEST_JWT),
  ];

  for (const req of unauthorized) {
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
      buildContext: contextReturning(COLD_START_CONTEXT, () => {
        contextCalled = true;
      }),
    });

    assertEquals(res.status, 401);
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assertEquals((await res.json()).error?.code, "UNAUTHORIZED");
  }

  assertEquals(providerCalled, false);
  assertEquals(contextCalled, false);
  assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
});

Deno.test("An auth-service 429 becomes 503 AUTH_SERVICE_RATE_LIMITED with Retry-After, before retrieval or provider", async () => {
  const { fetchImpl, requests } = createFetchMock({ auth: "rate_limited", authRetryAfter: "17" });
  let providerCalled = false;

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
  });

  assertEquals(res.status, 503);
  assertEquals(res.headers.get("retry-after"), "17");
  assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assertEquals((await res.json()).error?.code, "AUTH_SERVICE_RATE_LIMITED");
  assertEquals(providerCalled, false);
  assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
});

Deno.test("Generation defaults off and requires a valid operator opt-in before reading the body, quota or context", async () => {
  const names = [GENERATE_ENABLED_ENV, GENERATE_DISABLED_ENV];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  try {
    Deno.env.delete(GENERATE_DISABLED_ENV);
    for (const value of [undefined, "", "false", "0", "off", "typo"]) {
      if (value === undefined) Deno.env.delete(GENERATE_ENABLED_ENV);
      else Deno.env.set(GENERATE_ENABLED_ENV, value);
      const { fetchImpl, requests } = createFetchMock();
      let providerCalls = 0;
      let quotaCalls = 0;
      let contextCalls = 0;
      let bodyReads = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          bodyReads++;
          controller.enqueue(new TextEncoder().encode(validBody()));
          controller.close();
        },
      }, { highWaterMark: 0 });
      const res = await generateRecipeHandler(
        new Request(`http://localhost${ENDPOINT_PATHS[0]}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
          body,
        }),
        {
          supabaseUrl: TEST_SUPABASE_URL,
          supabaseAnonKey: TEST_ANON_KEY,
          fetch: fetchImpl,
          provider: providerReturning(MOCK_GENERATED_RECIPE, () => providerCalls++),
          quotaCheck: () => {
            quotaCalls++;
            return Promise.resolve({ status: "allowed", limit: 20, used: 0 });
          },
          buildContext: contextReturning(COLD_START_CONTEXT, () => {
            contextCalls++;
          }),
        },
      );
      assertEquals(res.status, 503);
      assertEquals((await res.json()).error?.code, "AI_DISABLED");
      assertEquals(res.headers.get("cache-control"), "no-store");
      assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
      assertEquals(bodyReads, 0);
      assertEquals(quotaCalls, 0);
      assertEquals(contextCalls, 0);
      assertEquals(providerCalls, 0);
      assertEquals(requests.map((request) => request.path), ["/auth/v1/user"]);
      await body.cancel();
    }
    for (const value of ["1", "true", "yes", "on", " TRUE "]) {
      Deno.env.set(GENERATE_ENABLED_ENV, value);
      const { fetchImpl, requests } = createFetchMock();
      const res = await generateRecipeHandler(generateRequest(validBody()), {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(COLD_START_GENERATED),
        buildContext: contextReturning(COLD_START_CONTEXT),
      });
      assertEquals(res.status, 200);
      assertNoDatabaseWrites(requests);
    }
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("The operator kill switch overrides the generation opt-in before quota, retrieval or provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  let contextCalled = false;
  const previous = Deno.env.get(GENERATE_DISABLED_ENV);

  try {
    Deno.env.set(GENERATE_DISABLED_ENV, "1");
    const res = await handler(generateRequest(validBody()), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
      buildContext: contextReturning(COLD_START_CONTEXT, () => {
        contextCalled = true;
      }),
    });

    assertEquals(res.status, 503);
    assertEquals((await res.json()).error?.code, "AI_DISABLED");
    assertEquals(providerCalled, false);
    assertEquals(contextCalled, false);
    assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
  } finally {
    if (previous === undefined) Deno.env.delete(GENERATE_DISABLED_ENV);
    else Deno.env.set(GENERATE_DISABLED_ENV, previous);
  }

  // A falsy kill switch permits generation when the operator opt-in is enabled.
  Deno.env.set(GENERATE_DISABLED_ENV, "0");
  try {
    const res = await handler(generateRequest(validBody()), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(COLD_START_GENERATED),
      buildContext: contextReturning(COLD_START_CONTEXT),
    });
    assertEquals(res.status, 200);
  } finally {
    if (previous === undefined) Deno.env.delete(GENERATE_DISABLED_ENV);
    else Deno.env.set(GENERATE_DISABLED_ENV, previous);
  }
});

Deno.test("Malformed JSON bodies return 400 INVALID_JSON without calling quota, retrieval or the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  let contextCalled = false;

  for (const rawBody of [
    "",
    "   ",
    "{not-valid-json",
    '{"pantryItems": ["Unclosed',
    "null",
    "true",
    "123",
    '"just a string"',
    "[]",
    '[{"pantryItems": ["array not object"]}]',
  ]) {
    const res = await handler(generateRequest(rawBody), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
      buildContext: contextReturning(COLD_START_CONTEXT, () => {
        contextCalled = true;
      }),
    });

    assertEquals(res.status, 400);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals((await res.json()).error?.code, "INVALID_JSON");
  }

  assertEquals(providerCalled, false);
  assertEquals(contextCalled, false);
  assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
});

Deno.test("Invalid payloads fail Zod validation with 400 VALIDATION_ERROR and never retrieve or call the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  let contextCalled = false;

  const invalidCases: unknown[] = [
    {},
    { pantryItems: "rice" },
    { pantryItems: null },
    { pantryItems: [] },
    { pantryItems: ["   "] },
    { pantryItems: ["\t\n"] },
    { pantryItems: [123] },
    { pantryItems: ["rice", ""] },
    { pantryItems: ["x".repeat(101)] },
    { pantryItems: Array.from({ length: 101 }, () => "rice") },
    { pantryItems: ["rice"], preferences: 123 },
    { pantryItems: ["rice"], preferences: "x".repeat(1001) },
  ];

  for (const payload of invalidCases) {
    const res = await handler(generateRequest(JSON.stringify(payload)), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
      buildContext: contextReturning(COLD_START_CONTEXT, () => {
        contextCalled = true;
      }),
    });

    assertEquals(res.status, 400);
    const rawText = await res.text();
    assertEquals(rawText.includes(VALID_TEST_JWT), false);
    assertEquals(rawText.includes(TEST_ANON_KEY), false);
    const body = JSON.parse(rawText);
    assertEquals(body.error?.code, "VALIDATION_ERROR");
    assertEquals(Array.isArray(body.error?.details), true);
    assertEquals(body.error.details.length > 0, true);
  }

  assertEquals(providerCalled, false);
  assertEquals(contextCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("An empty pantry is rejected as a client bug, so EMPTY_PANTRY is unreachable through this endpoint", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  let contextCalled = false;

  const res = await handler(generateRequest(JSON.stringify({ pantryItems: [] })), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
    buildContext: contextReturning(COLD_START_CONTEXT, () => {
      contextCalled = true;
    }),
  });

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error?.code, "VALIDATION_ERROR");
  assertEquals(
    body.error.details.some((issue: { path?: string }) => issue.path === "pantryItems"),
    true,
  );
  assertEquals(providerCalled, false);
  assertEquals(contextCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("Oversized bodies return 413 INPUT_TOO_LARGE before quota, retrieval or the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  const deps = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
    buildContext: contextReturning(COLD_START_CONTEXT),
  };

  const hugeBody = JSON.stringify({
    pantryItems: ["rice"],
    junk: "x".repeat(MAX_REQUEST_BYTES + 1),
  });
  const tooBig = await handler(generateRequest(hugeBody), deps);
  assertEquals(tooBig.status, 413);
  assertEquals((await tooBig.json()).error?.code, "INPUT_TOO_LARGE");

  // A declared Content-Length over the cap is rejected before the body is read.
  const declaredHeaders = new Headers({
    Authorization: `Bearer ${VALID_TEST_JWT}`,
    "Content-Type": "application/json",
    "Content-Length": String(MAX_REQUEST_BYTES + 1),
  });
  const declared = await handler(
    new Request(`http://localhost${ENDPOINT_PATHS[0]}`, {
      method: "POST",
      headers: declaredHeaders,
      body: validBody(),
    }),
    deps,
  );
  assertEquals(declared.status, 413);
  assertEquals((await declared.json()).error?.code, "INPUT_TOO_LARGE");

  // Exactly at the cap is still allowed.
  const atCap = await handler(generateRequest(bodyOfExactByteLength(MAX_REQUEST_BYTES)), {
    ...deps,
    provider: providerReturning(COLD_START_GENERATED),
  });
  assertEquals(atCap.status, 200);

  const overCap = await handler(generateRequest(bodyOfExactByteLength(MAX_REQUEST_BYTES + 1)), deps);
  assertEquals(overCap.status, 413);
  assertEquals((await overCap.json()).error?.code, "INPUT_TOO_LARGE");

  // A multibyte body under the byte cap is decoded intact; over it is rejected
  // even though its character count is under the cap.
  const multibyteOk = JSON.stringify({
    pantryItems: ["é".repeat(100)],
    junk: "é".repeat(1_000),
  });
  assertEquals(new TextEncoder().encode(multibyteOk).byteLength < MAX_REQUEST_BYTES, true);
  const ok = await handler(generateRequest(multibyteOk), {
    ...deps,
    provider: providerReturning(COLD_START_GENERATED),
  });
  assertEquals(ok.status, 200);

  const multibyteOver = JSON.stringify({
    pantryItems: ["rice"],
    junk: "\u{1F600}".repeat(40_000),
  });
  assertEquals(multibyteOver.length < MAX_REQUEST_BYTES, true);
  assertEquals(new TextEncoder().encode(multibyteOver).byteLength > MAX_REQUEST_BYTES, true);
  const over = await handler(generateRequest(multibyteOver), deps);
  assertEquals(over.status, 413);
  assertEquals((await over.json()).error?.code, "INPUT_TOO_LARGE");

  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("Streaming byte enforcement cancels at the first over-limit chunk regardless of Content-Length", async () => {
  for (const declaredLength of [undefined, "invalid", "1", String(MAX_REQUEST_BYTES + 1)]) {
    const { fetchImpl, requests } = createFetchMock();
    let reads = 0;
    let cancelled = false;
    let providerCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(reads <= 2 ? MAX_REQUEST_BYTES / 2 : 1));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const headers = new Headers({ Authorization: `Bearer ${VALID_TEST_JWT}` });
    if (declaredLength !== undefined) headers.set("Content-Length", declaredLength);
    const res = await handler(new Request(`http://localhost${ENDPOINT_PATHS[0]}`, {
      method: "POST",
      headers,
      body,
    }), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(COLD_START_GENERATED, () => providerCalls++),
      buildContext: contextReturning(COLD_START_CONTEXT),
    });
    assertEquals(res.status, 413);
    assertEquals((await res.json()).error?.code, "INPUT_TOO_LARGE");
    const fastRejected = declaredLength === String(MAX_REQUEST_BYTES + 1);
    assertEquals(reads, fastRejected ? 0 : 3);
    assertEquals(cancelled, !fastRejected);
    assertEquals(providerCalls, 0);
    assertEquals(requests.map((request) => request.path), ["/auth/v1/user"]);
    if (fastRejected) await body.cancel();
  }
});

Deno.test("Successful generation returns the validated preview, resolves parents and never persists", async () => {
  for (const path of ENDPOINT_PATHS) {
    const { fetchImpl, requests } = createFetchMock({ usageCount: 0 });
    const seenInputs: GenerateRecipeInput[] = [];

    const res = await handler(
      generateRequest(
        JSON.stringify({ pantryItems: ["  rice  ", "eggs"], preferences: "  quick  " }),
        path,
      ),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_GENERATED_RECIPE, (input) => seenInputs.push(input)),
        buildContext: contextReturning(MATCHED_CONTEXT),
      },
    );

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");

    const body = await res.json();
    assertEquals(GenerateRecipeResponseSchema.safeParse(body).success, true);
    assertEquals(body.recipe.title, MOCK_EXTRACTED_RECIPE.title);
    assertEquals(body.substitutions, MOCK_GENERATED_RECIPE.substitutions);
    assertEquals(body.parents, [
      { id: PARENT_ID, title: "Garlic Fried Rice", star_rating: 5 },
    ]);
    assertEquals(body.context, {
      status: "MATCHED",
      matchedCandidateCount: 1,
      totalCandidateCount: 4,
    });
    assertEquals((body.recipe as Record<string, unknown>).user_id, undefined);
    assertEquals((body.recipe as Record<string, unknown>).id, undefined);

    // The request is trimmed before it reaches retrieval and the provider.
    assertEquals(seenInputs.length, 1);
    assertEquals(seenInputs[0], { pantryItems: ["rice", "eggs"], preferences: "quick" });

    const quotaRead = requests.find((request) => request.path === "/rest/v1/ai_usage_daily");
    assertEquals(quotaRead?.method, "GET");
    assertEquals(quotaRead?.authorization, `Bearer ${VALID_TEST_JWT}`);
    assertEquals(quotaRead?.apikey, TEST_ANON_KEY);

    assertNoDatabaseWrites(requests);
    assertNoRecipeOrLineageAccess(requests);
  }
});

Deno.test("AI-07: generation returns a candidate token bound to the resolved parents", async () => {
  const { fetchImpl, requests } = createFetchMock();
  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(MOCK_GENERATED_RECIPE),
    buildContext: contextReturning(MATCHED_CONTEXT),
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(typeof body.candidate_token, "string");

  const verified = await verifyCandidateToken(body.candidate_token, {
    userId: VERIFIED_USER_ID,
    secret: TEST_CANDIDATE_TOKEN_SECRET,
  });
  assertEquals(verified.ok, true);
  if (!verified.ok) return;
  assertEquals(verified.claims.sub, VERIFIED_USER_ID);
  assertEquals(verified.claims.aud, CANDIDATE_TOKEN_AUDIENCE);
  assertEquals(verified.claims.parent_recipe_ids, [PARENT_ID]);
  const ttlSeconds = verified.claims.exp - verified.claims.iat;
  assertEquals(ttlSeconds > 0 && ttlSeconds <= 3600, true);
  assertNoRecipeOrLineageWrites(requests);
});

Deno.test("AI-07: generation fails closed before quota or provider when the candidate token secret is missing", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let quotaCalls = 0;
  let providerCalls = 0;

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    candidateTokenSecret: "",
    quotaCheck: () => {
      quotaCalls += 1;
      return Promise.resolve({ status: "allowed", limit: 20, used: 0 });
    },
    provider: providerReturning(MOCK_GENERATED_RECIPE, () => {
      providerCalls += 1;
    }),
    buildContext: contextReturning(MATCHED_CONTEXT),
  });

  assertEquals(res.status, 500);
  assertEquals((await res.json()).error?.code, "INTERNAL_ERROR");
  assertEquals(quotaCalls, 0);
  assertEquals(providerCalls, 0);
  assertEquals(requests.map((request) => request.path), ["/auth/v1/user"]);
});

Deno.test("The endpoint passes the authenticated user and trimmed input to retrieval, and returns its MATCHED context", async () => {
  const { fetchImpl, requests } = createFetchMock();
  const seen: Array<{ user: string; input: GenerateRecipeInput }> = [];

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(MOCK_GENERATED_RECIPE),
    buildContext: contextReturning(MATCHED_CONTEXT, (auth, input) => {
      seen.push({ user: auth.user.id, input });
    }),
  });

  assertEquals(res.status, 200);
  assertEquals(seen, [{
    user: VERIFIED_USER_ID,
    input: { pantryItems: ["rice", "eggs"] },
  }]);
  assertNoDatabaseWrites(requests);
});

Deno.test("Cold start with no saved recipes still generates an unsaved preview with no parents", async () => {
  const { fetchImpl, requests } = createFetchMock();
  const seenContexts: GenerateRecipeContext[] = [];

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(COLD_START_GENERATED, (_input, context) => {
      seenContexts.push(context);
    }),
    buildContext: contextReturning(COLD_START_CONTEXT),
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(GenerateRecipeResponseSchema.safeParse(body).success, true);
  assertEquals(body.parents, []);
  assertEquals(body.candidate_token, null);
  assertEquals(body.context, {
    status: "NO_SAVED_RECIPES",
    matchedCandidateCount: 0,
    totalCandidateCount: 0,
  });
  assertEquals(seenContexts.length, 1);
  assertEquals(seenContexts[0].recipes, []);
  assertNoDatabaseWrites(requests);
});

Deno.test("Cold start with saved recipes but no pantry overlap reports NO_PANTRY_OVERLAP and no parents", async () => {
  const { fetchImpl, requests } = createFetchMock();

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(COLD_START_GENERATED),
    buildContext: contextReturning(NO_OVERLAP_CONTEXT),
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.parents, []);
  assertEquals(body.context, {
    status: "NO_PANTRY_OVERLAP",
    matchedCandidateCount: 0,
    totalCandidateCount: 3,
  });
  assertNoDatabaseWrites(requests);
});

Deno.test("The real BE-10 retrieval feeds the endpoint and returns a resolved parent without writes", async () => {
  const { fetchImpl, requests } = createFetchMock({
    recipes: [{
      id: PARENT_ID,
      user_id: VERIFIED_USER_ID,
      title: "Garlic Fried Rice",
      ingredients: [
        { name: "rice", quantity: 2, unit: "cups", inferred: false },
        { name: "garlic", quantity: 2, unit: "cloves", inferred: false },
      ],
      instructions: [
        { step: 1, text: "Fry the garlic." },
        { step: 2, text: "Toss in the rice." },
      ],
      flavor_scores: null,
      star_rating: 5,
      created_at: "2026-10-01T00:00:00.000Z",
    }],
  });

  const res = await handler(
    generateRequest(JSON.stringify({ pantryItems: ["rice"] })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(MOCK_GENERATED_RECIPE),
    },
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.parents, [{ id: PARENT_ID, title: "Garlic Fried Rice", star_rating: 5 }]);
  assertEquals(body.context, {
    status: "MATCHED",
    matchedCandidateCount: 1,
    totalCandidateCount: 1,
  });

  const recipeRead = requests.find((request) => request.path === "/rest/v1/recipes");
  assertEquals(recipeRead?.method, "GET");
  assertEquals(recipeRead?.authorization, `Bearer ${VALID_TEST_JWT}`);
  assertNoDatabaseWrites(requests);
  assertEquals(
    requests.some((request) => request.path.startsWith("/rest/v1/recipe_lineage")),
    false,
  );
});

Deno.test("Duplicate parent IDs collapse to one resolved parent while keeping model order", async () => {
  const { fetchImpl } = createFetchMock();
  const secondParentId = "33333333-3333-4333-8333-333333333333";
  const twoCandidates: ChefRecipeContextResult = {
    ...MATCHED_CONTEXT,
    matchedCandidateCount: 2,
    totalCandidateCount: 4,
    recipes: [
      MATCHED_CONTEXT.recipes[0],
      {
        ...MATCHED_CONTEXT.recipes[0],
        id: secondParentId,
        title: "Egg Fried Rice",
        star_rating: null,
        matched_ingredients: ["eggs"],
      },
    ],
  };

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning({
      ...MOCK_GENERATED_RECIPE,
      parentRecipeIds: [secondParentId, PARENT_ID, secondParentId],
    }),
    buildContext: contextReturning(twoCandidates),
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.parents, [
    { id: secondParentId, title: "Egg Fried Rice", star_rating: null },
    { id: PARENT_ID, title: "Garlic Fried Rice", star_rating: 5 },
  ]);
});

Deno.test("A provider that skips validation cannot leak an invented parent ID to the client", async () => {
  const { fetchImpl, requests } = createFetchMock();

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning({
      ...MOCK_GENERATED_RECIPE,
      parentRecipeIds: [FOREIGN_PARENT_ID],
    }),
    buildContext: contextReturning(MATCHED_CONTEXT),
  });

  assertEquals(res.status, 502);
  const rawText = await res.text();
  assertEquals(rawText.includes(FOREIGN_PARENT_ID), false);
  assertEquals(JSON.parse(rawText).error?.code, "AI_OUTPUT_INVALID");
  assertNoDatabaseWrites(requests);
});

Deno.test("A parent ID with no retrieved candidates is rejected even though the ID is a valid UUID", async () => {
  const { fetchImpl } = createFetchMock();

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(MOCK_GENERATED_RECIPE),
    buildContext: contextReturning(COLD_START_CONTEXT),
  });

  assertEquals(res.status, 502);
  assertEquals((await res.json()).error?.code, "AI_OUTPUT_INVALID");
});

Deno.test("Malformed provider output is rejected before the frontend sees it", async () => {
  const cases: Array<{ generated: unknown; label: string }> = [
    { generated: { recipe: { title: 123 }, substitutions: [], parentRecipeIds: [] }, label: "bad recipe" },
    { generated: { recipe: MOCK_EXTRACTED_RECIPE, parentRecipeIds: [] }, label: "missing substitutions" },
    {
      generated: {
        recipe: MOCK_EXTRACTED_RECIPE,
        substitutions: [{ original: "soy sauce", replacement: "" }],
        parentRecipeIds: [],
      },
      label: "blank replacement",
    },
    {
      generated: {
        ...COLD_START_GENERATED,
        substitutions: [{ original: "quinoa", replacement: "rice" }],
      },
      label: "orphan substitution",
    },
    { generated: { ...COLD_START_GENERATED, parentRecipeIds: ["not-a-uuid"] }, label: "non-uuid parent" },
  ];

  for (const testCase of cases) {
    const { fetchImpl, requests } = createFetchMock();
    const res = await handler(generateRequest(validBody()), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(testCase.generated as GeneratedRecipe),
      buildContext: contextReturning(COLD_START_CONTEXT),
    });

    assertEquals(res.status, 502, testCase.label);
    assertEquals((await res.json()).error?.code, "AI_OUTPUT_INVALID", testCase.label);
    assertNoDatabaseWrites(requests);
  }
});

Deno.test("AI-09: a real adapter timeout, outage, malformed output or safety block fails safely and never writes", async () => {
  const cases: Array<{
    label: string;
    fail: (recordAttempt: () => void) => Promise<string>;
    status: number;
    code: string;
    attempts: number;
  }> = [
    {
      label: "timeout",
      fail: (recordAttempt) => {
        recordAttempt();
        // The SDK aborts the request when its timeout elapses.
        return Promise.reject(Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        }));
      },
      status: 504,
      code: "AI_TIMEOUT",
      // AI-18: one attempt plus one bounded retry, then a recoverable error.
      attempts: 2,
    },
    {
      label: "provider outage",
      fail: (recordAttempt) => {
        recordAttempt();
        return Promise.reject(Object.assign(new Error("upstream unavailable"), { status: 503 }));
      },
      status: 503,
      code: "AI_UNAVAILABLE",
      attempts: 2,
    },
    {
      label: "malformed output",
      fail: (recordAttempt) => {
        recordAttempt();
        return Promise.resolve("this is not JSON");
      },
      status: 502,
      code: "AI_OUTPUT_INVALID",
      // Invalid output is not retried: the same prompt would burn quota again.
      attempts: 1,
    },
    {
      label: "safety block",
      fail: (recordAttempt) => {
        recordAttempt();
        // The real SDK shape: `response.text()` throws this on a blocked
        // prompt/candidate, and it carries no HTTP status.
        return Promise.reject(
          new GoogleGenerativeAIResponseError("Response was blocked due to SAFETY", {
            promptFeedback: { blockReason: "SAFETY" },
          }),
        );
      },
      status: 502,
      code: "AI_PROVIDER_REJECTED",
      // A permanent block is never retried (pf-08).
      attempts: 1,
    },
  ];

  for (const path of ENDPOINT_PATHS) {
    for (const testCase of cases) {
      const { fetchImpl, requests } = createFetchMock();
      let attempts = 0;
      const provider = new GeminiAdapter({
        generateText: () => testCase.fail(() => {
          attempts += 1;
        }),
        log: () => {},
        sleep: async () => {},
      });

      const res = await handler(
        generateRequest(validBody(), path),
        {
          supabaseUrl: TEST_SUPABASE_URL,
          supabaseAnonKey: TEST_ANON_KEY,
          fetch: fetchImpl,
          provider,
          buildContext: contextReturning(MATCHED_CONTEXT),
        },
      );

      const label = `${path} ${testCase.label}`;
      assertEquals(res.status, testCase.status, label);
      assertEquals((await res.json()).error?.code, testCase.code, label);
      assertEquals(attempts, testCase.attempts, `${label}: bounded retry count`);
      assertNoDatabaseWrites(requests);
      assertNoRecipeOrLineageWrites(requests);
    }
  }
});

Deno.test("AI-09: the generation endpoint classifies a real SDK PROHIBITED_CONTENT block without retrying or writing", async () => {
  for (const path of ENDPOINT_PATHS) {
    const { fetchImpl, requests } = createFetchMock();
    let generateContentCalls = 0;
    let textCalls = 0;
    const fakeClient = {
      getGenerativeModel: () => ({
        generateContent: () => {
          generateContentCalls += 1;
          return Promise.resolve({
            response: {
              // SDK 0.21.0 returns empty text for this newer block reason; the
              // adapter must classify it from the finish reason before reading
              // text(), otherwise it would surface as AI_OUTPUT_INVALID.
              candidates: [{ finishReason: "PROHIBITED_CONTENT", content: { parts: [] } }],
              text: () => {
                textCalls += 1;
                return "";
              },
            },
          });
        },
      }),
    } as unknown as GoogleGenerativeAI;

    const provider = new GeminiAdapter({
      client: fakeClient,
      log: () => {},
      sleep: async () => {},
    });

    const res = await handler(
      generateRequest(validBody(), path),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider,
        buildContext: contextReturning(MATCHED_CONTEXT),
      },
    );

    const label = `${path} PROHIBITED_CONTENT`;
    assertEquals(res.status, 502, label);
    assertEquals((await res.json()).error?.code, "AI_PROVIDER_REJECTED", label);
    assertEquals(generateContentCalls, 1, `${label}: a blocked candidate must not be retried`);
    assertEquals(textCalls, 0, `${label}: the adapter must not read text() for a blocked candidate`);
    assertNoDatabaseWrites(requests);
    assertNoRecipeOrLineageWrites(requests);
  }
});

Deno.test("Provider failures map to safe, recoverable errors without leaking detail", async () => {
  const secretMessage = "internal provider detail rice eggs";

  const cases: Array<{
    code: AIErrorCode;
    status: number;
    expectedCode: string;
    retryAfterSeconds?: number;
    expectedRetryAfter?: string;
  }> = [
    { code: "invalid_output", status: 502, expectedCode: "AI_OUTPUT_INVALID" },
    { code: "provider_rejected", status: 502, expectedCode: "AI_PROVIDER_REJECTED" },
    { code: "provider_timeout", status: 504, expectedCode: "AI_TIMEOUT" },
    { code: "provider_unavailable", status: 503, expectedCode: "AI_UNAVAILABLE" },
    {
      code: "rate_limited",
      status: 429,
      expectedCode: "AI_RATE_LIMITED",
      retryAfterSeconds: 42,
      expectedRetryAfter: "42",
    },
    {
      code: "rate_limited",
      status: 429,
      expectedCode: "AI_RATE_LIMITED",
      retryAfterSeconds: 7_200,
      expectedRetryAfter: "3600",
    },
    { code: "rate_limited", status: 429, expectedCode: "AI_RATE_LIMITED", expectedRetryAfter: "30" },
    { code: "internal_error", status: 500, expectedCode: "INTERNAL_ERROR" },
  ];

  for (const testCase of cases) {
    const { fetchImpl, requests } = createFetchMock();
    const error = new AIError(
      testCase.code,
      "generate",
      secretMessage,
      undefined,
      testCase.retryAfterSeconds,
    );

    const res = await handler(generateRequest(validBody()), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(error),
      buildContext: contextReturning(MATCHED_CONTEXT),
    });

    assertEquals(res.status, testCase.status);
    const rawText = await res.text();
    assertEquals(rawText.includes(secretMessage), false);
    assertEquals(rawText.includes("rice"), false);
    assertEquals(rawText.includes("file://"), false);
    const body = JSON.parse(rawText);
    assertEquals(body.error?.code, testCase.expectedCode);
    assertEquals(body.error?.message.includes(secretMessage), false);

    if (testCase.expectedRetryAfter) {
      assertEquals(res.headers.get("retry-after"), testCase.expectedRetryAfter);
    } else {
      assertEquals(res.headers.get("retry-after"), null);
    }

    assertNoDatabaseWrites(requests);
  }
});

Deno.test("An unexpected provider exception becomes a generic 500 INTERNAL_ERROR with no leaked text", async () => {
  const { fetchImpl, requests } = createFetchMock();

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("boom rice eggs")),
    buildContext: contextReturning(MATCHED_CONTEXT),
  });

  assertEquals(res.status, 500);
  const rawText = await res.text();
  assertEquals(rawText.includes("boom"), false);
  assertEquals(rawText.includes("eggs"), false);
  assertEquals(JSON.parse(rawText), {
    error: { code: "INTERNAL_ERROR", message: "Internal server error." },
  });
  assertNoDatabaseWrites(requests);
});

Deno.test("A failing retrieval step becomes a generic 500 without calling the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
    buildContext: () => Promise.reject(new Error("CANDIDATE_RETRIEVAL_FAILED")),
  });

  assertEquals(res.status, 500);
  assertEquals((await res.json()).error?.code, "INTERNAL_ERROR");
  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("Quota exhaustion returns 429 QUOTA_EXCEEDED with Retry-After and never retrieves or calls the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  let contextCalled = false;

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
    buildContext: contextReturning(COLD_START_CONTEXT, () => {
      contextCalled = true;
    }),
    quotaCheck: () =>
      Promise.resolve({ status: "exceeded", limit: 20, used: 20, retryAfterSeconds: 123 }),
  });

  assertEquals(res.status, 429);
  assertEquals(res.headers.get("retry-after"), "123");
  assertEquals((await res.json()).error?.code, "QUOTA_EXCEEDED");
  assertEquals(providerCalled, false);
  assertEquals(contextCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("A failing quota check returns a safe 503 QUOTA_UNAVAILABLE and never retrieves or calls the provider", async () => {
  const { fetchImpl, requests } = createFetchMock({ usageError: true });
  let providerCalled = false;

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
    buildContext: contextReturning(COLD_START_CONTEXT),
  });

  assertEquals(res.status, 503);
  assertEquals((await res.json()).error?.code, "QUOTA_UNAVAILABLE");
  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("The endpoint passes the authenticated user id to the injected quota gate", async () => {
  const { fetchImpl } = createFetchMock();
  const seenUserIds: string[] = [];

  const res = await handler(generateRequest(validBody()), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(COLD_START_GENERATED),
    buildContext: contextReturning(COLD_START_CONTEXT),
    quotaCheck: (userId) => {
      seenUserIds.push(userId);
      return Promise.resolve({ status: "allowed", limit: 20, used: 0 });
    },
  });

  assertEquals(res.status, 200);
  assertEquals(seenUserIds, [VERIFIED_USER_ID]);
});

Deno.test("The default quota gate reads the daily counter and blocks at the configured limit", async () => {
  for (const [usageCount, expectedStatus] of [[0, 200], [19, 200], [20, 429], [25, 429]] as const) {
    const { fetchImpl, requests } = createFetchMock({ usageCount });
    const res = await handler(generateRequest(validBody()), {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(COLD_START_GENERATED),
      buildContext: contextReturning(COLD_START_CONTEXT),
    });

    assertEquals(res.status, expectedStatus);
    if (expectedStatus === 429) {
      assertEquals((await res.json()).error?.code, "QUOTA_EXCEEDED");
      assertEquals(typeof res.headers.get("retry-after"), "string");
    }

    const restCalls = requests.filter((request) => request.path.startsWith("/rest/"));
    assertEquals(restCalls.length, 1);
    assertEquals(restCalls[0].method, "GET");
    assertNoDatabaseWrites(requests);
  }
});

Deno.test("Simulation drills need an allowed environment plus both switches, and exercise the real error contract", async () => {
  const { fetchImpl } = createFetchMock();
  const passthrough = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    buildContext: contextReturning(COLD_START_CONTEXT),
  };

  // GEMINI_API_KEY is tracked so that "no drill fired" is deterministic: without
  // a key the real adapter throws, so the handler answers 500 rather than making
  // a live call.
  const trackedEnvs = [
    AI_ENVIRONMENT_ENV,
    ALLOW_FAILURE_DRILLS_ENV,
    SIMULATE_OUTAGE_ENV,
    SIMULATE_BAD_OUTPUT_ENV,
    "GEMINI_API_KEY",
  ];
  const previousEnv = new Map(trackedEnvs.map((name) => [name, Deno.env.get(name)]));

  try {
    for (const name of trackedEnvs) Deno.env.delete(name);
    Deno.env.set(AI_ENVIRONMENT_ENV, "test");

    // Baseline: no drill set, the injected provider is used.
    const baseline = await handler(generateRequest(validBody()), {
      ...passthrough,
      provider: providerReturning(COLD_START_GENERATED),
    });
    assertEquals(baseline.status, 200);

    const drills: Array<{ env: string; status: number; code: string }> = [
      { env: SIMULATE_OUTAGE_ENV, status: 503, code: "AI_UNAVAILABLE" },
      { env: SIMULATE_BAD_OUTPUT_ENV, status: 502, code: "AI_OUTPUT_INVALID" },
    ];

    for (const drill of drills) {
      // Drill switch alone must not fire: no master switch means the real
      // adapter is used (which here fails as a plain 500, never the drill code).
      Deno.env.set(drill.env, "1");
      const withoutMaster = await handler(generateRequest(validBody()), passthrough);
      assertEquals(withoutMaster.status, 500);
      assertEquals((await withoutMaster.json()).error?.code, "INTERNAL_ERROR");

      Deno.env.set(ALLOW_FAILURE_DRILLS_ENV, "1");
      // Production/default/unknown environments ignore every switch, even together.
      Deno.env.set(SIMULATE_OUTAGE_ENV, "1");
      Deno.env.set(SIMULATE_BAD_OUTPUT_ENV, "1");
      for (const environment of [undefined, "", "production", " PRODUCTION ", "staging", "typo"]) {
        if (environment === undefined) Deno.env.delete(AI_ENVIRONMENT_ENV);
        else Deno.env.set(AI_ENVIRONMENT_ENV, environment);
        const guarded = await handler(generateRequest(validBody()), passthrough);
        assertEquals(guarded.status, 500);
        assertEquals((await guarded.json()).error?.code, "INTERNAL_ERROR");
      }
      Deno.env.delete(SIMULATE_OUTAGE_ENV);
      Deno.env.delete(SIMULATE_BAD_OUTPUT_ENV);
      Deno.env.set(drill.env, "1");

      // Only an allowed environment plus both switches activates a drill.
      for (const environment of ["development", "test", " TEST "]) {
        Deno.env.set(AI_ENVIRONMENT_ENV, environment);
        const withMaster = await handler(generateRequest(validBody()), passthrough);
        assertEquals(withMaster.status, drill.status);
        assertEquals((await withMaster.json()).error?.code, drill.code);
      }

      Deno.env.delete(ALLOW_FAILURE_DRILLS_ENV);
      Deno.env.delete(drill.env);
    }

    // Outage takes precedence when both drill switches are set.
    Deno.env.set(ALLOW_FAILURE_DRILLS_ENV, "1");
    Deno.env.set(SIMULATE_OUTAGE_ENV, "1");
    Deno.env.set(SIMULATE_BAD_OUTPUT_ENV, "1");
    const precedence = await handler(generateRequest(validBody()), passthrough);
    assertEquals(precedence.status, 503);
    assertEquals((await precedence.json()).error?.code, "AI_UNAVAILABLE");

    // A falsy drill value stays off even with the master switch on.
    Deno.env.delete(SIMULATE_OUTAGE_ENV);
    Deno.env.set(SIMULATE_BAD_OUTPUT_ENV, "0");
    const offDrill = await handler(generateRequest(validBody()), passthrough);
    assertEquals(offDrill.status, 500);
    assertEquals((await offDrill.json()).error?.code, "INTERNAL_ERROR");
  } finally {
    for (const [name, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
