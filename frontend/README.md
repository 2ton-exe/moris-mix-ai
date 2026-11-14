# Mori's Mix frontend

UI-01 visual corrections replace the asymmetric dashboard book with equal facing
pages and reference-based stationery controls. See the
[visual correction report](../docs/frontend/journal-visual-corrections.md) for
measurements, screenshot comparisons, validation and remaining Figma differences.
Run `node e2e/journal-visual-fidelity.browser.mjs after` for screenshots at
1440, 1280, 768, 390 and 320px and a local comparison gallery in `test-results`.

UI-01 Phase A adds MORI'S MIX's reusable scrapbook visual foundation. See the
[foundation handoff](../docs/frontend/journal-foundation.md) for source recovery,
asset provenance, component usage, validation and the Phase B plan. To inspect
the components, run `pnpm dev` here and open `/journal-foundation.html`.

UI-01 Phase B adds the shared desk, leather journal, paper pages, and bookmark
navigation around the existing protected routes. See the
[shell handoff](../docs/frontend/journal-shell.md) for integration details,
the isolated authentication baseline comparison, and browser verification.
Run `node e2e/journal-shell.browser.mjs` here for isolated shell acceptance.

UI-01 Phase C applies the journal stationery presentation to the existing
login, signup, email verification, and session-restoration states. See the
[authentication handoff](../docs/frontend/journal-auth.md) for the route and
Supabase boundaries, visual integration, validation results, and the password
recovery capability gap. Run `node e2e/auth-ui.browser.mjs` here for isolated
authentication acceptance.

UI-01 Phase D styles the authenticated recipe collection and detail pages as
scrapbook entries while keeping their existing API, TanStack Query, route, and
action behavior. See the [recipe journal handoff](../docs/frontend/journal-recipes.md)
for implementation boundaries, browser acceptance, and Phase E planning. Run
`node e2e/recipe-journal.browser.mjs` here for isolated dashboard and detail
acceptance.

UI-01 Phase E brings the existing create/edit recipe forms and delete
confirmation into the journal's stationery style without changing their routes,
validation, mutations, or query behavior. See the
[recipe forms handoff](../docs/frontend/journal-forms.md) for interaction and
accessibility details. Run `node e2e/recipe-forms.browser.mjs` here for isolated
form, navigation guard, and delete-flow acceptance.

UI-01 Phase F verifies that the existing BE-08 discovery controls and cursor
results fit the scrapbook dashboard, then reviews semantics, keyboard focus,
responsive layout, and visual consistency across the journal. See the
[cross-phase review](../docs/frontend/journal-review.md) for findings, bundle
analysis, and the Phase G plan. Run `node e2e/recipe-discovery.browser.mjs` for
isolated discovery acceptance.

FE-04 adds the protected recipe dashboard at `/app` and `/app/recipes`, plus
details at `/app/recipes/:recipeId`, using TanStack Query and BE-06's authenticated
recipe REST API. The shared REST client checks the current SDK session for each
request. Without API configuration, normal mode reports an unavailable service
rather than showing sample recipes.

FE-05 adds a reusable recipe editor and protected `/app/recipes/new` and
`/app/recipes/:recipeId/edit` page boundaries. Edit loads through the shared,
account-scoped recipe query; create and edit save through authenticated POST and
PATCH requests. Notes persist through the REST API. Unsaved drafts stay in memory
and are guarded on in-app navigation and browser history; auth redirects remain
available. See the [recipe form handoff](../docs/frontend/recipe-form.md) for
schema limits and integration status. For a labeled local sample preview, set
`VITE_RECIPE_PREVIEW=true` and restart Vite; production builds ignore it.

Private recipe image panels and endpoint calls are disabled by default in
local builds. The production release build sets `VITE_RECIPE_IMAGES=true` per
owner direction, exposing the image UI to all production users on the next
release. This does not verify production R2 access or cleanup readiness, or
deploy new Edge Functions or enable cleanup. Keep the cleanup opt-in unset until its separate
readiness checks pass.

FE-03 adds login, signup, email verification, and session handling for the
protected recipe dashboard. Open `/home` and select **Your cooking journal**, or go to
`/login` directly. See the [authentication setup and FS-02 handoff](../docs/frontend/authentication.md)
for callback allowlist requirements, session interfaces, route ownership, and
the remaining live verification steps. The public FE-02 demo stays available
without authentication.

