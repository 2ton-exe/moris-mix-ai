# FE-03 authentication and FS-02 handoff

## Scope and route decisions

FE-03 adds Supabase email/password authentication using the existing React Router,
plain CSS, request-state components, and Vitest/Testing Library stack. The only
new production dependency is `@supabase/supabase-js`. No REST transport,
application data, Edge Function, schema, RLS, or deployment files are changed.

| Route | Behavior |
| --- | --- |
| `/`, `/home`, `/about`, `/demo-recipe` | Existing public FE-01/FE-02 behavior; no auth initialization or auth requests required |
| `/login`, `/signup` | Guest forms; signed-in visitors return to their intended `/app` destination |
| `/verify-email` | Confirmation instructions and email-link resend form |
| `/auth/callback` | Waits for the SDK to consume a signup verification link; shows confirmed-session status or recovery guidance |
| `/app/*` | Protected journal entry, ready for FE-04 recipe routes |

`/app` is a frontend landing route introduced here, not a backend endpoint or a
recipe CRUD implementation. Review this route choice with Belen when composing
FS-02 navigation. Existing public demo access stays intact. AuthProvider is
mounted once for the auth/application route tree. If a future shared header on
public pages needs `useAuth`, lift that same provider above the shared header;
do not nest a second provider or create a second Supabase client.

## Session ownership

