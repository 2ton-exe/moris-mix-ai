# Local development and troubleshooting

This guide uses the local Supabase stack for app development and documents standalone PostgreSQL as an optional path for database tests. The local stack provides the Auth and PostgREST services used by the app; deterministic checks can also run without it.

The local recipe and demo flows use local Supabase keys and do not require hosted Supabase, Gemini, or R2 credentials. AI extraction and generation each need an optional Gemini API key. Image upload, attachment, and private-read requests require server-side R2 configuration; image deletion only clears the association and queues cleanup, while physical cleanup needs R2. Neither is required to start the app or use recipe CRUD and the public demo. See the [AI API guide](api/ai-integration.md) and [recipe image API guide](api/recipe-images.md) before enabling either integration locally.

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
   The CLI automatically loads `supabase/functions/.env` when it exists (or a file passed with `--env-file`). AI endpoints are **off by default** (AI-05 and AI-06); create this gitignored file only if you want to exercise them locally:

   ```sh
   # Required: allow POST /extract-recipe and POST /generate-recipe.
   # These local opt-ins do not change production settings.
   AI_EXTRACT_ENABLED=true
   AI_GENERATE_ENABLED=true
   # development or test permits the demo-only failure drills; production ignores them.
   AI_ENVIRONMENT=development
   # Needed to reach Gemini when you actually exercise extraction or generation.
   GEMINI_API_KEY=your_gemini_api_key_here
   # AI-07: signs generation candidate tokens; at least 32 characters.
   # Generate one with: openssl rand -base64 48
   AI_CANDIDATE_TOKEN_SECRET=your_dev_candidate_token_secret_at_least_32_chars
   ```

   Without the matching opt-in, the endpoint answers `503 AI_DISABLED` and the app treats that AI feature as temporarily unavailable. Generation also fails closed with `500 INTERNAL_ERROR` when `AI_CANDIDATE_TOKEN_SECRET` is missing or shorter than 32 characters, because the save path could not enforce candidate membership. Never set `AI_ENVIRONMENT=development` or any `AI_SIMULATE_*` switch in production; see `docs/api/ai-integration.md` for the full switch list and the drill procedure.
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

## Authenticated recipe and AI browser journeys

The Playwright journeys sign in through the UI with synthetic local accounts. They cover recipe CRUD and ownership isolation, Chef generation with selected lineage, malformed and provider failure recovery, and extraction preview followed by an explicit save. The frontend package pins Supabase CLI 2.122.0 and Playwright 1.64.1. On supported Linux or Apple silicon macOS hosts, the runner uses Supabase's native experimental runtime and does not need Docker.

From the repository root, install the pinned tools and Chromium, then run:

```sh
pnpm install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend exec playwright install chromium
pnpm --dir frontend run test:e2e:local
```

Each run prepares the dedicated project in the ignored `.e2e-supabase/` workdir, starts it with `--runtime native`, and resets its database with the repository migrations and seed. It then creates the synthetic accounts through the local Auth admin API, serves the recipes, extraction, and generation functions, and starts Vite on `127.0.0.1:4173`. The extraction and generation functions use test-only mocked providers. The journeys do not use hosted credentials, Gemini, or R2. The project has a stable local ID and separate API, database, Studio, and mail ports. It does not attach to or stop the developer's regular Supabase stack.

The runner checks that the function handlers respond before Playwright starts. It expects `401` from the recipes handler and `405` from the extraction and generation handlers, so the Supabase gateway cannot be mistaken for a ready handler. Playwright and Vite receive an allowlisted environment with only the local Supabase URL and public key. Vite reads from a separate empty env directory and does not load the developer's `.env.local`. The generated local service key stays in the setup process, and the runner refuses a non-loopback Supabase URL. On success, failure, or SIGINT/SIGTERM, the runner stops its function-server process group and only this E2E stack. Stopping the stack preserves its data; the next run resets that database. Playwright retains a trace, screenshot, and video on failure. CI uploads those files as an artifact.

The runner stores the synthetic accounts' Auth user IDs in the ignored E2E workdir. After each database reset, it recreates the accounts and updates the ID files. Test recipe titles include fresh UUIDs. A failed run may leave uniquely named rows in the isolated E2E database; the next run resets it.

If forced termination or a machine shutdown prevents cleanup from completing, stop only the E2E stack from the frontend directory:

```sh
cd frontend
export SUPABASE_EXPERIMENTAL_STACK=1
pnpm exec supabase --workdir ../.e2e-supabase stack stop
```

