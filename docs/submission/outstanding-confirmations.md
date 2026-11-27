# Remaining facts and decisions

Recorded **27 November 2026 (Asia/Manila)**. **myntchoc owns current non-DevOps documentation, verification, synthesis and final document approval.** Historical authors remain credited in the [process](process-evidence.md) and [disclosure](external-work-disclosure.md). No contributor messages or review requests were sent. The five former unsent requests are removed from the submission path; Git preserves them.

Original Endterm instructions, pitch/plan copies, source/tool declarations and the existing `FINAL DOCUMENT` destination were found. They are not requested again. A current technical decision can be approved by myntchoc; it cannot create an old instructor approval, meeting record or another person's unknown tool history.

## Consolidated questions for myntchoc

Answer with an original link, an explicitly dated first-hand recollection, or “unknown/no original retained.” New answers retain their actual date.

| ID / category | Irreducible question or decision | What it resolves |
|---|---|---|
| Q1 · Missing originals | Which located pitch/version was actually instructor-approved, and what attributable approval or consultation-notification record survives? The native pitch and spec's “approved for implementation” wording identify no instructor approval event. Identify material notified changes only: backend boundary, Gemini/stack, explicit save, direct image transport and schedule. | Pitch identity/scope history; no new component-owner signatures or optional-feature gates. |
| Q2 · Missing originals / recollection | For each sprint, what actual dates, selected/carryover work and PO duty can you personally substantiate, and which original plans, standups, retrospectives/actions or consultation records do you retain? For your supplied week 1–3 feedback, identify event dates, speaker/audience and resulting actions only if known. You reported no week-4 consultation; none will be fabricated. | Exact process gaps beyond preserved plans, board and engineering chronology. Attendance/cadence are not inferred from commits. |
| Q3 · Missing media | Where are the retained `PA-20261127-DUR-01-post-deployment.png`, `PA-20261127-DUR-01-cleanup.png`, other sanitized journey/failure captures, final slides and any uninterrupted deployment recording? No matching PA screenshots were located in inspected local/Drive results. Do you retain the rejected revision source/output or Chef boundary stack? | Panel media and historical reproduction inputs. Existing captures are requested, with no new production check or provider call. |
| Q4 · Factual declaration / permission | For grouped A05 kitchen WebPs, A06 Mori/atlas, A07 stickers and A08/W03 adapted CSS/SVG, what creator/account, borrowed-source and source/output permission record can you personally establish? Tool/source declarations are already incorporated. If unknown, choose an exact-path fallback in the [disclosure](external-work-disclosure.md#one-grouped-declaration-for-a05a08w03). | Remaining permission basis, separate from attribution, procedural generation and document approval. No artwork removal/redesign occurs here; A02 uncertainty stays historical. |
| Q5 · Factual declaration | Does the tool/output/review disclosure accurately describe your own incorporated work? Correct known omitted code, writing, templates, fixture sources or artwork; clarify “Luna 6” only if known. Team access/use reports cannot certify each person's unknown history. No personal human evaluation score has been inferred. | First-hand disclosure corrections, without teammate signoff or a new large study. |
| Q6 · Current review / repair | Review the three-page [brief](final-brief.md) and decide whether to authorize the separate repair below. This task changes no application behavior. Final document approval remains yours; the existing Google Doc's `FINAL DOCUMENT` tab remains the dated 25 November draft pending approved replacement. | A concrete review result and one bounded application proposal. No new result is marked approved or submission-ready. |

## Application repair proposal

**One separate follow-up: normalize legacy revision amounts and stabilize desktop review measurement.** Findings are local at `d329285ce0be5e955ee6ac76751cf97f6e58f799`; neither is proven to explain PA-20261127.

1. **Confirmed valid-output rejection:** unchanged stored rice `cups` is read tolerantly while model output normalizes it to `cup`. `explainRecipeRevision` compares raw unit strings before reaching the olive-oil change, rejecting a valid 1→2 tsp revision. Reuse `normalizeIngredientUnit` for unchanged amount comparison in `supabase/functions/_shared/ai/recipeRevision.ts`, preserving the original record, quantity-text restrictions, real conversions and multiple-change rejection. Extend existing `supabase/functions/tests/generate_recipe_test.ts`: legacy `cups`→`cup` plus oil 1→2 acceptance; canonical control; equivalent oil 1 tsp→⅓ tbsp rejection; second real ingredient-change rejection. The acceptance diagnostic deliberately reports **2 passed / 1 failed** for the legacy case.
2. **Observed timing-dependent desktop post-save failure:** the exact-note browser probe sometimes hits the generic route boundary after **Save new version**, with `Maximum update depth exceeded` in `RecipeFormEditor` measurement. A settled-layout execution passes actual linked-copy reopen and original preservation; earlier failed executions remain recorded. Inspect both measurement paths in `frontend/src/recipe-form/RecipeFormEditor.tsx` and the comparison/saved transition in `frontend/src/ai-chef/ChefRecipeReviewPage.tsx`; keep a stable desktop review page budget across saving/receipt display instead of deriving capacity from its changing leaf. Add regressions at `frontend/e2e/ai-chef.browser.mjs` and `frontend/src/recipe-form/RecipePages.test.tsx`: edit revision title/amount, immediate explicit save, confirmed lineage, receipt and actual saved-copy reopen at 1440×900 and 1100×640; no boundary, duplicate save or lost edit. Retain Chef Instructions→inspiration and failed-lineage/reload/retry controls. Confirm the capacity-loop hypothesis with the captured dimensions before choosing the exact patch.

The structural verifier does not prove a proposal matches the note's target: a single 1→3 change can pass a note requesting 2. This is a separate semantic limit, not the observed rejection's cause. Do not weaken validation or add live retries to obtain green acceptance. Linked-copy save does not automatically update original Personal Notes; conditional notes updates are supported in the separate **Record cooking** flow.

[Exact commands, retained probes and sanitized diagnostics](compilation-record.md#verification-record). No application fix, migration, provider call or production retry was made.

## Separate DevOps dependency

Facts/evidence to integrate into required brief sections; no operational action or message was sent.

| ID | Exact fact/evidence still needed |
|---|---|
| D1 · Final release | Current designated tag/version, frontend/function revisions, changelog and corresponding deployment evidence. Tags/releases returned empty at reconciliation. Later main cannot inherit `5cad4b8`/`05c9b32` production acceptance. |
| D2 · R2-02 | Disposition of both objects reported present at 18:36:22/18:36:36 PHT; final-object worker scheduling/invocation and later exact-object absence if separately authorized. Supplied queue checkpoint: zero attempts. No keys or production data in the public pack. |
| D3 · Recovery/delivery packet | Current isolated restore/rollback evidence and limitations, release/migration policy, pipeline diagram, metrics/optimization/incident records and continuous deployment recording. Canonical docs exist; historical issue/failure states need current packet evidence. |
| D4 · Operational settings/data | Effective provider/model, key/project relationship, plans/cost/rate/spend limits, audience/region/content-use eligibility and controls; redacted environment/secret-history/staging-authority evidence and actual retention/cleanup policy. Code defaults and historical Free reports stay separate. |
| D5 · Access/disclosure | Panel-readable equivalents for restricted artifacts, board history, recording/operations evidence and attributable DevOps assistant/template disclosure. Access as myntchoc does not establish panel access. |

## Remaining-gap classification

| Category | Gap |
|---|---|
| Behavior failures | Historical Chef pre-save transition and rejected revision; local legacy-unit rejection and timing-dependent revision post-save measurement loop. R2 physical cleanup is an operational partial result. |
| Missing originals | Instructor-approved pitch identity; actual sprint calendars/PO/backlog, standups, retros/actions and some consultation originals. Week 1–3 recollections now recorded; no week-4 consultation claimed. |
| Missing media | Two named PA screenshots, other retained journey/failure media, final slides and uninterrupted deployment recording. Textual observations remain useful at recorded scope. |
| Factual declarations | Grouped asset permission/source facts, corrections to myntchoc's tool/output account and final document approval. |
| Access issues | Panel access to Google Doc, course/plan originals, original Projects history, recordings and restricted artifacts. Landing-page success is insufficient. |
