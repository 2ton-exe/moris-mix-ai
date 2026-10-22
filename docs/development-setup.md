# Local development and troubleshooting

This guide covers local development, testing, and troubleshooting for the project under a strict **no-Docker, no-container policy**. It uses native local tools, checked-in schemas, and migration runners without requiring Docker or container runtimes.

## Prerequisites

- [Node.js 24](https://nodejs.org/en/download) and pnpm 10 (`npm install --global pnpm@10`; see the [pnpm 10 installation guide](https://pnpm.io/10.x/installation))
- [Deno](https://deno.land/) (for running Edge Function deterministic and integration test suites)
- Native PostgreSQL 15+ running as a local service on loopback (`127.0.0.1` or `localhost`)
- Supabase CLI 2.x (optional; used for Edge Function serving or schema tooling; container commands are not used)

> [!IMPORTANT]
> **Strict No-Docker Policy:** The project enforces a strict no-Docker and no-container policy for local development. Tools such as Docker, Docker Compose, and container-based CLI commands like `supabase start` are not required and should not be used.

## Database setup with native PostgreSQL

Local database operations and migration tests run directly against your native PostgreSQL instance:

1. **Service configuration:** Ensure your native PostgreSQL instance is running on loopback (`127.0.0.1` or `localhost`).
2. **Default connection settings:** The local test runner defaults `DATABASE_URL` to port `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), matching the database port configured in `supabase/config.toml` (`[db] port = 54322`).
3. **Loopback connection overrides:** If your native PostgreSQL installation listens on standard port `5432` or uses different credentials, provide a loopback `DATABASE_URL` override in your environment:
   ```sh
   export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
   ```
   In PowerShell:
   ```powershell
   $env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
   ```
4. **Applying migrations:** Apply versioned SQL migrations in `supabase/migrations/` to your native database using the project migration runner:
   ```sh
   pnpm db:setup
   ```
   This executes `node run-migrations.mjs`, which validates schema definitions, acquires an advisory lock, executes migrations deterministically in timestamp order, and tracks applied versions in `schema_migrations`.
5. **Demo seed data:** To seed demo records (e.g. `Classic Tomato Scraps Pasta`) into your native local database for frontend exploration, apply `supabase/seed.sql` using standard PostgreSQL tools (`psql`):
   ```sh
   psql "$DATABASE_URL" -f supabase/seed.sql
   ```
   Do not execute seed scripts against production databases.

## Starting the app and frontend

1. **Serve the Edge Function (optional local serving):**
   Edge Functions can be served locally using the Supabase CLI without container dependencies:
   ```sh
   supabase functions serve demo-recipe --no-verify-jwt
   ```
2. **Configure and start the frontend:**
   In another terminal, configure and launch the Vite development server:
   ```sh
   cd frontend
   pnpm install --frozen-lockfile
   cp .env.example .env.local
   ```
   (In PowerShell: `Copy-Item .env.example .env.local`).
   Set `VITE_SUPABASE_URL` to your local or target Supabase endpoint (e.g. `http://127.0.0.1:54321`) and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) to the corresponding public key. Never add service-role or secret keys to frontend configuration.
   Start Vite:
   ```sh
   pnpm dev
   ```
   Open the printed URL (normally `http://localhost:5173`).

## Migrations and schema management

The repository manages database schemas via versioned SQL migrations in `supabase/migrations/`.
- Run migrations against your native PostgreSQL instance with `pnpm db:setup` (`node run-migrations.mjs`).
- Never run destructive reset commands against remote or production projects.
- For remote schema updates on approved projects, migrations can be pushed using `supabase db push --dry-run --linked` and `supabase db push --linked`.

## Demo API

The frontend calls `GET /functions/v1/demo-recipe` at the configured Supabase URL and sends the public key in the `apikey` header. No signed-in user or request body is needed. The function reads only the approved public demo row and returns JSON; it does not call Gemini. The full response schema, CORS behavior, and error codes are in the [demo recipe API contract](api/demo-recipe.md).

You can check the local route from another terminal, replacing the placeholder with your local publishable/anon key:

```sh
curl --include http://127.0.0.1:54321/functions/v1/demo-recipe \
  --header 'apikey: <local-publishable-or-anon-key>'
```

In PowerShell, use `curl.exe` with the same URL and key:

```powershell
curl.exe --include "http://127.0.0.1:54321/functions/v1/demo-recipe" --header "apikey: <local-publishable-or-anon-key>"
```

A successful response is `200 OK` with `recipe.title` set to `Classic Tomato Scraps Pasta`. A function response with status `404` and JSON `error.code` set to `DEMO_RECIPE_NOT_FOUND` means the seeded public recipe was not found. A generic `404` may instead mean the function is not being served or the URL is incorrect; check the function-serving process and endpoint URL before resetting the database. Gateway and network failures may not use the function's JSON error envelope; see the API contract for the function error format.

## Checks and test suites

### Frontend checks

Run frontend checks from `frontend/`:

```sh
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

### Test suite taxonomy and execution gates

The test suite separates tests into four distinct categories to maintain rigorous verification without requiring unnecessary external services:

1. **Migration unit tests (`node test-migrations.mjs` or `pnpm test`):**
   - **Offline execution:** Runs completely offline without database connectivity.
   - **Verification:** Discovers versioned migration files in `supabase/migrations/`, asserts deterministic ascending timestamp sorting, checks filename integrity, validates schema completeness definitions, and tests SQL migration parsing.

2. **Database-backed migration lifecycle integration tests (`node test-migrations.mjs --run-db-tests` or `pnpm run test:lifecycle`):**
   - **Native PostgreSQL execution:** Runs all 13 migration lifecycle integration scenarios against a running native local PostgreSQL service on loopback.
   - **Verification:** Dynamically provisions an isolated temporary database (`test_mig_suite_<timestamp>_<random>`), verifies initial schema creation, column data types, nullability, constraints, indexes, triggers, functions, RLS policies, advisory locks, idempotency across repeated runs, and rollback state reconciliation. Automatically drops the temporary database upon completion.
   - **Prerequisites:** Requires a native local PostgreSQL instance reachable via loopback `DATABASE_URL` (defaults to port `54322`, or a loopback override like port `5432`). Does **not** require Supabase Auth or PostgREST HTTP APIs.

3. **Deterministic Edge Function and contract tests (47 tests in Deno):**
   - **Offline execution:** Fully offline in CI and local environments without database, Auth, or external network dependencies.
   - **Test distribution (47 tests total):**
     - `demo_recipe_test.ts` (11 deterministic tests): Validates Zod schema against `fixtures/demo-recipe.json`, tests CORS preflight (`204 No Content`), disallowed HTTP methods (`405 METHOD_NOT_ALLOWED`), unapproved recipe rejection (`404`), and safe internal error envelopes (`500`).
     - `auth_test.ts` (15 deterministic tests): Validates `extractBearerToken()`, `authenticateRequest()`, `GET /auth-session` contract, error classifications (`401 UNAUTHORIZED`, `405 METHOD_NOT_ALLOWED`, `503 AUTH_SERVICE_RATE_LIMITED` with `Retry-After`), caller ID tampering guards, and client PostgREST JWT forwarding.
     - `auth_rls_integration_test.ts` (5 deterministic tests): Validates acceptance of modern `sb_secret_*` keys and legacy service-role JWTs, placeholder and production credential rejection, loopback port `54321` and URL collision safety checks, explicit skip reporting, and client authentication header normalization.
     - `recipes_test.ts` (14 deterministic tests): Validates `CreateRecipeRequestSchema` and `RecipeResponseSchema`, CORS preflight (`204`), disallowed methods (`405`), unsupported routes (`404`), ownership and `is_public` tampering prevention, authentication enforcement (`401`), malformed JSON handling (`400`), and safe database error redaction (`500`).
   - **Execution command:**
     ```sh
     deno test --frozen-lockfile --node-modules-dir=auto --allow-env --allow-read=fixtures/demo-recipe.json supabase/functions/tests/demo_recipe_test.ts supabase/functions/tests/auth_test.ts supabase/functions/tests/auth_rls_integration_test.ts supabase/functions/tests/recipes_test.ts
     ```

4. **Intentionally ignored live integration tests (3 tests across two distinct gates):**
   Live integration tests verify real PostgREST queries and PostgreSQL RLS enforcement. They are split into two completely separate gates with distinct prerequisites:

   - **Gate A: Local Demo Live Integration Test (`supabase/functions/tests/demo_recipe_test.ts`)**
     - **Test:** `GET returns 200 from live PostgreSQL with approved columns and headers (live integration)`.
     - **Prerequisites:** Requires a compatible API endpoint running at the expected local loopback address and port `54321` (e.g. `http://127.0.0.1:54321`) with the seeded public recipe available, plus `SUPABASE_URL` and a valid legacy `service_role` JWT in `SUPABASE_SERVICE_ROLE_KEY`.
     - **Gate isolation:** Hosted project secrets (`BE04_RLS_TEST_*`) **cannot** enable the demo live test. The test runner strictly scrubs and isolates hosted project credentials from the local demo probe, and rejects hosted URLs that attempt to target loopback port `54321`. When a local loopback API on port `54321` is not running, this test is safely ignored by default (`ignore: !hasDbEnv`).

   - **Gate B: Hosted Non-Production RLS Integration Tests (`auth_rls_integration_test.ts` and `recipes_test.ts`)**
     - **Tests:**
       1. Hosted profile RLS test in `supabase/functions/tests/auth_rls_integration_test.ts` (`Live PostgreSQL RLS enforcement on public.profiles allows own-profile reads and blocks cross-user reads (hosted integration)`)
       2. Hosted POST `/recipes` RLS test in `supabase/functions/tests/recipes_test.ts` (`Live PostgreSQL persistence and RLS enforcement for POST /recipes (hosted integration)`)
     - **Prerequisites and supported GitHub Actions secrets:** These two tests require a **dedicated non-production Supabase cloud project** (with the repository schema and RLS policies applied) and the following secrets mapped in `.github/workflows/ci.yml`:
       - `BE04_RLS_TEST_SUPABASE_URL` (`${{ secrets.BE04_RLS_TEST_SUPABASE_URL }}`): Project URL of the dedicated non-production test project (rejected if it matches production ref `gtbwblxskctpsqhbpebg` or loopback port `54321`).
       - `BE04_RLS_TEST_SUPABASE_ANON_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_ANON_KEY }}`): Public key for the dedicated test project. In CI, this is the single mapped public key secret, accepting either a legacy `anon` JWT or a modern `sb_publishable_*` key. (Local runs also accept `BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY` as an optional local environment variable override).
       - `BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY }}`) or `BE04_RLS_TEST_SUPABASE_SECRET_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_SECRET_KEY }}`): Administrative credentials (legacy `service_role` JWT or modern `sb_secret_*` key) used strictly for test user setup and teardown cleanup.
       - `RUN_BE04_RLS_INTEGRATION=true`: Explicit opt-in flag (set automatically in CI when prerequisite secrets are present).
     - **Supported key formats and Supabase client behavior:**
       - *Public / Anon key:* Accepts either a legacy `anon` JWT (`role: "anon"`) or a modern `sb_publishable_*` key. Test clients set `apikey: <key>` and strip any synthetic `Authorization: Bearer <key>` header to preserve user bearer tokens.
       - *Service-role / Secret key:* Accepts either a legacy `service_role` JWT (`role: "service_role"`) or a modern `sb_secret_*` key. Admin test clients set `apikey: <key>` and omit the synthetic bearer header so the opaque secret key is accepted directly by PostgREST and Auth.
     - **Skip behavior:** In GitHub Actions CI and local runs, if these dedicated non-production secrets are missing or target safety prechecks fail, the runner outputs an explicit skip reason and registers the tests as ignored (`0 failed | 2 ignored`). Unexecuted tests are never reported as passed, and production credentials are never used.

