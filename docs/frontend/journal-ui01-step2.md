# UI-01 Step 2 — original journal page compositions

November 1, 2026. Work remains on `feat/UI-01-journal-redesign`. The incoming
Step 1 working tree is preserved. No branch, commit, push, rebase, merge or PR
operation is part of this milestone. Physical continuation pages and page-turn
animations are deferred to Step 3.

**1. Root causes and design authority**

The earlier presentation treated the collection as a two-column dashboard:
search occupied the left leaf and every recipe card occupied the right. Detail
put ingredients below the left-side identity, while method and notes each gained
another paper panel. Create/edit reserved the left leaf for introductory content
and stacked every field, ingredient row and instruction inside nested panels on
the right. CSS rules scoped to the right leaf also prevented directly moving
fields left without addressing control styling and native form ownership.

The verified authority is the unmodified sibling `../figma-make-reference`:
`src/journal/book.tsx`, `src/features/journal.tsx`, `src/features/recipe.tsx`,
`src/features/discovery.tsx`, and `src/styles/{book,paper,decor,screens}.css`.
`src/ui/kit.tsx` and `src/lib/sketch.ts` provide the original SVG fallback artwork.
The reference is rendered with its own React/Tailwind plugins; its Make-managed
configuration is absent from the archive. No reference authentication, storage,
AI service, seeded content or prototype API code is imported into production.

**2. Files changed in Step 2**

| Files | Purpose |
| --- | --- |
| `frontend/src/journal/JournalShell.tsx`, `JournalLayoutContext.ts`, `JournalFacingPage.tsx` | Shared footer destination, measured footer clearance, source bookplate; stable facing-page destinations |
| `frontend/src/journal/page-compositions.css`, `folio.css`, `frontend/src/main.tsx` | Collection/index/reading composition, contained bodies, stationery form controls and responsive flow |
| `frontend/src/journal/useJournalMedia.ts`, `indexNavigation.ts` | Source single-page/phone layout and cursor-aware presentation pages |
| `frontend/src/pages/RecipeDashboardPage.tsx`, `frontend/src/recipes/RecipeCollectionPages.tsx` | First/subsequent spreads, separate index view on the existing route, criteria and return position |
| `frontend/src/recipes/RecipeCard.tsx`, `RecipeScrapArtwork.tsx`, `RecipeSketch.tsx`, `sketch.ts`, `recipePresentation.ts` | Paper-integrated entries, compact index cards, original title-based SVG sketches and date captions |
| `frontend/src/pages/RecipeDetailPage.tsx`, `DemoRecipePage.tsx`, `frontend/src/recipes/RecipeReading.tsx` | Shared source-inspired reading layout, authoritative fields and compact footer actions |
| `frontend/src/pages/CreateRecipePage.tsx`, `EditRecipePage.tsx`, `frontend/src/recipe-form/RecipeEditorFrame.tsx`, `RecipeForm.tsx`, `recipe-form.css` | One native controlled form around the journal, facing fields, preserved guards/mutations and recoverable errors |
| `frontend/src/recipes/RecipeDeletionControl.tsx`, `frontend/src/pages/JournalPage.tsx` | Preserve collection return criteria after deletion; move general journal footer to the desk companion |
| `frontend/src/recipes/{RecipeScreens,RecipeDiscovery}.test.tsx`, `frontend/src/recipe-form/RecipePages.test.tsx`, `frontend/src/journal/indexNavigation.test.ts`, `frontend/src/pages/DemoRecipePage.test.tsx` | Composition, native form ownership, cursor loading, shared demo metadata and behavioral regression coverage |
| `frontend/e2e/journal-step2.browser.mjs` | Matching source/before/after scenes, physical geometry and composition checks, cursor retry and return/resize acceptance |
| Existing discovery, recipe, form, Mori, shell, expanded and Step 1 browser suites; `frontend/e2e/journal-geometry.mjs` | Update intentional composition/scroll-region expectations; wait for actual source-sized bounds after viewport changes |
| This report | Evidence, adaptations, validation and Step 3 handoff |

