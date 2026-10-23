import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { authenticateRequest, extractBearerToken } from "../_shared/auth.ts";
import { handler } from "../auth-session/index.ts";

const VALID_TEST_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6InZlcmlmaWVkQG1vcmlzc2NyYXBzLmxvY2FsIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_segment_ok";
const FORGED_TEST_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoic2VydmljZV9yb2xlIn0.forged_unverified_sig";
const EXPIRED_TEST_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJleHAiOjF9.expired_signature_seg";
const TEST_SUPABASE_URL = "https://mock.supabase.co";
const TEST_ANON_KEY = "mock-anon-public-key-value";
const VERIFIED_USER_ID = "99999999-9999-9999-9999-999999999999";
const VERIFIED_USER_EMAIL = "verified@morisscraps.local";

Deno.test("Valid Bearer token with standard, lowercase, or mixed-case scheme resolves to expected authenticated user context without exposing accessToken", async () => {
  for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
    let authRequestUrl: URL | null = null;
    let authRequestHeaders: Headers | null = null;

    const mockFetch: typeof fetch = (input, init) => {
      authRequestUrl = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      );
      authRequestHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: VERIFIED_USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: VERIFIED_USER_EMAIL,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    };

    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: {
        Authorization: `${scheme} ${VALID_TEST_JWT}`,
      },
    });

    const extracted = extractBearerToken(req);
    assertEquals(extracted.ok, true);
    if (extracted.ok) {
      assertEquals(extracted.token, VALID_TEST_JWT);
    }

    const result = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.context.user.id, VERIFIED_USER_ID);
      assertEquals(result.context.user.email, VERIFIED_USER_EMAIL);
      assertEquals(result.context.user.role, "authenticated");
      assertEquals(typeof result.context.supabase, "object");
      assertEquals("accessToken" in (result.context as Record<string, unknown>), false);
    }

    assertNotEquals(authRequestUrl, null);
    assertEquals(authRequestUrl!.pathname, "/auth/v1/user");
    assertNotEquals(authRequestHeaders, null);
    assertEquals(authRequestHeaders!.get("authorization"), `Bearer ${VALID_TEST_JWT}`);
    assertEquals(authRequestHeaders!.get("apikey"), TEST_ANON_KEY);
  }
});

Deno.test("Missing Authorization header is rejected with 401 UNAUTHORIZED and performs zero network calls", async () => {
  let fetchCount = 0;
  const mockFetch: typeof fetch = () => {
    fetchCount++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  const req = new Request("http://localhost/functions/v1/auth-session", {
    method: "GET",
  });

  const extracted = extractBearerToken(req);
  assertEquals(extracted.ok, false);

  const result = await authenticateRequest(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(result.ok, false);
  assertEquals(fetchCount, 0);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
    assertEquals(result.response.headers.get("content-type"), "application/json");
    assertEquals(result.response.headers.get("cache-control"), "no-store");
    assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    const body = await result.response.json();
    assertEquals(body.error?.code, "UNAUTHORIZED");
    assertEquals(body.error?.message, "Missing or invalid Authorization header.");
  }
});

Deno.test("Empty Bearer credential is rejected with 401 UNAUTHORIZED and performs zero network calls", async () => {
  let fetchCount = 0;
  const mockFetch: typeof fetch = () => {
    fetchCount++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  for (const headerValue of ["", "   ", "Bearer", "bearer", "Bearer ", "bearer   "]) {
    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: {
        Authorization: headerValue,
      },
    });

    const result = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(result.ok, false);
    assertEquals(fetchCount, 0);
    if (!result.ok) {
      assertEquals(result.response.status, 401);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
      const body = await result.response.json();
      assertEquals(body.error?.code, "UNAUTHORIZED");
      assertEquals(body.error?.message, "Missing or invalid Authorization header.");
    }
  }
});