### Full local test runner (`pnpm run test:local:all`)

The root command `pnpm run test:local:all` (executing `node run-local-tests.mjs`) orchestrates local database migration lifecycle tests and Edge Function test suites in a single workflow:

```sh
pnpm run test:local:all
```

#### Prerequisites and execution behavior

1. **Native PostgreSQL migration lifecycle:** The runner first executes `node test-migrations.mjs --run-db-tests`, which runs all 13 migration lifecycle integration scenarios against an isolated temporary database created on your native PostgreSQL instance.
2. **Default database port and overrides:** `DATABASE_URL` defaults to port `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), matching the local port configured in `supabase/config.toml` (`[db] port = 54322`). If your native PostgreSQL service runs on port `5432` or uses custom credentials, supply `DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:<port>/postgres"`.
3. **Connection failure behavior:** If the native local database is unreachable (e.g. `ECONNREFUSED 127.0.0.1:54322`), the runner immediately stops execution and propagates exit code `1`. It never silently skips database verification and never falls back to a remote database.
4. **Loopback safety and forwarding limitation:** `isAllowedLoopbackDatabaseUrl` restricts local database testing strictly to loopback hostnames (`127.0.0.1`, `localhost`, `::1`), preventing direct connections to remote database hostnames. However, loopback address validation prevents direct remote connections but cannot detect whether local loopback ports are actively forwarded to an external or remote database via SSH tunnels, port forwarding, or network proxies. Developers must ensure local loopback ports target a native local development database.
5. **Separation of migration tests from live API tests:**
   - **PostgreSQL Migration Tests:** A native PostgreSQL instance satisfies the 13 migration lifecycle integration tests by providing standard PostgreSQL database capabilities.
   - **Supabase Live API Integration Tests:** A native PostgreSQL database alone **does not** provide the Supabase Auth (GoTrue) or PostgREST HTTP APIs required by live API tests.
   - The runner evaluates the local demo API probe on loopback port `54321` and evaluates hosted RLS test prerequisites independently. In the absence of dedicated non-production cloud credentials or local loopback API services, the runner safely skips the live tests, logs explicit skip explanations, and executes all 47 deterministic offline tests without error.