**3. Collection: source, incoming and corrected**

The source opens against the patterned inside front cover and centered bookplate,
with two scraps on the right. Later desktop spreads contain two scraps per leaf.
The incoming implementation instead had a permanent search/introductory left
leaf and up to two boxed cards on the right.

The corrected first spread restores the inside cover and bookplate. Two compact
entries sit directly on parchment, alternating photo/sketch and copy positions.
Later spreads use both leaves, up to four entries when available. Page numbers,
small page controls and the empty slot stay in the paper hierarchy. Recipe list
summaries do not include ingredients or notes, so collection teasers from the
prototype are omitted rather than invented or fetched through extra detail calls.

`leaf` describes a collection window; `entry` retains its recipe anchor across
responsive layouts. The collection follows BE-08's opaque continuation until the
requested window is filled, stops on a next-page error, and offers the existing
retry/Load More controls. It never derives the server total from the loaded count.
Direct links to unloaded windows work through the same cursor path. Known-ended
shorter results clamp the visible window. Collection and index criteria share
the existing account-scoped infinite query.

Opening a recipe replaces the current history entry's return-focus metadata
before navigating. Back restores the selected card. Search criteria, sort, view
and recipe anchor remain in the URL and return links, including after deletion.
Index anchors also restore through cursors after a reload or cache expiry; they
do not depend on previously loaded infinite-query pages still being cached.

**4. Recipe detail: source, incoming and corrected**

The source puts its visual identity, title, cooked date and rating on the left;
ingredients, ordered method and a single notes scrap occupy the right. Edit and
Remove live in the right-page footer. Previously, ingredients remained on the
left and multiple boxed panels enlarged both leaves.

The corrected layout follows that reading hierarchy. The actual API currently
has no image field, so its title selects the original kitchen sketch SVG in a
taped polaroid. Quantities, units and amount descriptions remain authoritative.
Instruction `step` values determine display order without mutating cached data.
Notes preserve line breaks and long words; all flavor scores remain available.
Edit/Delete and collection navigation occupy the footer below the body scroll
region. Delete retains its existing confirmation, pending/error and cache logic.

**5. Create/edit distribution and form behavior**

| Left leaf | Right leaf | Footer |
| --- | --- | --- |
| Recipe title, cooked date, rating, personal notes | Structured ingredient name/quantity/unit/amount description, ordered cooking steps, add/move/remove actions | One Save, return control, dirty/pending/error/success feedback |

One native `<form>` wraps the complete journal. Each column's disabled fieldset
and the portalled footer still belong to that form. This avoids disconnected
inputs or duplicate submission handlers when fields occupy the facing slot.
The existing controlled state, Zod schema, stable row keys, ordering, validation
focus, POST/PATCH adapter, saved-recipe follow-up PATCH, unsaved guard and
account-scoped invalidation remain in use. Recoverable edit-load errors retain
the dirty editor and their retry message; access denial still hides the form.

The source create sheet floats over the book. Production adapts its fresh paper,
underlined controls and distributed fields to the existing leather boundaries.
The native rating select is retained. Structured production ingredients require
more room than the prototype's one free-text input per ingredient; they remain
complete and scrollable.

**6. Discovery/index adaptations**

`?view=index` opens the index on the existing recipe route; no route is removed
or added. Its kraft leaves, compact search strip and ruled index entries follow
the source insert. Collection/index links retain the current criteria and anchor.
Legacy links containing supported search/sort criteria open the index unless
they explicitly request the collection view.

Unlike the prototype's disabled/simulated controls, production retains title,
ingredient and combined search, 300ms debounce, newest/rating sorting, server
cursors, Load More, initial/refresh/next-page errors and retry. Unsupported filters
remain unavailable. Index entries show real summary metadata; ingredient/step
counts are absent because the summary contract does not supply them.

**7. Responsive behavior**

