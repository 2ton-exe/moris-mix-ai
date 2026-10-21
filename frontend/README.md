# Mori's Mix frontend

FE-04 adds the protected recipe dashboard at `/app` and `/app/recipes`, plus
details at `/app/recipes/:recipeId`, using TanStack Query. The shared REST client
now supports authenticated GET and POST requests using a freshly checked SDK
session on each request. BE-06's recipe endpoint contract is still unavailable,
so the production recipe source remains unavailable and normal mode shows an
explicit unavailable state. For a labeled local sample preview, set
`VITE_RECIPE_PREVIEW=true` and restart Vite; existing authentication is still
required. Production builds ignore this flag. See the [FE-04 implementation and
integration handoff](../docs/frontend/recipe-dashboard.md) for the remaining
REST work.

FE-03 adds login, signup, email verification, session handling, and a protected
`/app` journal entry. Open `/home` and select **Your cooking journal**, or go to
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