Deno.test("Malformed Authorization header or unsupported authentication scheme is rejected with 401 UNAUTHORIZED", async () => {
  let fetchCount = 0;
  const mockFetch: typeof fetch = () => {
    fetchCount++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  const malformedHeaders = [
    "Basic dXNlcjpwYXNz",
    "Token abc.def.ghi",
    "Digest abc.def.ghi",
    `Bearer ${VALID_TEST_JWT} extra-segment`,
    `bearer ${VALID_TEST_JWT} extra-segment`,
    "Bearer not-a-three-part-jwt",
    "bearer not-a-three-part-jwt",
    "Bearer only.two",
    "Bearer a.b.c.d",
    "Bearer a..c",
    "Bearer .b.c",
    "Bearer a.b.",
    "Bearer invalid$char.payload.sig",
  ];

  for (const headerValue of malformedHeaders) {
    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: {
        Authorization: headerValue,
      },
    });

    const result = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(result.ok, false);
    assertEquals(fetchCount, 0);
    if (!result.ok) {
      assertEquals(result.response.status, 401);
      const body = await result.response.json();
      assertEquals(body.error?.code, "UNAUTHORIZED");
      assertEquals(body.error?.message, "Missing or invalid Authorization header.");
    }
  }
});

Deno.test("Invalid token rejected by Supabase Auth returns 401 UNAUTHORIZED and does not trust unverified JWT claims", async () => {
  let authVerifyCalls = 0;
  const mockFetch: typeof fetch = () => {
    authVerifyCalls++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          code: 401,
          error_code: "bad_jwt",
          msg: "invalid JWT: unable to parse or verify signature, token signature is invalid",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  };

  const req = new Request("http://localhost/functions/v1/auth-session", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${FORGED_TEST_JWT}`,
    },
  });

  const result = await authenticateRequest(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(authVerifyCalls, 1);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
    assertEquals(result.response.headers.get("cache-control"), "no-store");
    assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    const body = await result.response.json();
    assertEquals(body.error?.code, "UNAUTHORIZED");
    assertEquals(body.error?.message, "Invalid or expired authentication credentials.");
  }
});

Deno.test("Expired token rejected by Supabase Auth returns 401 UNAUTHORIZED", async () => {
  const mockFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 403,
          error_code: "bad_jwt",
          msg: "invalid JWT: token is expired by 120s",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

  const req = new Request("http://localhost/functions/v1/auth-session", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${EXPIRED_TEST_JWT}`,
    },
  });

  const result = await authenticateRequest(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.response.status, 401);
    const body = await result.response.json();
    assertEquals(body.error?.code, "UNAUTHORIZED");
    assertEquals(body.error?.message, "Invalid or expired authentication credentials.");
  }
});

Deno.test("Recognized authentication errors on nonstandard upstream statuses return 401 while invalid server API keys, unrecognized 401/403, and unexpected 404/422 return 500", async () => {
  const recognizedAuthFailureCases = [
    {
      status: 403,
      payload: { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" },
    },
    {
      status: 404,
      payload: { code: 404, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" },
    },
    {
      status: 422,
      payload: { code: 422, error_code: "bad_jwt", msg: "JWT is malformed" },
    },
    {
      status: 400,
      payload: { message: "Invalid JWT: unable to parse token claims" },
    },
  ];

  for (const testCase of recognizedAuthFailureCases) {
    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });
    const res = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(testCase.payload), {
            status: testCase.status,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    });
    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.response.status, 401);
      const body = await res.response.json();
      assertEquals(body.error?.code, "UNAUTHORIZED");
      assertEquals(body.error?.message, "Invalid or expired authentication credentials.");
    }
  }

  const serverErrorCases = [
    {
      status: 401,
      payload: { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." },
    },
    {
      status: 401,
      payload: { error_code: "invalid_api_key", msg: "No API key found in request" },
    },
    {
      status: 401,
      payload: { message: "Upstream gateway rejected request" },
    },
    {
      status: 403,
      payload: { message: "Project is paused or quota exceeded on upstream gateway" },
    },
    {
      status: 404,
      payload: { message: "Route GET:/auth/v1/user not found on gateway" },
    },
    {
      status: 422,
      payload: { code: "unexpected_schema_error", message: "Unprocessable upstream proxy configuration" },
    },
  ];

  for (const testCase of serverErrorCases) {
    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });
    const res = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(testCase.payload), {
            status: testCase.status,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    });
    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.response.status, 500);
      const body = await res.response.json();
      assertEquals(body.error?.code, "INTERNAL_ERROR");
      assertEquals(body.error?.message, "Internal server error.");
    }
  }
});

