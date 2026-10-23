# FE-04 recipe dashboard and detail

## Delivery status and branch dependency

FE-04 provides the protected dashboard, detail screen, reusable cards, TanStack
Query hooks, account cache isolation, and an explicit development preview.
The shared REST client now supports authenticated GET and POST requests using a
freshly checked SDK session for each request. **Production recipe-source
integration remains blocked by BE-06's missing endpoint contract.** The
production source stays unavailable; normal application mode shows a
service-unavailable message rather than an empty collection or sample recipes.

## BE-06 dependency update — October 19, 2026

Ramos has confirmed that **BE-06 implementation has not started and its API
contracts are not finalized**. The following is coordination information only;
it does not authorize a live adapter or establish a request/response contract.

| Operation / boundary | Current information | Still required before integration |
| --- | --- | --- |
| Recipe list | Provisional `GET /recipes` | Final deployed URL/function prefix, query parameters, ordering/pagination, success envelope and item schema |
| Recipe detail | Route pattern pending | Method/path, ID rules, success schema, optional fields and missing/foreign-resource behavior |
| Recipe updates/rating | PATCH contract pending | Separate dependency for later mutations; no FE-04 write implementation |
| Recipe deletion | DELETE contract pending | Separate dependency for later mutations; no FE-04 delete implementation |
| Authentication and ownership | Private endpoints will require Bearer JWT; backend will enforce ownership and PostgreSQL RLS | Published authorization/error behavior and backend tests demonstrating ownership enforcement |
| Validation and errors | Shared Zod validation and consistent error responses are planned | Concrete browser-compatible schema exports, response examples, status/code mapping and error envelope |

Do not turn the provisional list hint into a fetch URL, infer a detail route,
guess an array/envelope shape, or treat database/demo schemas as private API
contracts. No temporary REST adapter is added. The existing dashboard, detail
screens, hooks, account cache isolation and tests remain intact. Synthetic
fixtures remain confined to tests and the explicitly enabled development
preview. Production continues to use the unavailable adapter; it never falls
back to mock recipes after a failed request.

**Ramos / BE-06 must supply:**

1. A finalized, versioned read/list/detail contract: deployed paths and prefixes,
   ID rules, list parameters and pagination semantics, successful JSON examples,
   required/nullable/optional metadata, and any related/lineage DTOs.
2. Shared Zod validators/types for successful and failed responses, usable by
   the browser build without Deno-only imports. Confirm the status/error-code
   policy for missing/expired authentication, forbidden access, missing recipes,
   validation failures, throttling and server failures; no envelope is assumed.
3. Deployed authenticated endpoints and frontend CORS support, including the
   Authorization header. Verify that every list/detail operation derives its
   owner from the JWT and enforces ownership/RLS, including guessed recipe IDs.
   The frontend's `userId` is only expected-session context, never proof of access.

**Belen / FS-02 must supply:**

