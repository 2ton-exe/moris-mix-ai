# FE-05 reusable recipe form

## Status and branch foundation

FE-05 implements the reusable create/edit form and protected page boundaries.
The default pages use FS-02's authenticated REST client for recipe GET, POST,
and PATCH operations. Confirmed saves invalidate the signed-in account's recipe
list and, for edits, the edited recipe detail. Production acceptance remains
pending. No backend persistence is simulated in the application.

FE-05's editor is composed with FE-04's protected dashboard and query provider.
The default create and edit routes persist through the authenticated REST
adapter; edit loads a matching account-scoped record before showing the form.
The form keeps its injectable callback and record-loading interfaces; it adds
no competing query provider, key factory, fetch client or domain loader.

## Components and routes

| Component/file | Responsibility |
| --- | --- |
| `recipe-form/RecipeForm.tsx` | Endpoint-independent controlled form, stable rows, ordering, validation, pending/error/success feedback, lifetime/cancellation guards, unsaved-change warning |
| `recipe-form/draft.ts` | Zod frontend draft schema, editor normalization, ordered step serialization; not a REST request schema |
| `recipe-form/RecipeFormField.tsx` | Accessible labels, hints and field errors |
| `recipe-form/submission.ts` | Host callback/record types, safe error mapping and confirmation checks |
| `recipe-form/useRecipeSave.ts` | Current-context session preflight, REST save, expected account/signal propagation and confirmed-save cache invalidation |
| `recipe-form/RecipeEditorFrame.tsx`, `recipe-form.css` | Scoped responsive journal styling and account-keyed form lifetime |
| `pages/CreateRecipePage.tsx` | Create mode; injected confirmed-save callback; existing journal navigation |
| `pages/EditRecipePage.tsx` | Authenticated detail loading and host-supplied loading/error/record states; refuses mismatched-route or old-account records; edit/rating callback |
| `recipe-form/testing/fixtures.ts` | Test-only draft data; never imported by application code |

Protected routes reuse FE-03's existing AuthProvider, AuthReady and
ProtectedRoute:

- `/app` and `/app/recipes`: FE-04's protected recipe dashboard and collection.
- `/app/recipes/:recipeId`: FE-04's protected recipe detail page.
- `/app/recipes/new`: editable form that creates recipes through authenticated
  `POST /functions/v1/recipes`.
- `/app/recipes/:recipeId/edit`: loads the matching account-scoped record over
  authenticated GET and saves edits and ratings through PATCH. Loading, retry,
  and access-error states are supported.
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
| Rating | Unrated/null or integer 1–5; existing values retained | BE-05 create and BE-06 update contracts use this scale |
| Cooked date | Optional/null or real `YYYY-MM-DD` calendar date; no timezone conversion | Shared date-only shape; no invented future/past restriction |
| Notes | Optional multiline value, default empty, rendered as plain text and persisted | BE-06 accepts nullable notes; no maximum length is published |

The published shared schemas allow empty arrays and empty nested ingredient/step
text. The editor shows empty-state guidance and validates types but does not
invent nonempty-list/text requirements. It also imposes no arbitrary character
caps. Tests record these boundaries explicitly; no minimum item counts,
required nested text, or maximum lengths are published for those fields.
Normalized server validation codes support `required`, `invalid` and `too-long`
feedback without rendering raw backend messages.

The REST adapter maps the editor's rating and notes to the published create and
update contracts. If a host callback is supplied while notes are nonempty and
`notesSupported` is false, submission is blocked before invoking it. Text is
retained. No mock storage or localStorage draft persistence exists.

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
| Medium (contract dependency) | `frontend/src/recipe-form/draft.ts:30` | The published BE-06 notes field has no maximum-length rule. | The UI accepts the API's current contract without inventing a client-only limit. | Add a shared limit and field feedback if the backend publishes one. |
| Low | `frontend/src/App.tsx:8` | The form pages are statically imported into the shared application entry. The fresh Vite build reports a 643.42 kB minified entry chunk (185.71 kB gzip), above the 500 kB warning threshold. | Larger initial download on routes that do not use the form. | Follow up with route-level code splitting if the bundle budget requires it; no unrelated bundler change was made in FE-05. |

Review also confirmed stable ingredient and step row keys, contiguous step
serialization, null handling for optional quantity/rating/date fields, date-only
serialization, preserved multiline notes, safe React rendering, safe error
mapping, and confirmed-response checks before success feedback. No recipe database
calls, second Supabase Auth client, hardcoded recipe write endpoint, or
production mock persistence were found. The `useBlocker` route guard now covers
links, programmatic navigation, Back/Forward, another recipe ID and the editor
Back action; FE-03 auth redirects bypass it to avoid trapping authentication.

BE-05's authenticated create contract and BE-06's update/rating contract are
published in [the recipe API handoff](../api/recipes.md). FE-05 wires the
default pages to FS-02's authenticated request client and validates the
returned recipe envelope and owner before reporting success.

## FE-04 / FS-02 integration status

1. Reuses FE-04's account-scoped QueryClientProvider and `recipeKeys`; no second
   provider or key factory is added. FE-04 reference:
   [recipe-dashboard handoff](https://github.com/2ton-exe/moris-mix-ai/blob/feat/FE-04-recipe-dashboard/docs/frontend/recipe-dashboard.md).
2. Wires create to BE-05's authenticated `POST /functions/v1/recipes` contract
   and edits/rating to BE-06's PATCH contract through FS-02's client.
3. Maps draft fields to the published write schemas and validates the real
   response before resolving `{ id }`; omitted PATCH fields remain untouched.
4. Uses the caller's AbortSignal and verifies the current account/session after
   token retrieval. Writes are not blindly retried; errors are normalized.
5. After confirmed persistence, invalidates the account list and, for edits,
   the affected detail key. Cache operations are account-scoped; cache-refresh
   failures do not turn confirmed persistence into a failed save.
6. Loads the FE-04 account-scoped detail into the editor after validating the
   route ID and owner. These standalone pages own a `<main>`, so they remain
   outside the journal's existing `<main>` shell.
7. Adapter and page tests cover authenticated requests, validation, confirmed
   persistence, and list/detail invalidation.

The adapter retrieves the current session at request time, checks the expected
account, attaches the current Bearer token, honors the passed `AbortSignal`,
maps safe status/field errors, and validates the real persistence response. It
does not trust the frontend `userId` for ownership or create another Supabase
client.

## Validation and milestones

Historical validation for the original FE-05 form work was run on October 19,
2026 with Node 24.22.0 and pnpm 10.34.7, before the BE-06 integration. The frozen
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

Known limitations: production acceptance has not been performed; notes have no
published maximum length; auth redirects intentionally discard an in-memory
draft; permission/missing-record edit errors hide the form and discard its
in-memory values; and the Vite entry chunk exceeds its 500 kB warning threshold.

| Milestone | Status |
| --- | --- |
| Reusable form and page boundaries | Implemented |
| Deterministic draft/interaction/callback validation | Implemented; 214 frontend tests pass, including all FE-03 regressions |
| FE-04 query provider and route composition | Integrated; one provider and route tree |
| REST create integration | Implemented with authenticated POST and response validation |
| REST edit/rating integration | Implemented with authenticated GET/PATCH and response validation |
| Account-scoped query invalidation after confirmed saves | Implemented and covered by page tests |
| Deployed production acceptance | Not performed |

FE-05 is integrated with the published REST contracts. Deployed production
acceptance remains open.
