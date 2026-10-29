# Sprint 1 Architecture Decision Record — Sprints 1–3

**Status:** Draft for team review

**Scope:** Target application architecture and development conventions established in Sprint 1 and extended for Sprints 2 and 3. Sprint-by-sprint progress and acceptance evidence belong in the sprint logs.

The target architecture uses a React frontend and Supabase Edge Functions as the boundary for application data. The public demo remains available without sign-in; recipe, AI, and image operations use authenticated server-side handlers.

## Target architecture

```text
Browser (React/Vite/TypeScript app on Cloudflare Workers)
├── GET /functions/v1/demo-recipe (public JSON endpoint)
│   └── Supabase Edge Function → approved public recipe in PostgreSQL
├── Authenticated REST requests (recipes, AI, and image metadata)
│   └── Supabase Edge Function
│       ├── Verify the Bearer token with Supabase Auth
│       ├── Use a user-scoped Supabase client → PostgreSQL with RLS
│       ├── Call Gemini for extraction and Chef generation
│       └── Authorize and verify private R2 image operations
└── Image bytes → private R2 through a short-lived, backend-signed PUT URL
```

The browser may use Supabase Auth and public client configuration. Protected requests carry the active session's access token; Edge Functions verify it and derive identity from the verified user. Route guards support navigation but do not grant backend access. PostgreSQL RLS remains active for user-owned data. The demo endpoint stays public and anonymous. Browser code does not query application tables or call Gemini directly. Service-role credentials, Gemini keys, and R2 signing credentials stay on the server.

Version-controlled Supabase migrations define the recipe, lineage, and AI quota schema, indexes, and RLS. Keep the public demo seed separate and non-sensitive; the endpoint may return only records approved for public demonstration.

## API contract and communication

Document each Edge Function endpoint under `docs/api/`. Its contract must state the method and path, access level, query parameters and body, successful response shape, HTTP status and error codes, CORS behavior, and frontend loading and error behavior.

Use JSON for request and response bodies. Return errors with a stable `error.code` and user-safe `error.message`; never expose secrets, database details, or stack traces. Validate untrusted function input at the boundary with Zod. The Sprint 1 demo route is public and may use the Supabase anon key without a signed-in user. Never put a service-role key in the browser. Restrict the demo query to approved sample rows so it cannot return private user data.

The frontend handles pending requests, successful responses, non-2xx responses, network failures, and invalid JSON. It shows a user-safe, retryable error rather than raw backend details. Handle `OPTIONS` preflight for the configured frontend origin and allow only the methods and headers the endpoint needs.

The demo recipe's full response schema, error table, CORS details, and fixture are maintained in the [FS-01 contract pull request](https://github.com/2ton-exe/moris-mix-ai/pull/30); this ADR does not duplicate that payload schema.

## Authenticated application boundary

- Supabase Auth owns session restoration, refresh, and sign-out. For each protected API request, the frontend reads the current session token and sends it as a Bearer token; it does not create a second auth state or its own refresh mechanism.
- If there is no usable session, protected navigation and requests stop in the shared auth flow. A rejected or expired token follows that flow; an authenticated permission denial remains an access error and does not by itself sign the user out.
- Protected Edge Functions authenticate through the shared server helper, derive the owner from the verified user context, and use a user-scoped Supabase client so PostgreSQL RLS remains in force. Client-supplied owner IDs are never trusted, and user-owned operations do not use a service-role client.
- Recipe CRUD stays behind the authenticated REST API. The public demo remains anonymous and does not receive an Authorization header.
- The authenticated critical browser journey should use an isolated local Supabase stack with real local Auth, Edge Functions, and PostgreSQL/RLS. Test setup uses a dedicated local account and unique data, does not reset a developer's database, and does not depend on production credentials or Gemini.

The reusable authentication contract and protected session endpoint are documented in [`docs/api/auth-session.md`](../api/auth-session.md).

## AI workflows and lineage

