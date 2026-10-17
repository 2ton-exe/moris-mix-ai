# Local development and troubleshooting

This guide runs the Sprint 1 demo against a local Supabase stack. It uses the checked-in schema and sample recipe; a real Supabase project, Gemini key, or other secret is not required.

## Prerequisites

- [Node.js 24](https://nodejs.org/en/download) and pnpm 10 (`npm install --global pnpm@10`; see the [pnpm 10 installation guide](https://pnpm.io/10.x/installation))
- Supabase CLI 2.x
- Docker Desktop or another Docker-compatible runtime, running

See Supabase's [CLI installation guide](https://supabase.com/docs/guides/local-development/cli/getting-started) and [local development guide](https://supabase.com/docs/guides/local-development) for CLI and runtime installation instructions. The first `supabase start` downloads the local service images.

## Start the app

From the repository root, start Supabase:

```sh
supabase start
```

On initial setup, the CLI starts the local database and API and applies the migrations in `supabase/migrations/` followed by the configured `supabase/seed.sql`. `supabase/config.toml` enables that seed; Supabase documents this [local seed behavior](https://supabase.com/docs/guides/local-development/seeding-your-database). To recreate a clean local database and replay both migrations and seed data later, run:

```sh
supabase db reset --local
```

This deletes and rebuilds the **local** database. Keep `--local`; `supabase db reset --linked` targets and wipes the linked remote project.

In another terminal, serve the Edge Function:

```sh
supabase functions serve demo-recipe
```

In a third terminal, configure and start the frontend:

```sh
cd frontend
pnpm install --frozen-lockfile
cp .env.example .env.local
```

If using PowerShell, copy the file with `Copy-Item .env.example .env.local`. Set `VITE_SUPABASE_URL` to `http://127.0.0.1:54321` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the local publishable key shown by `supabase status`. If your CLI shows a legacy `anon key` instead, set `VITE_SUPABASE_ANON_KEY` to that value. The frontend supports either public key setting. Do not copy the local service-role/secret key into the frontend file or share the full `supabase status` output.

Start Vite:

```sh
pnpm dev
```

Open the URL Vite prints (normally `http://localhost:5173`). The root route opens `/demo-recipe`.

## Migrations and demo data

The local stack replays versioned migrations in order, then loads `supabase/seed.sql`. The seed contains synthetic demo records only; `Classic Tomato Scraps Pasta` is the public recipe returned by the endpoint. The repeated seed inserts use fixed IDs and conflict handling.

Use `supabase db reset --local` to reproduce a clean local schema and seed. It deletes existing local database data first. Do not use the seed against production. For an approved remote schema update, preview and apply pending migrations to the linked project with `supabase db push --dry-run --linked` and `supabase db push --linked`; these commands do not include seed data by default. See Supabase's [local and remote workflow](https://supabase.com/docs/guides/local-development/cli-workflows) for command details. Never run `supabase db reset --linked` against a shared or production project.

The repository also has a Node migration runner (`pnpm db:setup`) that applies SQL to the database named by `DATABASE_URL`. It is not needed for normal local setup. Do not point it at a hosted database unless you have approval to modify that exact project. The root `.env.example` contains placeholders for hosted connection settings; it is not a local Supabase URL.

## Demo API

The frontend calls `GET /functions/v1/demo-recipe` at the configured Supabase URL and sends the public key in the `apikey` header. No signed-in user or request body is needed. The function reads only the approved public demo row and returns JSON; it does not call Gemini. The full response schema, CORS behavior, and error codes are in the [demo recipe API contract](api/demo-recipe.md).

You can check the local route from another terminal, replacing the placeholder with the local publishable/anon key from `supabase status`:

```sh
curl --include http://127.0.0.1:54321/functions/v1/demo-recipe \
  --header 'apikey: <local-publishable-or-anon-key>'
```

A successful response is `200 OK` with `recipe.title` set to `Classic Tomato Scraps Pasta`. A `404` means the seeded public recipe was not found; other errors use the safe JSON error envelope documented in the API contract.

## Checks

Run frontend checks from `frontend/`:

```sh
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `supabase start` says Docker is unavailable or a service is unhealthy | Start Docker Desktop or the configured compatible runtime, then run `supabase start` again. |
| A local port is already in use | Run `supabase status` to see the local services, then stop an old local stack with `supabase stop` before restarting. |
| The function URL returns 404 or the browser cannot reach it | Keep `supabase functions serve demo-recipe` running and use `http://127.0.0.1:54321` as `VITE_SUPABASE_URL`. |
| The API returns `DEMO_RECIPE_NOT_FOUND` | Replay the local migrations and seed with `supabase db reset --local`; this deletes and rebuilds the local database. |
| The frontend reports missing configuration | Check the `VITE_` variable names and restart Vite after editing `frontend/.env.local`. Use only a publishable/anon key in this file. |
| The browser reports a CORS error after changing the frontend origin | The function allows all origins by default. If `ALLOWED_ORIGIN` is set for local function serving, set it to the exact frontend origin and restart the function. |

Gemini credentials are only needed for the separate backend AI connectivity check. Keep those credentials in a server-side environment and never put them in a `VITE_` variable.
