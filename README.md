# Mori's Scraps

An AI-assisted recipe journal and leftover-meal assistant developed by Team 2ton.exe. Save recipes, structure cooking notes, and generate meal ideas from available ingredients.

## Project Setup

See the [local development and troubleshooting guide](docs/development-setup.md) for frontend setup, the local Supabase stack, migrations and demo seed, and the demo API. It uses local-only credentials and does not require real Supabase or Gemini secrets.

The CI workflow uses Node.js 24 and pnpm 10. The React/Vite frontend is under `frontend/`, and Supabase Edge Function source is under `supabase/functions/`.

Never expose Gemini credentials, service role keys, or Cloudflare R2 secrets to the browser.

## Team Roles

| Member | Role |
|---|---|
| [@KleinRheePagulongSioson](https://github.com/KleinRheePagulongSioson) | AI Engineer |
| [@adnro2](https://github.com/adnro2) | Frontend Engineer |
| [@DanielRamos1186](https://github.com/DanielRamos1186) | Backend Engineer |
| [@myntchoc](https://github.com/myntchoc) | Full-Stack |
| [@DaeSaster](https://github.com/DaeSaster) | DevOps Engineer |

## Architecture

See the [Sprint 1 architecture ADR](docs/architecture/sprint-1-adr.md) for the target data flow, API contract, folder and pnpm conventions, and Workers deployment plan.

## Tech Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, and shadcn
- Authentication and database: Supabase Auth and PostgreSQL with RLS
- Backend: Supabase Edge Functions with Zod validation
- AI: Gemini through AIProvider
- Object storage: Cloudflare R2
- Frontend hosting: Cloudflare Workers
- Package manager: pnpm
- CI/CD: GitHub Actions

## Branch Strategy

`main` is the protected production branch. Create one branch per issue using:

```text
<type>/<issue-id>-short-description
```

Workflow:

```text
Issue → Branch → Implementation → Tests → Pull Request
→ Teammate Review → CI → Merge → Deploy → Verify
```
