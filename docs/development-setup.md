# Local development and troubleshooting

This guide uses the local Supabase stack for app development and documents standalone PostgreSQL as an optional path for database tests. The local stack provides the Auth and PostgREST services used by the app; deterministic checks can also run without it.

## Prerequisites

- [Node.js 24](https://nodejs.org/en/download) and pnpm 10 (`npm install --global pnpm@10`; see the [pnpm 10 installation guide](https://pnpm.io/10.x/installation))
- Supabase CLI 2.x: the standard local development stack uses Docker Desktop or another Docker-compatible runtime. Local authenticated E2E pins CLI 2.122.0 and uses its native experimental runtime on Linux `amd64`/`arm64` or macOS 14+ on Apple silicon; it needs `tar` and network access to download service artifacts, but not Docker. Windows and Intel Mac contributors should use the existing Ubuntu E2E job in GitHub Actions. See the [Supabase native runtime guide](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes).
- [Deno](https://deno.land/) (for running Edge Function deterministic and integration test suites)
- Standalone PostgreSQL 15+ on loopback (`127.0.0.1` or `localhost`) only if you choose not to use the local Supabase database for migration lifecycle tests

## Start local Supabase

From the repository root, start the local database, Auth, and API services:

```sh
supabase start
```

The first start downloads the local service images, applies migrations in `supabase/migrations/`, and loads `supabase/seed.sql`. Use `supabase status` to see the local URLs and keys. The publishable/anon key can be used by the frontend; never copy the service-role/secret key into frontend configuration or share the full status output.

To recreate a clean local database and replay migrations and seed data, run:

```sh
supabase db reset --local
```

This deletes local database data first. Keep `--local`; never run `supabase db reset --linked` against a shared or production project.

## Optional standalone PostgreSQL testing

The local Supabase database is available on loopback port `54322` by default and can be used for migration lifecycle tests. If you prefer a separately installed local PostgreSQL service, use a loopback `DATABASE_URL` override:

1. **Service configuration:** Ensure your native PostgreSQL instance is running on loopback (`127.0.0.1` or `localhost`).
2. **Default connection settings:** The test runner defaults `DATABASE_URL` to port `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), matching the local Supabase database port configured in `supabase/config.toml` (`[db] port = 54322`).
3. **Loopback connection overrides:** If your standalone PostgreSQL installation listens on standard port `5432` or uses different credentials, provide a loopback `DATABASE_URL` override in your environment:
   ```sh
   export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
   ```
   In PowerShell:
   ```powershell
   $env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
   ```
4. **Applying migrations:** For a standalone database, apply versioned SQL migrations in `supabase/migrations/` with the project migration runner:
   ```sh
   pnpm db:setup
   ```
   This executes `node run-migrations.mjs`, which validates schema definitions, acquires an advisory lock, executes migrations deterministically in timestamp order, and tracks applied versions in `schema_migrations`.
5. **Demo seed data:** The local Supabase stack loads demo data from `supabase/seed.sql` automatically. For a standalone database, apply it with standard PostgreSQL tools (`psql`) if you need the demo record:
   ```sh
   psql "$DATABASE_URL" -f supabase/seed.sql
   ```
   Do not execute seed scripts against production databases.

## Starting the app and frontend

1. **Serve the Edge Functions:**
   ```sh
   supabase functions serve
   ```
2. **Configure and start the frontend:**
   In another terminal, configure and launch the Vite development server:
   ```sh
   cd frontend
   pnpm install --frozen-lockfile
   cp .env.example .env.local
   ```
   (In PowerShell: `Copy-Item .env.example .env.local`).
   Set `VITE_SUPABASE_URL` to `http://127.0.0.1:54321` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) to the corresponding local public key shown by `supabase status`. Never add service-role or secret keys to frontend configuration.
   Start Vite:
   ```sh
   pnpm dev
   ```
   Open the printed URL (normally `http://localhost:5173`).

## Authenticated recipe and ownership browser journeys

The Playwright journeys sign in through the UI with dedicated synthetic local accounts. They exercise recipe create, read, update, rating, persistence, delete, and ownership isolation through the application and authenticated Edge Function. The frontend package pins Supabase CLI 2.122.0 and Playwright 1.64.1. The runner explicitly uses Supabase's native experimental stack runtime, so these journeys do not need Docker on supported Linux or Apple silicon macOS hosts.

From the repository root, install the pinned tools and Chromium, then run:

```sh
pnpm install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend exec playwright install chromium
pnpm --dir frontend run test:e2e:local
```

The command prepares a dedicated Supabase project in the ignored `.e2e-supabase/` workdir, starts it with `--runtime native`, applies the repository migrations, prepares or reuses `fs03-playwright@example.test` and `fs03-playwright-other@example.test` through the local Auth admin API, starts `supabase functions serve recipes` against that workdir, waits for the handler's unauthenticated response, and starts Vite on `127.0.0.1:4173`. The readiness check expects the recipe handler's 401 response, so it does not mistake the gateway's pre-existing function route for a ready handler. On success, setup/test failure, or SIGINT/SIGTERM, the runner stops the function server's process group and runs `supabase stack stop` for this E2E workdir only. Stopping the stack preserves its local data; the runner never stops all Supabase stacks, resets the database, or destroys the E2E stack. This project has its own stable local project ID and Supabase CLI assigns it separate API, database, Studio, and mail ports. It does not attach to or stop the developer's regular Supabase stack. The generated local service key stays in the setup process and the runner refuses a non-loopback Supabase URL. Playwright and Vite receive only an allowlisted process environment, the local Supabase URL and its public key; Vite reads from a separate empty env directory and does not load the developer's `.env.local`. The journeys do not use hosted credentials or invoke Gemini. Playwright retains a trace, screenshot, and video on failure; CI uploads those files as an artifact.

The synthetic accounts remain in the dedicated E2E Auth database for reuse. The runner stores their returned Auth user IDs in the ignored E2E workdir and updates only those accounts on later runs. Each recipe title starts with `FS-03 Playwright` or `FS-03 Ownership` and includes a fresh UUID; successful journeys delete their recipes, while a failed run may leave uniquely named data in the isolated E2E collection.

If forced termination or a machine shutdown prevents cleanup from completing, stop only the E2E stack from the frontend directory:

```sh
cd frontend
export SUPABASE_EXPERIMENTAL_STACK=1
pnpm exec supabase --workdir ../.e2e-supabase stack stop
```

To inspect leftover recipes, start the E2E stack with `stack start --runtime native`, point the local app at its URL and public key from `stack status`, then sign in with the synthetic account that owns the recipe and delete recipes named `FS-03 Playwright <UUID>` or `FS-03 Ownership <UUID>`. To intentionally remove all E2E Auth and recipe data, run `pnpm exec supabase --workdir ../.e2e-supabase stack destroy --yes`; this is destructive and is never run automatically. Do not use `--all` or run the destroy command outside the dedicated E2E workdir.

## Migrations and schema management

The local Supabase stack applies versioned migrations in `supabase/migrations/` on start and when reset locally. For standalone PostgreSQL, use `pnpm db:setup` (`node run-migrations.mjs`). Never run destructive reset commands against remote or production projects. For approved remote schema updates, preview and apply migrations with `supabase db push --dry-run --linked` and `supabase db push --linked`.

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
   - **Local PostgreSQL execution:** Runs all 13 migration lifecycle integration scenarios against the local database configured by `DATABASE_URL` (the local Supabase database or a standalone PostgreSQL service).
   - **Verification:** Dynamically provisions an isolated temporary database (`test_mig_suite_<timestamp>_<random>`), verifies initial schema creation, column data types, nullability, constraints, indexes, triggers, functions, RLS policies, advisory locks, idempotency across repeated runs, and rollback state reconciliation. Automatically drops the temporary database upon completion.
   - **Prerequisites:** Requires a local PostgreSQL instance reachable via loopback `DATABASE_URL` (defaults to port `54322`, or a loopback override like port `5432`). Does **not** require Supabase Auth or PostgREST HTTP APIs.

3. **Deterministic Edge Function and contract tests (48 tests in Deno):**
   - **Offline execution:** Fully offline in CI and local environments without database, Auth, or external network dependencies.
   - **Test distribution (48 tests total):**
     - `demo_recipe_test.ts` (11 deterministic tests): Validates Zod schema against `fixtures/demo-recipe.json`, tests CORS preflight (`204 No Content`), disallowed HTTP methods (`405 METHOD_NOT_ALLOWED`), unapproved recipe rejection (`404`), and safe internal error envelopes (`500`).
     - `auth_test.ts` (15 deterministic tests): Validates `extractBearerToken()`, `authenticateRequest()`, `GET /auth-session` contract, error classifications (`401 UNAUTHORIZED`, `405 METHOD_NOT_ALLOWED`, `503 AUTH_SERVICE_RATE_LIMITED` with `Retry-After`), caller ID tampering guards, and client PostgREST JWT forwarding.
     - `auth_rls_integration_test.ts` (7 deterministic tests): Validates hosted RLS credential and HTTPS target safety, production and URL-collision rejection, explicit skip reporting, client authentication header normalization, and cleanup error handling.
     - `recipes_test.ts` (15 deterministic tests): Validates `CreateRecipeRequestSchema` and `RecipeResponseSchema`, CORS preflight (`204`), disallowed methods (`405`), unsupported routes (`404`), ownership and `is_public` tampering prevention, authentication enforcement (`401`), malformed JSON handling (`400`), hosted RLS target HTTPS enforcement, and safe database error redaction (`500`).
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
     - **Prerequisites and supported GitHub Actions secrets:** These tests require a **dedicated non-production Supabase cloud project** with the repository schema and RLS migrations applied; CI applies pending migrations when the database URL is configured. Configure the following in `.github/workflows/ci.yml` or the modular PR caller/reusable Edge/API workflow:
       - `BE04_RLS_TEST_SUPABASE_URL` (`${{ secrets.BE04_RLS_TEST_SUPABASE_URL }}`): Project URL of the dedicated non-production test project (rejected if it matches production ref `gtbwblxskctpsqhbpebg` or loopback port `54321`).
       - `BE04_RLS_TEST_SUPABASE_ANON_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_ANON_KEY }}`): Public key for the dedicated test project. In CI, this is the single mapped public key secret, accepting either a legacy `anon` JWT or a modern `sb_publishable_*` key. (Local runs also accept `BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY` as an optional local environment variable override).
       - `BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY }}`) or `BE04_RLS_TEST_SUPABASE_SECRET_KEY` (`${{ secrets.BE04_RLS_TEST_SUPABASE_SECRET_KEY }}`): Administrative credentials (legacy `service_role` JWT or modern `sb_secret_*` key) used strictly for test user setup and teardown cleanup.
       - `BE04_RLS_TEST_EXPECTED_PROJECT_REF` (`${{ vars.BE04_RLS_TEST_EXPECTED_PROJECT_REF || secrets.BE04_RLS_TEST_EXPECTED_PROJECT_REF }}`): Expected Supabase project reference to verify the target URL and database connection string.
       - `BE04_RLS_TEST_DATABASE_URL` (`${{ secrets.BE04_RLS_TEST_DATABASE_URL }}`): Dedicated test project database connection string, used by `run-migrations.mjs --test-target` before the hosted suite to apply pending migrations and reload PostgREST schema cache.
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