To inspect leftover recipes before the next run, start the E2E stack with `stack start --runtime native`, point the local app at its URL and public key from `stack status`, then sign in with the synthetic account that owns the recipe. To intentionally remove all E2E Auth and recipe data, run `pnpm exec supabase --workdir ../.e2e-supabase stack destroy --yes`; this is destructive and is never run automatically. Do not use `--all` or run the destroy command outside the dedicated E2E workdir.

## Migrations and schema management

The local Supabase stack applies versioned migrations in `supabase/migrations/` on start and when reset locally. For standalone PostgreSQL, use `pnpm db:setup` (`node run-migrations.mjs`). Never run destructive reset commands against remote or production projects. Production schema changes use the separately managed database release process. A merge to `main` deploys Edge Functions but does not apply migrations. Do not use `supabase db push --linked` as a production migration path.

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

Use separate commands for migration checks, database lifecycle checks, function checks, and live integration:

1. **Migration unit tests (`node test-migrations.mjs` or `pnpm test`):**
   - **Offline execution:** Runs completely offline without database connectivity.
   - **Verification:** Discovers versioned migration files in `supabase/migrations/`, asserts deterministic ascending timestamp sorting, checks filename integrity, validates schema completeness definitions, and tests SQL migration parsing.

2. **Database-backed migration lifecycle integration tests (`node test-migrations.mjs --run-db-tests` or `pnpm run test:lifecycle`):**
   - **Local PostgreSQL execution:** Runs the migration lifecycle scenarios against the local database configured by `DATABASE_URL` (the local Supabase database or a standalone PostgreSQL service).
   - **Verification:** Dynamically provisions an isolated temporary database (`test_mig_suite_<timestamp>_<random>`), verifies initial schema creation, column data types, nullability, constraints, indexes, triggers, functions, RLS policies, advisory locks, idempotency across repeated runs, and rollback state reconciliation. Automatically drops the temporary database upon completion.
   - **Prerequisites:** Requires a local PostgreSQL instance reachable via loopback `DATABASE_URL` (defaults to port `54322`, or a loopback override like port `5432`). Does **not** require Supabase Auth or PostgREST HTTP APIs.

3. **Deterministic Edge Function and contract tests:**
   The CI command type-checks the implemented handlers and runs the maintained deterministic test list. The suite covers authentication, recipe CRUD and lineage, AI schemas and provider journeys, quotas, and image lifecycle handlers. These checks use local fixtures and mocks; they do not call Gemini or R2. See the [reusable Edge/API workflow](../.github/workflows/reusable-edge-api.yml) for the current Deno version, permissions, and test-file list.

