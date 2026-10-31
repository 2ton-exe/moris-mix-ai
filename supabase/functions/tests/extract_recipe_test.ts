import { assertEquals } from "jsr:@std/assert@1";
import {
  EXTRACT_DISABLED_ENV,
  EXTRACT_ENABLED_ENV,
  handler as extractRecipeHandler,
  MAX_REQUEST_BYTES,
} from "../extract-recipe/index.ts";
import {
  AI_ENVIRONMENT_ENV,
  ALLOW_FAILURE_DRILLS_ENV,
  SIMULATE_BAD_OUTPUT_ENV,
  SIMULATE_OUTAGE_ENV,
} from "../_shared/ai/drills.ts";
import {
  ExtractRecipeRequestSchema,
  ExtractRecipeResponseSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/schemas.ts";
import { MOCK_EXTRACTED_RECIPE } from "../_shared/ai/mocks.ts";
import { AIError, type AIErrorCode } from "../_shared/ai/GeminiAdapter.ts";
import type { AIProvider, ExtractRecipeInput, ExtractedRecipe } from "../_shared/ai/AIProvider.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";
import {
  DEFAULT_AI_DAILY_LIMIT,
  checkDailyQuota,
  consumeDailyQuota,
  reconcileUnconfirmedReservation,
  resolveDailyLimit,
  secondsUntilNextUtcDay,
  utcDateString,
  type QuotaCheckDeps,
} from "../_shared/ai/quota.ts";

const VALID_TEST_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6InZlcmlmaWVkQG1vcmlzc2NyYXBzLmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_segment_ok";
const FORGED_TEST_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoic2VydmljZV9yb2xlIn0.forged_unverified_sig";
const EXPIRED_TEST_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJleHAiOjF9.expired_signature_seg";
const TEST_SUPABASE_URL = "https://mock.supabase.co";
const TEST_ANON_KEY = "mock-anon-public-key-value";
const TEST_SERVICE_ROLE_KEY = "mock-service-role-key-value";
const VERIFIED_USER_ID = "99999999-9999-9999-9999-999999999999";
const VERIFIED_USER_EMAIL = "verified@morisscraps.local";
const NOTES = "Boiled chicken with garlic and a splash of soy sauce.";
const ENDPOINT_PATHS = ["/functions/v1/extract-recipe", "/extract-recipe"];

/** Existing endpoint contracts are exercised with the operator opt-in explicitly set. */
async function handler(...args: Parameters<typeof extractRecipeHandler>): Promise<Response> {
  const mergedDeps: Parameters<typeof extractRecipeHandler>[1] = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseServiceRoleKey: TEST_SERVICE_ROLE_KEY,
    ...args[1],
  };
  const previous = Deno.env.get(EXTRACT_ENABLED_ENV);
  try {
    Deno.env.set(EXTRACT_ENABLED_ENV, "true");
    return await extractRecipeHandler(args[0], mergedDeps);
  } finally {
    if (previous === undefined) Deno.env.delete(EXTRACT_ENABLED_ENV);
    else Deno.env.set(EXTRACT_ENABLED_ENV, previous);
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
 * Auth + quota fetch mock. It answers only the two endpoints this function is
 * allowed to touch, and records every call so tests can prove no write happens.
 */
function createFetchMock(
  options: {
    auth?: "ok" | "unauthorized" | "rate_limited";
    authRetryAfter?: string;
    usageCount?: number;
    usageError?: boolean;
    usageRow?: unknown;
    quotaConsumeStatus?: "allowed" | "exceeded" | "conflict";
    conflictReservations?: Set<string>;
    confirmError?: boolean;
    reconcileError?: boolean;
    unconfirmedReconcileError?: boolean;
    onConsume?: (body: unknown) => void;
    onConfirm?: (body: unknown) => void;
    onReconcile?: (body: unknown) => void;
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
        const h = jsonHeaders();
        if (options.authRetryAfter) {
          h["Retry-After"] = options.authRetryAfter;
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 429,
              error_code: "over_request_rate_limit",
              msg: "Too many requests. Please try again later.",
            }),
            { status: 429, headers: h },
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
        new Response(
          JSON.stringify(payload),
          { status: 200, headers: jsonHeaders() },
        ),
      );
    }

    if (url.pathname === "/rest/v1/rpc/consume_ai_quota") {
      if (options.usageError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "PGRST500", message: "database is down" }),
            { status: 500, headers: jsonHeaders() },
          ),
        );
      }
      let reqBody: Record<string, unknown> = {};
      try {
        if (typeof init?.body === "string") {
          reqBody = JSON.parse(init.body);
        }
      } catch {
      }

      const reservationId = typeof reqBody.p_reservation_id === "string" ? reqBody.p_reservation_id : "";
      if (options.conflictReservations?.has(reservationId)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "conflict",
              is_new: false,
              message: "Reservation ID already consumed",
            }),
            { status: 200, headers: jsonHeaders() },
          ),
        );
      }

      options.onConsume?.(reqBody);

      if (options.quotaConsumeStatus === "conflict") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "conflict",
              is_new: false,
              message: "Reservation ID already consumed",
            }),
            { status: 200, headers: jsonHeaders() },
          ),
        );
      }

      const limit = typeof reqBody.p_daily_limit === "number" ? reqBody.p_daily_limit : 20;
      const current = options.usageCount ?? 0;

      if (options.quotaConsumeStatus === "exceeded" || current >= limit) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "exceeded",
              is_new: false,
              limit,
              used: current,
            }),
            { status: 200, headers: jsonHeaders() },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "allowed",
            is_new: true,
            limit,
            used: current + 1,
          }),
          { status: 200, headers: jsonHeaders() },
        ),
      );
    }

    if (url.pathname === "/rest/v1/rpc/confirm_ai_quota") {
      let reqBody: Record<string, unknown> = {};
      try {
        if (typeof init?.body === "string") {
          reqBody = JSON.parse(init.body);
        }
      } catch {
      }
      options.onConfirm?.(reqBody);

      if (options.confirmError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "PGRST500", message: "confirm failed" }),
            { status: 500, headers: jsonHeaders() },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ confirmed: true, status: "confirmed" }),
          { status: 200, headers: jsonHeaders() },
        ),
      );
    }

    if (url.pathname === "/rest/v1/rpc/reconcile_ai_quota") {
      let reqBody: Record<string, unknown> = {};
      try {
        if (typeof init?.body === "string") {
          reqBody = JSON.parse(init.body);
        }
      } catch {
      }
      options.onReconcile?.(reqBody);

      if (options.reconcileError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "PGRST500", message: "reconcile failed" }),
            { status: 500, headers: jsonHeaders() },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            reconciled: true,
            status: "refunded",
            used: Math.max(0, (options.usageCount ?? 1) - 1),
          }),
          { status: 200, headers: jsonHeaders() },
        ),
      );
    }

    if (url.pathname === "/rest/v1/rpc/reconcile_unconfirmed_reservation") {
      if (options.unconfirmedReconcileError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "PGRST500", message: "admin reconcile failed" }),
            { status: 500, headers: jsonHeaders() },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            reconciled: true,
            status: "refunded",
            used: 0,
          }),
          { status: 200, headers: jsonHeaders() },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  return { fetchImpl, requests };
}
function providerReturning(
  recipe: ExtractedRecipe,
  onInput?: (input: ExtractRecipeInput) => void,
): AIProvider {
  return {
    extractRecipe: (input) => {
      onInput?.(input);
      return Promise.resolve(recipe);
    },
    generateRecipe: () => Promise.reject(new Error("generateRecipe is not used here")),
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };
}

