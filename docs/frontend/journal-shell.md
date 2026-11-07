# UI-01 Phase B: physical journal shell and navigation

Implemented on `feat/UI-01-journal-redesign`, on top of the existing uncommitted
[Phase A foundation](journal-foundation.md). No commit, push, merge, or PR was
performed. No other worktree was changed.

## Pre-implementation verification

- Confirmed the branch and reviewed the complete tracked Phase A diff and handoff.
  Recorded SHA-256 hashes of every modified/untracked Phase A file before edits.
  The foundation components, fonts, artwork, textures, gallery, licenses, and
  handoff remain intact. Only `main.tsx`, `JournalPage.tsx`, and
  `RecipeEditorFrame.tsx` needed integration changes.
- Rechecked the reference's `journal/book.tsx`, `scene/desk.tsx`, book/desk styles,
  paper materials, bookmarks, route setup, and local reference screenshots.
  Figma Make design context still returns the source inventory. The screenshot
  tool does not support Make files; the previously recovered local screenshots
  show the desk and closed cover, not full authenticated screens.
- Confirmed the original production composition:
  `createBrowserRouter` / `RouterProvider` / Strict Mode → shared route tree →
  `AuthProvider` → `AuthReady` → `ProtectedRoute` → `RecipeQueryProvider` →
  existing route elements. Query clients remain keyed by account.
- Confirmed that dashboard/detail render through `JournalPage`'s `Outlet`, while
  create/edit are sibling routes with their own `RecipeEditorFrame`. Both now
  compose the same presentation without moving either provider boundary.

## Authentication baseline comparison

Approved `origin/main` and feature HEAD were both
`46809319eb23394a45d6f1ea79f8ee41f541011b`.

Used `git archive origin/main frontend` and `git archive origin/main fixtures`
to extract tracked baseline files into a newly created system temporary
directory. Installed its dependencies independently with
`pnpm install --offline --frozen-lockfile`. No checkout, stash, reset, worktree
switch, or edits to the feature branch were needed for comparison.

Ran this unchanged test in both baseline and feature directories:

```powershell
pnpm test -- src/auth/AuthFlow.test.tsx -t 'restores a valid session on a fresh mount and allows protected access'
```

The baseline passes with no API configuration. With synthetic public API
configuration (`VITE_SUPABASE_URL=https://baseline.example.test`,
`VITE_SUPABASE_PUBLISHABLE_KEY=isolated-browser-public-key`,
`VITE_RECIPE_PREVIEW=false`), it reproduces the reported assertion at
`AuthFlow.test.tsx:167`: expected two `getSession` calls, received four. The
feature directory reproduces the same assertion with its existing environment.

This is configuration-dependent: the configured recipe source performs its own
authenticated session reads, in addition to provider initialization. No real
credentials were copied into the isolated baseline. The test, authentication
implementation, and API session handling were not changed.

## Implementation

| File | Responsibility |
| --- | --- |
| `frontend/src/journal/JournalShell.tsx` | Shared desk/toolbar, leather boards, patterned flyleaf, Mori bookplate, brass binding, paper page, and bookmark links |
| `frontend/src/journal/journal-shell.css` | Scoped physical layers, stitching, page edges/shadows, flowing layout, responsive container queries, focus, and reduced-motion support |
| `frontend/src/journal/DeskStationery.tsx` | Original decorative reference SVG pencil, clips, tape, sprig, and cup stain; pencil text uses MORI'S MIX |
| `frontend/src/pages/JournalPage.tsx` | Retains the existing logout handler, preview/error notices, route outlet, and footer inside the shell |
| `frontend/src/recipe-form/RecipeEditorFrame.tsx` | Uses the same shell for create/edit while keeping account-keyed form content |
| `frontend/src/main.tsx` | Loads shell CSS after the existing styles and Phase A foundation |
| `frontend/e2e/journal-shell.browser.mjs` | Isolated browser acceptance with synthetic auth and intercepted REST |

`JournalShell` accepts `account`, `children`, and an optional `pageClassName`.
It owns presentation only. Exported `JournalPageContainer` is a reusable native
`main` element with the paper surface and normal HTML props. Phase A's
`JournalSurface`, `PaperCard`, `Stamp`, `BrandMark`, `MoriEmblem`, local fonts,
JPEG materials, procedural paper textures, and tokens are reused directly.

Wide layouts show an inside-cover bookplate and content page. Narrow or zoomed
layouts use one flowing paper page with bookmarks above it. Long collections,
forms, and recipes use document scrolling; no fixed-height content viewport or
page-turn snapshot runtime is introduced. Recipe cards adapt to the content
page's available width. The existing `#journal` anchor is retained, and a skip
link focuses `#journal-content`.

Bookmarks link to `/app/recipes` and `/app/recipes/new`, with current-section
indication and visible keyboard focus. Detail pages remain in the recipes
section; edit pages do not falsely select the new-recipe bookmark. Discovery
stays in the existing recipes dashboard. Account controls retain their original
scope: logout on dashboard/detail/error screens; account identity in editors.
Editor navigation continues through React Router's existing dirty-form blocker.

## Validation — October 31, 2026

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm type-check` | Pass |
| `pnpm build` | Pass; existing large-chunk warning remains |
| `pnpm test` standalone rerun | 367 pass, only the baseline-confirmed authentication assertion fails |
| `node e2e/recipe-discovery.browser.mjs` | Pass at 1280, 375, and 320px |
| `node e2e/journal-shell.browser.mjs` | Pass at 1440, 768, 375, and 320px |

The initial full-suite run alongside build/browser work also hit a deletion
retry timeout. The entire 22-test deletion suite passed on its own; the
subsequent full-suite run passed all deletion tests. No test timeout or
expectation was changed.

Shell browser acceptance verifies dashboard aliases, recipe links, detail
reload, Back/Forward, direct create/edit URLs, dirty-editor bookmark cancel and
confirm, viewport-sized deletion confirmation with Escape/focus restoration,
missing-recipe recovery, current sections, skip-link focus, keyboard
focus outlines, bookmark hit areas, local font/texture loading, no horizontal
overflow, logout, guest protection, and public/authentication routes. It also
checks 200% CSS zoom and reduced-motion preferences. Screenshots are written to
a fresh temporary directory printed by the script. Desktop, tablet, mobile
editor, and zoom screenshots were visually reviewed. Browser fixtures never
contact a hosted Supabase project or write real recipes.

The existing route declarations, public/auth screens, authentication behavior,
query providers, recipe API, editor submission, deletion logic, and discovery
behavior remain authoritative and unchanged. New shell styles are scoped to
the authenticated presentation. The foundation preview remains separate.

## Scope and fidelity

This phase implements the open journal shell. The layout uses the reference's
materials, patterned endpaper, brass hardware, stationery, and bookmark colors,
with space adapted to real dashboard/detail/editor content. Available reference
screenshots cannot establish pixel-level authenticated-screen fidelity.

Closed-cover/page-turn animation, AI/Mori chat, prototype navigation/services,
full dashboard/card redesign, auth-screen redesign, and editor-control redesign
remain outside this phase. No new dependency, route, mock production service,
or prototype router was introduced. No live Supabase E2E acceptance was run.