4. **Live integration test gates (Gates A, B, and C):**
   Live integration tests verify real PostgREST queries and PostgreSQL RLS enforcement. They are split into three completely separate gates with distinct prerequisites and failure semantics:

   - **Gate A: Local Demo Live Integration Test (`supabase/functions/tests/demo_recipe_test.ts`)**
     - **Test:** `GET returns 200 from live PostgreSQL with approved columns and headers (live integration)`.
     - **Prerequisites:** Requires a compatible API endpoint running at the expected local loopback address and port `54321` (e.g. `http://127.0.0.1:54321`) with the seeded public recipe available, plus `SUPABASE_URL` and a valid legacy `service_role` JWT in `SUPABASE_SERVICE_ROLE_KEY`.
     - **Gate isolation:** Hosted project secrets (`NON_PRODUCTION_TEST_DATABASE_*`) **cannot** enable the demo live test. The test runner strictly scrubs and isolates hosted project credentials from the local demo probe, and rejects hosted URLs that attempt to target loopback port `54321`. When a local loopback API on port `54321` is not running, this test is safely ignored by default (`ignore: !hasDbEnv`).

   - **Gate B: Optional Hosted Non-Production Test Database RLS Integration Tests (`auth_rls_integration_test.ts`, `recipes_test.ts`, and `recipe_context_test.ts`)**
     - **Tests:**
       1. Hosted profile RLS test in `supabase/functions/tests/auth_rls_integration_test.ts` (`Live PostgreSQL RLS enforcement on public.profiles allows own-profile reads and blocks cross-user reads (hosted integration)`)
       2. Hosted POST `/recipes` RLS test in `supabase/functions/tests/recipes_test.ts` (`Live PostgreSQL persistence and RLS enforcement for recipe CRUD (hosted integration)`)
       3. Hosted Chef recipe-context ownership test in `supabase/functions/tests/recipe_context_test.ts` (`Live PostgreSQL cross-user RLS isolation for AI Chef recipe context retrieval (hosted integration)`)
     - **Prerequisites and supported GitHub Actions secrets:** These tests run optionally within the `test-edge-api` job and require a **dedicated non-production Supabase cloud project** with the repository schema and RLS migrations applied; CI applies pending migrations when `NON_PRODUCTION_TEST_DATABASE_URL` is configured:
       - `NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL }}`): Project URL of the dedicated non-production test project (rejected if it matches production ref `gtbwblxskctpsqhbpebg` or loopback port `54321`).
       - `NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY }}`): Public key for the dedicated test project. It accepts either a legacy `anon` JWT or a modern `sb_publishable_*` key. CI workflows and local runners also support `NON_PRODUCTION_TEST_DATABASE_SUPABASE_PUBLISHABLE_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_PUBLISHABLE_KEY }}`).
       - `NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY }}`) or `NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY }}`): Administrative credentials (legacy `service_role` JWT or modern `sb_secret_*` key) used strictly for test user setup and teardown cleanup.
       - `NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF` (`${{ vars.NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF || secrets.NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF || vars.NON_PRODUCTION_TEST_DATABASE_PROJECT_REF || secrets.NON_PRODUCTION_TEST_DATABASE_PROJECT_REF }}`): Expected Supabase project reference to verify the target URL and database connection string (supports `NON_PRODUCTION_TEST_DATABASE_PROJECT_REF` variable/secret fallback).
       - `NON_PRODUCTION_TEST_DATABASE_URL` (`${{ secrets.NON_PRODUCTION_TEST_DATABASE_URL }}`): Dedicated test project database connection string, used by `run-migrations.mjs --test-target` before the hosted suite to apply pending migrations and reload PostgREST schema cache.
       - `RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION=true`: Explicit opt-in flag (set automatically in CI when prerequisite secrets are present).
     - **Supported key formats and Supabase client behavior:**
       - *Public / Anon key:* Accepts either a legacy `anon` JWT (`role: "anon"`) or a modern `sb_publishable_*` key. Test clients set `apikey: <key>` and strip any synthetic `Authorization: Bearer <key>` header to preserve user bearer tokens.
       - *Service-role / Secret key:* Accepts either a legacy `service_role` JWT (`role: "service_role"`) or a modern `sb_secret_*` key. Admin test clients set `apikey: <key>` and omit the synthetic bearer header so the opaque secret key is accepted directly by PostgREST and Auth.
     - **Skip behavior:** In GitHub Actions CI and local runs, if these dedicated non-production secrets are missing or target safety prechecks fail, the runner outputs an explicit skip reason and registers the unrun tests as ignored. Unexecuted tests are never reported as passed, and production credentials are never used.

   - **Gate C: Hosted RLS Integration Gate (`cross_user_rls_lineage_test.ts` and `recipe_context_test.ts`)**
     - **Job:** `test-hosted-rls` (named **"Hosted RLS Integration"**) in `.github/workflows/reusable-edge-api.yml`, called by modular PR/main validation.
     - **Shared test project:** Gate C uses the same dedicated non-production project and `NON_PRODUCTION_TEST_DATABASE_*` credentials as Gate B. The job waits for `test-edge-api` to finish so its optional migration step completes before the lineage scenario runs. No separate BE-07 credential secrets are needed.
     - **Required deployment gate:** The modular main workflow calls the reusable Edge/API workflow with `require-hosted-rls: true`. Production depends on that workflow, so its hosted RLS job must pass before deployment proceeds.
     - **Execution command & test filter:**
       ```sh
       deno test --frozen-lockfile --node-modules-dir=auto --allow-env --allow-net --filter "hosted integration" supabase/functions/tests/cross_user_rls_lineage_test.ts supabase/functions/tests/recipe_context_test.ts
       ```
     - **Scenarios:** The hosted filter runs live checks for cross-user recipe and lineage access, AI quota atomicity and RLS, and Chef recipe-context isolation. Deno filters out tests that do not match `hosted integration`.
     - **Fail-closed gate behavior:**
       The workflow exports `REQUIRE_HOSTED_RLS_INTEGRATION="true"`. Main push and manual runs require the shared `NON_PRODUCTION_TEST_DATABASE_*` credentials and fail closed if a required value is missing. The separate hosted job runs only on `main` and is skipped for PRs; optional hosted integration steps inside Edge/API retain their existing behavior. For a local opt-in, set `RUN_BE07_RLS_INTEGRATION=true` to run the cross-user, lineage, quota, and Chef recipe-context checks against the same non-production test database.
     - **Required credentials and configuration:**
       Configure the `NON_PRODUCTION_TEST_DATABASE_*` secrets and expected project reference listed under Gate B. The lineage test uses the same target safety checks and does not accept a separate BE-07 key namespace.
     - **Security and target safety rules:**
       - Credentials must never be committed to source control or printed in CI logs.
       - A dedicated non-production Supabase project must always be used.
       - Target safety guards verify HTTPS, reject loopback/localhost targets, and reject known production project references.