function providerThrowing(error: unknown, onCall?: () => void): AIProvider {
  return {
    extractRecipe: () => {
      onCall?.();
      return Promise.reject(error);
    },
    generateRecipe: () => Promise.reject(new Error("generateRecipe is not used here")),
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };
}

/** Builds a JSON request with configurable routing and method, omitting auth when the token is null. */
function extractRequest(
  body: string,
  path = ENDPOINT_PATHS[0],
  method = "POST",
  token: string | null = VALID_TEST_JWT,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, { method, headers, body });
}

/**
 * Builds a well-formed request body of an exact byte length. The padding lives
 * in an ignored `junk` field so the `notes` contract stays valid; `a` is one
 * byte, making the arithmetic exact.
 */
function bodyOfExactByteLength(targetBytes: number): string {
  const prefix = '{"notes":"x","junk":"';
  const suffix = '"}';
  const overhead = prefix.length + suffix.length;
  return prefix + "a".repeat(Math.max(0, targetBytes - overhead)) + suffix;
}

function assertNoDatabaseWrites(requests: RecordedRequest[]): void {
  const writes = requests.filter(
    (request) =>
      request.path.startsWith("/rest/") &&
      !request.path.startsWith("/rest/v1/rpc/") &&
      request.method !== "GET",
  );
  assertEquals(writes, []);
}

Deno.test("ExtractRecipe schemas validate the request/response contract and normalise notes", () => {
  assertEquals(MAX_EXTRACTION_INPUT_CHARS, 10_000);
  assertEquals(DEFAULT_AI_DAILY_LIMIT, 20);

  const trimmed = ExtractRecipeRequestSchema.safeParse({ notes: "  Boiled chicken  " });
  assertEquals(trimmed.success, true);
  if (trimmed.success) {
    assertEquals(trimmed.data.notes, "Boiled chicken");
  }

  for (const invalid of [{}, { notes: "" }, { notes: "   " }, { notes: 123 }, { notes: null }, {
    notes: ["x"],
  }]) {
    assertEquals(ExtractRecipeRequestSchema.safeParse(invalid).success, false);
  }

  assertEquals(ExtractRecipeResponseSchema.safeParse({ recipe: MOCK_EXTRACTED_RECIPE }).success, true);
  assertEquals(ExtractRecipeResponseSchema.safeParse({ recipe: { title: 123 } }).success, false);
  assertEquals(ExtractRecipeResponseSchema.safeParse({}).success, false);
});

