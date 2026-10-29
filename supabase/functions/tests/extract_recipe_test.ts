import { assertEquals } from "jsr:@std/assert@1";
import {
  ALLOW_FAILURE_DRILLS_ENV,
  EXTRACT_DISABLED_ENV,
  handler,
  MAX_REQUEST_BYTES,
  SIMULATE_BAD_OUTPUT_ENV,
  SIMULATE_OUTAGE_ENV,
} from "../extract-recipe/index.ts";
import {
  ExtractRecipeRequestSchema,
  ExtractRecipeResponseSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/schemas.ts";
import { MOCK_EXTRACTED_RECIPE } from "../_shared/ai/mocks.ts";
import { AIError, type AIErrorCode } from "../_shared/ai/GeminiAdapter.ts";
import type { AIProvider, ExtractRecipeInput, ExtractedRecipe } from "../_shared/ai/AIProvider.ts";
import {
  DEFAULT_AI_DAILY_LIMIT,
  resolveDailyLimit,
  secondsUntilNextUtcDay,
  utcDateString,
} from "../_shared/ai/quota.ts";

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
const NOTES = "Boiled chicken with garlic and a splash of soy sauce.";
const ENDPOINT_PATHS = ["/functions/v1/extract-recipe", "/extract-recipe"];

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
        if (options.authRetryAfter) {
          headers["Retry-After"] = options.authRetryAfter;
        }
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
      return Promise.resolve(
        new Response(
          JSON.stringify(count > 0 ? [{ operation_count: count }] : []),
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
    (request) => request.path.startsWith("/rest/") && request.method !== "GET",
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

Deno.test("The operator kill switch refuses extraction before the quota read or provider, and is off unless truthy", async () => {
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
      },
    );

    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error?.code, "AI_DISABLED");
    assertEquals(providerCalled, false);
    // Refused before auth's downstream work: no usage read, no writes.
    assertEquals(requests.every((request) => !request.path.startsWith("/rest/")), true);
  } finally {
    if (previous === undefined) Deno.env.delete(EXTRACT_DISABLED_ENV);
    else Deno.env.set(EXTRACT_DISABLED_ENV, previous);
  }

  // A falsy value leaves extraction enabled.
  Deno.env.set(EXTRACT_DISABLED_ENV, "0");
  try {
    const res = await handler(
      extractRequest(JSON.stringify({ notes: NOTES })),
      {
        supabaseUrl: TEST_SUPABASE_URL,
        supabaseAnonKey: TEST_ANON_KEY,
        fetch: fetchImpl,
        provider: providerReturning(MOCK_EXTRACTED_RECIPE),
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

    const quotaRead = requests.find((request) => request.path === "/rest/v1/ai_usage_daily");
    assertEquals(quotaRead?.method, "GET");
    assertEquals(quotaRead?.authorization, `Bearer ${VALID_TEST_JWT}`);
    assertEquals(quotaRead?.apikey, TEST_ANON_KEY);

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
    { code: "rate_limited", status: 429, expectedCode: "AI_RATE_LIMITED", expectedRetryAfter: "30" },
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

Deno.test("Simulation drills need the master switch plus the drill switch, and exercise the real error contract", async () => {
  const { fetchImpl } = createFetchMock();
  const passthrough = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: fetchImpl,
  };

  // GEMINI_API_KEY is tracked so that "no drill fired" is deterministic: without
  // a key the real adapter throws, so the handler answers 500 rather than making
  // a live call.
  const trackedEnvs = [
    ALLOW_FAILURE_DRILLS_ENV,
    SIMULATE_OUTAGE_ENV,
    SIMULATE_BAD_OUTPUT_ENV,
    "GEMINI_API_KEY",
  ];
  const previousEnv = new Map(trackedEnvs.map((name) => [name, Deno.env.get(name)]));

  try {
    for (const name of trackedEnvs) Deno.env.delete(name);

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

      // Adding the master switch activates the drill; still no GEMINI_API_KEY needed.
      Deno.env.set(ALLOW_FAILURE_DRILLS_ENV, "1");
      const withMaster = await handler(
        extractRequest(JSON.stringify({ notes: NOTES })),
        passthrough,
      );
      assertEquals(withMaster.status, drill.status);
      assertEquals((await withMaster.json()).error?.code, drill.code);

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
