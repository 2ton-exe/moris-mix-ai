# Authenticated recipe creation API contract (`POST /recipes`)

This contract defines the authenticated recipe creation endpoint (`supabase/functions/recipes/index.ts`) and shared Zod schemas (`CreateRecipeRequestSchema`, `RecipeSchema`, `RecipeResponseSchema` in `supabase/functions/_shared/ai/schemas.ts`, re-exported via `supabase/functions/_shared/schemas.ts`) implemented for BE-05 (#47).

## Request

- **Method and path:** `POST /functions/v1/recipes` (also accepts `POST /recipes` when invoked directly)
- **Headers:**
  - `Authorization: Bearer <supabase-access-token>` (required)
  - `apikey: <supabase-anon-or-publishable-key>`
  - `Content-Type: application/json`
- **Query parameters:** none (any caller-supplied query parameters are ignored)
- **Access:** authenticated users only. Verified through `authenticateRequest(req, deps)` (`supabase/functions/_shared/auth.ts`).

### Request body (`CreateRecipeRequestSchema`)

```json
{
  "title": "Crispy Garlic Shallot Rice",
  "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
  "ingredients": [
    { "name": "jasmine rice", "quantity": 2, "unit": "cups", "inferred": false },
    { "name": "shallots", "quantity": null, "unit": null, "quantityText": "2 small", "inferred": true }
  ],
  "instructions": [
    { "step": 1, "text": "Slice shallots and garlic thinly." },
    { "step": 2, "text": "Crisp in oil and toss with rice." }
  ],
  "flavor_scores": {
    "sweet": 1,
    "salty": 4,
    "sour": 0,
    "bitter": 1,
    "umami": 5,
    "spicy": 2
  },
  "star_rating": 5,
  "cooked_at": "2026-10-19"
}
```

#### Field rules

| Field | Required | Type / Constraints | Default / Normalization |
| --- | --- | --- | --- |
| `title` | Required | `string`, trimmed, minimum 1 non-whitespace character | Trimmed via `.trim()` |
| `raw_input` | Optional | `string | null` | `null` when omitted |
| `ingredients` | Required | `Ingredient[]` (`IngredientSchema`: `name: string`, `quantity: number | null`, `unit: string | null`, `quantityText?: string`, `inferred?: boolean`) | `inferred` defaults to `false` |
| `instructions` | Required | `Instruction[]` (`InstructionSchema`: `step: number`, `text: string`) | Preserved as validated array |
| `flavor_scores` | Optional | `FlavorScores | null` (`FlavorScoreSchema`: `sweet`, `salty`, `sour`, `bitter`, `umami`, `spicy`, each `number` in `0..5`) | `null` when omitted |
| `star_rating` | Optional | `number` (integer `1..5`) or `null` | `null` when omitted |
| `cooked_at` | Optional | `string` (valid calendar date `YYYY-MM-DD`) or `null` | `null` when omitted |

### Ownership and server-controlled fields

- Recipe ownership (`user_id`) is derived exclusively from `auth.context.user.id` after `authenticateRequest(req, deps)` verifies the Bearer token against Supabase Auth.
- Any client-supplied ownership or server-managed fields (`id`, `user_id`, `userId`, `owner_id`, `ownerId`, `is_public`, `image_url`, `image_path`, `created_at`, `updated_at`) in the request body, query parameters, or headers are stripped/ignored.
- User-created recipes are always inserted with `user_id = auth.context.user.id` and `is_public = false`.
- The database insert runs through the request-scoped RLS-aware Supabase client (`auth.context.supabase`), so PostgreSQL Row-Level Security (`recipes_insert_own` with `WITH CHECK (auth.uid() = user_id)` and `recipes_select_own` with `USING (auth.uid() = user_id)`) remains active.

## Successful response

Returns `201 Created` with `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Access-Control-Allow-Methods: POST, OPTIONS`:

```json
{
  "recipe": {
    "id": "33333333-3333-4333-8333-333333333333",
    "user_id": "99999999-9999-9999-9999-999999999999",
    "title": "Crispy Garlic Shallot Rice",
    "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
    "ingredients": [
      { "name": "jasmine rice", "quantity": 2, "unit": "cups", "inferred": false },
      { "name": "shallots", "quantity": null, "unit": null, "quantityText": "2 small", "inferred": true }
    ],
    "instructions": [
      { "step": 1, "text": "Slice shallots and garlic thinly." },
      { "step": 2, "text": "Crisp in oil and toss with rice." }
    ],
    "flavor_scores": {
      "sweet": 1,
      "salty": 4,
      "sour": 0,
      "bitter": 1,
      "umami": 5,
      "spicy": 2
    },
    "star_rating": 5,
    "cooked_at": "2026-10-19",
    "image_url": null,
    "created_at": "2026-10-20T06:00:00.000Z",
    "updated_at": "2026-10-20T06:00:00.000Z"
  }
}
```

Internal columns (`image_path` and `is_public`) are excluded from the public response envelope.

## Errors

All error responses use `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Access-Control-Allow-Methods: POST, OPTIONS`.

| HTTP status | Code | Message | When |
| --- | --- | --- | --- |
| `400 Bad Request` | `INVALID_JSON` | `Request body must be a valid JSON object.` | Request body is empty, malformed JSON, or not a plain JSON object (e.g., array or primitive). |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid recipe payload.` | Request body fails `CreateRecipeRequestSchema` validation. Includes `error.details` array of `{ path, code, message }`. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Missing or invalid Authorization header.` | `Authorization` header is missing, empty, not `Bearer`, or not a compact 3-part JWS. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Invalid or expired authentication credentials.` | Supabase Auth rejects the Bearer JWT as invalid, expired, revoked, or unauthenticated. |
| `404 Not Found` | `NOT_FOUND` | `Route not found.` | Request targets an unsupported sub-path under `/recipes`. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only POST and OPTIONS methods are supported.` | Request uses an HTTP method other than `POST` or `OPTIONS`. Includes `Allow: POST, OPTIONS`. |
| `503 Service Unavailable` | `AUTH_SERVICE_RATE_LIMITED` | `Authentication service is temporarily unavailable. Please try again later.` | Upstream Supabase Auth returns `429 Too Many Requests` during token verification. Propagates a validated `Retry-After` header when present. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Missing/invalid server configuration, upstream Auth failure, database persistence error, RLS denial, or response schema validation failure. Never exposes secrets, tokens, SQL details, or stack traces. |

## CORS behavior

- `OPTIONS` preflight requests are handled before authentication and return `204 No Content` with `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`, and `X-Content-Type-Options: nosniff`.
- In `supabase/config.toml`, `[functions.recipes]` sets `verify_jwt = false` at the gateway so unauthenticated browser `OPTIONS` preflight requests reach the handler while `POST` strictly enforces `authenticateRequest(req, deps)`.

## Verification and testing (`supabase/functions/tests/recipes_test.ts`)

Verification for `POST /recipes` is organized into distinct offline deterministic tests and optional live hosted RLS integration testing, fitting within the broader test suite hierarchy:
- **Deterministic offline tests (47 tests in Deno):** Run completely offline without database or Auth dependencies, including the 14 unit and contract tests in `recipes_test.ts`.
- **Database-backed migration lifecycle tests (13 scenarios):** Run against native local PostgreSQL via `node test-migrations.mjs --run-db-tests`.
- **Migration unit tests:** Run offline via `node test-migrations.mjs`.
- **Intentionally ignored live tests (3 tests across two distinct gates):**
  1. *Gate A (Local Demo Live Integration Test):* In `demo_recipe_test.ts`, requires a compatible local API endpoint running on loopback port `54321`. Hosted project secrets cannot enable it.
  2. *Gate B (Hosted Non-Production RLS Integration Tests):* In `recipes_test.ts` (POST `/recipes`) and `auth_rls_integration_test.ts` (profiles), which require a dedicated non-production Supabase project and dedicated secrets.

### 1. Deterministic unit and schema tests (`supabase/functions/tests/recipes_test.ts`)

- **Scope:** 14 offline tests executed via Deno without network or database dependencies.
- **Verification areas:**
  - `CreateRecipeRequestSchema` and `RecipeResponseSchema` payload validation, including optional field defaulting and nullable columns.
  - Empty or malformed JSON rejection (`400 INVALID_JSON`).
  - Zod validation failure reporting with field-level details (`400 VALIDATION_ERROR`).
  - Bearer token authentication enforcement (`401 UNAUTHORIZED`) before any database operation.
  - Ownership (`user_id`) and `is_public` tampering prevention in body, query parameters, or headers.
  - CORS preflight handling (`204 No Content`) with `POST, OPTIONS` allowed.
  - Unsupported HTTP method rejection (`405 METHOD_NOT_ALLOWED`).
  - Unsupported sub-path rejection (`404 NOT_FOUND`).
  - Safe internal error handling and sensitive information redaction (`500 INTERNAL_ERROR`).
  - RLS test resource cleanup and exception handling.
- **Command:**
  ```sh
  deno test --frozen-lockfile --node-modules-dir=auto --allow-env supabase/functions/tests/recipes_test.ts
  ```

### 2. Hosted POST `/recipes` live integration test (`supabase/functions/tests/recipes_test.ts`)

- **Purpose:** Verifies live PostgreSQL persistence, recipe owner enforcement, `is_public: false` invariant, and cross-user RLS read isolation on a dedicated hosted, non-production Supabase test project without using Docker or local containers.
- **Prerequisites and supported GitHub Actions secrets:**
  - `BE04_RLS_TEST_SUPABASE_URL` (`${{ secrets.BE04_RLS_TEST_SUPABASE_URL }}`) — project URL of the dedicated non-production Supabase test project (with repository schema and RLS policies applied).
  - `BE04_RLS_TEST_SUPABASE_ANON_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_ANON_KEY }}`) — public key for the dedicated test project. In CI (`.github/workflows/ci.yml`), this is the single mapped public key secret, accepting either a legacy `anon` JWT or a modern `sb_publishable_*` key. (Local runs also accept `BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY` as an optional local environment variable override).
  - `BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY }}`) or `BE04_RLS_TEST_SUPABASE_SECRET_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_SECRET_KEY }}`) — administrative credentials (legacy `service_role` JWT or modern `sb_secret_*` key) used strictly for test user setup and teardown cleanup (never passed to user requests).
  - `RUN_BE04_RLS_INTEGRATION=true` — explicit opt-in flag required to execute the live test (set automatically in CI when prerequisite secrets are present).