`frontend/src/auth/client.ts` lazily creates one SDK client and exports only its
Auth interface. It uses the existing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` variables, with `VITE_SUPABASE_ANON_KEY` as the
legacy public-key fallback. Configuration failures have safe, retryable UI.
All browser environment values are public; privileged keys must never be used.

The SDK owns session persistence, URL consumption, automatic refresh, and tab
notifications. There is no additional localStorage token key. The provider
restores the session, listens synchronously for auth events, unsubscribes on
cleanup, ignores obsolete initialization results, and hides protected content
until initialization finishes. `INITIAL_SESSION` is not a new auth mutation and
does not suppress the explicit restoration request's errors. Each initialization
attempt has a 15-second deadline; failure displays retry and public demo
navigation. A timed-out attempt ignores late results/events, and retry creates
a new provider attempt using the same SDK client. It does not create another
client or independently exchange tokens. An SDK initialization request that is
still pending may remain pending on retry until the network recovers; public
demo navigation remains available. Strict Mode cleanup cancels attempt timers
and unsubscribes listeners.

Expired sessions are excluded from UI auth state;
the SDK normally refreshes beforehand. A null/signout event immediately removes
the session and user. Logout uses `signOut({ scope: 'local' })`: it signs out this
browser session, including its same-origin tabs, rather than all devices. The
installed SDK may clear local storage and emit `SIGNED_OUT` before returning a
remote revocation error. In that case the provider keeps the session cleared and
shows a dismissible notice on the login/signup pages that the server could not
confirm logout. A failure before local signout leaves a recoverable error on the
journal. The UI never restores a cleared session or claims complete logout when
server revocation failed. The notice survives navigation within the auth route
tree; it is transient UI state and is not persisted through a full reload.

Pending login/signup forms use a component lifetime guard. Leaving a form
prevents its completion from navigating or updating abandoned UI, while the SDK
can still establish a valid session for the next visit. Auth action responses
also respect the revision counter: a newer SDK event wins over an older action
response, including a signup response without a session.

`useAuth()` from `frontend/src/auth/context.ts` exposes `user`, `session`,
`isLoading`, `isAuthenticated`, `error`, initialization retry, `login`, `signup`,
`logout`, verification resend, and a dismissible logout notice. Signup explicitly distinguishes an immediate
session from `verification-required`. Form validation requires email, password,
and matching confirmation, with a six-character signup minimum; Supabase remains
authoritative for stronger project password policy.

## Belen: FS-02 integration

- Reuse `ProtectedRoute`, `GuestRoute`, and `AuthReady`; avoid parallel route guards.
- Use the current `session.access_token` inside the provider tree. For REST calls
  outside React, `await getAuthClient().getSession()` supplies the SDK-managed
  current session, including refresh. Handle its error/null result before making
  authenticated requests. Do not capture a token once at module initialization.
- FS-02 owns adding the user's Bearer token to the existing REST client and its
  handling of backend 401 responses. FE-03 adds no interceptor or token headers.
- Keep the anonymous FE-02 demo request behavior. Application data must continue
  through Edge Functions. Frontend guards provide UX, never backend authorization.
- The inspection found no FS-02 code, published branch, or open integration PR.
  Unpublished teammate changes still need coordination during review.

## Ramos: required Supabase configuration and live verification

The browser chooses `window.location.origin + '/auth/callback'` as the
`emailRedirectTo` for signup and resend. No production origin is hardcoded.
This uses Supabase's browser **implicit** flow: the standard confirmation link
returns session credentials in the fragment and the SDK consumes them. A custom
PKCE/code or token-hash email template requires an agreed callback contract and
an implementation update; those formats show recovery guidance today.

Verification success uses the initialization outcome of the SDK client that
actually received the signup callback. A restored confirmed session alone is
insufficient. The SDK's existing `initialize()` promise is observed to retain URL
processing errors; it does not perform a second exchange. Completed callback
results are not reused for a later callback visit. Auth fragments and sensitive
query parameters are removed with same-origin history replacement on success,
failure, and initialization timeout. Unrelated query parameters are preserved;
credentials and raw callback errors are never rendered or logged by FE-03.
Callback processing has the same independent 15-second deadline, so an unrelated
cross-tab sign-in cannot leave callback feedback spinning indefinitely. Once that
callback attempt times out, a late SDK completion cannot turn its feedback into
verification success; login or a fresh email link remains the recovery path.

Configure Supabase Auth's Site URL for the approved frontend deployment and add
exact allowed redirect URLs for each approved environment, for example
`http://localhost:5173/auth/callback` for default Vite development and
`https://<approved-production-host>/auth/callback` for production. If using
`127.0.0.1` or a different development port, allow that exact origin too. Keep the
confirmation email template compatible with Supabase's normal confirmation URL
and redirect parameter. Supabase redirect allowlist behavior is documented in
the [official redirect guide](https://supabase.com/docs/guides/auth/redirect-urls).

Ramos must confirm these exact values against the intended environments before
changing the shared configuration:

| Setting/environment | Value to confirm |
| --- | --- |
| Hosted Site URL | `https://moris-mix-ai.diofelgwenharesco.workers.dev` (the host recorded in the deployment runbook; confirm it remains approved) |
| Hosted redirect allowlist | `https://moris-mix-ai.diofelgwenharesco.workers.dev/auth/callback` |
| Default Vite development redirect | `http://localhost:5173/auth/callback` |
| Vite using the loopback IP | `http://127.0.0.1:5173/auth/callback` if this origin is used |
| Existing port-3000 setup | `http://127.0.0.1:3000/auth/callback` only if the frontend is deliberately served there; current `https://127.0.0.1:3000` allowlist entry does not match HTTP or `/auth/callback` |

Use exact callback entries for approved additional ports/domains, including
preview deployments; they are not inferred or added by FE-03. For local Supabase,
confirm `site_url` and `additional_redirect_urls` correspond to the frontend
actually being run. For hosted Supabase, confirm URL Configuration separately.

Also confirm email/password signup is enabled, **Confirm email** is enabled for
the verification-required acceptance path, the confirmation template uses the
standard Supabase confirmation URL and honors `emailRedirectTo`, and email/SMTP
delivery, confirmation-link expiry, resend rate limits, and password policy are
appropriate. If confirmation is intentionally disabled, signup must instead
return a usable session and skip verification instructions. No dashboard or
shared configuration changes were performed by this remediation.

The checked-in local `supabase/config.toml` currently targets port 3000 rather
than default Vite port 5173. FE-03 intentionally leaves that backend configuration
unchanged for its owner. Hosted Auth configuration, email confirmation policy,
password policy, email templates, and email delivery were not inspected or
modified. Confirm these with Ramos before live acceptance.

After configuration, verify with a disposable test account: signup and actual
email arrival, verification redirect and URL cleanup, login, refresh/session
restoration, a protected deep link, expiry/invalid link recovery, resend, and
logout followed by refresh/back navigation. Also check a narrow viewport and
keyboard-only navigation. CI tests mock Auth or HTTP; they do not prove hosted
email delivery or deployed redirect settings. BE-04 JWT authorization middleware
remains backend-owned.

## Validation and Definition of Done

Local validation on October 19, 2026 used Node 24.22.0 and pnpm 10.34.7
(invoked as `npx --yes pnpm@10` because this machine defaults to pnpm 12).

| Check | Actual result |
| --- | --- |
| Frozen-lockfile install | Passed |
| Lint | Passed, zero warnings |
| Type check | Passed |
| Frontend tests | Remediation: 124 passed across 9 files, including all original 104 tests |
| Production build | Remediation build passed; Vite reports a 515.20 kB minified entry chunk (149.61 kB gzip), above its 500 kB warning threshold |
| Final diff review | No backend, REST client, CI/deployment, populated environment, or secret changes; whitespace check passed |

The bundle-size warning remains a frontend performance follow-up; there is no
build failure. Live Supabase/email and visual/browser smoke checks have not been
performed. The automated SDK callback test runs in jsdom with mocked HTTP.

From `frontend/`, use Node 24 and pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Tests cover form validation, success/error and pending states, signup with and
without confirmation, session restoration, protected/guest routes, expiry,
logout, auth events, initialization errors, Strict Mode subscription cleanup,
late initialization races, verification recovery and resend, public-key
configuration, and the existing FE-02 behavior. A real SDK test uses mocked HTTP
to verify successful callback consumption, URL cleanup, and logout without any
live credentials. No real authentication calls are needed in CI.

Review remediation adds regressions for: rejected callbacks with an existing
confirmed session; expired/malformed/unsupported callbacks and URL cleanup;
non-reuse of old callback success; `INITIAL_SESSION(null)` followed by a
restoration error; a never-settling restoration with deadline/retry and stale
completion rejection; abandoned login and signup (with and without an immediate
session); and logout HTTP 500 after the real SDK clears local storage. The real
SDK callback tests also exercise Strict Mode and a never-settling callback.
Abandoned-form tests mock the public demo adapter as well, so these navigation
regressions do not send real network requests.

Remediation changed `client.ts`, `context.ts`, `AuthProvider.tsx`, `AuthRoutes.tsx`,
`AuthPage.tsx`, `EmailVerificationPage.tsx`, `JournalPage.tsx`, the three auth test
files, `frontend/README.md`, and this report. It introduced no new dependencies,
REST-client changes, backend/configuration changes, or bundle optimization.

All four confirmed review defects and the initialization availability scenario
have automated regression coverage. No unresolved confirmed implementation
defects from that review remain. The environment-dependent live verification gap
remains Medium until Ramos confirms configuration and the live smoke checks.
The entry-bundle warning remains a Low performance follow-up. Belen still needs
to review the shared guards/session interface and own FS-02 Bearer-token wiring.

FE-03 is ready for code review when local checks pass. Full live acceptance still
requires the configuration and smoke checks above, plus Belen's review. This
change does not claim production readiness or complete the FS-02/BE-04 work.
For FE-04, replace the protected journal landing content with recipe screens and
route their data requests through FS-02's authenticated REST integration.

## File inventory

Modified:

- `frontend/package.json`, `frontend/pnpm-lock.yaml`: Supabase SDK dependency.
- `frontend/src/App.tsx`: authentication routes and journal entry link.
- `frontend/src/styles.css`: responsive forms, field feedback, focus and pending states.
- `frontend/README.md`: auth setup/handoff entry point.

Created:

- `frontend/src/auth/client.ts`: centralized Auth-only SDK access.
- `frontend/src/auth/context.ts`: typed context and `useAuth`.
- `frontend/src/auth/AuthProvider.tsx`: session lifecycle and auth actions.
- `frontend/src/auth/AuthRoutes.tsx`: initialization, guest, and protected guards.
- `frontend/src/auth/navigation.ts`: safe intended-destination handling.
- `frontend/src/auth/errors.ts`: safe authentication error mapping.
- `frontend/src/components/AuthField.tsx`: accessible field and password toggle.
- `frontend/src/pages/AuthPage.tsx`: login and signup forms.
- `frontend/src/pages/EmailVerificationPage.tsx`: verification, callback, and resend UI.
- `frontend/src/pages/JournalPage.tsx`: protected entry and logout UI.
- `frontend/src/auth/AuthFlow.test.tsx`, `frontend/src/auth/client.test.ts`,
  `frontend/src/auth/CallbackIntegration.test.tsx`: deterministic auth coverage.
- `docs/frontend/authentication.md`: this setup, ownership, and validation report.

Work is on `feat/FE-03-authentication-ui`, originally created from FE-02 commit
`0ec4565`. FE-02 was subsequently squash-merged into `main`; submission should
include only the FE-03 commit on top of current `main`, preserving newer team
changes. Implementation/remediation validation preceded commit and PR approval;
production authentication verification remains outstanding.
