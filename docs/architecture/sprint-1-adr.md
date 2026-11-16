# Sprint 1 Architecture Decision Record — Sprints 1–3

**Status:** Draft for team review

**Scope:** Target application architecture and development conventions established in Sprint 1 and extended for Sprints 2 and 3. Sprint-by-sprint progress and acceptance evidence belong in the sprint logs.

The application uses a React frontend and Supabase Edge Functions as the boundary for application data. The public demo remains available without sign-in; recipe, AI, and image operations use authenticated server-side handlers.

## Architecture

```text
Browser (React/Vite/TypeScript app on Cloudflare Workers)
├── GET /functions/v1/demo-recipe (public JSON endpoint)
│   └── Supabase Edge Function → approved public recipe in PostgreSQL
├── Authenticated REST requests (recipes, AI, and image metadata)
│   └── Supabase Edge Function
│       ├── Verify the Bearer token with Supabase Auth
│       ├── Use a user-scoped Supabase client → PostgreSQL with RLS
│       ├── Call Gemini for extraction and Chef generation
│       ├── Authorize and verify private R2 image operations
│       └── Resolve owned images and sign short-lived private R2 GET URLs
└── Image bytes → short-lived presigned R2 PUT → private R2
    └── Browser reads image bytes through a short-lived signed GET URL
```

The browser may use Supabase Auth and public client configuration. Protected requests carry the active session's access token; Edge Functions verify it and derive identity from the verified user. Route guards support navigation but do not grant backend access. PostgreSQL RLS remains active for user-owned data. The demo endpoint stays public and anonymous. Browser code does not query application tables or call Gemini directly. Service-role credentials, Gemini keys, and R2 secret signing keys stay on the server; the non-secret R2 access-key ID appears inside presigned URLs.

Version-controlled Supabase migrations define the recipe, lineage, and AI quota schema, indexes, and RLS. Keep the public demo seed separate and non-sensitive; the endpoint may return only records approved for public demonstration.

## API contract and communication

Document each Edge Function endpoint under `docs/api/`. Its contract must state the method and path, access level, query parameters and body, successful response shape, HTTP status and error codes, CORS behavior, and frontend loading and error behavior.

Use JSON for request and response bodies, except the recipe-image upload PUT request, which carries raw JPEG, PNG, or WebP bytes under the image API contract. Return errors with a stable `error.code` and user-safe `error.message`; never expose secrets, database details, or stack traces. Validate untrusted function input at the boundary with Zod. The Sprint 1 demo route is public and may use the Supabase anon key without a signed-in user. Never put a service-role key in the browser. Restrict the demo query to approved sample rows so it cannot return private user data.

The frontend handles pending requests, successful responses, non-2xx responses, network failures, and invalid JSON. It shows a user-safe, retryable error rather than raw backend details. Handle `OPTIONS` preflight for the configured frontend origin and allow only the methods and headers the endpoint needs.

The demo recipe's full response schema, error table, CORS details, and fixture are maintained in the [FS-01 contract pull request](https://github.com/2ton-exe/moris-mix-ai/pull/30); this ADR does not duplicate that payload schema.

## Authenticated application boundary

- Supabase Auth owns session restoration, refresh, and sign-out. For each protected API request, the frontend reads the current session token and sends it as a Bearer token; it does not create a second auth state or its own refresh mechanism.
- If there is no usable session, protected navigation and requests stop in the shared auth flow. A rejected or expired token follows that flow; an authenticated permission denial remains an access error and does not by itself sign the user out.
- Protected Edge Functions authenticate through the shared server helper, derive the owner from the verified user context, and use a user-scoped Supabase client for user-owned reads and ordinary CRUD so PostgreSQL RLS remains in force. Client-supplied owner IDs are never trusted. Service-role access is limited to the allowlisted public demo read, per-user AI quota operations, and dedicated image lifecycle/upload/cleanup operations; it is not used for general recipe reads or CRUD.
- Recipe CRUD stays behind the authenticated REST API. The public demo remains anonymous and does not receive an Authorization header.
- The authenticated critical browser journey should use isolated Supabase test resources. Local Playwright E2E runs use the dedicated stack's native runtime on supported hosts, so they do not require Docker. Hosted Auth/RLS integration runs use the dedicated non-production project, dedicated synthetic accounts, unique test data, an explicitly configured and verified project reference, and cleanup safeguards. These checks do not use production credentials or data, reset a developer's database, or invoke Gemini.

The reusable authentication contract and protected session endpoint are documented in [`docs/api/auth-session.md`](../api/auth-session.md).

## AI workflows and lineage

- Quick AI Entry and Chef are authenticated Edge Function workflows. The backend bounds and validates input, calls Gemini through the server-side AI provider, validates model output against shared schemas, and returns safe errors. Prompts are versioned; automated checks use injected or mocked providers rather than paid live calls.
- Extraction returns an editable preview only. Creating a recipe uses the existing authenticated recipe API after explicit user confirmation; generation and preview edits do not write recipe or lineage rows.
- Chef retrieval is limited to the signed-in user's eligible saved recipes and ranks candidates deterministically by pantry overlap, rating, and recency. Gemini receives that candidate context. The backend rejects proposed parent IDs outside that context, and the lineage save boundary re-checks that the authenticated user owns the child and every parent.
- Lineage creation checks ownership of the child and all selected parents in one read before its existing batch insert. Lineage retrieval embeds the related rows in the child recipe read and preserves stable timestamp/ID ordering.
- Keep `auth.uid()` wrapped in a scalar subquery in user-scoped RLS policies so PostgreSQL can evaluate it once per statement. The upload quota and lineage-order indexes follow their query predicates and ordering.
- AI usage quotas are per user and mutated only by backend operations against `ai_usage_daily`; browser clients have no quota-write access. Quota enforcement must remain safe under concurrent requests.