Session initialization offers retry and public demo navigation after a
15-second deadline. Verification status reflects the current callback's SDK
result, and callback credentials are removed from the URL on success, failure,
or timeout. If logout clears this browser session but server revocation fails,
the login page displays a dismissible notice.

Opening `/` redirects to `/demo-recipe`; the previous starter page remains at
`/home`. The `/demo-recipe` page requests `GET /functions/v1/demo-recipe` from the configured
Supabase project. It validates the [FS-01 response contract](../docs/api/demo-recipe.md)
before rendering recipe details. Loading, error, and manual retry states are shown
on the page. The shared fixture is used only by unit tests; the production page
has no mock or fallback success path.

## Local setup

Use Node 24 and pnpm 10. Copy `.env.example` to `.env.local` and set:

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

The URL must be the project origin, with no path or credentials. Use only the
project's public publishable key. A legacy public anon JWT can instead be set as
`VITE_SUPABASE_ANON_KEY`. Every `VITE_*` value is visible in the browser and in
the built JavaScript. Never use a service-role key or another secret here. Restart
the development server or rebuild after changing these values. Missing values
show a configuration error and prevent a request.

The native fetch client sends the public key in the `apikey` header, requests JSON
without cookies, and supports aborting an obsolete request. No signed-in user is
needed for this public demo function, so it does not send an `Authorization` bearer token.
The UI never renders raw server error payloads. HTTP, network, malformed JSON,
and invalid contract responses show a safe error with a manual retry.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

The test and build scripts use Vite's runner config loader because the default
bundled loader cannot resolve config paths in this Windows workspace sandbox.

The optional Figma comparison harnesses (`node e2e/journal-step1.browser.mjs`,
`node e2e/journal-step2.browser.mjs`, and `node e2e/journal-step4.browser.mjs`)
require the original reference app in `../figma-make-reference`, a sibling of
this repository (not inside `frontend`). Restore that checkout and run
`pnpm install` there first; its Vite, `@vitejs/plugin-react`, and
`@tailwindcss/vite` dependencies must be installed. These harnesses check the
prerequisites before importing reference dependencies and write comparisons
under `frontend/test-results`. The reference checkout is not required for
production builds, normal CI, or the isolated browser acceptance suites.

## Production verification still needed

For the production workflow, configure these GitHub Actions repository variables
under **Settings → Secrets and variables → Actions → Variables**:

- `VITE_SUPABASE_URL`: the deployed Supabase project origin.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's public publishable key. If using
  a legacy public anon JWT instead, set `VITE_SUPABASE_ANON_KEY` and leave the
  publishable key variable unset. The publishable key takes precedence when both
  are set.

The deployment job checks for the URL and one public key before building. These
values are embedded in the browser bundle, so never use a service-role key or
another private credential. The existing `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` remain GitHub Actions secrets.

Ensure BE-03 is deployed with the demo seed and the
approved frontend origin in CORS. Then verify in a browser that `/demo-recipe`
loads the PostgreSQL-backed response, that the request uses GET and public
headers, and that blocked network access and backend errors show a retryable
error. Confirm no private recipe data or service-role key appears in the browser
response or bundle. Local unit tests and a build do not establish this live path.

## Mori dialogue UI (UI-01 Phase G)

The authenticated recipe index includes an opt-in, inline note from Mori. Its
content and choices are supplied as presentation props; it does not call an AI
service, persist dialogue, or write recipes. The reusable interface and future
service coordination notes are documented in
[journal-dialogue.md](../docs/frontend/journal-dialogue.md).

## Physical journal workflows

The index, recipe detail, create/edit forms, and public demonstration recipe all
use the same leather journal on their existing routes. Desktop book dimensions
are constrained by viewport width and height; each facing page scrolls within
the stationary cover. Narrow and zoomed viewports use one readable page scroll
area, with tabs attached at the top. Search, sorting, and leaf state survive return.

See [journal-physical-ux.md](../docs/frontend/journal-physical-ux.md) for geometry,
implementation, screenshots, validation, and remaining reference differences.
Run `node e2e/journal-expanded.browser.mjs` to regenerate the viewport matrix and
`node e2e/journal-zoom.browser.mjs` for native Chrome 200% zoom. Evidence is in
`test-results/physical-journal/index.html` (ignored by Git).
