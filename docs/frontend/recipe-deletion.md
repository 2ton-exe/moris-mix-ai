# Recipe deletion (FE-06)

## Implementation overview

The recipe detail screen uses a reusable `DeleteRecipeDialog` and `RecipeDeletionControl`. The control opens only from an authenticated recipe detail view. It asks the existing `RecipeSource` for an optional `deleteRecipe(id, request)` handler; the handler receives the recipe ID plus the account-scoped request (`userId` and `AbortSignal`). No route, HTTP method response envelope, or success status is assumed here.

The FE-04 base has no configured production delete adapter. If a recipe is loaded through a source that does not provide deletion, its detail screen shows a disabled **Delete unavailable** action and an explanatory status. The default production source is currently unavailable for both listing and detail, so the recipe cannot load and FE-04's recipe-unavailable state is shown instead. Neither case sends a delete request or changes recipe data. Preview fixtures also have no delete adapter.

## Confirmation and mutation states

- **Idle:** the delete action opens the confirmation dialog when an authenticated handler is configured.
- **Confirmation:** the dialog names the recipe, warns that deletion cannot be undone, and offers Cancel and Delete. Cancel and Escape close it without invoking the handler. Focus moves into the dialog, stays within it for Tab navigation, and returns to the trigger when the dialog closes.
- **Pending:** the dialog announces the recipe being deleted and disables both actions. A synchronous submit guard prevents a second request before React renders the pending state. Escape does not close an in-flight dialog.
- **Success:** the injected handler must resolve only after the backend confirms deletion. Only then does the mutation remove the account-scoped detail cache, invalidate that account's collection, navigate to the collection, and display a generic success status scoped to that account.
- **Error:** server payloads are never rendered. 401/403/404 and permanent client rejections are non-retryable from the current dialog. Network failures, timeouts/abort errors, malformed responses, unexpected adapter failures, and retryable server failures explain that the outcome could not be confirmed and allow a deliberate retry. Errors invalidate detail and collection queries for reconciliation while retaining the last confirmed detail until a refetch determines its state.

There is no optimistic removal and no automatic mutation retry. A failed or interrupted request is not reported as a successful deletion. An adapter that ignores abort may still have reached the backend; after an account change or unmount, the hook ignores any late success and the account-scoped query provider clears its cache.

## TanStack Query and account isolation

The mutation uses FE-04's existing `RecipeQueryProvider` and `recipeKeys`; it does not create a second client. On confirmed success it removes exactly `recipeKeys.detail(userId, recipeId)` and invalidates exactly `recipeKeys.lists(userId)`. On failure it invalidates that detail and collection so a 404 or an interrupted response can be reconciled. No optimistic cache update is applied.

The user ID is used only to select the account-scoped cache and is passed as adapter context. It is not an authorization claim. The authenticated adapter must compare the current Supabase session subject with that ID before sending a bearer token. The existing account-keyed provider cancels queries and clears the previous account's cache when the authenticated user changes or logs out.

## API integration boundaries

BE-06's exact route, success status, and response envelope are not available in the FE-04 base. The optional handler is the seam for that future adapter. It must reject on every unconfirmed outcome and resolve `void` only after validating whatever success contract BE-06 approves. The UI does not call `supabase.from()` and does not implement backend behavior.

The inspected FS-02 authenticated JSON client is on a separate branch from this FE-04 base and currently exposes authenticated GET and POST helpers, but no DELETE helper. The FE-06 change does not copy or invent that transport. Belen and Ramos need to provide or integrate an authenticated DELETE-capable REST adapter and its agreed contract before production deletion can be enabled.

### Required BE-06 contract

- Final authenticated DELETE route and recipe ID encoding rules.
- Exact success status and whether success has an empty body or a response envelope.
- Safe, stable status behavior for 401, 403, 404, validation/conflict responses, and server failures.
- Ownership enforcement in the backend and PostgreSQL RLS; a client-supplied `userId` must never grant access.
- Bearer JWT validation and safe errors that do not disclose another user's recipe or raw database details.

### Required FS-02 integration

- Reuse its session-aware authenticated REST client and reject expired, missing, or mismatched sessions before sending the request.
- Add DELETE support only after the API contract is agreed; preserve `AbortSignal` handling and keep transport payloads opaque to the UI.
- Map a confirmed backend success to handler resolution. Map network interruption, malformed success responses, and 5xx errors to rejection so the UI can reconcile instead of claiming success.
- Do not add direct Supabase table access or a mock persistence fallback.

## Security considerations

The delete control exists only in the authenticated detail route and only when the recipe is present in the authenticated, account-scoped recipe query. This is UI gating, not an authorization boundary. BE-06 must independently authenticate the bearer token, verify recipe ownership, enforce RLS, and return safe errors. The client never treats the route ID or `userId` as proof of ownership.

## Tests

`frontend/src/recipes/DeleteRecipe.test.tsx` covers opening and canceling confirmation, keyboard focus and Escape, pending feedback and same-tick duplicate-submit prevention, confirmed navigation, detail-cache removal and list refresh, retry after network failure, safe timeout/unexpected-error/500/401/403/404 handling, account-cache isolation, account-switch/logout/unmount during a pending request, account-scoped success feedback, unavailable integration behavior, and request context passed to the injected adapter. The existing FE-04 screen/query tests remain in place and are run alongside the new tests.

All deletion tests use deterministic injected handlers. They do not require Supabase credentials and do not exercise a live BE-06 endpoint.

Validation on the FE-06 worktree: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`, and `git diff --check` pass. The suite reports 194 passing tests across 12 files. The production bundle is 343.27 kB JavaScript (107.01 kB gzip) and 11.34 kB CSS (3.22 kB gzip), with no build warnings.

## Known limitations and Definition of Done

- **Frontend implementation:** complete on the FE-04 base. ESLint, TypeScript, all frontend tests, and the production build pass.
- **Mock testing:** complete. The full frontend suite passes 194 tests across 12 files, including the FE-03 auth tests and FE-04 dashboard/detail regression tests.
- **Live API integration:** not complete; BE-06's contract and a DELETE-capable FS-02 adapter are blockers.
- **Production acceptance:** not complete until live authenticated ownership/RLS behavior, response interruption handling, and desktop/mobile browser accessibility are verified against the agreed backend. The frontend package has no browser test runner configured, so browser-width checks were not run.
- **Live backend tested:** no. No production DELETE handler is configured by this change.

The confirmation, mutation controller, cache policy, unavailable state, and integration seam are ready for the backend adapter. The feature must remain unavailable in production until that adapter is configured and its resolution semantics have been reviewed.