Deno.test("CORS OPTIONS preflight on /extract-recipe returns 204 without authentication and scopes ALLOWED_ORIGIN", async () => {
  const preflight = await handler(
    new Request("http://localhost/functions/v1/extract-recipe", { method: "OPTIONS" }),
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
      new Request("http://localhost/extract-recipe", { method: "OPTIONS" }),
    );
    assertEquals(scoped.status, 204);
    assertEquals(
      scoped.headers.get("access-control-allow-origin"),
      "https://frontend.morisscraps.com",
    );
    assertEquals(scoped.headers.get("access-control-allow-methods"), "POST, OPTIONS");
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
      new Request("http://localhost/functions/v1/extract-recipe", {
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
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    const body = await res.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
    assertEquals(typeof body.error?.message, "string");
  }

  assertEquals(providerCalled, false);
  assertEquals(requests, []);
});

Deno.test("Unknown paths return 404 NOT_FOUND without authenticating", async () => {
  const { fetchImpl, requests } = createFetchMock();

  for (const path of [
    "/functions/v1/extract-recipe/extra",
    "/extract-recipe/extra",
    "/functions/v1/other",
    "/",
  ]) {
    const res = await handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VALID_TEST_JWT}`, "Content-Type": "application/json" },
        body: JSON.stringify({ notes: NOTES }),
      }),
      { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: fetchImpl },
    );

    assertEquals(res.status, 404);
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    const body = await res.json();
    assertEquals(body.error?.code, "NOT_FOUND");
  }

  assertEquals(requests, []);
});

Deno.test("Unauthenticated requests return 401 UNAUTHORIZED before quota or provider", async () => {
  const { fetchImpl, requests } = createFetchMock({ auth: "unauthorized" });
  let providerCalled = false;

  const unauthorized: Array<Request> = [
    new Request("http://localhost/functions/v1/extract-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: NOTES }),
    }),
    extractRequest(JSON.stringify({ notes: NOTES }), ENDPOINT_PATHS[0], "POST", "not-a-compact-jwt"),
    extractRequest(JSON.stringify({ notes: NOTES }), ENDPOINT_PATHS[0], "POST", FORGED_TEST_JWT),
    extractRequest(JSON.stringify({ notes: NOTES }), ENDPOINT_PATHS[0], "POST", EXPIRED_TEST_JWT),
  ];

  for (const req of unauthorized) {
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
    });

    assertEquals(res.status, 401);
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assertEquals(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assertEquals(body.error?.code, "UNAUTHORIZED");
  }

  assertEquals(providerCalled, false);
  assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
});

Deno.test("An auth-service 429 becomes 503 AUTH_SERVICE_RATE_LIMITED with Retry-After, before quota or provider", async () => {
  const { fetchImpl, requests } = createFetchMock({ auth: "rate_limited", authRetryAfter: "17" });
  let providerCalled = false;

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
    },
  );

  assertEquals(res.status, 503);
  assertEquals(res.headers.get("retry-after"), "17");
  assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assertEquals(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assertEquals(body.error?.code, "AUTH_SERVICE_RATE_LIMITED");

  assertEquals(providerCalled, false);
  assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
});

Deno.test("Extraction defaults off and requires a valid operator opt-in before reading the body or quota", async () => {
  const names = [EXTRACT_ENABLED_ENV, EXTRACT_DISABLED_ENV];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  try {
    Deno.env.delete(EXTRACT_DISABLED_ENV);
    for (const value of [undefined, "", "false", "0", "off", "typo"]) {
      if (value === undefined) Deno.env.delete(EXTRACT_ENABLED_ENV);
      else Deno.env.set(EXTRACT_ENABLED_ENV, value);
      const { fetchImpl, requests } = createFetchMock();
      let providerCalls = 0;
      let quotaCalls = 0;
      let bodyReads = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          bodyReads++;
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ notes: NOTES })));
          controller.close();
        },
      }, { highWaterMark: 0 });
      const res = await extractRecipeHandler(new Request(`http://localhost${ENDPOINT_PATHS[0]}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
        body,
      }), {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        supabaseServiceRoleKey: TEST_SERVICE_ROLE_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE, () => providerCalls++),
        quotaCheck: () => {
          quotaCalls++;
          return Promise.resolve({ status: "allowed", limit: 20, used: 0 });
        },
      });
      assertEquals(res.status, 503);
      assertEquals((await res.json()).error?.code, "AI_DISABLED");
      assertEquals(res.headers.get("cache-control"), "no-store");
      assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
      assertEquals(bodyReads, 0);
      assertEquals(quotaCalls, 0);
      assertEquals(providerCalls, 0);
      assertEquals(requests.map((request) => request.path), ["/auth/v1/user"]);
      await body.cancel();
    }
    for (const value of ["1", "true", "yes", "on", " TRUE "]) {
      Deno.env.set(EXTRACT_ENABLED_ENV, value);
      const { fetchImpl, requests } = createFetchMock();
      const res = await extractRecipeHandler(extractRequest(JSON.stringify({ notes: NOTES })), {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        supabaseServiceRoleKey: TEST_SERVICE_ROLE_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
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

Deno.test("The operator kill switch overrides the extraction opt-in before the quota read or provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  const previous = Deno.env.get(EXTRACT_DISABLED_ENV);

  try {
    Deno.env.set(EXTRACT_DISABLED_ENV, "1");
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run"), () => {
          providerCalled = true;
        }),
        quotaCheck: checkDailyQuota,
      },
    );

    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error?.code, "AI_DISABLED");
    assertEquals(providerCalled, false);
    // Authentication completed, but no usage read or writes followed.
    assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
  } finally {
    if (previous === undefined) Deno.env.delete(EXTRACT_DISABLED_ENV);
    else Deno.env.set(EXTRACT_DISABLED_ENV, previous);
  }

  // A falsy kill switch permits extraction when the operator opt-in is enabled.
  Deno.env.set(EXTRACT_DISABLED_ENV, "0");
  try {
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
        quotaCheck: checkDailyQuota,
      },
    );
    assertEquals(res.status, 200);
  } finally {
    if (previous === undefined) Deno.env.delete(EXTRACT_DISABLED_ENV);
    else Deno.env.set(EXTRACT_DISABLED_ENV, previous);
  }
});