Deno.test("Upstream HTTP 429 from Supabase Auth returns 503 AUTH_SERVICE_RATE_LIMITED with safe message, security/CORS headers, and never executes database logic", async () => {
  const sensitiveRateLimitDetail = "UPSTREAM_RATE_LIMIT_INTERNAL_NODE_ip_10_0_0_99_secret";
  let authVerifyCalls = 0;
  let postgrestCalled = false;

  const rateLimitPayloads = [
    {
      code: 429,
      error_code: "over_request_rate_limit",
      msg: `Rate limit exceeded on upstream auth service for ${VALID_TEST_JWT} (${sensitiveRateLimitDetail})`,
    },
    {
      code: 429,
      error_code: "bad_jwt",
      msg: `Invalid JWT rate limit check failed for ${TEST_ANON_KEY} (${sensitiveRateLimitDetail})`,
    },
  ];

  for (const payload of rateLimitPayloads) {
    const mockFetch: typeof fetch = (input) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      );

      if (url.pathname === "/auth/v1/user") {
        authVerifyCalls++;
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.pathname.startsWith("/rest/v1/")) {
        postgrestCalled = true;
      }

      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    };

    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });

    const authResult = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });

    assertEquals(authResult.ok, false);
    if (!authResult.ok) {
      assertEquals(authResult.response.status, 503);
      assertEquals(authResult.response.headers.get("content-type"), "application/json");
      assertEquals(authResult.response.headers.get("cache-control"), "no-store");
      assertEquals(authResult.response.headers.get("x-content-type-options"), "nosniff");
      assertEquals(authResult.response.headers.get("access-control-allow-origin"), "*");
      assertEquals(authResult.response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
      assertEquals(
        authResult.response.headers.get("access-control-allow-headers"),
        "authorization, x-client-info, apikey, content-type",
      );
      assertEquals(authResult.response.headers.get("retry-after"), null);

      const rawText = await authResult.response.text();
      assertEquals(rawText.includes(VALID_TEST_JWT), false);
      assertEquals(rawText.includes(TEST_ANON_KEY), false);
      assertEquals(rawText.includes(sensitiveRateLimitDetail), false);
      assertEquals(rawText.includes("over_request_rate_limit"), false);
      assertEquals(rawText.includes("at "), false);

      const body = JSON.parse(rawText);
      assertEquals(body, {
        error: {
          code: "AUTH_SERVICE_RATE_LIMITED",
          message: "Authentication service is temporarily unavailable. Please try again later.",
        },
      });
    }

    const handlerRes = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(handlerRes.status, 503);
    assertEquals(postgrestCalled, false);
    const handlerBody = await handlerRes.json();
    assertEquals(handlerBody.error?.code, "AUTH_SERVICE_RATE_LIMITED");
    assertEquals(
      handlerBody.error?.message,
      "Authentication service is temporarily unavailable. Please try again later.",
    );
  }

  assertEquals(authVerifyCalls, 4);
});

Deno.test("Upstream HTTP 429 propagates validated Retry-After header and omits invalid or missing Retry-After values", async () => {
  const validRetryAfterValues = [
    { raw: "0", expected: "0" },
    { raw: "  0  ", expected: "0" },
    { raw: "60", expected: "60" },
    { raw: "  120  ", expected: "120" },
    { raw: "Wed, 21 Oct 2026 07:28:00 GMT", expected: "Wed, 21 Oct 2026 07:28:00 GMT" },
  ];

  for (const { raw, expected } of validRetryAfterValues) {
    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });

    const result = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: 429, message: "Too many requests" }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": raw,
                "X-Upstream-Internal": "must-not-propagate",
              },
            },
          ),
        ),
    });

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 503);
      assertEquals(result.response.headers.get("retry-after"), expected);
      assertEquals(result.response.headers.get("x-upstream-internal"), null);
      const body = await result.response.json();
      assertEquals(body.error?.code, "AUTH_SERVICE_RATE_LIMITED");
    }
  }

  const invalidRetryAfterValues = [
    "",
    "   ",
    "-1",
    "-30",
    "12.5",
    "60s",
    "invalid-header-value",
    "60; injected=1",
    "9999999999",
    "Wed, 99 Oct 2026 99:99:99 GMT",
  ];

  for (const invalidValue of invalidRetryAfterValues) {
    const req = new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    });

    const result = await authenticateRequest(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: 429, message: "Too many requests" }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": invalidValue,
              },
            },
          ),
        ),
    });

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.response.status, 503);
      assertEquals(result.response.headers.get("retry-after"), null);
      const body = await result.response.json();
      assertEquals(body.error?.code, "AUTH_SERVICE_RATE_LIMITED");
    }
  }
});

