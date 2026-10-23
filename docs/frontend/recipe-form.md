# FE-05 reusable recipe form

## Status and branch foundation

FE-05 implements and tests the reusable create/edit form and protected page
boundaries. **Recipe mutation wiring, edit/rating support, query mutation
wiring, and production acceptance remain pending.** No backend persistence is
simulated in the application.

FE-05's editor is composed with FE-04's protected dashboard and query provider.
The default create and edit routes still have no save adapter or edit-record
loader, so they cannot persist or load saved recipes. The form keeps its injected
callback and record-loading interfaces; it adds no competing query provider,
key factory, fetch client or domain loader.

## Components and routes

| Component/file | Responsibility |
| --- | --- |
| `recipe-form/RecipeForm.tsx` | Endpoint-independent controlled form, stable rows, ordering, validation, pending/error/success feedback, lifetime/cancellation guards, unsaved-change warning |
| `recipe-form/draft.ts` | Zod frontend draft schema, editor normalization, ordered step serialization; not a REST request schema |
| `recipe-form/RecipeFormField.tsx` | Accessible labels, hints and field errors |
| `recipe-form/submission.ts` | Host callback/record types, safe error mapping and confirmation checks |
| `recipe-form/useRecipeSave.ts` | Current-context session preflight and expected account/signal propagation; no token attachment or HTTP |
| `recipe-form/RecipeEditorFrame.tsx`, `recipe-form.css` | Scoped responsive journal styling and account-keyed form lifetime |
| `pages/CreateRecipePage.tsx` | Create mode; injected confirmed-save callback; existing journal navigation |
| `pages/EditRecipePage.tsx` | Host-supplied loading/error/record state; refuses absent, mismatched-route or old-account records; edit/rating callback |
| `recipe-form/testing/fixtures.ts` | Test-only draft data; never imported by application code |

Protected routes reuse FE-03's existing AuthProvider, AuthReady and
ProtectedRoute:

- `/app` and `/app/recipes`: FE-04's protected recipe dashboard and collection.
- `/app/recipes/:recipeId`: FE-04's protected recipe detail page.
- `/app/recipes/new`: editable local form with an upfront unavailable notice.
  Save reports that nothing was saved when no integration is supplied.
- `/app/recipes/:recipeId/edit`: unavailable until a matching account-scoped
  record is supplied by an edit loader. It never creates a blank edit
  form for missing data. Host-provided loading, retry and access-error states
  are supported.
- Unknown `/app/*` routes show the protected not-found page.

The form supports both modes and optional initial values suitable for a future
Quick AI Entry preview. Same-record prop refreshes do not reinitialize a dirty
form. A recoverable background load failure preserves it. 401/403/404 loading
failures remove the form; account and recipe identity changes remount or hide it.

## Field rules and schema boundaries

The available shared Zod source is
`supabase/functions/_shared/ai/schemas.ts`, imported through Deno's
`npm:zod@3.22.4`. It defines extraction/demo shapes and cannot be imported
directly into Vite. The BE-05 create contract is documented in
[`docs/api/recipes.md`](../api/recipes.md); FE-05 pins browser Zod to the same
version and provides a draft-validation bridge, with ingredient/instruction
output types checked against FE-02's existing types. The form draft is not the
BE-05 transport schema. Backend validation remains authoritative.

| Field | Implemented behavior | Published basis / pending decision |
| --- | --- | --- |
| Title | Trimmed, required, field-level error and focus | Demo schema requires a nonempty title; no published maximum |
| Ingredients | Add/edit/remove/reorder; stable keys; name, optional numeric amount/unit/amount description; inferred flag preserved | Shared ingredient fields; no required units, enum or item minimum |
| Quantity | Blank becomes null; finite decimal number; zero and negative values allowed because no shared lower bound exists | Shared nullable number; fractional text such as `1/2` belongs in amount description rather than a numeric guess |
| Steps | Add/edit/delete/reorder; multiline text; serialize contiguous positions 1..n | Shared `{ step, text }` objects; no published text/item minimum |
| Rating | Unrated/null or integer 1–5; existing values retained | Shared/demo schema and BE-05 create contract use this scale; BE-06 update/rating semantics remain pending |
| Cooked date | Optional/null or real `YYYY-MM-DD` calendar date; no timezone conversion | Shared date-only shape; no invented future/past restriction |
| Notes | Optional multiline local draft, default empty, rendered as plain text | No notes field/column or maximum has been published; not a final API field |