The Step 1 transition remains below 1100px, including the short-height fallback.
At 1024px the collection shows two entries on a single page; at phone widths it
shows one stacked entry. The first phone page includes a compact owner/intro note
in place of the decorative inside-cover bookplate. The `entry` anchor preserves
the selected recipe when the number of entries per page changes.

Reading flows through identity, ingredients, method, notes and scores. Writing
flows through title/date/rating/notes and then ingredients/instructions. The same
live controls reflow through CSS; resizing does not remount form state. A shared
single-page scrollport retains all information. Its sticky footer keeps primary
actions available. Step 1 board, leaf, binding, stack and bookmark coordinates
and physical occlusion remain authoritative.

**8. Public demonstration and screenshot comparison**

The public demonstration uses the shared `RecipeReading` composition inside the
journal. Its original public endpoint, request cancellation, loading, safe errors,
retry and home navigation remain in place. It does not require authentication.

The [comparison gallery](../../frontend/test-results/ui01-step2/comparison.html)
contains original Make, incoming Step 1 and corrected scenes at 1440×900,
1280×900, 1024×900 and 390×900: first collection, subsequent collection, detail,
create, edit, index and demo. The source has no equivalent public reading route;
that row explicitly uses its detail composition with the same recipe fixture.
Fixture copies used to exercise density exist only in isolated browser responses
and reference storage. No test content or generated photographs enter the app.

The gallery compares composition and materials, not whole-screen pixel equality.
Real structured fields, supported flavor scores, working discovery controls,
production branding/account controls and the reduced bookmark set are deliberate
differences from the prototype. Caption dates use the source's short treatment;
full dates remain in recipe metadata.

Collection measurements retain Step 1's physical bounds:

| Viewport | Book W×H | Paper W×H | Visible collection entries |
| --- | --- | --- | --- |
| 1440×900 | 1164.38×776.42 | 550.56×744 per leaf | First spread 2; later spread 2 + 2 |
| 1280×900 | 1070.61×714.06 | 506×683.78 per leaf | First spread 2; later spread 2 + 2 |
| 1024×900 | 647×774 | 620×756, single | 2 per page |
| 390×900 | 355×712 | 328×694, single | 1 per page |

The 62px authenticated-phone account-row reserve is the existing Step 1
adaptation. The Step 1 regression suite again matches original geometry at the
desktop sizes, the 1100/1099px boundary and native 200% zoom. Bookmark root/end
hit tests, keyboard interaction, hardware layering and contextual control variants
pass. Source and application scenes use the same existing recipe fixture; the
subsequent phone comparison retains the same starting recipe while showing the
intended change from two entries to one.

Regenerate final comparisons from `frontend` with
`node e2e/journal-step2.browser.mjs after`. Preserve `before`: rerunning that phase
would capture the current checkout rather than the incoming Step 1 composition.
The [raw measurements](../../frontend/test-results/ui01-step2/after/measurements.json)
cover all 28 paired scenes. Links in the gallery open full-page PNGs, including
the production desk companion below the 900px viewport.

**9. Remaining scrolling and pagination boundaries**

Desktop leaves retain their physical dimensions while contained body regions
scroll. Footers sit outside those body regions with measured clearance. Narrow
layouts keep the shared scrollport and sticky actions. Long notes, all method
steps, every ingredient field and the last dynamic rows remain accessible.
No complete recipe information is truncated and no physical continuation engine
or animation has been introduced. Extremely long recipes and structured editors
still require scrolling; the index's loaded list also scrolls independently of
its footer on desktop.

**10. Validation and regressions**