Deno.test("Verified identity cannot be overridden by client-supplied query parameters or headers in protected handler", async () => {
  let postgrestUrl: URL | null = null;

  const mockFetch: typeof fetch = (input, _init) => {
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

    if (url.pathname === "/rest/v1/profiles") {
      postgrestUrl = url;
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: VERIFIED_USER_ID,
              display_name: "Verified Chef",
              avatar_url: null,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const attackerId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const req = new Request(
    `http://localhost/functions/v1/auth-session?id=${attackerId}&user_id=${attackerId}&userId=${attackerId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${VALID_TEST_JWT}`,
        "X-User-Id": attackerId,
        "X-Forwarded-User": attackerId,
      },
    },
  );

  const res = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  });

  assertEquals(res.status, 200);
  assertNotEquals(postgrestUrl, null);
  assertEquals(postgrestUrl!.pathname, "/rest/v1/profiles");
  assertEquals(postgrestUrl!.searchParams.get("id"), `eq.${VERIFIED_USER_ID}`);
  assertEquals(postgrestUrl!.searchParams.get("user_id"), null);
  assertEquals(postgrestUrl!.searchParams.get("userId"), null);

  const body = await res.json();
  assertEquals(body.user?.id, VERIFIED_USER_ID);
  assertEquals(body.user?.email, VERIFIED_USER_EMAIL);
  assertEquals(body.user?.display_name, "Verified Chef");
});