The published shared schemas allow empty arrays and empty nested ingredient/step
text. The editor shows empty-state guidance and validates types but does not
invent nonempty-list/text requirements. It also imposes no arbitrary character
caps. Tests record these boundaries explicitly. BE-05/BE-06 must confirm minimum
items, required nested text and maximum lengths before the live adapter ships.
Normalized server validation codes support `required`, `invalid` and `too-long`
feedback without rendering raw backend messages.

The current editor accepts the BE-05 create contract's rating range, but an
adapter still needs to map the draft to that request schema. BE-06 update/rating
semantics remain pending.

Notes are clearly labeled as local-only by default. If a connected callback is
supplied while notes are nonempty and `notesSupported` is false, submission is
blocked before invoking it. Text is retained. Do not enable `notesSupported`
until the backend explicitly supports persisting notes; never silently omit
them and claim success. No mock storage or localStorage draft persistence exists.

## Save and loading interfaces

The form receives `onSubmit(draft, { signal })`, with a normalized **frontend
draft**, and waits for a validated `{ id }` confirmation before displaying
success. This is a host UI interface, not an invented REST response envelope.
The adapter must map the actual confirmed backend response to it. Errors retain
all inputs. Unknown/5xx failures have a safe retry message; 401/403/404/422 are
handled without exposing exception text or server payloads. A normalized
`RecipeSubmissionError('validation', violations)` can identify fields by their
editor paths and safe error codes.

`CreateRecipePage` and `EditRecipePage` accept `save?: SaveRecipeDraft`:

```ts
type SaveRecipeDraft = (
  draft: RecipeDraft,
  context: { userId: string; signal: AbortSignal },
) => Promise<{ id: string }>
```

The page preflight checks FE-03's current context session and expiry; no token is
captured or attached. `userId` is expected-account context, not a backend
authorization claim. FS-02 must still obtain/refresh the current session at
request time and verify that expected account after asynchronous work. The
backend derives ownership from the JWT, never from this frontend identity.

Edit props are `record?: { id, userId, values }`, `isLoading`, `loadError`,
`onRetry`, `save`, and `notesSupported`. The host maps its validated detail DTO
into editable values; it must not pass a record cached for a previous account.
Edit confirmation must match the current route ID. The form keeps the entered
draft after successful saves; **Back to journal** navigates to existing `/app`.
Confirmed create and edit saves stay disabled while the current values match
the last confirmed draft. Editing the values enables another save; returning
to the already-confirmed values keeps the button disabled.

Pending fieldsets and a synchronous submission guard prevent duplicate saves.
Unmount/account changes abort the signal and ignore late results. This cannot
undo a request already accepted by the server; FS-02/backend must reconcile
that outcome. No automatic mutation retries or optimistic persistence claims
are implemented.

Dirty drafts warn on reload/tab close and on SPA navigation through links,
programmatic navigation, browser Back/Forward, and a change to another recipe.
The app mounts the existing route elements through React Router's data router
so the page-level `useBlocker` works; FE-03's AuthProvider, ProtectedRoute, and
route definitions remain shared. A confirmed save clears the block. Redirects
to `/login`, including logout or session expiry, bypass the prompt so
authentication cannot be trapped; the in-memory draft is discarded after that
redirect. The editor's Back button uses the same blocker, so it does not show a
second confirmation. Browser warnings also cannot guarantee recovery after
process crashes; drafts are memory-only.

## Review findings and remediation