Deno.test("Malformed JSON bodies return 400 INVALID_JSON without calling the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;

  for (const rawBody of [
    "",
    "   ",
    "{not-valid-json",
    '{"notes": "Unclosed',
    "null",
    "true",
    "123",
    '"just a string"',
    "[]",
    '[{"notes": "array not object"}]',
  ]) {
    const res = await handler(
      extractRequest(rawBody, ENDPOINT_PATHS[0], "POST"),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run"), () => {
          providerCalled = true;
        }),
      },
    );

    assertEquals(res.status, 400);
    assertEquals(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assertEquals(body.error?.code, "INVALID_JSON");
    assertEquals(typeof body.error?.message, "string");
  }

  assertEquals(providerCalled, false);
  assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
});

Deno.test("Invalid payloads fail Zod validation with 400 VALIDATION_ERROR and never call the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;

  const invalidCases: unknown[] = [
    {},
    { notes: 123 },
    { notes: null },
    { notes: "" },
    { notes: "   " },
    { notes: ["x"] },
    { notes: { text: "x" } },
  ];

  for (const payload of invalidCases) {
    const res = await handler(
      extractRequest(JSON.stringify(payload)),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run"), () => {
          providerCalled = true;
        }),
      },
    );

    assertEquals(res.status, 400);
    const rawText = await res.text();
    assertEquals(rawText.includes(VALID_TEST_JWT), false);
    assertEquals(rawText.includes(TEST_ANON_KEY), false);
    const body = JSON.parse(rawText);
    assertEquals(body.error?.code, "VALIDATION_ERROR");
    assertEquals(Array.isArray(body.error?.details), true);
    const hasNotesIssue = body.error.details.some(
      (issue: { path?: string }) => issue.path === "notes",
    );
    assertEquals(hasNotesIssue, true);
  }

  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("Oversized notes and oversized bodies return 413 INPUT_TOO_LARGE before the provider call", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;
  const deps = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run"), () => {
      providerCalled = true;
    }),
  };

  const tooLong = await handler(
    extractRequest(JSON.stringify({ notes: "a".repeat(MAX_EXTRACTION_INPUT_CHARS + 1) })),
    deps,
  );
  assertEquals(tooLong.status, 413);
  assertEquals((await tooLong.json()).error?.code, "INPUT_TOO_LARGE");

  // A well-formed body under the notes cap but larger than the request budget.
  const hugeBody = JSON.stringify({
    notes: NOTES,
    junk: "x".repeat(MAX_REQUEST_BYTES + 1),
  });
  const tooBig = await handler(extractRequest(hugeBody), deps);
  assertEquals(tooBig.status, 413);
  assertEquals((await tooBig.json()).error?.code, "INPUT_TOO_LARGE");

  // Exactly at the cap is still allowed.
  const atCap = await handler(
    extractRequest(JSON.stringify({ notes: "a".repeat(MAX_EXTRACTION_INPUT_CHARS) })),
    {
      ...deps,
      provider: providerReturning(MOCK_EXTRACTED_RECIPE),
    },
  );
  assertEquals(atCap.status, 200);

  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("The byte budget is enforced on the stream, not on string length, and cancels an over-limit body", async () => {
  const { fetchImpl, requests } = createFetchMock();

  // Exactly at the byte cap: allowed. +1 byte: rejected. Both bodies contain no
  // multibyte text, so this isolates the boundary arithmetic.
  const atCap = await handler(extractRequest(bodyOfExactByteLength(MAX_REQUEST_BYTES)), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerReturning(MOCK_EXTRACTED_RECIPE),
  });
  assertEquals(atCap.status, 200);

  const overCap = await handler(extractRequest(bodyOfExactByteLength(MAX_REQUEST_BYTES + 1)), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run")),
  });
  assertEquals(overCap.status, 413);
  assertEquals((await overCap.json()).error?.code, "INPUT_TOO_LARGE");

  // A multibyte body whose *character* count is under the byte cap but whose
  // byte length is far over it must still be rejected. 40,000 emoji = 160,000
  // bytes (4 each) but only 80,000 UTF-16 code units, and it lives in the
  // ignored `junk` field so the notes contract itself stays valid.
  const encoder = new TextEncoder();
  const multibyte = JSON.stringify({ notes: NOTES, junk: "\u{1F600}".repeat(40_000) });
  assertEquals(multibyte.length < MAX_REQUEST_BYTES, true);
  assertEquals(encoder.encode(multibyte).byteLength > MAX_REQUEST_BYTES, true);
  const multibyteOver = await handler(extractRequest(multibyte), {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
    provider: providerThrowing(new Error("must not run")),
  });
  assertEquals(multibyteOver.status, 413);
  assertEquals((await multibyteOver.json()).error?.code, "INPUT_TOO_LARGE");

  // ...but a multibyte body under the byte cap is decoded (not truncated) and succeeds.
  const multibyteOkNotes = "\u00e9".repeat(1_000);
  const multibyteOk = await handler(
    extractRequest(JSON.stringify({ notes: multibyteOkNotes })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(MOCK_EXTRACTED_RECIPE),
    },
  );
  assertEquals(multibyteOk.status, 200);

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
      provider: providerReturning(MOCK_EXTRACTED_RECIPE, () => providerCalls++),
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

