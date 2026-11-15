# FE-13 Stage 1 engineering handoff

Date: November 8, 2026 (Asia/Manila).

## Initial state and isolation

- Worktree: `C:/Users/ongan/PROJECTS/4TH YEAR/AI/moris-mix-ai-fe13`.
- Branch: `feat/FE-13-loading-error-degraded-states`.
- Verified base: `origin/feat/FE-11-lineage-parent-selection` at `507fe69be61d43ff8858ec72ceb49f1526070fe3`, fetched before worktree creation.
- Root worktree was clean on `fix/180-vitest-tinypool`; FE-13 branch and destination did not exist. Created FE-13 directly from the verified remote FE-11 ref.
- Existing FE-12 worktree was registered at `../moris-mix-ai-fe12` on `feat/FE-12-private-recipe-image-upload`. No file reads, writes, installs, builds, branch switches, or commands were run inside FE-12 or other existing worktrees. Initial Git inspection and fetch ran in the root as requested; all subsequent project work ran in FE-13.
- No pushes, PR creation, merges, remote branches, credential/configuration changes, stashes, resets, cleanup of other worktrees, or recovery-reference deletions.
- Read the master specification and issues 113/106 through connected tools. PRs 184 and 189 were open and unmerged when inspected. The actual checked-out code is the implementation authority.
- No AGENTS.md was present in the repository or its immediate project parent.

## Existing state architecture

React Query owns account-scoped recipe reads and delete mutations. RecipeQueryProvider creates a new client per account, cancels old requests, and clears the old cache. Read adapters validate unknown payloads before rendering. Access errors hide cached private records. Initial loading, empty collection, empty search/filter results, offline pauses, pagination failures, and stale refresh data already have separate paths.

The shared editor owns validation, stable draft values, synchronous duplicate-submit protection, abort handling, dirty navigation/logout guards, and confirmed-save baselines. useRecipeSave retains the confirmed created ID so subsequent edits update that recipe. Delete requires an explicit dialog, waits for confirmed 204, and reconciles failures without optimistic removal.

Quick AI and AI Chef keep notes/pantry/preferences and unsaved previews separate from recipe persistence. Session drafts are account-scoped and use verified writes plus memory recovery. Generation and extraction require an explicit action. AI Chef review saves the child first, checkpoints its ID and selected parents, then persists lineage. Ambiguous lineage is reconciled by authenticated GET; a conflict alone is never success. Expired authorization cannot be reused. Existing clearHandoffAfterSave protections remain unchanged.

## State audit matrix

**Existing** means audited behavior retained with its regression coverage. **Improved** identifies FE-13 changes. A dash means the category is not applicable as a separate state.

| Workflow | Loading | Empty | Error | Retry | Degraded | Result |
|---|---|---|---|---|---|---|
| Recipe list | Existing skeleton, pending search, next page | Existing collection versus search/filter distinction | Improved invalid-response and rate-limit copy; existing safe auth/network errors | Existing initial/page-specific retries | Improved live announcement of last loaded data; corrected delete notice | Existing behavior preserved; focused improvements |
| Recipe detail | Existing unresolved skeleton and refresh status | Missing/inaccessible distinct from transient errors; optional-field fallbacks existing | Improved invalid-response and rate-limit copy | Improved cached retry preserves focus; initial retry retains heading recovery | Improved announced explanation of last loaded content | Existing behavior preserved; focused improvements |
| Recipe create | Existing pending lock and stable editor | Existing title/field validation | Improved ambiguous-write, conflict, configuration, rate-limit copy | Existing explicit retry; ambiguous creation requires journal check | Existing local draft/storage notices | Confirmed ID and dirty guards retained |
| Recipe edit | Existing initial/pending/refresh behavior | Existing unavailable record and field validation | Same improved submission mapper; auth denies access | Existing PATCH retry keeps fields and same ID | Existing dirty edits survive read failure | No form refactor or image changes |
| Recipe delete | Existing explicit confirmation/pending lock | Missing recipe handled separately | Existing safe uncertainty and permanent rejection | Existing manual retry; no automatic DELETE | Improved deletion notice no longer claims collection refresh succeeded | Confirmed-delete semantics unchanged |
| Quick AI | Existing local empty-note validation and in-flight lock | Existing empty notes; no handoff; empty extracted sections | Improved explicit forbidden and generic 429 handling | Improved strict server guidance; removed fabricated provider/auth 30-second countdown | Existing verified storage and in-memory notes/handoff recovery | No automatic save or regenerate |
| AI Chef generation | Existing pantry validation and generating state | Existing empty pantry and absent preview | Improved forbidden messaging and date-aware guidance | Improved Retry-After lock, including native form submission | Improved real storage retry for resumed preview; changed-handoff protection; ignore late aborted completion | Pantry/preferences and saved-child recovery retained |
| AI Chef review | Existing explicit Save/pending/confirmed editor | Existing missing/invalid recovery page | Improved shared save-failure messages | Existing same-recipe post-save edits and storage cleanup retries | Existing storage warning and partial-save messages | clearHandoffAfterSave unchanged |
| Lineage persistence | Existing separate post-save pending state | No selection skips lineage | Existing expired/blocked/pending/ambiguous/confirmed distinctions | Existing GET-first reconciliation and lineage-only retry | Existing child ID and parent selection survive partial failure | No implementation changes; regressions retained |
| Authentication operations | Existing initialization/login/signup/logout/resend pending guards | Existing validation and verification-required states | Existing safe error allowlist; improved workflow access feedback | Existing explicit initialization/login/logout/resend recovery | Existing local-signout versus server revocation warning | Existing auth and callback suites retained |
| Image upload | Deferred | Deferred | Deferred | Deferred | Deferred | Stage 2 only |