1. **Local PostgreSQL migration lifecycle:** The runner first executes `node test-migrations.mjs --run-db-tests`, which runs all 13 migration lifecycle integration scenarios against an isolated temporary database created on the local PostgreSQL instance configured by `DATABASE_URL`.
2. **Default database port and overrides:** `DATABASE_URL` defaults to port `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), matching the local port configured in `supabase/config.toml` (`[db] port = 54322`). If your native PostgreSQL service runs on port `5432` or uses custom credentials, supply `DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:<port>/postgres"`.
3. **Connection failure behavior:** If the native local database is unreachable (e.g. `ECONNREFUSED 127.0.0.1:54322`), the runner immediately stops execution and propagates exit code `1`. It never silently skips database verification and never falls back to a remote database.
4. **Loopback safety and forwarding limitation:** `isAllowedLoopbackDatabaseUrl` restricts local database testing strictly to loopback hostnames (`127.0.0.1`, `localhost`, `::1`), preventing direct connections to remote database hostnames. However, loopback address validation prevents direct remote connections but cannot detect whether local loopback ports are actively forwarded to an external or remote database via SSH tunnels, port forwarding, or network proxies. Developers must ensure local loopback ports target a native local development database.
5. **Separation of migration tests from live API tests:**
   - **PostgreSQL Migration Tests:** The local Supabase database or a standalone PostgreSQL instance satisfies the 13 migration lifecycle integration tests by providing standard PostgreSQL database capabilities.
   - **Supabase Live API Integration Tests:** A standalone PostgreSQL database alone **does not** provide the Supabase Auth (GoTrue) or PostgREST HTTP APIs required by live API tests.
   - The runner evaluates the local demo API probe on loopback port `54321` and evaluates hosted RLS test prerequisites independently. In the absence of dedicated non-production cloud credentials or local loopback API services, the runner safely skips the live tests, logs explicit skip explanations, and executes all 48 deterministic offline tests without error.
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