Deno.test("Successful extraction returns the validated preview, uses the verified user context, and never persists", async () => {
  for (const path of ENDPOINT_PATHS) {
    const { fetchImpl, requests } = createFetchMock({ usageCount: 0 });
    const inputs: ExtractRecipeInput[] = [];

    const res = await handler(
      extractRequest(
        JSON.stringify({ notes: `  ${NOTES}  ` }),
        path,
        "POST",
      ),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE, (input) => inputs.push(input)),
      },
    );

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");

    const body = await res.json();
    assertEquals(ExtractRecipeResponseSchema.safeParse(body).success, true);
    assertEquals(body.recipe.title, MOCK_EXTRACTED_RECIPE.title);
    assertEquals(body.recipe.ingredients.length, MOCK_EXTRACTED_RECIPE.ingredients.length);
    assertEquals((body.recipe as Record<string, unknown>).user_id, undefined);
    assertEquals((body.recipe as Record<string, unknown>).id, undefined);

    assertEquals(inputs.length, 1);
    assertEquals(inputs[0].rawText, NOTES);

    const quotaOp = requests.find((request) => request.path === "/rest/v1/rpc/consume_ai_quota");
    assertEquals(quotaOp?.method, "POST");
    assertEquals(quotaOp?.authorization, `Bearer ${TEST_SERVICE_ROLE_KEY}`);
    assertEquals(quotaOp?.apikey, TEST_SERVICE_ROLE_KEY);

    assertNoDatabaseWrites(requests);
    assertEquals(
      requests.some((request) =>
        request.path.startsWith("/rest/v1/recipes") ||
        request.path.startsWith("/rest/v1/recipe_lineage")
      ),
      false,
    );
  }
});

Deno.test("The endpoint passes the authenticated user id to the injected quota gate", async () => {
  const { fetchImpl } = createFetchMock();
  const seenUserIds: string[] = [];

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning(MOCK_EXTRACTED_RECIPE),
      quotaCheck: (userId) => {
        seenUserIds.push(userId);
        return Promise.resolve({ status: "allowed", limit: 20, used: 0 });
      },
    },
  );

  assertEquals(res.status, 200);
  assertEquals(seenUserIds, [VERIFIED_USER_ID]);
});

Deno.test("Quota exhaustion returns 429 QUOTA_EXCEEDED with Retry-After and never calls the provider", async () => {
  const { fetchImpl, requests } = createFetchMock();
  let providerCalled = false;

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
      quotaCheck: () =>
        Promise.resolve({ status: "exceeded", limit: 20, used: 20, retryAfterSeconds: 123 }),
    },
  );

  assertEquals(res.status, 429);
  assertEquals(res.headers.get("retry-after"), "123");
  assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  const body = await res.json();
  assertEquals(body.error?.code, "QUOTA_EXCEEDED");
  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("QUOTA_EXCEEDED keeps the full wait until the UTC reset instead of capping it at one hour", async () => {
  const cases: Array<{ retryAfterSeconds: number; expected: string }> = [
    // 08:00 UTC is 16 hours from the reset; the old provider cap returned "3600".
    { retryAfterSeconds: 57_600, expected: "57600" },
    { retryAfterSeconds: 1, expected: "1" },
    { retryAfterSeconds: 60, expected: "60" },
    { retryAfterSeconds: 24 * 60 * 60, expected: "86400" },
    // Anything beyond a day is clamped to a day.
    { retryAfterSeconds: 90_000, expected: "86400" },
  ];

  for (const testCase of cases) {
    const { fetchImpl } = createFetchMock();
    let providerCalled = false;

    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run"), () => {
          providerCalled = true;
        }),
        quotaCheck: () =>
          Promise.resolve({
            status: "exceeded",
            limit: 20,
            used: 20,
            retryAfterSeconds: testCase.retryAfterSeconds,
          }),
      },
    );

    assertEquals(res.status, 429);
    assertEquals(res.headers.get("retry-after"), testCase.expected);
    assertEquals(providerCalled, false);
  }
});

Deno.test("Invalid quota retry delays fall back to the real time until the next UTC reset", async () => {
  for (const invalid of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { fetchImpl } = createFetchMock();
    const before = secondsUntilNextUtcDay();

    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run")),
        quotaCheck: () =>
          Promise.resolve({
            status: "exceeded",
            limit: 20,
            used: 20,
            retryAfterSeconds: invalid,
          }),
      },
    );

    const after = secondsUntilNextUtcDay();
    const retryAfter = Number(res.headers.get("retry-after"));
    assertEquals(res.status, 429);
    // Never the 30-second provider fallback; always a bounded day-scale wait.
    assertEquals(Number.isSafeInteger(retryAfter), true);
    assertEquals(retryAfter >= Math.min(before, after), true);
    assertEquals(retryAfter <= Math.max(before, after), true);
  }
});

Deno.test("The default quota gate reads the daily counter and blocks at the configured limit", async () => {
  for (const [usageCount, expectedStatus] of [[0, 200], [19, 200], [20, 429], [25, 429]] as const) {
    const { fetchImpl, requests } = createFetchMock({ usageCount });
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
        quotaCheck: checkDailyQuota,
      },
    );

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

Deno.test("A missing usage row allows zero usage, but a malformed counter fails closed", async () => {
  for (const usageRow of [[], null]) {
    const { fetchImpl } = createFetchMock({ usageRow });
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
        quotaCheck: checkDailyQuota,
      },
    );
    assertEquals(res.status, 200);
  }

  const malformedRows: unknown[] = [
    [{ operation_count: "20" }],
    [{ operation_count: -1 }],
    [{ operation_count: 1.5 }],
    [{ operation_count: null }],
    [{}],
    [null],
    { operation_count: "20" },
  ];

  for (const usageRow of malformedRows) {
    const { fetchImpl, requests } = createFetchMock({ usageRow });
    let providerCalled = false;

    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(new Error("must not run"), () => {
          providerCalled = true;
        }),
        quotaCheck: checkDailyQuota,
      },
    );

    assertEquals(res.status, 503);
    assertEquals((await res.json()).error?.code, "QUOTA_UNAVAILABLE");
    assertEquals(providerCalled, false);
    assertNoDatabaseWrites(requests);
  }
});

