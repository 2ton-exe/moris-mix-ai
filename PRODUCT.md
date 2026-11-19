# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Home cooks who want to keep their recipes organized and decide what to cook.

## Product Purpose

Mori’s Mix helps home cooks build a personal recipe journal and turn cooking notes or pantry ingredients into useful recipe ideas. Success means cooks can keep and revisit their recipes, use AI-generated drafts they can edit, and stay in control of what gets saved.

## Positioning

Mori’s Mix combines a personal cooking journal with reviewable AI drafts: cooks can structure rough cooking notes or get a pantry-based meal suggestion, then edit it before choosing to save it.

## Operating Context

- Cooks use a signed-in journal to create, browse, search, edit, and revisit their recipes.
- Quick AI Entry turns rough cooking notes into an editable recipe draft.
- AI Chef uses pantry ingredients and optional preferences to suggest a recipe, drawing on the cook’s own saved recipes when available.
- A public demo recipe is available without signing in.

## Capabilities and Constraints

- Recipe data is private and belongs to the signed-in account.
- AI requests run server-side; model output is validated before it reaches the frontend.
- AI extraction and generation return previews. A cook must review and explicitly confirm before a recipe is saved.
- Keep AI credentials and other server secrets out of the browser.
- The existing frontend is React, Vite, and TypeScript; backend operations use Supabase Edge Functions and PostgreSQL with row-level security.

## Brand Commitments

- The product is Mori’s Mix.
- Mori is the product’s rat-chef character and identity; preserve that identity.

## Evidence on Hand

- Current product description and public copy: `README.md`, `frontend/src/pages/PublicJournalPages.tsx`.
- Existing Mori character artwork: `frontend/src/journal/Mori.tsx`.
- AI behavior and API contracts: `docs/api/ai-integration.md`.
- Authentication and data boundaries: `docs/architecture/sprint-1-adr.md`.
- No customer testimonials, external benchmarks, or press evidence were found; do not invent them.

## Product Principles

- Keep personal recipes private and account-owned.
- Let AI assist with cooking and organization while keeping the cook in control.
- Keep generated recipes editable and require explicit confirmation before saving.
- Preserve Mori’s established rat-chef identity.
