# Sprint 1 Architecture Decision Record

**Status:** Draft for team review

**Scope:** Target architecture and development conventions for the Sprint 1 walking skeleton.

The Sprint 1 application path is a React frontend calling one public demo endpoint that reads non-sensitive seeded data from PostgreSQL.

## Target architecture

```text
Browser (React/Vite/TypeScript app on Cloudflare Workers)
└── GET /functions/v1/demo-recipe (public JSON endpoint)
    └── Supabase Edge Function
        ├── Validate the request and enforce the public-demo access policy
        ├── Query only approved, non-sensitive seeded data in PostgreSQL
        └── Return the response defined by the FS-01 contract

Backend-only Gemini connectivity check
└── Supabase Edge Function → AIProvider → Gemini
```

The browser may use Supabase Auth and public client configuration. The demo endpoint does not require a signed-in user. Browser code does not query application tables or call Gemini directly. Service-role credentials and Gemini keys stay on the server. The Gemini check is a controlled backend call and does not run in every CI build.

Version-controlled Supabase migrations define the Sprint 1 recipe and lineage schema, indexes, and RLS. Keep the public demo seed separate and non-sensitive; the endpoint may return only records approved for public demonstration.

## API contract and communication

Document each Edge Function endpoint under `docs/api/`. Its contract must state the method and path, access level, query parameters and body, successful response shape, HTTP status and error codes, CORS behavior, and frontend loading and error behavior.

Use JSON for request and response bodies. Return errors with a stable `error.code` and user-safe `error.message`; never expose secrets, database details, or stack traces. Validate untrusted function input at the boundary with Zod. The Sprint 1 demo route is public and may use the Supabase anon key without a signed-in user. Never put a service-role key in the browser. Restrict the demo query to approved sample rows so it cannot return private user data.

The frontend handles pending requests, successful responses, non-2xx responses, network failures, and invalid JSON. It shows a user-safe, retryable error rather than raw backend details. Handle `OPTIONS` preflight for the configured frontend origin and allow only the methods and headers the endpoint needs.

The demo recipe's full response schema, error table, CORS details, and fixture are maintained in the [FS-01 contract pull request](https://github.com/2ton-exe/moris-mix-ai/pull/30); this ADR does not duplicate that payload schema.

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

Cloudflare Workers serves the frontend's static build. [`wrangler.jsonc`](../../wrangler.jsonc) reads assets from `frontend/dist` and uses single-page application fallback behavior. The [production workflow](../../.github/workflows/deploy.yml) builds the frontend and deploys it with Wrangler after pushes to `main` that touch `frontend/**`, `wrangler.jsonc`, or the workflow file; manual dispatch is also restricted to `main`.

The [CI workflow](../../.github/workflows/ci.yml) and deployment workflow use Node.js 24 and pnpm 10 for frontend installs. The deployment workflow reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub Actions secrets. Do not commit or print their values. This workflow deploys the frontend only; Supabase Edge Functions and database migrations use their own deployment process.

**Current status:** The production workflow skips the build and deploy when `frontend/package.json` is absent. A green workflow before the frontend exists does not confirm a production deployment; verify the first real deployment at the production URL.
