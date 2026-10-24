# Recipe deletion (FE-06)

## Implementation overview

The recipe detail screen uses a reusable `DeleteRecipeDialog` and
`RecipeDeletionControl`. The control opens only from an authenticated recipe
detail view and calls the live `RecipeSource` DELETE adapter with the recipe ID
and account-scoped request (`userId` and `AbortSignal`). The adapter uses the
published `DELETE /functions/v1/recipes/:id` contract and accepts only the
expected empty `204 No Content` response.

The default application source uses the authenticated REST adapter. If an
injected source does not provide deletion, the detail screen shows a disabled
**Delete unavailable** action. Preview fixtures also omit the delete adapter.

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

The adapter calls BE-06's authenticated DELETE route through FS-02's REST
client. It rejects network failures, unsafe status codes, malformed success
responses, and other unconfirmed outcomes; it resolves only after the client
confirms the empty 204 response. The UI does not call `supabase.from()`.

The adapter encodes the recipe ID, uses the current authenticated session, and
passes the caller's `AbortSignal`. The user ID is request/cache context only;
the backend derives ownership from the bearer token and enforces RLS.

### Contract used

- `DELETE /functions/v1/recipes/:id` with an RFC 4122 UUID path parameter.
- `204 No Content` with an empty response body on success.
- Safe authenticated errors for access, validation, missing recipes, and server failures.
- Backend ownership enforcement and PostgreSQL RLS independent of client cache identity.

### Authenticated request behavior

- Reuses FS-02's session-aware REST client and rejects expired, missing, or mismatched sessions before sending the request.
- Preserves abort handling and keeps transport payloads opaque to the UI.
- Maps confirmed 204 success to handler resolution. Network interruption, unexpected success bodies, and retryable server errors reject so the UI can reconcile instead of claiming success.
- Uses no direct Supabase table access or mock persistence fallback.

## Security considerations

The delete control exists only in the authenticated detail route and only when the recipe is present in the authenticated, account-scoped recipe query. This is UI gating, not an authorization boundary. BE-06 must independently authenticate the bearer token, verify recipe ownership, enforce RLS, and return safe errors. The client never treats the route ID or `userId` as proof of ownership.

## Tests

`frontend/src/recipes/DeleteRecipe.test.tsx` covers opening and canceling confirmation, keyboard focus and Escape, pending feedback and same-tick duplicate-submit prevention, confirmed navigation, detail-cache removal and list refresh, retry after network failure, safe timeout/unexpected-error/500/401/403/404 handling, account-cache isolation, account-switch/logout/unmount during a pending request, account-scoped success feedback, unavailable integration behavior, and request context passed to the injected adapter. The existing FE-04 screen/query tests remain in place and are run alongside the new tests.

Deletion UI tests use deterministic injected handlers and do not require
Supabase credentials. Adapter tests validate the request contract without
exercising a deployed BE-06 environment.

Historical validation on the original FE-06 worktree passed `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`, and `git diff --check`. That snapshot reported 194 passing tests across 12 files, before the BE-06 REST integration.

## Known limitations and Definition of Done

- **Frontend implementation:** complete, including the authenticated BE-06 DELETE adapter.
- **Mock testing:** covers confirmation, pending/success/error states, cache reconciliation, account isolation, and the REST response contract.
- **Production acceptance:** not performed. Deployed ownership/RLS behavior and desktop/mobile browser accessibility still need verification. The frontend package has no browser test runner configured, so browser-width checks were not run.
- **Live backend tested:** no. This change does not call a deployed BE-06 environment.

The confirmation flow, mutation controller, cache policy, and authenticated
REST adapter are implemented. Production acceptance remains open until the
deployed endpoint and browser behavior are verified.
