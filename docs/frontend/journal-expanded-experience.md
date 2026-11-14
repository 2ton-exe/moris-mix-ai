# UI-01: journal composition and expanded sheets

> **Historical implementation report — superseded.** The detached expanded
> sheets and non-scrolling sheet contracts described below are no longer the
> application's current architecture. See [journal-physical-ux.md](journal-physical-ux.md)
> and the later UI-01 implementation handoffs:
> [Step 1](journal-ui01-step1.md), [Step 2](journal-ui01-step2.md),
> [Step 3A](journal-ui01-step3a.md), [Step 3B](journal-ui01-step3b.md),
> [Step 4](journal-ui01-step4.md), and [Step 6A](journal-ui01-step6a.md).

November 1, 2026 · `feat/UI-01-journal-redesign` · uncommitted work.

## 1. Root cause

The initial inspection found that the previous geometry correction already used
`1fr / 26px / 1fr`. The remaining architectural problem was a viewport-constrained
book containing an unbounded collection, full recipe detail, and full editors.
Each facing page scrolled independently, and large photo cards and controls
competed for the same limited area. Equal widths alone could not fix that.

## 2. Presentation architecture

`JournalShell` now has explicit `journal` and `expanded` presentation modes.
The journal retains its leather cover, equal papers, centered brass binding,
bookmarks, and facing-page portal. The expanded presentation is a broad, punched
recipe sheet with the same paper textures, tape, stamps, fonts, and controls.

The existing route tree selects the presentation. `JournalPage` selects a sheet
for its detail route; `RecipeEditorFrame` uses a sheet for existing editor routes.
No duplicate routes, recipe stores, query clients, API services, or dependencies
were introduced. Responsive changes use CSS and keep the live editor mounted.
Mori's optional dialogue has a stable portal destination below the book, so it
can open and grow in document flow without crowding either paper.

## 3. Route coverage

| Destination | Presentation |
| --- | --- |
| `/` | Existing redirect to `/demo-recipe` retained |
| `/home` | Composed journal introduction, bookplate opposite |
| `/about` | Composed journal explanation, bookplate opposite |
| `/app`, `/app/recipes` | Recipe index spread: discovery left, previews right |
| `/app/recipes/:recipeId` | Expanded recipe sheet |
| `/app/recipes/new` | Expanded create sheet |
| `/app/recipes/:recipeId/edit` | Expanded edit sheet |
| `/demo-recipe` | Public expanded demonstration sheet |
| `/login`, `/signup` | Existing stationery auth card and leather cover |
| `/verify-email`, `/auth/callback` | Existing verification stationery |
| `/app/*`, `*` | Journal-style missing page; existing auth boundary retained |

The starter copy, Vite guide link, generic starter card, and placeholder About
screen have been removed from the active public routes. Initialization/loading,
auth error, verification error, and callback recovery presentations were also
reviewed; they already use the stationery auth scene.

## 4. Book proportions

The desktop grid is `minmax(0, 1fr) 26px minmax(0, 1fr)`: 50% / 50% paper widths,
excluding the gutter. Matching grid row heights align both paper edges. The
spread's preferred aspect ratio is 1.52, close to the Make source's portrait
pages (`page width = .74 × page height`). The stage caps at 1120px and reserves
room for bookmarks. It no longer reduces the entire book based on viewport
height. Pages have content-aware minimum heights as a safeguard for exceptional
wrapping and feedback; text never escapes a fixed-height paper or gets clipped.

At the standard desktop fixture, Chromium measured:

| Viewport | Left paper | Right paper | Spine offset |
| --- | --- | --- | --- |
| 1440px | 528px | 528px | 0px |
| 1280px | 481.61px | 481.61px | 0px |

At widths below 1100px or heights below 640px, the book becomes a single readable
paper flow with bookmarks above and the binding along its left edge. The
expanded sheet remains a document at every width; its content columns stack.

## 5. Content fitting, navigation, and state

The journal presents two recipe previews per index page. Previous/Next links
turn through the already loaded collection. `Load more` continues to call the
existing BE-08 adapter with its server-owned cursor, 24-record request size,
deduplication, and retry behavior. Local index leaves never generate cursors.
The collection count indicates loaded records. Preview titles longer than 100
characters are excerpts; the accessible link and expanded recipe retain the full
title. No recipe content was invented for the production interface.

Discovery criteria (`q`, `scope`, `sort`, supported `filter.*`) and the index leaf
are presentation URL parameters. Controls retain debounce and existing query
ownership. Editing criteria resets the leaf and uses history replacement to
avoid an entry for every keystroke; page turns create normal history entries.
The URL state is cleared when an account change would otherwise retain another
account's in-session search. Unsupported URL criteria fall back safely.

Opening a recipe carries its journal return destination and folio in Router
state. The explicit return action restores search, sorting, index leaf, and focus
to the selected recipe link. Browser Back/Forward and direct URLs still work.
The query provider remains above the original routes, so loaded pages and cached
recipes retain the same owner. An editor opened from the index or detail retains
the corresponding journal destination. Direct editor Cancel keeps its existing
`/app` fallback.

Neither book paper nor expanded sheet has a vertical scroll container. The
document can scroll naturally, particularly on mobile and for long sheets.
Recipe ingredient, method, note, flavor, rating, cooked date, edit, and delete
information remains available. Form validation, row ordering, mutations,
pending/error states, and unsaved-change protection retain their existing code.
Resizing does not switch editor component trees or discard a draft.