6. **Standalone unit testing without database connectivity:** When a local PostgreSQL service is not available, developers can execute offline unit and schema checks without database connectivity:
   - Migration unit tests: `pnpm test` (or `node test-migrations.mjs`) verifies migration discovery, sorting, and schema assertions without connecting to PostgreSQL.
   - Edge Function deterministic tests:
     ```sh
     deno test --frozen-lockfile --node-modules-dir=auto --allow-env --allow-read=fixtures/demo-recipe.json supabase/functions/tests/demo_recipe_test.ts supabase/functions/tests/auth_test.ts supabase/functions/tests/auth_rls_integration_test.ts supabase/functions/tests/recipes_test.ts
     ```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Database connection failed (`ECONNREFUSED 127.0.0.1:54322` or `127.0.0.1:5432`) | Verify that your native local PostgreSQL service is running. If your instance runs on port 5432 or requires specific user credentials, export `DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:<port>/postgres"`. |
| A local port is already in use | Verify which service is using the port with `netstat` or `lsof`, and either stop the conflicting process or configure native PostgreSQL and `DATABASE_URL` to an available port. |
| The function URL returns a generic 404 or the browser cannot reach it | Verify `supabase functions serve demo-recipe` is running and use `http://127.0.0.1:54321` as `VITE_SUPABASE_URL`. |
| The function response has status `404` and JSON `error.code` is `DEMO_RECIPE_NOT_FOUND` | Ensure `supabase/seed.sql` has been applied to your database via `psql "$DATABASE_URL" -f supabase/seed.sql`. |
| The frontend reports missing configuration | Check the `VITE_` variable names and restart Vite after editing `frontend/.env.local`. Use only a publishable/anon key in this file. |
| The browser reports a CORS error after changing the frontend origin | The function allows all origins by default. If `ALLOWED_ORIGIN` is set for local function serving, set it to the exact frontend origin and restart the function. |

Gemini credentials are only needed for the separate backend AI connectivity check. Keep those credentials in a server-side environment and never put them in a `VITE_` variable.