Deno.test("Authenticated Supabase client forwards the verified user's Bearer JWT and anon key for PostgreSQL RLS enforcement", async () => {
  let postgrestHeaders: Headers | null = null;

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

    if (url.pathname === "/rest/v1/profiles") {
      postgrestHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: VERIFIED_USER_ID,
              display_name: "Verified Chef",
              avatar_url: "https://example.com/avatar.png",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const req = new Request("http://localhost/functions/v1/auth-session", {
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
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");

  assertNotEquals(postgrestHeaders, null);
  assertEquals(postgrestHeaders!.get("authorization"), `Bearer ${VALID_TEST_JWT}`);
  assertEquals(postgrestHeaders!.get("apikey"), TEST_ANON_KEY);
});

Deno.test("Invalid authentication prevents protected handler database logic from executing", async () => {
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
            msg: "invalid JWT: signature is invalid",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      postgrestCalled = true;
    }

    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  };

  const unauthenticatedRequests = [
    new Request("http://localhost/functions/v1/auth-session", { method: "GET" }),
    new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: "Bearer malformed-token" },
    }),
    new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${FORGED_TEST_JWT}` },
    }),
  ];

  for (const req of unauthenticatedRequests) {
    const res = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetch,
    });
    assertEquals(res.status, 401);
    assertEquals(postgrestCalled, false);
  }
});

Deno.test("Error responses never expose JWT contents, secrets, upstream provider details, or stack traces", async () => {
  const sensitiveUpstreamDetail = "UPSTREAM_SECRET_KEY_LEAK_pgrst_jwt_secret_value_12345";

  const mockFetch401: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 401,
          error_code: "bad_jwt",
          msg: `Token ${FORGED_TEST_JWT} failed verification against ${sensitiveUpstreamDetail}`,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

  const req401 = new Request("http://localhost/functions/v1/auth-session", {
    method: "GET",
    headers: { Authorization: `Bearer ${FORGED_TEST_JWT}` },
  });

  const res401 = await handler(req401, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch401,
  });

  const text401 = await res401.text();
  assertEquals(res401.status, 401);
  assertEquals(text401.includes(FORGED_TEST_JWT), false);
  assertEquals(text401.includes(TEST_ANON_KEY), false);
  assertEquals(text401.includes(sensitiveUpstreamDetail), false);
  assertEquals(text401.includes("at "), false);

  const mockFetchInvalidApiKey: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          message: `Invalid API key ${TEST_ANON_KEY} with secret ${sensitiveUpstreamDetail}`,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

  const resInvalidApiKey = await handler(
    new Request("http://localhost/functions/v1/auth-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
    }),
    {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: mockFetchInvalidApiKey,
    },
  );

  const textInvalidApiKey = await resInvalidApiKey.text();
  assertEquals(resInvalidApiKey.status, 500);
  assertEquals(textInvalidApiKey.includes(VALID_TEST_JWT), false);
  assertEquals(textInvalidApiKey.includes(TEST_ANON_KEY), false);
  assertEquals(textInvalidApiKey.includes(sensitiveUpstreamDetail), false);
  assertEquals(textInvalidApiKey.includes("at "), false);

  const mockFetch500: typeof fetch = () => {
    throw new Error(`Fatal internal failure with key ${TEST_ANON_KEY} and ${sensitiveUpstreamDetail}`);
  };

  const req500 = new Request("http://localhost/functions/v1/auth-session", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });

  const res500 = await handler(req500, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch500,
  });

  const text500 = await res500.text();
  assertEquals(res500.status, 500);
  assertEquals(text500.includes(VALID_TEST_JWT), false);
  assertEquals(text500.includes(TEST_ANON_KEY), false);
  assertEquals(text500.includes(sensitiveUpstreamDetail), false);
  assertEquals(text500.includes("at "), false);
});

Deno.test("Missing or invalid configuration, upstream 5xx errors, and network failures return 500 INTERNAL_ERROR instead of 401", async () => {
  const req = new Request("http://localhost/functions/v1/auth-session", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_TEST_JWT}` },
  });

  const missingConfigRes = await handler(req, {
    supabaseUrl: "",
    supabaseAnonKey: "",
  });
  assertEquals(missingConfigRes.status, 500);
  const missingConfigBody = await missingConfigRes.json();
  assertEquals(missingConfigBody.error?.code, "INTERNAL_ERROR");
  assertEquals(missingConfigBody.error?.message, "Internal server error.");

  const invalidUrlRes = await handler(req, {
    supabaseUrl: "not-a-valid-url",
    supabaseAnonKey: TEST_ANON_KEY,
  });
  assertEquals(invalidUrlRes.status, 500);
  const invalidUrlBody = await invalidUrlRes.json();
  assertEquals(invalidUrlBody.error?.code, "INTERNAL_ERROR");
  assertEquals(invalidUrlBody.error?.message, "Internal server error.");

  for (const upstreamStatus of [500, 502, 503, 504]) {
    const upstream5xxRes = await handler(req, {
      supabaseUrl: TEST_SUPABASE_URL,
      supabaseAnonKey: TEST_ANON_KEY,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ message: "Auth service unavailable" }),
            { status: upstreamStatus, headers: { "Content-Type": "application/json" } },
          ),
        ),
    });
    assertEquals(upstream5xxRes.status, 500);
    const body = await upstream5xxRes.json();
    assertEquals(body.error?.code, "INTERNAL_ERROR");
    assertEquals(body.error?.message, "Internal server error.");
  }

  const networkErrorRes = await handler(req, {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: () => Promise.reject(new TypeError("Failed to fetch upstream auth server")),
  });
  assertEquals(networkErrorRes.status, 500);
  const networkErrorBody = await networkErrorRes.json();
  assertEquals(networkErrorBody.error?.code, "INTERNAL_ERROR");
  assertEquals(networkErrorBody.error?.message, "Internal server error.");
});

Deno.test("Protected handler preserves CORS OPTIONS preflight without requiring Authorization and rejects unsupported methods with 405", async () => {
  const preflightReq = new Request("http://localhost/functions/v1/auth-session", {
    method: "OPTIONS",
  });
  const preflightRes = await handler(preflightReq);
  assertEquals(preflightRes.status, 204);
  assertEquals(preflightRes.headers.get("access-control-allow-origin"), "*");
  assertEquals(preflightRes.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assertEquals(
    preflightRes.headers.get("access-control-allow-headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(preflightRes.headers.get("x-content-type-options"), "nosniff");
  assertEquals(await preflightRes.text(), "");

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const invalidMethodReq = new Request("http://localhost/functions/v1/auth-session", {
      method,
    });
    const invalidMethodRes = await handler(invalidMethodReq);
    assertEquals(invalidMethodRes.status, 405);
    assertEquals(invalidMethodRes.headers.get("allow"), "GET, OPTIONS");
    assertEquals(invalidMethodRes.headers.get("cache-control"), "no-store");
    assertEquals(invalidMethodRes.headers.get("x-content-type-options"), "nosniff");
    const body = await invalidMethodRes.json();
    assertEquals(body.error?.code, "METHOD_NOT_ALLOWED");
  }
});
