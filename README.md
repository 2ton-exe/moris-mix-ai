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

See the [Sprint 1 architecture ADR](docs/architecture/sprint-1-adr.md) for the target data flow, API contract, folder and pnpm conventions, and Workers deployment plan.
