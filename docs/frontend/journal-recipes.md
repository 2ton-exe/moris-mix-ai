# UI-01 Phase D: recipe collection and detail scrapbook

Implemented on `feat/UI-01-journal-redesign`, preserving the uncommitted
Phases A–C changes. No commit, push, merge, or PR was performed.

## Integration boundaries

- The existing React Router owns `/app`, `/app/recipes`, and
  `/app/recipes/:recipeId`; the shared Phase B journal shell continues to wrap
  these routes. Create/edit remain on their existing sibling routes.
- `RecipeDashboardPage` still uses `useRecipeDiscovery`, its current controls,
  paginated result handling, retry states, and discovery adapter.
- `RecipeDetailPage` still uses `useRecipe` and the current recipe source.
  Loading, offline, retry, stale-data, missing/access errors, live edit, and
  delete behavior remain in place.
- No query key, cache ownership, account scoping, service, API contract, backend,
  discovery handler, authentication behavior, or form implementation changed.
- The current recipe types do not provide photo URLs. Cards and detail entries
  therefore use the labeled local Mori artwork as a deliberate illustrated
  fallback; they do not generate photos or render fixture imagery.
- An empty collection remains empty and links to the existing
  `/app/recipes/new` route through **Add Your First Scrap**.
- Detail links carry only the visible folio in React Router location state.
  Direct links remain supported and omit the collection ordinal when unavailable.

## Presentation

`RecipeCard` is now a paper scrap with a Polaroid-style Mori illustration,
handwritten folio/date captions, stamp, real title and rating. The dashboard
keeps its real search, sort, filter, refresh, and paging controls, with scoped
styling, a page index, and a welcoming empty page. Detail uses paper sections
for ingredients, ordered steps, personal notes, and flavor scores. Long text
wraps inside normal document scrolling. Focus moves to the destination heading
on dashboard/detail navigation and is returned to the collection after Back.

The page transition uses ordinary React Router navigation within the existing
open-book shell. No route snapshot engine or new dependency was introduced.
Motion is limited to small decorative/hover effects and honors reduced-motion
preferences.

## Validation — October 31, 2026

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm type-check` | Pass |
| `pnpm test` | 367 pass; one known baseline `AuthFlow.test.tsx:167` expectation fails (expected 2 `getSession` reads, received 4), independently reproduced on `origin/main` |
| `pnpm build` | Pass; existing >500 kB chunk warning remains |
| `node e2e/recipe-journal.browser.mjs` | Pass at 1440, 768, 390, and 320px; includes 200% zoom, reduced motion, keyboard card activation, focus recovery, long content, history, empty state, offline, retry, and action accessibility |
| `node e2e/recipe-discovery.browser.mjs` | Pass at 1280, 375, and 320px |
| `node e2e/journal-shell.browser.mjs` | Pass at 1440, 768, 375, and 320px, including guest gates |
| `node e2e/auth-ui.browser.mjs` | Pass; session restoration, logout, recovery states, focus/keyboard, narrow layout, reduced motion, and 200% zoom |

Browser acceptance uses a synthetic session and intercepted recipe responses;
it made no hosted Supabase requests and wrote no real recipes. Desktop and
320px dashboard/detail screenshots were visually reviewed. The full-suite
authentication failure is unchanged from the approved baseline; no other test
regression was observed.

## Files

| File | Change |
| --- | --- |
| `frontend/src/pages/RecipeDashboardPage.tsx` | Scrapbook collection, empty page, folio, and destination focus |
| `frontend/src/pages/RecipeDetailPage.tsx` | Paper recipe entry, notes, sections, folio, and focus handling |
| `frontend/src/recipes/RecipeCard.tsx` | Card metadata, real ratings, cooked date, link folio, and scrap composition |
| `frontend/src/recipes/RecipeScrapArtwork.tsx` | Accessible local illustration fallback |
| `frontend/src/recipes/recipePresentation.ts` | Locale-formatted cooked date without date-only timezone drift |
| `frontend/src/journal/recipe-journal.css` | Scoped collection/detail styles and responsive, focus, contrast-mode, and motion rules |
| `frontend/src/main.tsx` | Loads Phase D journal stylesheet |
| `frontend/src/recipes/RecipeScreens.test.tsx` | Presentation, empty-state, and focus expectations |
| `frontend/e2e/recipe-journal.browser.mjs` | Isolated browser acceptance using intercepted synthetic API/session data |

## Reference and fidelity

Reviewed the extracted Make source at `../figma-make-reference`, including
`src/features/journal.tsx`, `src/features/recipe.tsx`, `src/journal/book.tsx`,
`src/ui/kit.tsx`, and the paper/decor/screen styles. Reused the Phase A
`PaperCard`, `Tape`, `Stamp`, and Mori artwork, plus the Phase B shell, local
wood/paper materials, and bookmark navigation. The data-backed layout adapts the
reference's scrapbook scraps, Polaroid, labels, and paper sections to actual
application fields and long-form content. It is a close visual adaptation of
the available source, not a pixel-matched import of prototype-specific seeded
pages, images, routes, or page-turn machinery.

## Phase E recommendation

Integrate the existing create/edit recipe editor into the scrapbook presentation
while preserving its validation, dirty-form guard, API writes, and focus behavior.
Treat any real recipe image support as a separate data-contract decision; until
then, keep the illustrated fallback.
