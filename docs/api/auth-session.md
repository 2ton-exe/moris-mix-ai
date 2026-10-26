# Authenticated session and Edge Function authentication boundary contract

This contract defines the reusable Supabase Edge Function authentication boundary (`supabase/functions/_shared/auth.ts`) and the protected session verification endpoint (`supabase/functions/auth-session/index.ts`) implemented for BE-04.

## Reusable authentication boundary (`_shared/auth.ts`)

Protected Edge Function handlers must authenticate incoming requests through `authenticateRequest(req, deps)` rather than parsing JWT claims manually or trusting client-supplied identifiers.

### Interface

```ts
export type AuthenticatedUser = {
  id: string;
  email: string | null;
  role: string | null;
};

export type AuthContext = {
  user: AuthenticatedUser;
  supabase: SupabaseClient;
};

export type AuthSuccess = {
  ok: true;
  context: AuthContext;
};

export type AuthFailure = {
  ok: false;
  response: Response;
};

export type AuthResult = AuthSuccess | AuthFailure;
```

### Security and RLS guarantees

1. **Bearer extraction and structural check:** `extractBearerToken(req)` requires an `Authorization: Bearer <jwt>` header (matching the `Bearer` scheme case-insensitively per RFC 6750/RFC 9110) containing a single compact three-segment JWS (`header.payload.signature`). Missing headers, unsupported schemes, extra segments, or empty credentials immediately return `401 Unauthorized` without network calls.
2. **Genuine token verification:** `authenticateRequest(req, deps)` verifies the extracted Bearer token against Supabase Auth (`supabase.auth.getUser(accessToken)`). Unverified JWT payloads are never trusted.
3. **Minimal trusted context:** On success, `authenticateRequest` returns only `context.user` (`id`, `email`, `role`) and `context.supabase`. The raw `accessToken` is not separately exposed on `AuthContext`.
4. **PostgreSQL RLS preservation:** `context.supabase` is constructed with the public anon/publishable key (`SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`) and sets `Authorization: Bearer <accessToken>` on outgoing requests. All subsequent PostgREST operations execute as the verified user so PostgreSQL Row Level Security (`auth.uid()`) remains active. Service-role credentials are never used for user-owned data operations.
5. **Caller override protection:** Downstream handlers must resolve ownership and identity exclusively from `auth.context.user.id` and ignore any `id`, `user_id`, `userId`, or custom identity headers supplied by the caller.

## Protected endpoint request (`GET /functions/v1/auth-session`)

- **Method and path:** `GET /functions/v1/auth-session`
- **Headers:** `Authorization: Bearer <supabase-access-token>`, `apikey: <supabase-anon-or-publishable-key>`
- **Query parameters:** none (any caller-supplied identity parameters are ignored)
- **Request body:** none
- **Access:** authenticated users only.

## Successful response

