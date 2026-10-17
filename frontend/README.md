# FE-02 preparation

This dependent branch builds on FE-01. `/demo-recipe` is a pending-data page;
it does not fetch a recipe or import the unapproved draft fixture.

## Local checks

Use Node 24 and pnpm 10, matching repository CI:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm dev
```

## HTTP infrastructure

Copy `.env.example` to `.env.local` and, once deployment is confirmed, set
`VITE_API_BASE_URL` to the Supabase project origin (for example
`https://PROJECT_REF.supabase.co`), with no path, query, or credentials. Vite reads
it at startup/build time; restart or rebuild after changes. All `VITE_*` values
are browser-visible. Never add service-role credentials or LLM secrets.

`src/api/config.ts` exports the configured `apiClient`.
`apiClient.getJson('/functions/v1/demo-recipe', { signal })` will issue a native
GET with JSON Accept, no cookies, and an optional cancellation signal. This call
is not yet made by the page. Missing/invalid configuration fails before fetch.

The transport returns `unknown`, or null for HTTP 204, and raises `HttpError` for
configuration, HTTP, network/body-read, and malformed JSON failures. HTTP status
and opaque parsed error payloads are retained for the future FS-01 adapter.
Network/CORS, 408, 429, and 5xx failures are retryable. Cancellation propagates to
the caller. Browser CORS errors cannot be reliably distinguished from network
failures; fix backend CORS rather than using `no-cors` or a security bypass.

`LoadingState` announces progress; `ErrorState` announces a safe message and
provides a retry button when passed `onRetry`. The future screen must validate
the approved payload and decide which failures support recovery before rendering.

## Pending integration

- Belen: approved FS-01 success/error types, validation rules, official fixture,
  and empty-data behavior.
- Ramos: BE-03 deployment origin, approved public access headers, CORS, and
  PostgreSQL-backed response evidence.
- After approval: add contract-specific validation, fixture/live adapters and a
  source selector, wire loading/error/retry into the recipe page, and test approved
  fields and source switching. Do not silently fall back to mocks in live mode.

Review [the draft proposal](docs/fs-01-contract-proposal.DRAFT.md) and its labeled
example fixture with Belen and Ramos. Neither is an approved production contract.
No backend-owned files were changed. Live UI → Edge Function → PostgreSQL
verification and the FE-02 Definition of Done remain incomplete.

## Review handoff

Suggested PR title: `[FE-02] Prepare HTTP transport and request-state UI`.

Suggested description:

> Adds a native-fetch JSON client configured through Vite, accessible loading/error
> components with manual retry, and a routed demo placeholder. Includes transport
> and UI tests plus an explicitly unapproved FS-01 proposal for Belen and Ramos.
> Recipe validation, fixture/live switching, recipe display, and deployed
> PostgreSQL-backed verification remain pending FS-01/BE-03.

Branch: `feat/FE-02-api-client-walking-skeleton`, based on FE-01 commit `7b4ec9c`.
If FE-01 is still awaiting review, use its branch as the dependent PR base; review
the diff before retargeting to main after FE-01 merges. No PR has been opened.

Created files:

- `src/api/http.ts`, `src/api/config.ts`, and their `.test.ts` files.
- `src/components/LoadingState.tsx`, `ErrorState.tsx`, `RequestStates.test.tsx`.
- `src/pages/DemoRecipePage.tsx` and `DemoRecipePage.test.tsx`.
- `src/vite-env.d.ts`, `src/test/setup.ts`, `vitest.config.ts`.
- `.env.example`, this README, and the two labeled draft files in `docs/`.

Modified files: `src/App.tsx`, `src/styles.css`, `.gitignore`, `package.json`,
`pnpm-lock.yaml`. Test tooling is development-only; no runtime dependency was added.

Local validation on 2026-10-15, using temporary Node 24.22.0/pnpm 10.34.7 tooling
outside the repository because neither tool was available on the shell PATH:

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`: 37 tests across four files passed.
- [x] `pnpm build`
- [x] `git diff --check`; build output, dependencies, and local environment files ignored.
- [x] Draft fixture is absent from the production bundle.
- [ ] Approved recipe fixture/schema and mock/live switching tests.
- [ ] Browser verification on desktop/mobile against the approved recipe UI.
- [ ] Live deployed frontend → Edge Function → PostgreSQL smoke test.

These results are local validation, not evidence of CI or live deployment.