| Severity | Location | Finding and evidence | Impact | Disposition |
| --- | --- | --- | --- | --- |
| Medium | `frontend/src/recipe-form/RecipeForm.tsx:62` | The first fresh test run showed the `beforeunload` listener could remain active immediately after a confirmed save because a passive effect had not removed it yet. | A clean form could still show a browser leave warning just after save. | Fixed by attaching/removing the listener in a layout effect; the existing regression now passes. |
| Medium (contract dependency) | `frontend/src/recipe-form/draft.ts:30` | Notes have no maximum-length rule because the backend has not published notes support or a limit. The default page blocks sending nonempty notes. | Notes cannot be persisted safely until the backend contract and maximum are known. | Keep notes local-only; add the confirmed limit to the shared browser schema and field feedback when BE-05/BE-06 publish it. |
| Low | `frontend/src/App.tsx:8` | The form pages are statically imported into the shared application entry. The fresh Vite build reports a 643.42 kB minified entry chunk (185.71 kB gzip), above the 500 kB warning threshold. | Larger initial download on routes that do not use the form. | Follow up with route-level code splitting if the bundle budget requires it; no unrelated bundler change was made in FE-05. |

Review also confirmed stable ingredient and step row keys, contiguous step
serialization, null handling for optional quantity/rating/date fields, date-only
serialization, preserved multiline notes, safe React rendering, safe error
mapping, and confirmed-response checks before success feedback. No recipe database
calls, second Supabase Auth client, hardcoded recipe write endpoint, or
production mock persistence were found. The `useBlocker` route guard now covers
links, programmatic navigation, Back/Forward, another recipe ID and the editor
Back action; FE-03 auth redirects bypass it to avoid trapping authentication.

BE-05's authenticated create contract is published in
[the recipe API handoff](../api/recipes.md), and FS-02 provides the shared
authenticated request client. FE-05 has not wired that contract to its save
callback. BE-06's update/rating contract and an edit-record loader are still
pending; the default routes cannot report a fake persistent success.

## Belen: FE-04 / FS-02 integration