Success remains confirmation-based in every write workflow. Entered notes, recipe edits, pantry/preferences, selected parents, and confirmed child IDs remain under their existing owners. Access-denied responses hide cached private recipes; account changes remount scoped query/draft sessions. Status text uses existing journal styling, visible text, role=status/alert, keyboard controls, and existing reduced-motion behavior. Quick AI countdown uses a non-live timer; Chef cooldown status text does not change every second, avoiding repeated countdown announcements.

## Changes and merge hotspots

- `frontend/src/api/retryAfter.ts`: small pure utility for integer delta seconds and HTTP-date guidance. Rejects negative, fractional, scientific/hexadecimal, nonfinite and unbounded inputs. No raw server text is rendered and no successful future request is promised.
- `recipes/RecipeStates.tsx`: actionable invalid-response/rate-limit messages using existing ErrorState.
- `recipe-form/submission.ts`: distinguishes conflict and rate limit; uncertain transport/response failures tell the user to check the journal before retrying.
- `pages/RecipeDashboardPage.tsx`: announces stale collection; says only that deletion was confirmed, independently of list refresh.
- `pages/RecipeDetailPage.tsx`: announces stale content and avoids title focus changes during cached retry.
- `quick-ai/QuickAiEntryPage.tsx`: strict shared Retry-After parser, safe 403 and plain 429 feedback, and no invented provider/auth cooldown. Existing documented daily quota reset fallback remains; countdown says when to retry rather than promising availability.
- `ai-chef/generateRecipe.ts`: shared server-date guidance and forbidden copy.
- `ai-chef/AIChefPage.tsx`: blocks retries until supplied guidance permits, retains editable pantry/preferences, rejects late aborted success, and retries resumed-preview storage through a real write while protecting changed handoffs.
- Focused unit/integration and deterministic browser regressions extend the existing infrastructure. Exact-message assertions changed where truthful copy changed; no tests were removed or skipped.
- No dependencies, backend contracts, image assets, image picker/compression/upload/attachment/private-read behavior, or lineage implementation changed.

Potential FE-12 conflict hotspots: RecipeStates.tsx, RecipeDashboardPage.tsx, RecipeDetailPage.tsx, submission.ts, and recipe browser fixtures. Changes to shared files are narrow. RecipeFormEditor.tsx and all upload-specific files remain unchanged. Browser edits concerning images were not introduced; existing photo-placeholder assertions are retained.

## Safe retry ledger