Deno.test("AI_DAILY_LIMIT overrides the default and invalid values fall back safely", async () => {
  assertEquals(resolveDailyLimit(undefined), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit(""), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit("abc"), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit("0"), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit("-1"), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit("1.5"), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit("1000000000000000000000"), DEFAULT_AI_DAILY_LIMIT);
  assertEquals(resolveDailyLimit("5"), 5);
  assertEquals(resolveDailyLimit(" 7 "), 7);

  const previous = Deno.env.get("AI_DAILY_LIMIT");
  try {
    Deno.env.set("AI_DAILY_LIMIT", "1");
    const { fetchImpl } = createFetchMock({ usageCount: 1 });
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
        quotaCheck: checkDailyQuota,
      },
    );
    assertEquals(res.status, 429);
  } finally {
    if (previous === undefined) Deno.env.delete("AI_DAILY_LIMIT");
    else Deno.env.set("AI_DAILY_LIMIT", previous);
  }
});

Deno.test("utcDateString and secondsUntilNextUtcDay are UTC-based and bounded", () => {
  assertEquals(utcDateString(new Date("2026-10-29T23:59:59.000Z")), "2026-10-29");
  assertEquals(utcDateString(new Date("2026-10-30T00:00:00.000Z")), "2026-10-30");

  const justBeforeMidnight = secondsUntilNextUtcDay(new Date("2026-10-29T23:59:59.000Z"));
  assertEquals(justBeforeMidnight, 1);
  const midday = secondsUntilNextUtcDay(new Date("2026-10-29T12:00:00.000Z"));
  assertEquals(midday, 12 * 60 * 60);
  const earlyMorning = secondsUntilNextUtcDay(new Date("2026-10-29T08:00:00.000Z"));
  assertEquals(earlyMorning, 16 * 60 * 60);
});

Deno.test("A failing quota check returns a safe 503 QUOTA_UNAVAILABLE and never calls the provider", async () => {
  const { fetchImpl, requests } = createFetchMock({ usageError: true });
  let providerCalled = false;

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
    },
  );

  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error?.code, "QUOTA_UNAVAILABLE");
  assertEquals(providerCalled, false);
  assertNoDatabaseWrites(requests);
});

Deno.test("Provider failures map to safe, recoverable errors without leaking detail", async () => {
  const secretMessage = `internal provider detail ${NOTES}`;

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
    // Provider cooldowns stay capped at one hour, unlike daily-quota waits.
    {
      code: "rate_limited",
      status: 429,
      expectedCode: "AI_RATE_LIMITED",
      retryAfterSeconds: 7_200,
      expectedRetryAfter: "3600",
    },
    { code: "rate_limited", status: 429, expectedCode: "AI_RATE_LIMITED", expectedRetryAfter: "30" },
    {
      code: "rate_limited",
      status: 429,
      expectedCode: "AI_RATE_LIMITED",
      retryAfterSeconds: 0,
      expectedRetryAfter: "30",
    },
    { code: "internal_error", status: 500, expectedCode: "INTERNAL_ERROR" },
  ];

  for (const testCase of cases) {
    const { fetchImpl, requests } = createFetchMock();
    const error = new AIError(
      testCase.code,
      "extract",
      secretMessage,
      undefined,
      testCase.retryAfterSeconds,
    );

    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerThrowing(error),
      },
    );

    assertEquals(res.status, testCase.status);
    const rawText = await res.text();
    assertEquals(rawText.includes(secretMessage), false);
    assertEquals(rawText.includes(NOTES), false);
    assertEquals(rawText.includes("file://"), false);
    const body = JSON.parse(rawText);
    assertEquals(body.error?.code, testCase.expectedCode);
    assertEquals(typeof body.error?.message, "string");
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

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerThrowing(new Error(`boom ${NOTES}`)),
    },
  );

  assertEquals(res.status, 500);
  const rawText = await res.text();
  assertEquals(rawText.includes(NOTES), false);
  assertEquals(rawText.includes("boom"), false);
  assertEquals(JSON.parse(rawText), {
    error: { code: "INTERNAL_ERROR", message: "Internal server error." },
  });
  assertNoDatabaseWrites(requests);
});

Deno.test("Malformed output from a provider that forgot to validate is rejected before the frontend sees it", async () => {
  const { fetchImpl } = createFetchMock();

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: providerReturning({
        title: 123,
        ingredients: "not an array",
      } as unknown as ExtractedRecipe),
    },
  );

  assertEquals(res.status, 502);
  assertEquals((await res.json()).error?.code, "AI_OUTPUT_INVALID");
});