## Private recipe images

- Keep the recipe image bucket private. The backend authorizes an owned recipe, persists its upload intent and quota, and issues a short-lived presigned R2 `PUT` limited to one staging object. The browser sends the raw bytes directly to R2 without Supabase credentials. It receives neither the R2 secret signing key nor a final object key; the presigned URL contains the non-secret access-key ID and signature.
- Follow the image contract's 10-minute URL lifetime and JPEG/PNG/WebP allowlist. Bind the declared byte size, content type, and create-only `If-None-Match: *` condition into the signature. Attachment verifies the stored object's actual size, type, and image structure before associating it. Preserve safe cleanup of failed or abandoned staging objects.
- Configure R2 bucket CORS for the deployed frontend origin, `PUT`, `Content-Type`, and `If-None-Match`. The proxy transport accepted in PR #190 remains historical and its old URL path is retained only for in-flight compatibility during rollout. The transport revision and production CORS gate are recorded in [ADR-0001](../adr/0001-direct-r2-recipe-image-uploads.md). Follow the [production rollout runbook](../devops/deployment-runbook.md#enable-private-recipe-images) before enabling signing.
- Image upload authorization, attachment, private-read resolution, and deletion use ownership-checking service-role RPCs instead of normal-path ownership pre-reads. Upload authorization checks and locks the owned recipe while reserving quota and inserting its intent in one RPC. Attachment claims remain atomic with their ownership checks; handlers derive the user ID from verified auth context. The RPCs keep internal keys server-side and remain inaccessible to browser roles. Ambiguous not-found results may use one fallback read to preserve the API's error distinction. Do not use the service role for general recipe access.
- Private image download uses the service-role-only resolver RPC to check ownership and resolve attached-image metadata in one database request. The RPC rechecks ownership before returning an internal object key. Until its migration is applied, the handler uses a user-scoped read only for the old ambiguous `not_found` response.
- Before attachment, verify the R2 object's stored content-type metadata and actual byte size against the upload intent and allowed limits, then recheck recipe ownership. Metadata alone does not validate image bytes; a trusted processing or rendering boundary must decode or normalize them.
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

The frontend and repository tooling are separate pnpm projects. Run frontend installs from `frontend/` and keep its manifest, workspace file, and lockfile there. Keep repository tooling dependencies and its lockfile at the repository root; do not share or move dependencies between these projects. The [reusable frontend validation](../../.github/workflows/reusable-frontend.yml) and production workflow are configured to use Node.js 24, pnpm 10, and `pnpm install --frozen-lockfile` from `frontend/` when `frontend/package.json` exists. Install repository tooling from the repository root with the same versions and a frozen lockfile.

## Cloudflare Workers deployment

Cloudflare Workers serves the frontend's static build. [`wrangler.jsonc`](../../wrangler.jsonc) reads assets from `frontend/dist` and uses single-page application fallback behavior.

**Current workflow configuration checked 2026-11-15 at `main` SHA `0dd27d0fbba8f5cca5a7153229bda68b985be78c`:** [Modular Main Validation](../../.github/workflows/modular-main.yml) is the sole production caller after [PR #142](https://github.com/2ton-exe/moris-mix-ai/pull/142) retired `ci.yml`. It runs on pushes to `main` and manual dispatches from `main`. Production requires successful frontend, database, and Edge/API validation plus `frontend/package.json`; the Edge/API reusable workflow requires its nested Hosted RLS job on `main`. Main E2E runs separately and is not a production dependency. PR workflows do not call production; their local validation, E2E, and trusted staging paths are controlled by the path classifier and PR trust conditions. The [issue #73 handoff](../devops/modular-workflows.md#issue-73-final-cleanup-proposal-2026-10-31) retains the historical cutover and rollback context.

The [reusable production release](../../.github/workflows/reusable-production.yml) uses Node.js 24 and pnpm 10. It deploys `recipes`, `extract-recipe`, `generate-recipe`, and `recipe-image-attach`; `account-export` is explicitly disabled with `if: false` pending its acceptance gates. `recipe-image-upload-url` and `recipe-image-download-url` deploy only when `VITE_RECIPE_IMAGES` is `true`; `recipe-image-upload-cleanup` deploys only when `RECIPE_IMAGE_CLEANUP_ENABLED` is `true`. Enabling the image UI also requires cleanup enabled, a successful protected readiness run for the exact `main` SHA with its environment URL matching `PRODUCTION_FRONTEND_URL`, and the required image migrations present in the production ledger. The separate cleanup workflow runs only on `main` with its opt-in enabled and uses its protected environment. The release then deploys the frontend to Cloudflare, verifies the deployment URL and AI routes, and runs the production runtime smoke. It does not apply production database migrations. Supabase and Cloudflare credentials are supplied through Actions secrets; their values must stay out of Git and logs.

**Historical execution evidence:** Cutover and ownership rollback were operator-confirmed on `46809319eb23394a45d6f1ea79f8ee41f541011b` before legacy retirement. [Modular Main Validation #29](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41222561150) on merge SHA `8747e6e605c5eda358c1bb77b27d3d120c87bddc` passed core validation, mandatory Hosted RLS, production deployment, and production runtime smoke, verifying the modular-only path after merge. That run is historical evidence and does not establish execution of the current conditional image release path.
