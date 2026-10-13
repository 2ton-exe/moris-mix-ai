# Mori's Scraps

An AI-assisted recipe journal developed by Team 2ton.exe.

## Project Structure

- `frontend/` — React, Vite, TypeScript
- `supabase/functions/` — REST API and AI backend
- `supabase/migrations/` — PostgreSQL schema migrations
- `.github/workflows/` — CI/CD automation
- `docs/` — project documentation

## Development Workflow

- `main` — shared integration and deployment branch
- `feature/*` — feature development
- `devops/*` — infrastructure and automation

All changes should be submitted through pull requests for review.

## Architecture

```text
Browser (React SPA on Cloudflare Workers)
│  * Direct supabase.from(...) domain queries & LLM calls prohibited
│
├── Supabase Auth → authenticated session / JWT
│├── REST API calls + Bearer JWT
│   ↓
│  Supabase Edge Functions
│   ├── request validation (Zod) / JWT authorization middleware
│   ├── recipe CRUD / search / lineage
│   │    └── queries PostgreSQL using caller JWT context (RLS enforced)
│   ├── AI orchestration / quotas (ai_usage_daily)
│   │    └── Gemini via AIProvider → returns unsaved preview to browser
│   │        (persistence requires explicit user POST to /recipes)
│   └── R2 signing / verification
│        ├── Supabase PostgreSQL + RLS
│        ├── Gemini via AIProvider
│        └── Cloudflare R2
│
└── Presigned R2 PUT only after backend authorization
```