Deno.test("Simulation drills need an allowed environment plus both switches, and exercise the real error contract", async () => {
  const { fetchImpl } = createFetchMock();
  const passthrough = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    supabaseServiceRoleKey: TEST_SERVICE_ROLE_KEY,
    fetch: fetchImpl,
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
    const baseline = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      { ...passthrough, provider: providerReturning(MOCK_EXTRACTED_RECIPE) },
    );
    assertEquals(baseline.status, 200);

    const drills: Array<{ env: string; status: number; code: string }> = [
      { env: SIMULATE_OUTAGE_ENV, status: 503, code: "AI_UNAVAILABLE" },
      { env: SIMULATE_BAD_OUTPUT_ENV, status: 502, code: "AI_OUTPUT_INVALID" },
    ];

    for (const drill of drills) {
      // Drill switch alone must not fire: no master switch means the real
      // adapter is used (which here fails as a plain 500, never the drill code).
      Deno.env.set(drill.env, "1");
      const withoutMaster = await handler(
        extractRequest(JSON.stringify({ notes: NOTES })),
        passthrough,
      );
      assertEquals(withoutMaster.status, 500);
      assertEquals((await withoutMaster.json()).error?.code, "INTERNAL_ERROR");

      Deno.env.set(ALLOW_FAILURE_DRILLS_ENV, "1");
      // Production/default/unknown environments ignore every switch, even together.
      Deno.env.set(SIMULATE_OUTAGE_ENV, "1");
      Deno.env.set(SIMULATE_BAD_OUTPUT_ENV, "1");
      for (const environment of [undefined, "", "production", " PRODUCTION ", "staging", "typo"]) {
        if (environment === undefined) Deno.env.delete(AI_ENVIRONMENT_ENV);
        else Deno.env.set(AI_ENVIRONMENT_ENV, environment);
        const guarded = await handler(extractRequest(JSON.stringify({ notes: NOTES })), passthrough);
        assertEquals(guarded.status, 500);
        assertEquals((await guarded.json()).error?.code, "INTERNAL_ERROR");
      }
      Deno.env.delete(SIMULATE_OUTAGE_ENV);
      Deno.env.delete(SIMULATE_BAD_OUTPUT_ENV);
      Deno.env.set(drill.env, "1");

      // Only an allowed environment plus both switches activates a drill.
      for (const environment of ["development", "test", " TEST "]) {
        Deno.env.set(AI_ENVIRONMENT_ENV, environment);
        const withMaster = await handler(
          extractRequest(JSON.stringify({ notes: NOTES })),
          passthrough,
        );
        assertEquals(withMaster.status, drill.status);
        assertEquals((await withMaster.json()).error?.code, drill.code);
      }

      Deno.env.delete(ALLOW_FAILURE_DRILLS_ENV);
      Deno.env.delete(drill.env);
    }

    // A falsy drill value stays off even with the master switch on.
    Deno.env.set(ALLOW_FAILURE_DRILLS_ENV, "1");
    Deno.env.set(SIMULATE_OUTAGE_ENV, "0");
    const offDrill = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      passthrough,
    );
    assertEquals(offDrill.status, 500);
    assertEquals((await offDrill.json()).error?.code, "INTERNAL_ERROR");
  } finally {
    for (const [name, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});


Deno.test("Logical AI operation with bounded retry charges 1 quota reservation and confirms on success", async () => {
  let providerCalls = 0;
  const retryProvider: AIProvider = {
    extractRecipe: () => {
      providerCalls++;
      if (providerCalls === 1) {
        throw new AIError("rate_limited", "extract", "Transient provider rate limit");
      }
      return Promise.resolve(MOCK_EXTRACTED_RECIPE);
    },
    generateRecipe: () => Promise.reject(new Error("generateRecipe is not used here")),
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };

  const consumedReservations: string[] = [];
  const confirmedReservations: string[] = [];
  const reconciledReservations: string[] = [];

  const { fetchImpl, requests } = createFetchMock({
    onConsume: (body) => {
      consumedReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
    onConfirm: (body) => {
      confirmedReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
    onReconcile: (body) => {
      reconciledReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
  });

  const wrappedProvider: AIProvider = {
    extractRecipe: async (input) => {
      try {
        return await retryProvider.extractRecipe(input);
      } catch {
        return await retryProvider.extractRecipe(input);
      }
    },
    generateRecipe: () => Promise.reject(new Error("generateRecipe is not used here")),
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: wrappedProvider,
    },
  );

  assertEquals(res.status, 200);
  assertEquals(providerCalls, 2);
  assertEquals(consumedReservations.length, 1);
  assertEquals(confirmedReservations.length, 1);
  assertEquals(reconciledReservations.length, 0);
  assertEquals(confirmedReservations[0], consumedReservations[0]);
  assertNoDatabaseWrites(requests);
});

Deno.test("Logical AI operation with retry exhaustion refunds the quota reservation", async () => {
  let providerCalls = 0;
  const failingProvider: AIProvider = {
    extractRecipe: () => {
      providerCalls++;
      throw new AIError("rate_limited", "extract", "Provider rate limit exhausted");
    },
    generateRecipe: () => Promise.reject(new Error("generateRecipe is not used here")),
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };

  const consumedReservations: string[] = [];
  const confirmedReservations: string[] = [];
  const reconciledReservations: string[] = [];

  const { fetchImpl } = createFetchMock({
    onConsume: (body) => {
      consumedReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
    onConfirm: (body) => {
      confirmedReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
    onReconcile: (body) => {
      reconciledReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
  });

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: failingProvider,
    },
  );

  assertEquals(res.status, 429);
  assertEquals((await res.json()).error?.code, "AI_RATE_LIMITED");
  assertEquals(providerCalls, 1);
  assertEquals(consumedReservations.length, 1);
  assertEquals(confirmedReservations.length, 0);
  assertEquals(reconciledReservations.length, 1);
  assertEquals(reconciledReservations[0], consumedReservations[0]);
});

Deno.test("Reservation replay rejection prevents repeated provider invocations under single reservation", async () => {
  let providerCalls = 0;
  const mockProvider = providerReturning(MOCK_EXTRACTED_RECIPE, () => providerCalls++);
  const reusedReservationId = crypto.randomUUID();
  const conflictSet = new Set<string>();

  const { fetchImpl } = createFetchMock({
    conflictReservations: conflictSet,
    onConsume: (body) => {
      const id = (body as { p_reservation_id: string }).p_reservation_id;
      if (id === reusedReservationId) {
        conflictSet.add(id);
      }
    },
  });

  const res1 = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: mockProvider,
      quotaCheck: (userId: string, sb: SupabaseClient, deps?: QuotaCheckDeps) =>
        consumeDailyQuota(userId, sb, { ...deps, reservationId: reusedReservationId }),
    },
  );
  assertEquals(res1.status, 200);
  assertEquals(providerCalls, 1);

  const res2 = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: mockProvider,
      quotaCheck: (userId: string, sb: SupabaseClient, deps?: QuotaCheckDeps) =>
        consumeDailyQuota(userId, sb, { ...deps, reservationId: reusedReservationId }),
    },
  );
  assertEquals(res2.status, 503);
  assertEquals((await res2.json()).error?.code, "QUOTA_UNAVAILABLE");
  assertEquals(providerCalls, 1);
});