The submission review fetched newly published FS-02 transport work on
`codex/fs-02-session-jwt` at `d0c1a03`, with
[PR #65](https://github.com/2ton-exe/moris-mix-ai/pull/65). Its transport exposes
`getAuthenticatedJson(path, { userId, signal })`, resolves the current Auth
session per request, checks expiry/account identity, and forwards cancellation.
This is available for review, but has not been merged into this FE-04 branch or
wired to a finalized recipe contract. Earlier absence findings in this document
describe the original FE-04 inspection. No new transport validation or live
integration is claimed by this documentation update.

1. The authenticated REST client interface/configuration, acquiring the current
   SDK-managed session for every request and handling refresh, missing/expired
   sessions and authorization failures. Do not capture a token once, hardcode a
   JWT, add privileged credentials, or duplicate FE-03's auth state/refresh logic.
2. Expected-account checks after asynchronous session retrieval, AbortSignal
   propagation through fetch, and safe normalized HTTP/network/contract errors.
   An old request must not clear a newer session or publish its data into a new
   account's cache. Preserve the anonymous public demo's existing behavior.
3. A coordinated mapping from the finalized BE-06 response validators to the
   existing `RecipeSource.list/detail` frontend interfaces. Include list filters
   or cursors in query keys if required by the final contract; do not flatten an
   unknown paginated response into a purported complete collection.

Once both dependencies are ready, validate `unknown` responses with the agreed
schemas and wire the real adapter through the existing source boundary. Verify
real list/detail/empty states, token refresh and expiry, account switching,
logout, cancellation/late results, malformed responses, safe error handling and
two-user ownership isolation. Only then claim live REST integration; deployed
acceptance remains a separate verification step. No backend, FE-05 or FE-06
functionality is part of this dependency update.

**Status remains: frontend implemented and validated; live REST integration
blocked by BE-06 and FS-02 integration.** The validation results below are the prior FE-04
implementation results, not new live API evidence. This update changes only
the handoff document and does not require rerunning unchanged frontend tests.

## Branch dependency

Inspection on October 19, 2026 found a clean working tree on
`feat/FE-03-authentication-ui` at `c6fcc85`. After fetching origin, `origin/main`
was still `cbf31cc`, without FE-03. FE-04 therefore uses the explicitly stacked
branch `feat/FE-04-recipe-dashboard`, based on `c6fcc85`. No uncommitted changes
were transferred. Review the FE-04 diff against `feat/FE-03-authentication-ui`;
do not submit the combined FE-03/FE-04 diff as one PR against main. After FE-03
merges, transplant only the FE-04 commits onto the updated main and revalidate.
If FE-03 is squash-merged, a plain merge/rebase must not reintroduce its old
commit. Submission uses a draft PR targeting FE-03; do not retarget it to main
until the stack has been explicitly reconciled.

Final review fetched `origin/main` at `7b577e7` (the newer CI gating change) and
confirmed FE-03 is still unmerged at `c6fcc85`. [FE-03 PR #45](https://github.com/2ton-exe/moris-mix-ai/pull/45)
is open and mergeable. Although the task described it as approved, GitHub's
recorded review is `COMMENTED` with no formal `APPROVED` review. This does not
change the requested stacked PR base. FE-04 is tracked in
[issue #54](https://github.com/2ton-exe/moris-mix-ai/issues/54).

## Inspection findings

| Area | Available implementation |
| --- | --- |
| FE-01 | React 19, Vite 6, TypeScript, React Router 7, plain CSS with slate/sage colors; no Tailwind/shadcn configuration |
| FE-02 / FS-01 | Public `GET /functions/v1/demo-recipe`, `createHttpClient`, `HttpError`, validated demo DTO, shared JSON fixture |
| FE-03 | `AuthProvider`, `useAuth`, `AuthReady`, `ProtectedRoute`, singleton Auth-only SDK client, journal landing/logout |
| BE-06 | No authenticated recipe list/detail Edge Functions, GET contracts, or published branch in fetched refs |
| FS-02 | Shared client supports authenticated GET/POST, per-request SDK session validation, Bearer and public `apikey` headers, cancellation, and safe errors; not yet connected to the recipe source |
| Shared schemas | `_shared/ai/schemas.ts` defines ingredient, instruction, flavor, extraction and demo Zod shapes using Deno imports; no BE-06 list/detail schema |
| TanStack Query | Previously absent; FE-04 adds `@tanstack/react-query` 5 and one provider for the protected application |
| Tests | Existing Vitest/jsdom, Testing Library, mocked HTTP and real-SDK auth regressions reused |

Database columns are not REST contracts. `recipes` has rating/cooked date and
nullable flavor data, but no notes column; lineage has a separate table. FE-04
does not infer a private response envelope or query PostgreSQL from the browser.
The recipe source and query integration remain unchanged and unavailable; the
shared transport now provides the authenticated request capability they can use
once BE-06 publishes its contract.

## Routes and screens

| Route | Behavior |
| --- | --- |
| `/app`, `/app/recipes` | Protected recipe collection with skeleton, empty guidance, cards, refresh, safe error/retry and unavailable states |
| `/app/recipes/:recipeId` | Protected dedicated detail request, ingredients, numerically ordered steps, available rating/cooked date/flavor data, and collection navigation |
| Unknown `/app/*` | Protected not-found page |
| Existing public and auth routes | Existing behavior retained |

The shared journal shell keeps logout available on detail and error screens.
Dates remain date-only strings to avoid timezone shifts. Missing optional
metadata is omitted. Empty ingredients/steps have explanatory text. The
dashboard has no delete flow, fabricated notes, or lineage interface. Empty
journals offer expandable first-recipe planning guidance and a link to the
existing public demo. The merged `/app/recipes/new` route opens the FE-05 draft
form, but saving and edit-record loading are not connected yet.

401 asks the user to log out and sign in again; 403 explains access denial; a
detail 404 explains that the recipe is unavailable or removed. These statuses
have no automatic or error-card retry and hide previously loaded content.
General errors offer manual recovery. During a transient failed refresh, the
last loaded content remains visible with an explicit stale-data notice. Raw
exceptions and server payloads are never displayed.

## Adapter boundary for Belen / BE-06 owner

`frontend/src/recipes/types.ts` defines **frontend view models**, not a proposed
BE-06 payload. Ingredient/instruction/flavor types reuse FE-02's existing FS-01
shapes. `RecipeSource` supplies `list({ userId, signal })` and
`detail(id, { userId, signal })`. `userId` is a cache/session identity check, not
a request authorization claim. The backend must derive ownership from its JWT.

The query functions also validate the adapter's existing frontend view models
in `recipes/validation.ts` before caching results. Invalid titles/IDs, metadata,
ingredients, steps or flavor data become safe query errors rather than React
rendering crashes. Detail IDs must match the requested route. These checks do
not establish BE-06's wire schema or replace its future REST validation; extra
top-level properties are preserved for future related/lineage integration.

`frontend/src/recipes/source.ts` currently exports an unavailable adapter, with
an opt-in development adapter. Replace the unavailable adapter with the agreed
REST adapter once the dependencies are available. Keep `RecipeSource` stable
where possible so page components and cache keys need no rewrite.

Integration work still required:

- **Ramos / BE-06:** supply the authenticated GET/list/detail contract, ownership
  and error behavior, browser-compatible DTO/schema source, deployed endpoints
  and CORS configuration. [BE-06 #48](https://github.com/2ton-exe/moris-mix-ai/issues/48)
  remains open with no linked implementation or contract in its comments.
- **Belen / FS-02:** the shared client now supplies fresh-session authenticated
  GET/POST requests, cancellation, safe errors, and auth/client integration
  tests. Keep the production recipe source unavailable until BE-06 provides its
  endpoint and response contract. [FS-02 #53](https://github.com/2ton-exe/moris-mix-ai/issues/53)
  remains open; the implementation is under review in
  [PR #65](https://github.com/2ton-exe/moris-mix-ai/pull/65).
- Potential overlap is `App.tsx` and the query-provider placement. Reuse the
  FE-03 AuthProvider and guards, keep a single QueryClientProvider for the
  protected app, and compose FS-02 routes in that tree. Resolve route edits with
  Belen during integration rather than adding another auth/client stack.

1. Confirm BE-06 paths, ID validation, list ordering/pagination, success
   envelopes, error statuses, optional fields, and any related/lineage DTOs.
   No final list or detail URL is assumed here.
2. Use FS-02's authenticated REST client and its existing public configuration.
   Acquire the current SDK session for each request; the FE-03 handoff supports
   `await getAuthClient().getSession()` outside React. Check errors, null/expired
   sessions and that its user matches the request's expected user **after** any
   asynchronous refresh. Do not send a request for an obsolete account.
3. The shared authenticated methods attach the current Bearer token and validate
   expiry and user identity after the SDK session lookup. Never capture a
   module-level token or add independent auth storage/refresh. Do not blindly
   retry 401/403 or clear a newer account's session because an older request
   failed. The anonymous demo must retain its public behavior.
4. Pass TanStack Query's `signal` through FS-02 to fetch. Preserve the existing
   `HttpError` status/kind behavior (or normalize FS-02 errors at the adapter).
   Network, 408, 429 and 5xx errors may retry; auth, missing recipe,
   configuration, invalid JSON and invalid-contract errors must not auto-retry.
5. Validate `unknown` JSON with BE-06's agreed schemas before mapping it to the
   view models. Do not import Deno `npm:` modules directly into Vite. Introduce
   a compatible shared package or a documented browser validator once the wire
   contract exists. Preserve actual lineage types in that integration without
   implementing the advanced interface. Add notes only if the API supports them.
6. Add adapter-level authenticated HTTP regressions for fresh tokens, refresh,
   missing sessions, account changes while awaiting session, cancellation,
   status mapping, pagination and invalid contracts. Then run the live checks
   below before claiming the issue is fully integrated.

There is no `supabase.from()` call, guessed private endpoint, JWT constant,
privileged key, or live-data fallback in FE-04.

## Query ownership and mutation handoff

`RecipeQueryProvider` is mounted once under the existing protected route. Each
account receives a fresh centralized QueryClient. The keyed account subtree is
replaced synchronously when the user changes; unmount cancels and clears the
old client. Logout, expiry, leaving the protected tree, or auth failure unmounts
it too. The auth/callback pages are outside this keyed subtree, so a sign-in
does not remount callback processing. Token refresh for the same account keeps
its cache. No cache persistence or additional global state library is added.

The reusable hooks are `useRecipes()` and `useRecipe(id)`. Keys are:

```ts
recipeKeys.all(userId)        // ['recipes', userId]
recipeKeys.lists(userId)      // ['recipes', userId, 'list']
recipeKeys.detail(userId, id) // ['recipes', userId, 'detail', id]
```

Queries require a ready authenticated user, consume cancellation signals, use a
30-second stale time and five-minute inactive retention, and allow at most two
automatic retries for known transient transport failures. They share requests
and fresh cache entries; list data is never treated as a complete detail DTO.
Default stale-query focus/reconnect behavior remains enabled; dashboard refresh
explicitly fetches current adapter data. Offline requests show a reconnect
message. A future paginated list must include its filters/cursor in the list key.

FE-05/06 can invalidate the current account after an authorized mutation:

```ts
await queryClient.invalidateQueries({ queryKey: recipeKeys.all(userId) })
```

More targeted invalidation can use `lists(userId)` and `detail(userId, id)`.
Mutations themselves are outside FE-04. The cancellation and key patterns follow
the official [TanStack cancellation guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
and [query key guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys).

## Development preview

Set `VITE_RECIPE_PREVIEW=true` in local frontend configuration and restart Vite.
Sign in through the existing FE-03 auth flow, then open `/app/recipes`.
`recipes/testing/previewAdapter.ts` provides synthetic recipes, and both screens
display a persistent sample-data notice. Auth guards remain active. No preview
credentials are included in source or required by the mock adapter.

The adapter is lazy-loaded only behind `import.meta.env.DEV` and the explicit
flag. Production builds ignore the flag, exclude the recipe fixtures, and use
the unavailable adapter until the REST adapter is installed. There is no
automatic fallback after a failed live request. Tests inject adapters directly
and require no live Supabase credentials.

## Validation

Validated with Node 24.22.0 and pnpm 10.34.7 on October 19, 2026. This machine's
default pnpm is 12, so commands use `npx --yes pnpm@10` to match CI. Existing
local dependency links were reinstalled with pnpm 10; only TanStack Query and
its core package were added to the lockfile. Populated environment files and
shared backend, CI, deployment and auth-client files were not changed.

| Check | Result |
| --- | --- |
| pnpm 10 frozen-lockfile installation | Passed |
| Lint | Passed, zero warnings |
| Type check | Passed, also repeated by the final build |
| Full frontend tests | 174 passed across 11 files, including all 124 existing tests |
| Production build with `VITE_RECIPE_PREVIEW=true` | Passed; preview data excluded |
| Whitespace/diff check | Passed |

- Screen regressions cover loading/empty/success/error, refresh and stale data,
  401/403/404, 503 retry limits, missing optional fields, ingredient formatting,
  step order, detail/back navigation, preview labeling, default unavailable
  mode, duplicate consumers, cache reuse/invalidation, logout, account switches,
  token refresh, cancellation and late results, including React Strict Mode.
  Final-review regressions also cover malformed adapter data and a late detail
  response after account switching on the same route. Both original crash
  regressions were observed failing before the fix and passing afterward.
- Local Chrome checks at 1280, 375 and 320 pixels exercised the actual app with
  an isolated synthetic stored session and development samples. Dashboard,
  detail, refresh/back navigation and missing ID recovery passed, with no
  horizontal overflow, application console errors or page errors. Keyboard
  activation of a recipe link passed. Desktop/mobile screenshots were inspected.
  External requests were blocked; this does not verify hosted authentication.
- Production output is checked for absence of synthetic preview recipes, even
  with the preview flag set. Vite's existing 500 kB entry warning remains;
  the production entry is approximately 564 kB minified / 164 kB gzip.
- Production-preview browser checks with the flag enabled verified guest
  protection, signed-in dashboard/detail unavailable states, no sample content,
  and no external API requests. The inherited missing `/favicon.ico` produces a
  browser resource 404 in production preview; no application errors occurred.

## Final review findings and submission limits

| Severity | Finding | Disposition |
| --- | --- | --- |
| Critical / High | None found in the reviewed FE-04 scope | Safe to submit as an integration-blocked draft |
| Medium | Malformed adapter results could crash cards/detail rendering | Fixed with frontend-model validation and regression tests |
| Medium | BE-06/FS-02 and authenticated deployed verification are absent | Preserved unavailable adapter; live acceptance remains pending |
| Medium | Existing CI only triggers for PRs targeting `main` or pushes to `main` | Stacked draft targets FE-03, so no automatic run is expected; report actual GitHub status and rerun after workflow/base reconciliation |
| Low | Vite entry exceeds its 500 kB warning threshold | Known concern; no unrelated bundle optimization |
| Low | Existing starter has no favicon and production preview returns favicon 404 | Inherited cosmetic issue; unrelated index/assets left unchanged |

Only FE-04 files are included in the submission; FE-03 commits/auth modules,
REST transport, backend, CI/deployment and populated environment files are not
modified. Review request for Belen covers query architecture, auth compatibility,
API boundaries, account isolation and the FS-02 adapter handoff. The draft does
not establish full Definition of Done and must not auto-close issue #54.

Live acceptance remains outstanding: Belen must review the FS-02 wiring, and
BE-06 must be deployed. Verify real collection ownership, empty user, direct
detail links, removed/foreign recipes, server refresh, expired/refreshed tokens,
account switching, logout/back navigation and offline/recovery behavior against
the agreed service. Automated fixtures do not establish live integration.