### Full local test runner (`pnpm run test:local:all`)

The root command `pnpm run test:local:all` (executing `node run-local-tests.mjs`) runs migration lifecycle tests and a selected Edge Function suite in one workflow:

```sh
pnpm run test:local:all
```

#### Prerequisites and execution behavior

1. **Local PostgreSQL migration lifecycle:** The runner first executes `node test-migrations.mjs --run-db-tests`, which runs the migration lifecycle scenarios against an isolated temporary database created on the local PostgreSQL instance configured by `DATABASE_URL`.
2. **Default database port and overrides:** `DATABASE_URL` defaults to port `54322` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), matching the local port configured in `supabase/config.toml` (`[db] port = 54322`). If your native PostgreSQL service runs on port `5432` or uses custom credentials, supply `DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:<port>/postgres"`.
3. **Connection failure behavior:** If the native local database is unreachable (e.g. `ECONNREFUSED 127.0.0.1:54322`), the runner immediately stops execution and propagates exit code `1`. It never silently skips database verification and never falls back to a remote database.
4. **Loopback safety and forwarding limitation:** `isAllowedLoopbackDatabaseUrl` restricts local database testing strictly to loopback hostnames (`127.0.0.1`, `localhost`, `::1`), preventing direct connections to remote database hostnames. However, loopback address validation prevents direct remote connections but cannot detect whether local loopback ports are actively forwarded to an external or remote database via SSH tunnels, port forwarding, or network proxies. Developers must ensure local loopback ports target a native local development database.
5. **Separation of migration tests from live API tests:**
   - **PostgreSQL Migration Tests:** The local Supabase database or a standalone PostgreSQL instance provides the PostgreSQL capabilities required by the migration lifecycle tests.
   - **Supabase Live API Integration Tests:** A standalone PostgreSQL database alone **does not** provide the Supabase Auth (GoTrue) or PostgREST HTTP APIs required by live API tests.
   - The runner checks the local demo API and hosted RLS prerequisites independently. It skips live checks when safe local or dedicated non-production credentials are unavailable. The Deno command in `run-local-tests.mjs` runs selected demo, authentication, recipe, lineage, and Chef context tests. It does not run the complete deterministic Edge/API suite.
6. **Checks without a local database:** Run `pnpm test` for migration discovery, ordering, and schema assertions. Run the deterministic Deno command from the [reusable Edge/API workflow](../.github/workflows/reusable-edge-api.yml) for the complete function and contract suite.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Database connection failed (`ECONNREFUSED 127.0.0.1:54322` or `127.0.0.1:5432`) | Verify that your native local PostgreSQL service is running. If your instance runs on port 5432 or requires specific user credentials, export `DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:<port>/postgres"`. |
| A local port is already in use | Verify which service is using the port with `netstat` or `lsof`, and either stop the conflicting process or configure native PostgreSQL and `DATABASE_URL` to an available port. |
| The function URL returns a generic 404 or the browser cannot reach it | Verify `supabase functions serve demo-recipe` is running and use `http://127.0.0.1:54321` as `VITE_SUPABASE_URL`. |
| The function response has status `404` and JSON `error.code` is `DEMO_RECIPE_NOT_FOUND` | Ensure `supabase/seed.sql` has been applied to your database via `psql "$DATABASE_URL" -f supabase/seed.sql`. |
| The frontend reports missing configuration | Check the `VITE_` variable names and restart Vite after editing `frontend/.env.local`. Use only a publishable/anon key in this file. |
| The browser reports a CORS error after changing the frontend origin | The function allows all origins by default. If `ALLOWED_ORIGIN` is set for local function serving, set it to the exact frontend origin and restart the function. |

Gemini credentials are required when you exercise the Gemini-backed extraction or generation endpoints, or run the connectivity check. Keep them server-side; never put them in a `VITE_` variable.