Return `200 OK` with `Content-Type: application/json`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`:

```json
{
  "user": {
    "id": "99999999-9999-9999-9999-999999999999",
    "email": "verified@morisscraps.local",
    "display_name": "Verified Chef",
    "avatar_url": null
  }
}
```

## Errors

Function errors use `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and the standard error envelope:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authentication credentials."
  }
}
```

| HTTP status | Code | Message | When |
| --- | --- | --- | --- |
| `401 Unauthorized` | `UNAUTHORIZED` | `Missing or invalid Authorization header.` | The `Authorization` header is missing, empty, does not use the `Bearer` scheme (case-insensitive), has extra segments, or is not a three-part compact JWT. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Invalid or expired authentication credentials.` | Supabase Auth explicitly identifies the user token as invalid, expired, malformed, revoked, or belonging to a nonexistent/unauthenticated user. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only GET and OPTIONS methods are supported.` | A method other than `GET` or CORS preflight `OPTIONS` is used. Includes `Allow: GET, OPTIONS`. |
| `503 Service Unavailable` | `AUTH_SERVICE_RATE_LIMITED` | `Authentication service is temporarily unavailable. Please try again later.` | Upstream Supabase Auth returns HTTP `429 Too Many Requests` during token verification. Propagates a validated `Retry-After` header (positive integer delay-seconds or valid RFC 9110 IMF-fixdate) when provided by the upstream response and omits invalid or missing `Retry-After` values. Never exposes upstream error bodies or implies the caller personally exceeded an API limit. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Missing or invalid server configuration (`SUPABASE_URL` / `SUPABASE_ANON_KEY`), invalid server API key rejected by the upstream gateway, unrecognized upstream 4xx/5xx error, upstream Auth network failure, or database query failure. Never exposes tokens, secrets, upstream messages, or stack traces. |

## CORS behavior

Handles `OPTIONS` preflight before authentication so browser preflight requests succeed with `204 No Content` without requiring an `Authorization` header. Allows `GET, OPTIONS` and permits `authorization, x-client-info, apikey, content-type`.

## Intentional `verify_jwt = false` gateway configuration (`supabase/config.toml`)

In `supabase/config.toml`, `[functions.auth-session]` is intentionally configured with `verify_jwt = false`:

1. **Gateway behavior:** Gateway-level JWT verification is disabled for `auth-session`, allowing incoming HTTP requests to reach the Edge Function handler (`supabase/functions/auth-session/index.ts`) without being rejected by the Supabase API gateway before the handler executes.
2. **Application-level authentication:** Disabling gateway verification does **not** make `GET /functions/v1/auth-session` a public endpoint. The protected `GET` handler enforces authentication by calling `authenticateRequest(req, deps)` (`supabase/functions/_shared/auth.ts`), which extracts the `Bearer` token and verifies it against Supabase Auth via `supabase.auth.getUser(accessToken)`.
3. **Authentication failure behavior:** Missing, malformed, invalid, and expired credentials are rejected by `authenticateRequest()` with `401 Unauthorized` before any protected PostgREST query or business logic executes. Upstream rate limits (`429` mapped to `503 AUTH_SERVICE_RATE_LIMITED`), server configuration errors, invalid server API keys, and infrastructure failures return their standardized safe JSON error envelopes without leaking tokens, secrets, upstream payloads, or stack traces.
4. **CORS preflight behavior:** The handler processes `OPTIONS` preflight requests before invoking `authenticateRequest()`. Because browsers do not attach `Authorization: Bearer <token>` headers to CORS preflight `OPTIONS` requests, handling preflight at the application layer allows browser preflight checks to succeed with `204 No Content`. This unauthenticated exception applies strictly to `OPTIONS` preflight processing, never to the protected `GET` endpoint.
5. **Configuration change risk:** Enabling `verify_jwt = true` on `[functions.auth-session]` alters the request-validation path: the gateway would intercept and reject unauthenticated or malformed requests (and potentially unauthenticated browser `OPTIONS` preflight requests depending on gateway behavior) before the Edge Function handler runs, bypassing the repository's standardized JSON error envelope, security headers (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`), and CORS handling. Any future change to `verify_jwt` must evaluate the full authentication, error-envelope, and CORS preflight flow.
6. **Security responsibility:** Because `verify_jwt = false` delegates verification from the gateway to the Edge Function handler, the handler's own authentication boundary (`authenticateRequest()`) is solely responsible for enforcing authentication on protected routes. This setting must never be interpreted as permission to omit, weaken, or bypass `authenticateRequest()` on protected request paths.
7. **Public endpoint distinction:** The `verify_jwt = false` configuration on `auth-session` is specific to how this protected endpoint manages application-layer authentication and CORS preflight; it must not be used to infer the access policy of other Edge Functions. In contrast, `supabase/functions/demo-recipe/index.ts` (`[functions.demo-recipe]`) is an intentionally public read-only endpoint with its own separate access policy and contract (`docs/api/demo-recipe.md`).

## Verification and testing (`supabase/functions/tests/`)

The repository separates backend verification into distinct offline and live categories:
- **Deterministic offline tests (48 tests in Deno):** Run completely offline without database or Auth dependencies, verifying schemas, HTTP methods, error envelopes, caller override protections, and PostgREST client JWT forwarding.
- **Database-backed migration lifecycle tests (13 scenarios):** Run against native local PostgreSQL via `node test-migrations.mjs --run-db-tests`.
- **Migration unit tests:** Run offline via `node test-migrations.mjs`.
- **Intentionally ignored live tests (3 tests across two distinct gates):**
  1. *Gate A (Local Demo Live Integration Test):* In `demo_recipe_test.ts`, requires a compatible local API endpoint running on loopback port `54321`. Hosted project secrets cannot enable it.
  2. *Gate B (Hosted Non-Production RLS Integration Tests):* In `auth_rls_integration_test.ts` (profiles) and `recipes_test.ts` (POST `/recipes`), which require a dedicated non-production Supabase project and dedicated secrets.

### 1. Deterministic authentication and JWT-forwarding tests (`supabase/functions/tests/auth_test.ts`)

