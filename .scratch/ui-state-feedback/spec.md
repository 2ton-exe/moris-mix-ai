# UI-05 — Truthful photo states and visible Mori feedback

Status: implementing

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
