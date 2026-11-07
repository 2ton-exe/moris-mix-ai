# UI-01 Figma fidelity correction — Step 1

Completed on November 1, 2026, on `feat/UI-01-journal-redesign`.
No commit, push, rebase, merge, staging, or PR operation was performed.
The incoming working tree already contained the journal redesign; those changes
were preserved. This report describes the corrections made in this milestone.

**1. Reference and files changed**

The authority is [the original Figma Make](https://www.figma.com/make/p2oIcNIvnbLu8exQJ6P9hP/Design-Pan%E2%80%99s-Scraps-Journal)
and `../figma-make-reference`, particularly `src/styles/book.css`,
`src/journal/book.tsx`, `src/styles/paper.css`, `src/styles/decor.css`, and the
feature-level button usage. The Figma connector returned the Make resource index;
its screenshot/session tools do not support Make files. The original app was
therefore rendered locally, using its React and Tailwind plugins without changing
its source or requiring the missing Make-managed Vite configuration.

| Files changed in this milestone | Purpose |
| --- | --- |
| `frontend/src/journal/JournalShell.tsx`, `journal-shell.css` | Source geometry, separate boards/stacks/leaves, gutter, plate, punched holes, rings, physically occluded bookmarks, overlay destination |
| `frontend/src/journal/foundation.css`, `Scrapbook.tsx` | Reusable small/standard/large sizes and ghost/page-turn/icon presentations; original materials |
| `frontend/src/journal/journal-auth.css` | Remove the blanket large-primary size override; explicit contextual sizes own dimensions |
| `frontend/src/journal/recipe-journal.css` | Preserve curvature under the later kraft material rule; remove conflicting action heights |
| `frontend/src/journal/journal-compositions.css` | Keep desk companion margins after moving book sizing out of desk padding; prevent Mori entrance overflow |
| `frontend/src/pages/AuthPage.tsx`, `EmailVerificationPage.tsx` | Explicit large prominent actions; ordinary verification submission stays standard |
| `frontend/src/pages/RecipeDetailPage.tsx`, `RecipeDashboardPage.tsx` | Small Edit and source page-turn presentation on existing navigation links |
| `frontend/src/recipes/RecipeDeletionControl.tsx`, `DeleteRecipeDialog.tsx` | Small ghost delete trigger; confirmation portal above the physical book |
| `frontend/src/recipe-form/RecipeForm.tsx`, `recipe-form.css`, `UnsavedChangesDialog.tsx` | Compact contextual controls, 40px named remove icons, standard save actions, guard portal |
| `frontend/package.json`, `pnpm-lock.yaml` | Pin `lucide-react` 1.64.0 for the original BookOpen, NotebookPen, and X icons; matching icon treatment for existing public links |
| `frontend/e2e/journal-step1.browser.mjs`, `journal-geometry.mjs` | Paired source/production rendering, geometry/style assertions, actual root and exposed-end clicks, hover, focus, modal stacking, breakpoint and native zoom evidence |
| `frontend/e2e/journal-shell.browser.mjs`, `recipe-journal.browser.mjs`, `recipe-forms.browser.mjs`, `mori-dialogue.browser.mjs` | Update structural/material and 38px expectations; use half-size viewport reflow alongside the separate native browser zoom suite |
| This report and `journal-ui01-auth-baseline.md` | Completion evidence and separate baseline failure record |

Router paths, auth/session code, Query hooks, CRUD/discovery adapters, validation,
guards, API contracts, and dialogue state machines were not changed. Dialog portals
preserve React context, pending state, keyboard traps, Escape behavior, and focus
restoration. No source prototype services or authentication were imported.

**2. Original versus corrected geometry**

Measurements are Chromium CSS pixels at 100% zoom, viewport height 900px.
Desktop paper dimensions include the complete physical leaf. Narrow layouts use
the existing shared scrolling paper area, rather than the height of its flowing
content children.

| Viewport | Source book W×H | Before book W×H | Corrected book W×H | Source paper W×H | Before paper W×H | Corrected paper W×H |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 1164.38×776.42 | 1132.39×756 | 1164.38×776.42 | 550.55×744 | 534.20×720 | 550.56×744 |
| 1280×900 | 1070.61×714.06 | 1126×751.78 | 1070.61×714.06 | 506×683.78 | 531×715.78 | 506×683.78 |
| 1024×900 | 647×774 | 870×583.36 | 647×774 | 620×756, single | 403×547.36, each of two | 620×756, single |
| 390×900 | 355×774 | 370×688 | 355×712 | 328×756 | 352×664 | 328×694 |

The original formulas now determine paper height from both viewport axes, paper
width from `.74 × height`, proportional board overhang, gutter, outer/page radii,
ring width/height, and placement. There are no book scaling transforms or reduced
body text used to fit the viewport.

| Viewport | Corrected book origin | Paper origin, right/single | Paper ratio W/H | Spine center X |
| --- | --- | --- | --- | --- |
| 1440×900 | 137.81, 71.78 | 735.39, 87.98 | .7400 | 720 |
| 1280×900 | 104.69, 102.95 | 654.16, 118.09 | .7400 | 640 |
| 1024×900 | 188.50, 112 | 206.50, 121 | .8201 | 213.50, left binding |
| 390×900 | 17.50, 174 | 35.50, 183 | .4726 | 42.50, left binding |

Both desktop leaf tops/bottoms align. The desktop gutters are approximately
30.83px and 28.34px, replacing the fixed 26px gap. Subpixel differences from the
source are below .02px at the requested desktop sizes.

On authenticated phones the retained production account row needs 62px more
top clearance than Make's compact toolbar. The book starts at 174px instead of
112px and its paper height reduces accordingly; width, binding, tab insertion,
and the bottom position remain derived from the source. This prevents logout and
tabs from overlapping. Every complete requested book remains within the 900px
viewport; the 1024px and 390px covers end at y=886px.

Raw [before measurements](../../frontend/test-results/ui01-step1/before/measurements.json)
and [source/corrected measurements](../../frontend/test-results/ui01-step1/after/measurements.json)
include page dimensions, positions, ratio, rings, styles, and hit-test coordinates.

**3. Bookmark stacking and hit-test evidence**

All physical layers share the book's coordinate system. Boards are at 1/3,
gutter at 2, brass plate at 5, paper stacks at 7, bookmarks at 9, live paper at
10, and rings at 15. The desktop `main` spread has `z-index: auto`; it does not
trap live leaves beneath bookmarks. On narrow layouts, the shared scrollport is
the live paper layer at 10. Decorative layers all ignore pointer events.

Bookmarks are 130×46px on desktop, Figtree 650 at 13.5px/1.05, padding
`0 8px 0 30px`, with a 10px vertical gap. The original grain, sage/mustard/cream
colors and cast/inset shadows are retained. There is no rotation or active
underline. The 24px base insertion combines with the source translations:

| Desktop state | Translate X | Covered root | Visible protrusion |
| --- | --- | --- | --- |
| Inactive | −14px | 38px | 92px |
| Hover | −6px | 30px | 100px |
| Active, including hover | 0 | 24px | 106px |

At 1440px, for example, the active root test at `(1265.97,163.06)` hits
`.mm-journal-page`; its exposed end at `(1375.97,163.06)` hits the actual link.
The inactive root at `(1251.97,219.06)` hits paper and the exposed end at
`(1361.97,219.06)` hits the New recipe link. The focused suite also clicks those
points: the covered root leaves the route unchanged and the exposed end opens
the editor. Keyboard focus and Enter open the same route.

Top tabs are 54px high, translated down 8px inactive, 4px on hover, and 0 active.
Paper covers 20/16/12px respectively. Their visible strips are 34/38/42px high.
An unpainted 10px extension above the strips provides at least a 44px interactive
height. That extension supplies only hit area; actual paper at z=10 covers the
bookmark roots. Below 400px, icons are hidden and padding/gaps follow the final
original responsive overrides. Full production accessible names remain intact.

The JSON evidence records actual `elementFromPoint` targets. Bookmark closeups
and hover captures are in each requested width's `after/*-bookmarks*.png` files.
Confirmation buttons are separately hit-tested outside the paper stacking
contexts. Existing suites verify both delete and dirty-form focus traps and
restoration, including native zoom.

**4. Contextual button comparison**

The same labels were rendered through original CSS and production variants under
the same Figtree font. Widths differ by less than 1px; the following heights,
font sizes, line heights, radii, padding, and background treatments match exactly.

| Variant / sample | Source and corrected W×H | Text | Radius | Actual use |
| --- | --- | --- | --- | --- |
| Small / Edit | 49.59×38px | 13.5px | 8px | Edit recipe, compact move controls |
| Standard / Save recipe | 116.02×44px | 15px | 10px | Save, cancel, regular actions |
| Large / Log in | 96.28×52px | 16.5px | 12px | Authentication submission and prominent verified continuation; these expand to card width |
| Ghost small / Remove | 67.06×38px | 13.5px | 8px | Delete trigger and compact form additions, with contextual source colors |
| Page turn / Next page → | 105.78×44px | 13px | 999px | Existing collection page links; transparent dog-ear navigation treatment |
| Icon / × | 40×40px | 17px source X icon in real forms | 999px | Remove ingredient/step; existing accessible labels preserved |

Ink and paper controls retain source grain, highlights, lower edge and cast
shadows. Ghost, page-turn and icon controls have no filled material shadow.
Compact actions have surrounding row/action spacing; regular actions were not
globally reduced to the small size. Actual Edit/Delete, add/remove row, Save and
login controls are checked in their real routes, in addition to the CSS probes.

**5. Matching screenshots**

Open the [three-way screenshot gallery](../../frontend/test-results/ui01-step1/comparison.html).
It shows original, before, and corrected captures at 1440, 1280, 1024, and 390px,
with the same 900px viewport and 100% zoom. Gallery frames align the first 900px;
linked PNGs retain their full-page capture, including the desk companion below
the viewport. These are browser screenshots, not reconstructed design images.

| Scene | Production route | Original route | Example original / before / corrected |
| --- | --- | --- | --- |
| Index | `/app/recipes` | `/journal/index` | [Original](../../frontend/test-results/ui01-step1/reference/1440-index.png) / [Before](../../frontend/test-results/ui01-step1/before/1440-index.png) / [Corrected](../../frontend/test-results/ui01-step1/after/1440-index.png) |
| Detail | `/app/recipes/:id` | `/journal/scraps/:id` | [Original](../../frontend/test-results/ui01-step1/reference/1440-detail.png) / [Before](../../frontend/test-results/ui01-step1/before/1440-detail.png) / [Corrected](../../frontend/test-results/ui01-step1/after/1440-detail.png) |
| Create | `/app/recipes/new` | `/journal/scraps/new` | [Original](../../frontend/test-results/ui01-step1/reference/1440-create.png) / [Before](../../frontend/test-results/ui01-step1/before/1440-create.png) / [Corrected](../../frontend/test-results/ui01-step1/after/1440-create.png) |
| Login | `/login` | `/login` | [Original](../../frontend/test-results/ui01-step1/reference/1440-login.png) / [Before](../../frontend/test-results/ui01-step1/before/1440-login.png) / [Corrected](../../frontend/test-results/ui01-step1/after/1440-login.png) |

Both apps use the existing `fixtures/demo-recipe.json`, with its title,
ingredients, method, rating and cooked date mapped to each app's schema.
Reference mock storage is confined to its browser context. Production uses its
real router/components with intercepted fixture responses and synthetic test
sessions. Reference web fonts are served from the same local normal font files
for reproducibility; external services are not contacted.

Evidence is local and ignored under `frontend/test-results/ui01-step1/`.
From `frontend`, regenerate the corrected captures with
`node e2e/journal-step1.browser.mjs after`. The sibling reference must have its
dependencies installed. Keep the existing `before` directory: running `before`
again captures the current checkout, not historical code.

**6. Responsive and zoom results**

At 1100px the original and corrected app both render a spread, with a
416×562.16px paper. At 1099px both render a single 620×756px paper. Resizing back
to 1024px preserves that arrangement and complete content access. See
[boundary measurements](../../frontend/test-results/ui01-step1/breakpoint-measurements.json).
The original short-height transition below 640px is also retained.

Native Chrome 200% zoom uses isolated profiles with the browser zoom preference,
not CSS zoom or a scaling transform. Both apps match at the same physical window:

| Window at 200% | Observed CSS viewport | Source and corrected paper | Result |
| --- | --- | --- | --- |
| 1440×900 | 712×402, DPR 2 | 620×258.5px | Same bounds, single page, no horizontal overflow |
| 1280×900 | 632×402, DPR 2 | 570×258.5px | Same bounds, single page, no horizontal overflow |

Browser chrome accounts for the difference from a nominal half-size CSS viewport.
[Zoom measurements](../../frontend/test-results/ui01-step1/native-zoom-measurements.json),
[1440 original](../../frontend/test-results/ui01-step1/reference/1440-native-200-index.png),
[1440 corrected](../../frontend/test-results/ui01-step1/after/1440-native-200-index.png),
[1280 original](../../frontend/test-results/ui01-step1/reference/1280-native-200-index.png),
and [1280 corrected](../../frontend/test-results/ui01-step1/after/1280-native-200-index.png)
are retained. The separate native zoom acceptance suite covers journal, detail,
create/edit, demo, validation focus, dynamic rows, guard keyboard traps and return
navigation. Other browser suites retain explicit half-size viewport reflow checks.

Desktop leaf scrolling and the existing narrow shared scrollport remain. No
recipe overflow was hidden, content truncated, or continuation pagination added.
Long-content suites exercise 34 ingredients/22 method steps and 18-row/14-step
editors, including narrow widths, reachable end content and save controls.
Passing these checks verifies accessibility of the current content, and does not
approve scrolling leaves as the final composition design.

**7. Functional validation**

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm type-check` | Pass |
| Full frontend tests, one worker | 382 passed; one existing auth baseline failure out of 383 |
| `pnpm build` | Pass; existing >500kB bundle advisory remains |
| Auth browser acceptance | Pass: login/signup, verification, resend, protected return, restoration, logout, keyboard, responsive and reduced motion |
| Journal shell browser acceptance | Pass: 1440/768/375/320px, aliases, direct editors, Back/Forward, dirty bookmark guard, materials, public routes |
| Recipe journal browser acceptance | Pass: 1440/768/390/320px, long complete content, edit/delete and focus/history |
| Recipe forms browser acceptance | Pass: CRUD, dynamic fields/order, validation, pending/error/retry, guards, 320px and zoom-equivalent reflow |
| BE-08 discovery browser acceptance | Pass: 1280/375/320px, search/debounce/sort, mappings, cursor pagination, retry/end states and logout |
| Mori dialogue browser acceptance | Pass: 1440/768/375/320px, focus, route cleanup, reduced motion, reflow and no network writes |
| Expanded journal browser acceptance | Pass: 1440/1366/1280/1024/390/320px, guarded drafts, collection navigation, public/demo routes and geometry |
| Native Chrome 200% acceptance | Pass: journal/detail/edit/create/demo, focus, validation, dynamic rows and guard |
| New Step 1 comparison/interaction suite | Pass: matching source geometry, all variants, computed layers, buried/exposed clicks, hover, keyboard, modals, breakpoint and paired native zoom |
| `git diff --check` | Pass |
| Local Supabase acceptance runner | Could not start the stack: Windows subprocess executable resolution; no live backend acceptance result claimed |

The authentication baseline is documented separately in
[journal-ui01-auth-baseline.md](journal-ui01-auth-baseline.md). Its test expectation
and auth implementation were not changed. All validation logs are retained beside
the [visual evidence](../../frontend/test-results/ui01-step1/visual.log).

The local backend runner first failed with `spawn pnpm ENOENT`. Prepending the
native pnpm executable directory allowed the next attempt to reach pnpm, but the
sanitized subprocess environment still reported `Command "supabase" not found`
for both stack start and cleanup. No stack was started. No runner or backend
code was changed to bypass this environment limitation.

**8. Remaining deviations**

- Authenticated phone top clearance differs by the documented 62px account-row
  reserve. Transparent top-tab hit extensions improve usability without changing
  the original painted shape or root occlusion.
- The static stack shows four source-spaced sheet edges. Count/progress-based
  thickness and animated cover/page turns remain separate work.
- Production retains its two existing authenticated section links and separate
  Mori launcher; the prototype has four bookmarks. No new route or dialogue
  behavior was introduced to fill that difference.
- Detail/editor/index content composition, recipe card artwork/density, toolbar
  branding and the separate auth-cover composition retain their earlier design
  differences. Matching scenes expose these differences; they are not presented
  as full-screen pixel equivalence.
- Independent desktop paper scrolling remains by instruction. Source material
  curvature now faces the binding, but its CSS is integrated with those existing
  scroll regions; content and complete page-turn choreography are not redesigned.
- Verification uses Chromium and DOM accessibility/keyboard checks. No separate
  screen-reader session or multi-browser/device certification is claimed.

**9. Recommended Step 2, for separate approval**

1. Specify the source-matched detail and editor compositions on top of the now
   fixed paper geometry. Define which authoritative fields occupy each physical
   page and how single-page reading order works.
2. Design physical continuation pages for long ingredients, method and notes,
   including long individual entries, metadata and conditional/error states.
   Plan stable DOM reading order, focus, screen-reader page announcements and
   native zoom/reflow before replacing any scroll region.
3. Keep existing collection/cursor pagination distinct from physical continuation
   pages. Preserve BE-08 criteria, loaded data, return locations and history state.
4. Preserve one live editor and its draft across physical pages, with validation
   routing focus to the page containing the invalid field and the existing
   unsaved-change guard owning navigation decisions.
5. Implement one approved composition at a time, with paired source screenshots,
   adversarial long-content coverage, keyboard/history tests and reduced motion.
   Add animated/inert outgoing leaves only after the content model is complete.

Step 2 and physical continuation pagination have not been started.