- **Supported key formats and Supabase client behavior:**
  - *Public / Anon key:* Accepts either a legacy `anon` JWT (`header.payload.signature` signed with HMAC/SHA-256 with `role: "anon"`) or a modern publishable key (`sb_publishable_[A-Za-z0-9_-]{10,}`). Test clients normalize headers by ensuring `apikey: <key>` is passed while stripping any synthetic `Authorization: Bearer <publishable_key>` header so authenticated user session tokens remain intact.
  - *Service-role / Secret key:* Accepts either a legacy `service_role` JWT (`role: "service_role"`) or a modern secret key (`sb_secret_[A-Za-z0-9_-]{10,}`). Admin test clients normalize headers by setting `apikey: <key>` and omitting the synthetic `Authorization: Bearer <secret_key>` header so PostgREST and GoTrue accept the opaque key.
- **Gate isolation from local demo test:**
  - These hosted project secrets are shared with the profile RLS integration test (`auth_rls_integration_test.ts`), but **cannot** enable the local demo live integration test in `demo_recipe_test.ts` (which strictly requires a compatible API endpoint at the expected local loopback address and port `54321`).
- **Explicit opt-in and safety guards:**
  - The test never loads `.env` files automatically and never falls back to `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `DATABASE_URL`.
  - Safety checks reject execution if `BE04_RLS_TEST_SUPABASE_URL` points to the primary linked project (`gtbwblxskctpsqhbpebg`), matches `SUPABASE_URL` / `VITE_SUPABASE_URL`, uses local loopback port `54321`, or if the anon key equals the service-role key.
- **Skip behavior:**
  - When `RUN_BE04_RLS_INTEGRATION=true` or any `BE04_RLS_TEST_*` secret is missing, or if target safety prechecks fail, the test logs an explicit skip explanation and registers with `ignore: true` so Deno reports `0 passed | 1 ignored`. Unexecuted integration tests are never reported as passed, and production credentials are never used.
- **Execution command:**
  ```sh
  RUN_BE04_RLS_INTEGRATION=true \
  BE04_RLS_TEST_SUPABASE_URL="https://<dedicated-test-project-ref>.supabase.co" \
  BE04_RLS_TEST_SUPABASE_ANON_KEY="<dedicated-test-anon-key>" \
  BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY="<dedicated-test-service-role-key>" \
  deno test --frozen-lockfile --node-modules-dir=auto --allow-env --allow-net supabase/functions/tests/recipes_test.ts
  ```
- **Cleanup approach:**
  - Setup creates two unique test users (`User A` and `User B`). User A creates a recipe via `POST /recipes`. The test asserts positive retrieval by User A, negative retrieval (`[]` / `null`) by User B, and that the created recipe has `is_public: false`. A `finally` block deletes the created recipes and `auth.users` records via the admin client and verifies zero test recipe rows remain. Any setup, assertion, or cleanup error redacts all tokens, keys, and passwords before reporting.