| Operation/failure | Confirmed persistence | Input retained | Safe next action | Permanent/temporary and lost-response behavior |
|---|---|---|---|---|
| Initial list/detail read | No new write | Current query criteria | Retry read | Temporary failures retry; auth/ownership errors require recovery/navigation; malformed response never rendered |
| Background/page read | Previously confirmed query data | Current criteria/cards or detail | Retry failed read/page | Failed refresh cannot replace last confirmed data; access errors hide it |
| Recipe save rejected before request/validation | No write from that attempt | Entire editor draft and dirty state | Correct fields/configuration/auth | Explicit error class distinguishes preflight from uncertain transport |
| Recipe create response lost/invalid/server failure | Unknown; no invented ID | Entire draft | Check journal before another explicit save | No idempotency/reconciliation contract exists for an unconfirmed create; a blind retry can duplicate it |
| Confirmed create or edit | Confirmed recipe ID retained | Subsequent edits | PATCH same confirmed ID | No repeat create after confirmed save; session failure cannot announce success |
| Delete response failure | Unknown deletion result | Last confirmed record until read reconciliation | Check collection, then explicit dialog retry if offered | No automatic destructive retry; 401/403/404 and permanent rejection have specific feedback |
| Extraction/generation failure | No recipe save | Notes or pantry/preferences | Explicit failed AI operation retry | Available server cooldown honored; never automatic on render/recovery; provider calls may consume quota even if response is lost |
| Draft storage failure | Backend unchanged; disk draft not confirmed | Memory fallback and current fields | Retry verified storage write | Reload risk explained; resumed Chef retry preserves saved ID/selection and checks handoff identity |
| Child saved, lineage failed | Child ID confirmed; links unconfirmed | Child ID, selection, token, review | GET reconciliation then lineage-only retry | Do not recreate child; timeout/conflict cannot imply success; expired/blocked authorization not retried |
| Handoff cleanup failure | Recipe/confirmed lineage already saved | Recovery until verified clear | Retry actual storage clear | Existing idempotent cleanup and newer-handoff protection remain intact |

## Validation

The untouched base passed **546 tests across 37 files**. The final single-worker run passed **569 tests across 39 files**, with zero failures: **23 additional tests and two additional files**. Final run duration: 148.94 seconds.

| Check | Result | Evidence |
|---|---|---|
| Focused FE-13 tests | Passed | Initial five-file focused run: 115 passed; storage follow-up: 21 passed; final Quick AI follow-up: 32 passed. Full final suite also includes the added changed-handoff regression. These runs overlap. |
| Full Vitest suite | 569 passed / 39 files; zero failed | `pnpm test -- --maxWorkers=1` plus final explicit single-worker `pnpm exec vitest run --configLoader runner --maxWorkers=1` |
| ESLint | Passed (exit 0) | `pnpm lint` |
| Type-check | Passed (exit 0) | `pnpm type-check` |
| Production build | Passed (exit 0) | `pnpm build`; existing chunk-size advisory |
| CRUD browser acceptance | Passed | recipe-journal (final account switch, initial failure and cached recovery), recipe-forms (create/edit/delete) and recipe-discovery scripts |
| Quick AI browser acceptance | Passed | quick-ai-entry.browser.mjs, including non-live cooldown and stable viewport/reflow checks |
| AI Chef browser acceptance | Passed | ai-chef.browser.mjs: FE-11 scenarios A-E plus rate-limit/input-preservation retry |
| Journal regression | Passed | journal-shell and mori-dialogue scripts, all required widths/reflow |
| Git whitespace check | Passed | `git diff --check` |
| Real backend E2E | Not run | Local runner starts Supabase infrastructure; no backend environment was provisioned or changed |

Validation logs, including intermediate failures and final passing runs, are preserved outside Git at `C:/Users/ongan/AppData/Local/Temp/moris-fe13-validation-c9fd1d8cd1f243998a0d374e854736b0`. Final evidence: `fe13-release-tests.log`, `fe13-release-lint.log`, `fe13-release-types.log`, `fe13-release-build.log`, `fe13-release-browser-journal.log`, `fe13-release-browser-quick.log`, `fe13-complete-browser-chef.log`, and the forms/discovery/shell/Mori browser logs. Browser screenshots remain in their printed temporary or ignored test-results locations.

Synthetic sessions and intercepted/local fixture HTTP responses establish frontend behavior, not live persistence. Browser coverage includes pending versus empty, initial fetch failure, failed refresh retaining data, retry, edit/delete failure preservation, AI provider failure, cooldown and input retention, partial/expired/ambiguous lineage and no duplicate writes, keyboard/focus, reduced motion, 320/375/768/1440 px and 200%-equivalent reflow. Unit regressions additionally cover account-scoped caches, old-account aborts and late results, dirty navigation, session loss, and storage verification.

## Stage 2: deferred image integration checklist

Do not treat the full FE-13 issue as complete until this is done against stable FE-12 code.

