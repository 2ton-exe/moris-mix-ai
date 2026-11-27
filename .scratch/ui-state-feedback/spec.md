# UI-05 — Truthful photo states and visible Mori feedback

Status: implemented

## Problem
The photo editor shows selected preview and empty copy together, has a malformed grid, and lacks an empty photo frame. Mori activity explanations disappear when chat is closed, including duplicate pantry ingredient feedback.

## Outcome
Preserve the handmade ledger desktop design. Show a framed empty photo slot, explicit selected/pending/upload/error/attached states, and compact grouped controls. A selected preview must never claim successful private attachment before server verification. Preserve the saved photo during failed replacement. Use the supplied references for composition, not their simulated-storage claims. Keep existing file validation, R2 signing/PUT/attach/retry and ownership unchanged. Removal is outside this correction because it adds a new persistence workflow.

Expose current non-idle Mori feedback beside the closed companion without opening chat or stealing focus, and retain accessible feedback in signed-in open chat. Make duplicate pantry feedback visible and use existing Mori activity machinery for it. Inspect adjacent activity producers for equivalent hidden states.

## Verification
Behavioral component tests cover empty/selected/failed/attached photos and closed/open signed-in Mori updates, cleanup, and duplicate feedback. Existing browser journeys verify desktop photo geometry and Mori feedback. Run frontend tests, lint, build and existing auth/CRUD/AI/image checks as practical; distinguish mocked API/R2 checks from live storage validation. Preserve mobile/tablet behavior. Open one PR against main and leave it unmerged.

## Tickets
- [01 Photo states](issues/01-photo-states.md)
- [02 Mori feedback](issues/02-mori-feedback.md)

## Verification record

- Frontend: all 968 tests across 61 files passed on Node 24 with one worker; ESLint, TypeScript, production build, and diff checks passed. The final attachment-copy follow-up passed all 30 focused image tests.
- Browser: desktop authentication, complete recipe CRUD/forms/deletion, Quick AI extraction/review/save recovery, and AI Chef generation/lineage/recovery journeys passed with isolated API fixtures. The AI Chef run includes closed-chat duplicate-feedback visibility and bounds.
- Backend: the existing Edge/API suite passed 536 tests with 6 ignored (integration owner verification).
- Limits: local Supabase integration could not run because Docker is stopped. Browser storage checks use isolated API/R2 responses; live production R2 and AI provider requests were not exercised.
- Early parallel runs hit Node 26 web-storage incompatibility and UI timing failures; the sequential CI-version Node 24 full run passed without changing timeouts.
