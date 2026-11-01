# UI-01 Phase C: authentication journal presentation

Implemented on `feat/UI-01-journal-redesign`, preserving the Phase A foundation
and Phase B shell work already present in the working tree. No branch was
created and no commit, push, merge, or PR was made.

## Inspection and integration boundaries

Reviewed the Phase A and Phase B handoffs, existing auth pages/components,
Supabase client/provider/context, route tree, scrapbook primitives, desk
stationery, and the local Figma Make `src/features/auth.tsx`, `src/styles/screens.css`,
and `src/styles/decor.css` source. The reference supplies the recipe-card,
paperclip, tape, Mori, and closed-cover composition. Its extra password screens
depend on prototype auth methods and routes, which are not part of this app.

The existing route composition remains authoritative:

| Route | Existing access and behavior |
| --- | --- |
| `/login`, `/signup` | Public guest pages under `AuthReady` and `GuestRoute` |
| `/verify-email` | Public under `AuthReady`; can request another signup verification link |
| `/auth/callback` | Public under `AuthProvider`; consumes the existing PKCE callback |
| `/app` and recipe routes | Continue through `ProtectedRoute` and the existing query provider |

There is no `/forgot-password` or `/reset-password` route. `AuthState` provides
login, signup, logout, and verification resend; the app has no password reset
request/update method. The prototype's reset UI therefore cannot be attached to
an existing handler. Phase C adds no misleading link or simulated reset flow.

## Presentation changes

| File | Change |
| --- | --- |
| `frontend/src/journal/JournalAuth.tsx` | Adds `JournalAuthScene`, a closed leather cover, reusable paper auth card, and branded footer |
| `frontend/src/journal/journal-auth.css` | Adds scoped desk/card styles, responsive reflow, visible focus, forced-color support, and reduced-motion handling |
| `frontend/src/pages/AuthPage.tsx` | Composes existing login and signup forms in the new card |
| `frontend/src/pages/EmailVerificationPage.tsx` | Presents pending, successful, invalid/expired, resend, and retry states in the same card |
| `frontend/src/auth/AuthRoutes.tsx` | Places existing session-restoration loading/error states in the shared scene |
| `frontend/src/main.tsx` | Loads the auth presentation stylesheet after the existing foundation and shell CSS |
| `frontend/e2e/auth-ui.browser.mjs` | Adds isolated browser acceptance with synthetic Supabase responses and no hosted auth calls |
| `frontend/README.md` | Links the Phase C handoff and browser command |

The auth scene reuses Phase A's `JournalSurface`, `PaperCard`, `Tape`,
`PaperClip`, `Stamp`, `BrandMark`, `Mori`, `MoriEmblem`, typography, tokens,
textures, and Phase B's `DeskStationery`. Its closed cover is a small
authentication-specific composition using the shared leather material and
Mori emblem. Authenticated recipe pages continue using `JournalShell`.

The existing handlers, field validation, email/password fields, password
visibility toggle, safe error messages, intended-destination state, signup
verification instructions, verification resend, callback handling, logout,
session restoration, and route guards remain in place. `AuthProvider`, auth
client/context, Supabase calls, PKCE handling, cache cleanup, and route URLs
were not changed. No extra provider, dependency, or prototype runtime was added.

## Fidelity and accessibility

The desk, burgundy leather cover, textured recipe card, soft page shadow,
paperclip, sage tape, Mori expression, MORI'S MIX wordmark, and Fraunces/Figtree
typography follow the Figma Make concept closely. The login card sits beside the
closed journal on desktop and flows into a single-column page on narrow or
zoomed layouts. The exact reference screenshots do not include complete auth
screens, so this is a close adaptation of the source composition rather than a
pixel measurement match.

Browser checks cover labeled inputs, invalid-state descriptions, first-error
focus, password show/hide, keyboard tab order, visible focus, safe validation
and auth errors, long-message wrapping, and controls at 320/390px. The card
animation is disabled for reduced-motion preference. A 200% CSS zoom reflow
check has no horizontal overflow. Paper text and controls keep their existing
ink/burgundy colors; on parchment, the token pairs measure 15.08:1 for ink,
8.08:1 for soft ink, and 11.38:1 for burgundy links/buttons. The burgundy
validation color measures 8.71:1. Forced-colors mode receives explicit borders.

## Validation — October 31, 2026

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm type-check` | Pass |
| `pnpm test` | 367 pass; one known baseline failure remains |
| `pnpm build` | Pass; existing large JavaScript chunk warning remains |
| `node e2e/auth-ui.browser.mjs` | Pass: login, signup, verification pending/success/expired, resend, intended return, restoration, logout, keyboard/focus, 320/390px, reduced motion, long-error wrapping, and 200% reflow |
| `git diff --check` | Pass |

The only Vitest failure remains
`src/auth/AuthFlow.test.tsx:167`, which expects two `getSession` calls and gets
four in the configured recipe-source setup. Phase B's isolated comparison
reproduced this same assertion on approved `origin/main`; the Phase C full-suite
run has the same 367/368 result. The test and auth behavior were left intact.
The production bundle still emits its existing warning for a JavaScript chunk
larger than 500 kB. The browser fixture intercepts Supabase requests locally,
uses synthetic credentials, and never contacts a hosted Supabase project.

No new regression was observed in the full test run, build, or focused browser
acceptance. No live Supabase account was used.

## Recommended Phase D

First define and implement the actual Supabase password-reset request and
password-update/callback behavior, route destinations, safe states, and tests
as a separate auth capability. Then apply the existing journal card to those
real routes and add browser acceptance for request, expired link, new password,
success, and failure. Keep Phase C's presentation scoped to the auth pages and
keep the protected journal route tree unchanged.