- Quick AI Entry and Chef are authenticated Edge Function workflows. The backend bounds and validates input, calls Gemini through the server-side AI provider, validates model output against shared schemas, and returns safe errors. Prompts are versioned; automated checks use injected or mocked providers rather than paid live calls.
- Extraction returns an editable preview only. Creating a recipe uses the existing authenticated recipe API after explicit user confirmation; generation and preview edits do not write recipe or lineage rows.
- Chef retrieval is limited to the signed-in user's eligible saved recipes and ranks candidates deterministically by pantry overlap, rating, and recency. Gemini receives that candidate context. The backend rejects proposed parent IDs outside that context, and the lineage save boundary re-checks that the authenticated user owns the child and every parent.
- AI usage quotas are per user and mutated only by backend operations against `ai_usage_daily`; browser clients have no quota-write access. Quota enforcement must remain safe under concurrent requests.

## Private recipe images

- Keep the recipe image bucket private. The backend authorizes an owned recipe and issues a short-lived, object-specific presigned `PUT`; the browser uploads bytes directly to R2 without receiving storage credentials.
- Follow the image contract's 10-minute URL lifetime, 10 MiB size limit, and JPEG/PNG/WebP allowlist. Before attaching an image, the backend verifies the stored object's actual type and size and checks recipe ownership again.
- Private reads and deletion stay behind authenticated backend operations. A failed or incomplete upload leaves the current image unchanged. After replacement commits, delete only the previous final key recorded by that transaction; after recipe deletion commits, delete only the current final key captured by that transaction. Cleanup of expired staging objects and orphan final keys follows the [image contract](../api/recipe-images.md).

## Folder and package conventions

For Sprint 1, keep each area in its project boundary:

```text
.github/workflows/       CI and deployment workflows

docs/
  api/                   Endpoint contracts
  architecture/          Architecture decisions
  devops/                Deployment and operations documentation

fixtures/                Stable API mock data

frontend/
  src/                   Browser application
  package.json           Frontend dependencies and scripts
  pnpm-workspace.yaml    Frontend workspace definition
  pnpm-lock.yaml         Frontend dependency lockfile

supabase/
  functions/
    _shared/             Code shared by Edge Functions
    tests/               Function tests
    demo-recipe/          Read-only demo endpoint
  migrations/            Database schema changes
  seed.sql                Non-sensitive demo data only

run-migrations.mjs       Repository database tooling
test-rls.mjs             Repository database checks
package.json             Repository tooling dependencies and scripts
pnpm-lock.yaml           Repository tooling dependency lockfile
wrangler.jsonc           Cloudflare Workers configuration
```

The frontend and repository tooling are separate pnpm projects. Run frontend installs from `frontend/` and keep its manifest, workspace file, and lockfile there. Keep repository tooling dependencies and its lockfile at the repository root; do not share or move dependencies between these projects. The [CI workflow](../../.github/workflows/ci.yml) and production workflow are configured to use Node.js 24, pnpm 10, and `pnpm install --frozen-lockfile` from `frontend/` when `frontend/package.json` exists. Install repository tooling from the repository root with the same versions and a frozen lockfile.

## Cloudflare Workers deployment

Cloudflare Workers serves the frontend's static build. [`wrangler.jsonc`](../../wrangler.jsonc) reads assets from `frontend/dist` and uses single-page application fallback behavior. The unified [CI workflow](../../.github/workflows/ci.yml) builds and deploys the frontend with Wrangler on `main` after its required checks succeed.

The [CI workflow](../../.github/workflows/ci.yml) uses Node.js 24 and pnpm 10 for repository tooling and frontend installs. Its gated `deploy` job deploys the `recipes` Edge Function to Supabase before deploying the frontend to Cloudflare. The function step uses `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; the Cloudflare step uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Keep secret values out of Git and logs. Production database migrations remain a separate process.

**Current status:** `frontend/package.json` is present. The production `deploy` job runs only on pushes to `main` or manual `workflow_dispatch` runs on `main`, after `frontend`, `test-db`, `test-edge-api`, and `test-hosted-rls` succeed. It builds the frontend, deploys `recipes` to Supabase, then publishes the static assets to Cloudflare; pull requests skip deployment. The earlier behavior that skipped build and deployment when the frontend package was absent is historical. The first successful run of this production path remains unverified.