- **Purpose:** Verifies `extractBearerToken()`, `authenticateRequest()`, error classification (`401`, `405`, `503 AUTH_SERVICE_RATE_LIMITED`, `500`), `Retry-After` validation, CORS preflight handling, caller identity-override protection, and that the authenticated Supabase client forwards `Authorization: Bearer <accessToken>` and `apikey: <anonKey>` to PostgREST.
- **Limitation:** Because these tests use injected `fetch` mocks so they can run offline in CI and local environments without credentials, they prove client JWT forwarding but do not by themselves prove live PostgreSQL RLS evaluation.
- **Command:**
  ```sh
  deno test --frozen-lockfile --node-modules-dir=auto --allow-env --allow-read=fixtures/demo-recipe.json supabase/functions/tests/demo_recipe_test.ts supabase/functions/tests/auth_test.ts
  ```

### 2. Hosted PostgreSQL RLS integration test (`supabase/functions/tests/auth_rls_integration_test.ts`)

- **Purpose:** Exercises real Supabase Auth and live PostgreSQL RLS enforcement on `public.profiles` (`profiles_select_own`: `auth.uid() = id`) against a dedicated hosted, non-production Supabase test project without using Docker or local containers.
- **Prerequisites and supported GitHub Actions secrets:**
  - `NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL }}`) — project URL of the dedicated non-production Supabase test project (must have the repository's `public.profiles` schema and RLS policies applied).
  - `NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY }}`) — public key for the dedicated test project. In CI (`.github/workflows/ci.yml`), this is the single mapped public key secret, accepting either a legacy `anon` JWT or a modern `sb_publishable_*` key. (Local runs also accept `NON_PRODUCTION_TEST_DATABASE_SUPABASE_PUBLISHABLE_KEY` as an optional local environment variable override).
  - `NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY }}`) or `NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY }}`) — administrative credentials (legacy `service_role` JWT or modern `sb_secret_*` key) for the dedicated test project, used strictly for test user/profile setup and teardown cleanup (never passed to `authenticateRequest()`, `handler()`, or user-scoped queries).
  - `RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION=true` — explicit opt-in flag required to execute the live test (set automatically in CI when prerequisite secrets are present).
- **Supported key formats and Supabase client behavior:**
  - *Public / Anon key:* Accepts either a legacy `anon` JWT (`header.payload.signature` signed with HMAC/SHA-256 with `role: "anon"`) or a modern publishable key (`sb_publishable_[A-Za-z0-9_-]{10,}`). When a modern key is used, test clients automatically set `apikey: <key>` and strip the synthetic `Authorization: Bearer <publishable_key>` header to avoid conflicting with user session bearer tokens.
  - *Service-role / Secret key:* Accepts either a legacy `service_role` JWT (`role: "service_role"`) or a modern secret key (`sb_secret_[A-Za-z0-9_-]{10,}`). When an `sb_secret_*` key is used, admin test clients normalize headers by setting `apikey: <key>` and omitting any `Authorization: Bearer <secret_key>` header so PostgREST and GoTrue accept the opaque key.
- **Gate isolation from local demo test:**
  - Hosted project secrets (`NON_PRODUCTION_TEST_DATABASE_*`) are shared with the hosted POST `/recipes` live test (`recipes_test.ts`), but **cannot** enable the separate local demo live integration test in `demo_recipe_test.ts` (which strictly requires a compatible API endpoint at the expected local loopback address and port `54321`).
- **Explicit opt-in and safety guards:**
  - The test never loads `.env` files automatically and never falls back to `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `DATABASE_URL`.
  - Safety checks reject execution if `NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL` points to the primary linked project (`gtbwblxskctpsqhbpebg`), matches `SUPABASE_URL` / `VITE_SUPABASE_URL`, uses local loopback port `54321`, or if the anon key equals the service-role key.
- **Skip behavior:**
  - When `RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION=true` or any `NON_PRODUCTION_TEST_DATABASE_*` secret is missing, or if target safety prechecks fail, the test logs an explicit skip explanation and registers with `ignore: true` so Deno reports `0 passed | 1 ignored`. Unexecuted integration tests are never reported as passed and production credentials are never touched.
- **Execution command:**
  ```sh
  RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION=true \
  NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL="https://<dedicated-test-project-ref>.supabase.co" \
  NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY="<dedicated-test-anon-key>" \
  NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY="<dedicated-test-service-role-key>" \
  deno test --frozen-lockfile --node-modules-dir=auto --allow-env --allow-net supabase/functions/tests/auth_rls_integration_test.ts
  ```
- **Cleanup approach:**
  - Setup creates two unique test users (`User A` and `User B`) and ensures their `public.profiles` rows exist. After verifying positive own-profile reads, cross-user negative reads (`[]` / `null`), unfiltered query isolation, and user JWT preservation on PostgREST requests, a `finally` block deletes the created `public.profiles` rows and `auth.users` records via the admin client and verifies that zero test profile rows remain. Any setup, assertion, or cleanup error redacts all tokens, keys, and passwords before reporting.
