# FE-02 demo recipe frontend

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
