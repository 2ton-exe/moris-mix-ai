# Mori's Scraps

An AI-assisted recipe journal and leftover-meal assistant. Save recipes, structure cooking notes, and generate meal ideas from available ingredients.

## Project Setup

The CI workflow uses Node.js 24 and pnpm 10. The frontend and Supabase function source directories have not been added yet, so there is no application install or local run command at this stage.

When the Vite frontend is added, copy only the `VITE_` entries from `.env.example` to `frontend/.env.local`. Configure the backend entries in the local Supabase Edge Function environment. Never expose Gemini credentials, service role keys, or Cloudflare R2 secrets to the browser.

## Team Roles

| Member | Role |
|---|---|
| [@KleinRheePagulongSioson](https://github.com/KleinRheePagulongSioson) | AI Engineer |
| [@adnro2](https://github.com/adnro2) | Frontend Engineer |
| [@DanielRamos1186](https://github.com/DanielRamos1186) | Backend Engineer |
| [@myntchoc](https://github.com/myntchoc) | Full-Stack |
| [@DaeSaster](https://github.com/DaeSaster) | DevOps Engineer |

## Architecture

```text
Browser
├── Supabase Auth → authenticated session/JWT
├── REST API calls + JWT
│   └── Supabase Edge Functions
│       ├── request validation and authorization
│       ├── recipe CRUD, search, and lineage
│       ├── AI orchestration and quotas → Gemini via AIProvider
│       └── R2 signing and verification → Cloudflare R2
├── Supabase PostgreSQL + RLS (accessed by Edge Functions)
└── Presigned R2 PUT after backend authorization
```

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