## 6. Figma fidelity and visual changes

Inspected the extracted Figma Make source in `../figma-make-reference`, including
`src/styles/book.css`, `src/journal/book.tsx`, `src/features/discovery.tsx`, and
`src/features/recipe.tsx`. The Make reference is
[Design Pan's Scraps Journal](https://www.figma.com/make/p2oIcNIvnbLu8exQJ6P9hP/Design-Pan%E2%80%99s-Scraps-Journal).
Also compared the locally rendered Make index capture retained under
`frontend/test-results/visual-fidelity/reference/1440-index.png`.

The book follows the reference's equal portrait papers, centered brass gutter,
kraft discovery spread, leather overhang, warm paper controls, and physical
layering. Expanded sheets adapt the prototype's loose creation folio to natural
document reading and editing. Private and public recipe sheets share their
typography, artwork treatment, stationery materials, and spacious content panels.
The shared foundation supplies hover, pressed, disabled, and focus-visible button
states; newly styled public routes now use those same controls. Detail and editor
entry focus is explicit, index page turns focus the results heading, and return
navigation focuses the relevant recipe link.

This is an adaptation, not a pixel-perfect copy of the prototype. The production
index uses two illustrated previews instead of six compact title slips. It uses
real BE-08 discovery controls where the prototype shows unavailable concepts.
Mori illustrations remain the honest fallback for records without photo data.
The toolbar retains email/logout. The prototype's 3D cover/page-turn animation
has not been added. Full sheets intentionally depart from its constrained
scrolling form columns to satisfy readable long-content workflows.

## 7. Corrected missing screens

The public demonstration recipe now uses an expanded sheet without auth or query
provider requirements. Its existing `getDemoRecipe`, response parsing,
cancellation, loading, safe errors, retry, ingredients, instructions, scores,
rating, cooked date, and Back home link remain intact. Home, About, and both
fallback routes now belong to the cooking-journal experience. Auth and verification
routes were verified with their existing visual treatment and behavior.

## 8. Validation and evidence

Run commands from `frontend` unless stated otherwise:

| Check | Result |
| --- | --- |
| `pnpm.cmd lint` | Pass |
| `pnpm.cmd type-check` | Pass |
| `pnpm.cmd build` | Pass; existing large-bundle advisory remains |
| Full Vitest suite, one worker | 382 passed; 1 known baseline auth failure |
| New navigation helper tests | 8 passed |
| Final focused discovery/editor/navigation tests | 71 passed |
| Expanded-experience browser suite | Pass; five widths, geometry, containment, opening/return, index pagination, server cursor, history, focus, draft guards/resizing, public routes, reduced motion, zoom |
| Recipe journal browser suite | Pass; full and long recipe content, actions, focus/history, offline/retry, responsive layouts |
| Recipe forms browser suite | Pass; create/edit/delete, dynamic row ordering, Zod errors, pending/retry, dirty guards, long forms, 320px, zoom, reduced motion |
| Discovery browser suite | Pass; BE-08 mappings, search scopes/sort/debounce, cursor retries, focus, responsive layout |
| Journal shell browser suite | Pass; route aliases/direct URLs, auth gates, dirty bookmarks, Back/Forward, local assets, logout |
| Mori dialogue browser suite | Pass; keyboard, choices, focus, route cleanup, normal document flow, reduced motion and zoom |
| Auth UI browser suite | Pass; login/signup, callback/verification/recovery, session/logout, responsive layout, keyboard and zoom |
| `git diff --check` | Pass |

The full suite's baseline failure is
`src/auth/AuthFlow.test.tsx:167`: a spy expects two `getSession` calls and observes
four. Previous review documents already record its reproduction on the baseline.
This task leaves the authentication implementation and test expectation unchanged.

The new browser suite checks actual paper dimensions and descendant containment,
not CSS text. It also stresses two long preview titles. Existing long-content
suites cover 34 ingredients/22 instructions and an 18-ingredient/14-step editor.
The viewport matrix is 1440, 1280, 768, 390, and 320px. The new zoom captures use a
720 × 450 CSS viewport, equivalent to the effective layout viewport of
1440 × 900 at 200% browser zoom; existing suites additionally test 200% CSS zoom.

Evidence gallery: `frontend/test-results/expanded-experience/index.html`.
It contains actual Chromium captures of journal, recipe, create/edit, public
demo, home/About, fallback, auth and verification screens at all five widths,
plus zoom views and measured geometry JSON. Normal-layout captures use the
repository's existing demonstration recipe fixture. Distinct synthetic records
are used only in pagination assertions and its zoom screenshot. Existing long
content suites also use explicit stress fixtures. Nothing writes to production.
Generated evidence is ignored by Git and remains available locally for review.

The browser suites intercept API traffic and use synthetic auth. They validate
production React components and routes, not live Supabase operation. No live
backend acceptance result or formal assistive-technology audit is claimed.

## 9. Remaining issues and scope boundary

The known auth spy-count test failure and production bundle-size advisory remain.
The Make-specific cover and page-turn choreography remains a future enhancement.
No authentication, backend schema, recipe API contract, BE-08 adapter, mutation
state machine, or TanStack Query provider was redesigned. No commit, push, merge,
rebase, or PR was performed.