Validation ran sequentially: lint, type-check, full frontend tests, production
build, browser acceptance, then whitespace checks. Browser assertions were
updated for the intended full index list, one-entry phone pages and contained
body regions. New tests cover collection spread distribution and cursor loading,
detail hierarchy/footer placement, one native form across both leaves, unloaded
presentation pages, and restoring an index anchor without a warm query cache.

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm type-check` | Pass |
| `pnpm exec vitest run --configLoader runner --maxWorkers=1 --reporter=dot` | 387 passed; one existing authentication baseline failure out of 388 |
| `pnpm build` | Pass; existing >500kB bundle advisory remains |
| Auth browser acceptance | Pass: login/signup, verification/resend, protected return, restoration, logout, focus and responsive behavior |
| Journal shell acceptance | Pass: aliases, history/reload, direct editors, guards, local materials and responsive shell |
| Recipe journal acceptance | Pass: 1440/768/390/320px, complete long ingredients/method/notes, actions, focus, history and offline/retry |
| Recipe forms acceptance | Pass: native submission, POST/PATCH, structured rows/order, validation, pending/error/retry, guards, 18-ingredient/14-step editor, 320px/reflow |
| BE-08 discovery acceptance | Pass: title/ingredient/combined search, newest/rating sort, debounce, cursor retry/end states, focus and unavailable filters |
| Mori dialogue acceptance | Pass: keyboard, focus recovery, route cleanup, reduced motion, no obstruction or network writes |
| Expanded journal acceptance | Pass: 1440/1366/1280/1024/390/320px, public/demo routes, guarded drafts, cursor-backed spreads, criteria/history/return |
| Native Chrome 200% zoom | Pass: collection/detail/create/edit/demo, validation focus, dynamic rows, guard and geometry |
| Existing visual fidelity acceptance | Pass: paper-contained controls and complete reachable content |
| Step 1 regression/comparison | Pass: source dimensions, breakpoint, all button variants, physical layers, buried/exposed bookmark clicks, modal stacking and paired native zoom |
| New Step 2 comparison/acceptance | Pass: all 28 source/application scenes, native form ownership, first/subsequent density, opaque-cursor retry, direct unloaded windows, selected-card history/reload, index restoration and responsive anchor |
| Local Supabase acceptance runner | Environment failure before stack startup: sanitized Windows subprocess reports `Command "supabase" not found`; no live backend result claimed |
| `git diff --check` | Pass |

The unchanged baseline is `src/auth/AuthFlow.test.tsx:167`, “restores a valid
session on a fresh mount and allows protected access”: expected two calls to
`auth.getSession`, observed four. Its expectation and authentication code remain
unchanged. See [journal-ui01-auth-baseline.md](journal-ui01-auth-baseline.md).

All eleven isolated browser suites pass against the final implementation. Their
[results](../../frontend/test-results/ui01-step2/browser-results.json) and logs
are retained under `frontend/test-results/ui01-step2/`. The local backend runner
was retried with the native pnpm directory on PATH; both stack start and cleanup
still fail to resolve the Supabase CLI in its sanitized child environment. No
stack started and no live backend acceptance is claimed.

The resize stress check reproduced a transient DevTools viewport calculation:
two animation frames occasionally still reported the previous book dimensions;
the correct dimensions appeared within the next 100ms. Shared browser checks now
wait for the source-derived width and single/spread layout before measurement.
Application geometry formulas were not changed. Other in-scope regressions found
during development—refresh feedback, recoverable edit-load notices, account view
reset and Strict Mode return focus—were corrected. No remaining in-scope
regression is reported by the frontend or isolated browser coverage.

**11. Recommended Step 3 approach**

Keep server cursor discovery separate from physical content pagination. Measure
the actual paper body after fonts and responsive dimensions settle. Derive
continuation segments from semantic content: ingredient rows, ordered steps,
notes paragraphs and supported metadata, with a way to split one oversized item.
Keep stable item IDs and a recipe/content anchor so resize, editing and history
can find the same content. Reserve action/navigation space before measuring.

For forms, retain one controlled draft and native form, and map validation paths
to the continuation containing each field before focusing it. Plan keyboard
navigation, page announcements, zoom/reflow, pending/error layouts and dirty
guards before replacing the remaining scrollports. Establish readable static
continuation pages first; add page-turn animation only as separately approved work.