1. Reuse FE-04's account-scoped QueryClientProvider and `recipeKeys`; do not add
   a second provider or key factory. FE-04 reference:
   [recipe-dashboard handoff](https://github.com/2ton-exe/moris-mix-ai/blob/feat/FE-04-recipe-dashboard/docs/frontend/recipe-dashboard.md).
2. Wire create to BE-05's authenticated `POST /functions/v1/recipes` contract
   through FS-02's client, mapping the form draft to the published request
   schema. Update and rating mutations still need BE-06's contract.
3. Map draft fields to approved write schemas; preserve untouched recipe fields
   such as flavor/lineage data by using the actual PATCH semantics. Validate
   confirmations with the real response schema before resolving `{ id }`.
4. Use the caller's AbortSignal and verify current account/session after token
   retrieval. Never retry writes blindly. Normalize safe status/field errors.
5. After confirmed persistence, invalidate the existing account list key and
   affected detail key, or use FE-04's `recipeKeys.all(userId)` when appropriate.
   Bind cache operations to the originating client/account and ignore obsolete
   results. Keep cache-refresh failures distinct from failed persistence.
6. Map FE-04's account-scoped detail query to EditRecipePage's loading/record
   props. These standalone pages own a `<main>`, so keep them outside the
   journal's existing `<main>` shell.
7. Add real adapter/mutation tests for token freshness, session races, write
   validation, confirmed persistence and list/detail invalidation. **Actual
   TanStack mutation execution and cache invalidation are deferred and not
   claimed tested on this FE-03-based branch.**

## Ramos: backend requirements

- [BE-06 #48](https://github.com/2ton-exe/moris-mix-ai/issues/48): publish update/
  rating PATCH semantics, supported fields, ownership and missing-recipe errors.
- Confirm notes support and its storage, limits for every field/list, nested
  required fields, date behavior, and preservation of fields absent from edits.
- Provide shared browser-compatible schemas. Do not treat the extraction/demo
  schema or database columns as a final create/update contract.
- Coordinate with [FS-02 #53](https://github.com/2ton-exe/moris-mix-ai/issues/53)
  on current Bearer tokens and consistent safe error handling. Inspection found
  create uses the published BE-05 contract; update/rating still needs BE-06.

FS-02's authenticated client is available, but FE-05 has not connected a recipe
mutation adapter. Keep the save callback behind the existing page interface.
At request time the adapter must retrieve or
refresh the current session, compare the expected account, attach the current
Bearer token, honor the passed `AbortSignal`, map safe status/field errors, and
return only after validating the real persistence response. It must not trust
the frontend `userId` for ownership. FE-05 does not create another Supabase
client or attach tokens itself.

## Validation and milestones

Validated on October 19, 2026 with Node 24.22.0 and pnpm 10.34.7. The frozen
install was run with `CI=true` because pnpm needed permission to recreate the
existing `node_modules` directory in the non-interactive shell. Tests use
deterministic callbacks/fixtures with no live credentials. FE-04 tests are not
inherited or copied; its branch remains untouched. All 124 FE-03/base regressions
remain part of this branch's test suite.

| Check | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with pnpm 10.34.7 |
| `pnpm lint` | Passed, zero warnings |
| `pnpm type-check` | Passed |
| `pnpm test` | 214 passed across 12 files: 124 FE-03/base + 90 FE-05 |
| `pnpm build` | Passed; entry 643.42 kB minified / 185.71 kB gzip; Vite emitted its 500 kB chunk warning |
| `git diff --check` plus untracked-file whitespace scan | Passed |
| Production artifact scan for test recipe content | No fixture content found |
| Edge browser, 1280/375/320 px | Passed protected create, dynamic rows, preserved amount and multiline steps, unavailable submission with retained draft, and unavailable edit; no horizontal overflow |
| Edge route navigation | Passed Browser Back blocking, Stay/Leave behavior, explicit Back confirmation, and no duplicate dialog |
| Browser network/console check | No external requests or page/console errors |

Browser checks used an isolated synthetic session with external requests
blocked. Screenshots were inspected at desktop and mobile widths. They do not
establish live authentication, persisted edits or server behavior.

Review caught and fixed a deferred-focus race: an animation-frame focus callback
could run after the user moved to the quantity field. Focus now completes during
the React layout phase; a regression verifies immediate focus and subsequent
typing. Browser assertions verify ingredient names and amounts after reordering.
Final review also added data-router blocking for SPA navigation and kept FE-03
login redirects clear of blockers. Create and edit saves now stay disabled for
the last confirmed values, including after a user edits and restores that draft.

Coverage includes schema boundaries, normalized quantities/units/dates, stable
row identity, step sequences, optional notes, create/edit callback confirmations,
safe failures, duplicate prevention, field-level server codes, link/programmatic/
Back/Forward/recipe navigation, pending-save navigation, switching edit IDs,
auth redirect bypass, account-switch reset, malformed initial data, expired
sessions, account changes, abort/late completion, and recoverable background
refresh failures. All fixtures stay test-only.

Known limitations: live API and query mutation/cache validation are blocked;
notes persistence and final field limits require backend decisions; notes have
no length validation until the backend publishes a maximum; auth redirects
intentionally discard an in-memory draft; permission/missing-record edit errors
hide the form and discard its in-memory values; and the Vite entry chunk exceeds
its 500 kB warning threshold. No production acceptance or complete Definition
of Done is claimed.

| Milestone | Status |
| --- | --- |
| Reusable form and page boundaries | Implemented |
| Deterministic draft/interaction/callback validation | Implemented; 214 frontend tests pass, including all FE-03 regressions |
| FE-04 query provider and route composition | Integrated; one provider and route tree |
| REST create integration | BE-05 contract and FS-02 client available; FE-05 adapter not connected |
| REST edit/rating integration | Blocked on BE-06 update contract and edit-record loader |
| TanStack mutations and real cache invalidation | Not implemented |
| Deployed production acceptance | Not performed |

FE-05 is ready for contract and shared-query integration, not fully Done. No
commit, push or PR should be made until the user approves the reviewed result.