Deno.test("Error preservation returns original provider error even when rollback RPC fails", async () => {
  let providerCalls = 0;
  const failingProvider: AIProvider = {
    extractRecipe: () => {
      providerCalls++;
      throw new AIError("provider_rejected", "extract", "Gemini upstream 502 bad gateway");
    },
    generateRecipe: () => Promise.reject(new Error("generateRecipe is not used here")),
    testConnection: () => Promise.reject(new Error("testConnection is not used here")),
  };

  const { fetchImpl } = createFetchMock({
    reconcileError: true,
  });

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: failingProvider,
    },
  );

  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error?.code, "AI_PROVIDER_REJECTED");
  assertEquals(providerCalls, 1);
});

Deno.test("Confirmation safety delivers 200 OK preview even if confirmation RPC fails", async () => {
  let providerCalls = 0;
  const mockProvider = providerReturning(MOCK_EXTRACTED_RECIPE, () => providerCalls++);
  const reconciledReservations: string[] = [];

  const { fetchImpl } = createFetchMock({
    confirmError: true,
    onReconcile: (body) => {
      reconciledReservations.push((body as { p_reservation_id: string }).p_reservation_id);
    },
  });

  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: fetchImpl,
      provider: mockProvider,
    },
  );

  assertEquals(res.status, 200);
  assertEquals(providerCalls, 1);
  assertEquals(reconciledReservations.length, 0);
  const body = await res.json();
  assertEquals(body.recipe?.title, MOCK_EXTRACTED_RECIPE.title);
});

Deno.test("UTC reset boundaries behave deterministically across midnight transition", () => {
  const beforeMidnight = new Date("2026-10-31T23:59:59.000Z");
  const midnight = new Date("2026-11-01T00:00:00.000Z");
  const afterMidnight = new Date("2026-11-01T00:00:01.000Z");

  assertEquals(utcDateString(beforeMidnight), "2026-10-31");
  assertEquals(utcDateString(midnight), "2026-11-01");
  assertEquals(utcDateString(afterMidnight), "2026-11-01");

  assertEquals(secondsUntilNextUtcDay(beforeMidnight), 1);
  assertEquals(secondsUntilNextUtcDay(midnight), 86400);
  assertEquals(secondsUntilNextUtcDay(afterMidnight), 86399);
});

Deno.test("Administrative reconciliation requires audit reason and handles success and errors", async () => {
  const reservationId = crypto.randomUUID();
  const { fetchImpl } = createFetchMock();

  const result = await reconcileUnconfirmedReservation(reservationId, "provider_crash_recovery", {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseServiceRoleKey: TEST_SERVICE_ROLE_KEY,
    fetch: fetchImpl,
  });

  assertEquals(result.reconciled, true);
  assertEquals(result.status, "refunded");
});

Deno.test("Missing service role credentials fail closed with QUOTA_UNAVAILABLE before provider execution", async () => {
  const { fetchImpl } = createFetchMock();
  let providerCalled = false;
  const res = await handler(
    extractRequest(JSON.stringify({ notes: NOTES })),{
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      supabaseServiceRoleKey: undefined,
      fetch: fetchImpl,
      provider: providerThrowing(new Error("must not run"), () => {
        providerCalled = true;
      }),
    },
  );
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error?.code, "QUOTA_UNAVAILABLE");
  assertEquals(providerCalled, false);
});

Deno.test("Quota consumption falls back to environment variables when dependencies omit service role credentials", async () => {
  const prevUrl = Deno.env.get("SUPABASE_URL");
  const prevKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const { fetchImpl, requests } = createFetchMock({ usageCount: 0 });
  try {
    Deno.env.set("SUPABASE_URL", TEST_SUPABASE_URL);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", TEST_SERVICE_ROLE_KEY);
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),{
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        supabaseServiceRoleKey: undefined,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
      },
    );
    assertEquals(res.status, 200);
    const quotaOp = requests.find((request) => request.path === "/rest/v1/rpc/consume_ai_quota");
    assertEquals(quotaOp?.authorization, `Bearer ${TEST_SERVICE_ROLE_KEY}`);
  } finally {
    if (prevUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", prevUrl);
    if (prevKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prevKey);
  }
});