1. Verify the actual committed FE-12 branch/SHA, its published/reviewed state, and the actual API/UI contracts. Do not use uncommitted worktree contents as dependencies.
2. Inspect both histories and overlapping files. Create a recovery branch for FE-13 before integrating.
3. Choose a non-destructive integration strategy based on publication state. Prefer a normal merge when appropriate; a separate integration branch/PR can keep reviews independent. Do not rewrite reviewed history, force-push, silently retarget a PR, or integrate automatically.
4. Resolve conflicts semantically: retain FE-12 processing/upload/attachment/private-image logic and FE-13 state, input preservation, account isolation, and truthful persistence handling.
5. Verify empty selection/cancel, picker errors, decode/compression errors, and current-image/local-preview handling.
6. Verify upload authorization 401/403/429, unavailable feature/configuration, network/R2 PUT failures, cancellation, signed URL expiry, and authorization renewal. Never reuse expired upload URLs blindly.
7. Verify backend upload verification and attachment failure/uncertainty separately. Retry only the failed step; preserve already-confirmed recipe/image operations.
8. Preserve the existing attached image if any replacement step fails. Check private image-read failure/fallback/expiry without leaking private URLs across accounts.
9. Confirm delete/image cleanup semantics still belong to FE-12/FS-05; do not invent destructive cleanup recovery.
10. Add combined unit/browser cases for each image state, input preservation, request ordering/counts, duplicate-write protection, and partial recipe/image success. Repeat widths/reflow, keyboard, alerts, reduced motion, and account changes.
11. Run full combined frontend and appropriate backend tests. Review final diff and branch relationships before any separately authorized publication.

## Remaining limits and final classification

- Image-state acceptance is deferred; Stage 2 has not been performed.
- Real backend persistence, authorization, quota timing/CORS exposure, R2 behavior and production deployment are not established by mocked frontend tests.
- An unconfirmed recipe create has no supported lookup/idempotency key for deterministic reconciliation. UI reports uncertainty and advises checking the journal; it cannot guarantee deduplication if a user repeats an unconfirmed create.
- Chef cooldown is scoped to the mounted account session page; reloading/remounting can lose that UI deadline. Backend quota enforcement remains authoritative. Draft inputs and confirmed recovery identifiers use existing scoped storage/memory.
- The existing build chunk-size advisory is retained. Quick AI countdown uses a non-live timer; Chef adds a stable announcement. No broad animation, layout or auth refactor was attempted.
- FE-12 shared-file conflicts and combined image/recipe partial success require semantic integration and complete retesting.

Classification: **Stage 1 implemented with documented limitations; image integration pending.** No remote writes. Final local commit SHA and clean-worktree verification are supplied in the delivery message.

## Delivery file manifest

- `docs/FE-13-stage-1-report.md`
- `frontend/e2e/ai-chef.browser.mjs`
- `frontend/e2e/authenticated-crud.spec.ts`
- `frontend/e2e/quick-ai-entry.browser.mjs`
- `frontend/e2e/recipe-forms.browser.mjs`
- `frontend/e2e/recipe-journal.browser.mjs`
- `frontend/src/ai-chef/AIChefPage.test.tsx`
- `frontend/src/ai-chef/AIChefPage.tsx`
- `frontend/src/ai-chef/generateRecipe.ts`
- `frontend/src/api/retryAfter.test.ts`
- `frontend/src/api/retryAfter.ts`
- `frontend/src/pages/RecipeDashboardPage.tsx`
- `frontend/src/pages/RecipeDetailPage.tsx`
- `frontend/src/quick-ai/ExtractedRecipeReviewPage.test.tsx`
- `frontend/src/quick-ai/QuickAiEntryPage.test.tsx`
- `frontend/src/quick-ai/QuickAiEntryPage.tsx`
- `frontend/src/recipe-form/submission.test.ts`
- `frontend/src/recipe-form/submission.ts`
- `frontend/src/recipes/DeleteRecipe.test.tsx`
- `frontend/src/recipes/RecipeScreens.test.tsx`
- `frontend/src/recipes/RecipeStates.tsx`

Validation development notes: early checks caught expected-message assertions that needed updating for truthful error copy, a frozen-clock test that needed a progressing clock, an account-switch fixture that needed to use the actual SDK session event, a viewport assertion racing CSS viewport recalculation, and one delete-recovery timeout while browser suites ran concurrently. The final full suite runs explicitly with one worker after the browser jobs finish. The latter now uses the existing settleJournalLayout helper before asserting the same geometry limits. These corrections do not remove tests, suppress errors, or relax layout assertions. Final results above supersede intermediate failed runs. The final single-worker suite passed the unchanged delete-recovery assertions. Final ESLint, TypeScript and production build each returned exit 0.
