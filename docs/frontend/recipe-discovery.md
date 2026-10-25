# FE-07 recipe discovery handoff

Audit date: October 26, 2026 (Asia/Manila). Owner: Ong. Collaborators: Ramos and Belen.
Related issues: [FE-07 #59](https://github.com/2ton-exe/moris-mix-ai/issues/59), [BE-08 #50](https://github.com/2ton-exe/moris-mix-ai/issues/50).

**Status: frontend implementation and isolated acceptance complete; full FE-07 Definition of Done remains blocked by BE-08 and hosted acceptance.** Newest-first browsing and Load More use the existing, confirmed BE-06 contract. Production search, rating sort and filters remain visibly unavailable. There is no production search mock or invented REST parameter.

## Git safety and base

- Worktree: `C:/Users/ongan/PROJECTS/4TH YEAR/AI/moris-mix-ai-fe07`.
- Branch: `feat/FE-07-recipe-discovery`.
- Base and unchanged HEAD: `26863b843f5ede95f373e30a863052ce40be3cab`, latest fetched `origin/main` when work started, `[FS-03] Implement Playwright authenticated CRUD end-to-end journey (#79)`.
- Inspected status, worktrees, local/remote branches and the old `origin/main`, then fetched origin. No FE-07 branch or worktree existed; created both from the fetched main.
- Verified FE-03/04/05/06 merge commits are ancestors of `origin/main`: `5d981adc`, `c6d10196`, `b130d798`, `909b1130` respectively. Also inspected merged FS-02 #65, BE-05 #71 and BE-06 #72 metadata and their current code.
- Preserved the original FE-05 checkout (`moris-mix-ai`, HEAD `9da59c2`), FE-04 worktree (`moris-mix-ai-fe04-handoff`, HEAD `a06eca9`) and FE-06 worktree (`moris-mix-ai-fe06`, HEAD `432b143`). No resets, history rewrites, commits, pushes, PRs or merges were performed.

## Focused merged-foundation audit

| Area | Evidence and finding | Classification |
| --- | --- | --- |
| FE-03 routing/auth | The existing protected route tree and single AuthProvider remain intact. Account-keyed `RecipeQueryProvider` replaces the QueryClient and cancels/clears the old cache on account changes/logout. Tests cover late list/detail responses, restoration, callbacks and logout. | No blocking confirmed regression found. |
| FS-02 authenticated transport | Each REST call obtains the SDK-managed session and checks expiry and expected account before sending a Bearer token. AbortSignal passes through session lookup and fetch. Missing/expired/wrong-account sessions fail closed. Server 401/403 messages remain safe; 401 does not independently revoke an SDK session. | No confirmed regression; hosted expiry/refresh behavior remains pending acceptance. |
| FE-04 dashboard/detail | List key is `['recipes', userId, 'list']`; detail key is `['recipes', userId, 'detail', id]`. Legacy list adapter walks confirmed 1000-row offset pages until a short page. Loading, empty, unavailable, access-denied, refresh and retry states pass existing regressions. | No blocking confirmed regression found. |
| FE-05 saves | Confirmed POST/PATCH invalidates the account's lists and the edited detail. `notes` is nullable dedicated storage, independent of `raw_input`; `cooked_at` is a nullable, validated `YYYY-MM-DD` calendar date. Tests confirm saved forms can leave without an unsaved-change prompt. | No blocking confirmed regression found. |
| FE-06 deletes | The REST client requires HTTP 204. Unexpected 200/202 responses and errors do not claim success. Confirmed deletion removes the exact detail cache, invalidates lists and navigates to `/app/recipes`; notices are account-scoped. Ambiguous failures reconcile caches while preserving honest error/retry messaging. | No blocking confirmed regression found. |
| FE-07 cache compatibility | Existing mutations invalidated the legacy list key with `exact: true`. Nested discovery lists would remain stale under that behavior. Removed exact matching only for list invalidation in create/edit/delete success and delete reconciliation paths; detail matching remains exact. Extended mutation tests cover discovery variants and other-account isolation. | Relevant integration gap fixed as part of FE-07; not a pre-existing failing FE-03–06 behavior. |
| Keyboard focus after retry | The final review reproduced focus falling to the document body when the focused Load More/retry control disappeared. Added recovery to the next action, collection/empty heading or end status, with focus regressions. | Confirmed medium accessibility defect, fixed in FE-07. |
| Hosted services | Real signup email/callback delivery, deployed recipe CRUD, deployed pagination, refresh/expiry and hosted ownership/RLS were not exercised in this audit. | Pending live acceptance, not a confirmed code defect. |

No additional nonblocking FE-03–06 regression was confirmed that needs a separate fix. Historical handoff documents describe older backend blockers; current merged code and shared schemas were used for this audit. The current production bundle builds below Vite's default 500 kB warning threshold.

### GitHub CI reviewed

Read the actual PR-head workflow results through the connected GitHub API, rather than relying only on PR descriptions:

| Foundation | PR head | Reviewed result |
| --- | --- | --- |
| FE-03 #45 | `c6fcc858` | [CI #89](https://github.com/2ton-exe/moris-mix-ai/actions/runs/39191151198): success |
| FE-04 #63 | `09618b80` | [CI #103](https://github.com/2ton-exe/moris-mix-ai/actions/runs/39292462864): success |
| FE-05 #67 | `57a81a25` | [CI #177](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40086528610) and [Modular PR Validation #31](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40086528693): success |
| FE-06 #69 | `0f75dbae` | [CI #168](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40073825632) and [Modular PR Validation #25](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40073825581): success |
| FS-02 #65 | `c2c0402c` | [CI #105](https://github.com/2ton-exe/moris-mix-ai/actions/runs/39292756610): success |

Workflow success is historical CI evidence, not proof of hosted acceptance. FE-07 has no remote CI run because this handoff intentionally creates no commit or PR.

## Confirmed backend contract and missing BE-08 pieces

Inspected `supabase/functions/_shared/schemas.ts`, `_shared/ai/schemas.ts`, `recipes/index.ts`, `docs/api/recipes.md`, the FE-04 hooks, the recipe REST adapter and the FS-02 HTTP client. The repository's shared schemas live under `supabase/functions/_shared`, rather than a root `shared` directory.

BE-08 #50 is open, with unchecked contract tasks and no comments. No matching BE-08 branch appeared in the fetched remote refs or GitHub branch lookup, and no matching implementation PR was found by title search.

| Item | Confirmed behavior / missing decision |
| --- | --- |
| Endpoint | Authenticated `GET /functions/v1/recipes`. No browser recipe-table access. |
| Title search | No parameter or matching semantics defined. Unknown query parameters are currently ignored by the handler, so sending a guessed search parameter would falsely display unfiltered results. |
| Ingredient search | No parameter, ingredient-field matching or title/ingredient combination semantics defined. |
| Newest sort | Existing fixed order: `created_at DESC`, then `id ASC`. No sort parameter is needed or sent. |
| Rating sort | No parameter, direction, null-rating position or deterministic secondary/tertiary ordering defined. |
| Filters | No confirmed filter names or values. Production defines none. |
| Pagination | BE-06 supports `limit` (integer 1–1000; default 1000) and `offset` (non-negative safe integer; default 0), rejecting duplicate/invalid pagination values. FE-07 requests 24 rows per page. |
| Envelope | Existing `RecipeListResponseSchema`: `{ recipes: Recipe[] }`. Each record must belong to the expected account before it reaches the frontend cache. |
| Continuation | Existing documented rule: a page shorter than the requested limit is terminal; otherwise increase offset by the requested limit. No `has_more`, count or cursor is present. |
| Stable pages | Existing backend tie-breaker is deterministic for an unchanged collection. Offset pages can shift during concurrent writes; the frontend deduplicates IDs, but cannot guarantee snapshot completeness. BE-08 must define any stronger consistency/cursor guarantees. |

A full final page can require one additional empty request to learn that the collection ended. Load More follows the documented full-page continuation rule; it does not claim an exact remaining count. A short/empty terminal page removes the button. No opaque cursor is fabricated from recipe fields.

Ramos must define and implement the missing BE-08 schemas, parameters and ordering semantics. The adapter can then map those confirmed values, validate the new wire envelope and advertise only the capabilities that actually work. Belen should review that mapping against the existing authenticated transport and account conventions.

## Implemented controls and states

- An accessible discovery region with a labeled search input, title/ingredient/both scope selector, sort selector and capability-driven filter selectors. Production disables search, rating and filters with a visible explanation. No unsupported filter choices are shipped.
- When an adapter advertises confirmed search support, input debounces for 300 ms, preserves the typed value during requests and immediately hides cards for the previous input. Superseded requests are cancelled and checked again after asynchronous completion. These supported-search paths are exercised only with a clearly marked test adapter until BE-08 is available.
- Filters use only the supplied adapter's supported option values. Active selections remain visible and can be reset with search and sort. No page is locally filtered or locally sorted.
- Newest-first browsing uses the actual backend order. Rating UI wiring is implemented but disabled in the live adapter until its order is defined.
- Load More appends one page, preserves the server's first position per ID and lets overlapping later records refresh card metadata. A synchronous guard and `cancelRefetch: false` prevent duplicate next-page work. It stays disabled during fetching.
- Initial skeleton, same-query refresh, no saved recipes, no matching search/filter results, safe first-page failure, retained cards plus next-page retry, offline feedback, end-of-results and unavailable integration/feature explanations are implemented.
- After a keyboard-triggered first-page or later-page retry finishes and its control disappears, focus moves to the loaded collection/empty-state heading, retry control, or end-of-results status. Changing filters while a request is pending keeps focus on the newly selected control.
- Authentication/access errors suppress cached cards from every page and keep the existing reauthentication/access-denied guidance. Page errors never claim backend success.
- Existing slate/sage colors, cards, spacing, focus outlines and responsive journal layout are reused.

## Query and cache architecture

The existing `RecipeQueryProvider` and its per-account QueryClient remain the sole recipe provider. The live dashboard uses `useInfiniteQuery`; the old `useRecipes` remains compatible with preview/legacy adapters and existing consumers without issuing a second live list request.

Discovery keys extend the established list prefix:

```text
['recipes', userId, 'list', 'discovery', {
  search, searchMode, sort, filters
}]
```

The initial page parameter is `null` at the frontend adapter boundary. The live adapter maps it to confirmed offset zero and supplies subsequent numeric offsets itself. `RecipeContinuation` permits future adapter-owned string or numeric values; it is not a BE-08 wire token definition. The hook validates page view models and continuations and rejects a non-progressing continuation. No previous-query placeholder data is used.

Changing controls removes inactive discovery variants so returning to an earlier query also starts at its first page. A new query key resets the active page chain. The existing account-keyed provider remount resets controls, pages, pending operations and private caches on account switching/logout. Same-account token refresh preserves the cache and still obtains a fresh SDK session for the next HTTP call.

Create/edit/delete invalidate all discovery variants using the account's list prefix. Successful edit also invalidates the exact detail; confirmed delete removes that detail. Account checks, abort handling and safe error presentation are preserved. The old all-pages list adapter remains available to existing consumers; dashboard discovery no longer needs to download the whole account before showing the first page.

## Validation actually performed

Environment: Node `24.22.0`, pnpm `12.11.2`, Windows/PowerShell. Only frontend dependencies were needed. Frozen installation left the tracked lockfile unchanged.

| Command / check | Actual result |
| --- | --- |
| `pnpm --dir frontend install --frozen-lockfile` | Passed |
| Initial focused foundation run: `pnpm --dir frontend test src/auth src/api/http.test.ts src/recipes src/recipe-form` | 265 tests passed across 12 files, before dashboard wiring |
| Focused recipe/form run: `pnpm --dir frontend test src/recipes src/recipe-form/RecipePages.test.tsx` | 146 tests passed across 6 files; three further discovery regressions were subsequently added |
| Final focused review run: `pnpm --dir frontend test src/recipes src/recipe-form/RecipePages.test.tsx` | **151 tests passed across 6 files** |
| `pnpm --dir frontend lint` | Passed, zero warnings/errors |
| `pnpm --dir frontend type-check` | Passed |
| `pnpm --dir frontend test` | Final run: **350 tests passed across 19 files**, zero failures |
| `pnpm --dir frontend build` | Passed; 173 modules, JS 483.04 kB / 146.20 kB gzip, CSS 15.16 kB / 3.87 kB gzip; no chunk-size warning |
| `node frontend/e2e/recipe-discovery.browser.mjs` | Passed Chrome checks at **1280px, 375px and 320px**, including focus after retries |
| `git diff --check` and final file inventory | Passed; 20 files changed, no commit created |

The new discovery screen tests cover labels, debounce timing, superseded responses, pending input, filter/scope/sort identity, initial/empty/no-match/error states, next-page retry, duplicate requests/cards, pagination resets including revisited queries, end states, access loss, logout/account switches, private control resets, prefix invalidation, unavailable production capabilities, malformed adapter pages, refresh gating during debounce and focus recovery after initial/later-page retries. Adapter tests cover exact confirmed URLs, one-page fetching, authenticated headers/signals, owner checks, unsupported operations/tokens and exact-page-multiple termination. Existing create/edit/delete tests now assert discovery invalidation as well as prior behavior.

Browser acceptance runs the actual application route tree with isolated synthetic auth and intercepted REST responses. It checks no horizontal overflow, disabled unconfirmed controls, keyboard focus/Enter for pagination and retry, focus recovery when pagination controls disappear, retained cards after page failure, deduplication, terminal state, logout and absence of page exceptions. Initial 1280px and 320px screenshots were visually inspected. Screenshots are generated in a temporary directory printed by the script; the final review run used `C:/Users/ongan/AppData/Local/Temp/moris-fe07-browser-H0l4LZ`. No fixtures enter production assets, and the script blocks unexpected external requests.

No hosted Supabase request, hosted database/RLS acceptance, live email acceptance or new local Supabase/Docker CRUD journey was run. Existing deterministic FE-03–06 regressions passed in the full frontend suite. Browser checks establish UI behavior against controlled responses, not deployed service availability.

## Changed files

| File | Purpose |
| --- | --- |
| `frontend/src/pages/RecipeDashboardPage.tsx` | Controls, paged collection and all discovery states |
| `frontend/src/components/ErrorState.tsx` | Optional retry-button focus ref for recovery |
| `frontend/src/recipes/RecipeStates.tsx` | Pass dashboard retry focus ref through safely |
| `frontend/src/recipes/DiscoveryControls.tsx` | Accessible capability-gated search/filter/sort UI |
| `frontend/src/recipes/discoveryTypes.ts` | Typed frontend criteria, capabilities and page adapter boundary |
| `frontend/src/recipes/useDiscoveryControls.ts` | Debounce, criteria/reset state and inactive-page reset |
| `frontend/src/recipes/useRecipeDiscovery.ts` | Infinite queries, page validation, deduplication and load guard |
| `frontend/src/recipes/apiSource.ts` | Actual BE-06 one-page REST adapter and unavailable BE-08 capabilities |
| `frontend/src/recipes/types.ts` | Optional discovery adapter on the existing source |
| `frontend/src/recipes/queryOptions.ts` | Discovery identity under the account list prefix |
| `frontend/src/recipes/queries.ts` | Disable legacy fetching when discovery owns the dashboard |
| `frontend/src/recipes/useDeleteRecipe.ts` | Invalidate every discovery variant after deletion/reconciliation |
| `frontend/src/recipe-form/useRecipeSave.ts` | Invalidate discovery variants after confirmed create/edit |
| `frontend/src/styles.css` | Responsive controls, availability and pagination styling |
| `frontend/src/recipes/RecipeDiscovery.test.tsx` | Discovery and focus regressions |
| `frontend/src/recipes/apiSource.test.ts` | Confirmed pagination and unsupported-contract regressions |
| `frontend/src/recipes/DeleteRecipe.test.tsx` | Discovery invalidation after confirmed delete |
| `frontend/src/recipe-form/RecipePages.test.tsx` | Discovery invalidation after confirmed create/edit |
| `frontend/e2e/recipe-discovery.browser.mjs` | Reproducible isolated Chrome acceptance at three widths |
| `docs/frontend/recipe-discovery.md` | This audit and handoff |

## Consultation and Definition of Done

**Ready for a limited frontend consultation:** explain the disabled BE-08 controls, demonstrate newest-first pages, Load More, retry and account isolation with the isolated browser harness, and review the tested adapter boundary. With a configured and working deployed BE-06 service, the same UI is wired for real newest-first browsing; that service has not been accepted live in this task.

**Not ready to claim a complete live search/filter/rating demonstration.** Those features require BE-08's contract and implementation, adapter mapping and hosted acceptance. Do not enable capability flags alone or pass guesses to the current handler, which ignores unknown parameters.

- Completed: Git isolation, focused foundation audit, historical CI review, confirmed BE-06 pagination, discovery UI/boundary, account-safe query/cache integration, regression tests, three-width browser checks, frontend lint/type-check/tests/build, whitespace check and handoff documentation.
- Remaining: BE-08 title/ingredient semantics and parameters, rating ordering/null rules, supported filters, pagination/envelope confirmation, any stronger page consistency guarantee, implementation mapping and live authenticated integration/ownership/session acceptance with Ramos and Belen.
- Overall FE-07 DoD: **incomplete due to the explicitly unavailable backend features and unverified hosted acceptance**. No commit, push, PR or merge is included in this handoff.
