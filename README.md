# Mori's Mix

An AI-assisted recipe journal and leftover-meal assistant developed by Team 2ton.exe. Save recipes, structure cooking notes, and generate meal ideas from available ingredients.

## Submission evidence

Review the [three-page technical brief (PDF)](docs/submission/final-brief.pdf), [editable DOCX](docs/submission/final-brief.docx), [current evidence map](docs/submission/README.md) and [consolidated questions/DevOps dependencies](docs/submission/outstanding-confirmations.md). The [existing Google Doc destination](https://docs.google.com/document/d/1USkQIcd6oCz7vO2sAsE2ssJcLbs-OOlsEqgfmDamqcI/edit?tab=t.0) still contains the dated 25 November draft pending approved replacement. This 27 November reconciliation is provisional; historical attribution and evidence limits are preserved.


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

See the [Sprint 1 architecture ADR](docs/architecture/sprint-1-adr.md) for the application data flow, API contract, folder and pnpm conventions, and Workers deployment plan.

See the [database overview](docs/database.md) for the implemented tables, relationships, and ownership rules. The [API reference](docs/api/README.md) links the recipe, authentication, demo, AI, and private recipe-image contracts.

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
