# UI-01 visual correction report

November 1, 2026. Branch: `feat/UI-01-journal-redesign`. Changes remain uncommitted.

This pass corrects the book geometry, facing-page composition, stationery controls,
and authentication scene. It improves fidelity without claiming a pixel-perfect
reproduction of every Make screen or its page-turning machinery.

**1. Reference inspected and root cause**

Reference: [Figma Make journal](https://www.figma.com/make/p2oIcNIvnbLu8exQJ6P9hP/Design-Pan%E2%80%99s-Scraps-Journal),
with the extracted source in `../figma-make-reference`. Reviewed `journal/book.tsx`,
`features/journal.tsx`, `features/discovery.tsx`, `features/recipe.tsx`,
`features/auth.tsx`, and the book, paper, decor, screens, motion, desk and token CSS.

The four archived image assets show loading or closed-cover scenes. The extracted
Make app was therefore also rendered locally using a temporary Vite configuration
and temporary dependencies, without editing its source. Captures of its actual
index, collection and login screens are included in the evidence gallery. Its
prototype data and simulated services were used only in that isolated reference
render; none were imported into the production application.

The old `.mm-journal-spread` explicitly allocated
`minmax(240px, .8fr) 26px minmax(0, 2fr)`. That made the paper widths approximately
28.6% / 71.4%, with a long decorative flyleaf beside a wide dashboard. The original
Make book instead derives both pages from one shared `--pw`, approximately
`.74 * page height`, with a centered gutter and six brass rings.

Two other causes compounded the composition problem. Production actions still
used the generic `.button` foundation instead of the reference's layered materials.
Discovery's journal overrides depended on an unused `.mm-recipe-index` ancestor,
so the actual controls retained the old dashboard panel. The large rectangle
around the auto-focused heading was a general focus outline on a noninteractive
heading, rather than a reference stationery element.

**2. Component and CSS corrections**

- `JournalShell.tsx` and `journal-shell.css`: two equal `minmax(0, 1fr)` tracks,
  a 26px centered gutter, symmetric cover padding, aligned paper boundaries and
  mirrored page edges. Stage width accounts for viewport height, portrait page
  proportions, desk margins and external bookmark clearance. Each desktop paper
  has its own vertical scrolling region; the paper and cover do not grow with
  the number of recipes or form rows.
- `JournalFacingPage.tsx` and `JournalLayoutContext.ts`: one live facing-page slot
  implemented with a stable portal destination. Responsive CSS rearranges that
  same DOM; resizing does not mount a second set of controls or replace form state.
- `RecipeDashboardPage.tsx` and `recipe-journal.css`: introduction, actions,
  existing Mori launcher and search controls occupy the left paper; actual
  results occupy the right. This follows the reference discovery spread. Both
  pages use its kraft material. Search uses an ink field and paper selectors,
  with uppercase stationery labels. Existing capability explanations remain.
- `RecipeDetailPage.tsx`: actual title, metadata, illustration and actions occupy
  the facing paper. Ingredients, method and notes flow down the other paper,
  following the reference recipe composition.
- `RecipeEditorFrame.tsx` and `recipe-form.css`: move the existing introduction
  and Mori artwork to the facing paper and reduce nested padding around the live
  form. All inputs stay in the existing form, with Save and Cancel scroll-accessible.
- `JournalAuth.tsx` and `journal-auth.css`: closed leather book on the left,
  recipe card on the right, a maximum 450px card, blue ruling, a red double header
  rule, sage tape, paperclip, warm inset fields and an integrated password toggle.
  The cover has larger italic embossed lettering, a hinge, stitched seam,
  triangular brass corners, elastic and a hanging bookmark.

The main landmark now contains both papers. The noninteractive landing heading
does not draw the old dashboard rectangle; interactive controls and keyboard
scroll regions retain visible focus. The decorative binding ignores pointer
events. The right paper deliberately avoids a stacking context so fixed
confirmation dialogs render above the entire book.

**3. Desktop measurements**

Chromium, viewport height 900px. Measurements use rendered DOM rectangles,
including each paper's padding. Both page tops are at y=111px.

| Viewport | Before left / right | After left / right | After width difference | Spine offset from book center | Final book bounds |
| --- | --- | --- | --- | --- | --- |
| 1440px | 337.594 / 844.031px | 532.8125 / 532.8125px | 0% | 0px | x=155.188, width=1129.625, y=96, height=754.172px |
| 1280px | 294.625 / 736.594px | 457.609375 / 457.609375px | 0% | 0px | x=150.391, width=979.219, y=96, height=655.219px |

Before correction the spine was 253.219px off center at 1440 and 220.984px at
1280. The final page bottoms align exactly. Both complete books and their
bookmarks fit horizontally; the books also fit vertically at these viewports.

Raw evidence: [measurements](../../frontend/test-results/visual-fidelity/after/measurements.json).

**4. Button changes and reference mapping**

`foundation.css` now shares the same treatment between the existing semantic
`.button` actions and the reusable `ScrapbookButton`. Form and delete action
overrides that flattened these materials were removed.

| Production action | Make reference | Result |
| --- | --- | --- |
| Start a recipe, login/signup, Save | `decor.css .btn-ink` | Burgundy grain, top highlight, lower ink edge, cast shadow |
| Refresh, Mori launcher, demo recipe, Cancel | `.btn-paper` | Warm paper grain, inset 1.5px ink outline, lower paper edge |
| Delete | `.btn-danger` | Same geometry with distinct brick-red ink |
| Journal section links | `book.css .bookmark` | Sage/mustard tabs, lifted active edge, hover and pressed movement |

Buttons follow the reference's Figtree 650 typography, 15px base text, 44px minimum
height and 10px corners. Authentication primary actions use its 52px / 16.5px /
12px large variant. Pressing moves the control down 2px and compresses its shadow;
hover changes the ink or paper edge. Rounded layered controls are what the actual
source uses; arbitrary jagged button shapes were not added.

**5. Before-and-after screenshot comparison**

Open the [interactive comparison gallery](../../frontend/test-results/visual-fidelity/comparison.html).
It switches between 1440, 1280, 768, 390 and 320px, with dashboard, detail, create
and login captures at each width. It also shows the available locally rendered
1440px Make reference. Detail/editor selections use the collection reference only
to illustrate shared geometry; they are not represented as original detail/editor
screenshots.

| Scene | Before | After |
| --- | --- | --- |
| Desktop dashboard | Narrow decorative flyleaf, off-center binding, bordered heading, conventional search panel; the book extends far below the viewport | Equal kraft papers, centered binding, ink heading and stationery search on left, recipe entries on right, complete book visible |
| Desktop detail | Main content crowded onto the wide right paper | Title/artwork/actions on left; readable scrolling ingredients, method and notes on right |
| Desktop editor | Static bookplate beside the whole form | Existing editor introduction on left; less nested padding around the working form on right |
| Login | Card left, book right, small cover lettering, unruled card | Book left, ruled card right, visible embossing, brass corners, warm fields and layered actions |
| 390 / 320px | Cramped horizontal recipe-card content and selectors | One-column selectors and photo cards, readable titles, normal document scrolling |

These are screenshots of the actual production React components/router with
synthetic authentication and intercepted responses from the repository's existing
`fixtures/demo-recipe.json`. They do not establish live Supabase operation. The
same single recipe is used before and after; no recipes were invented or duplicated
to fill the spread. Login's original baseline was also recaptured from a saved
pre-edit source snapshot after its entrance animation settled.

Evidence is deliberately ignored under `frontend/test-results/`; keep the local
folder when reviewing. Regenerate after captures and the gallery from `frontend`
with `node e2e/journal-visual-fidelity.browser.mjs after`. Running `before` captures
the code currently checked out; it cannot recreate a historical implementation.

**6. Remaining differences from Figma**

The production dashboard combines the reference discovery spread with its
collection-style illustrated recipe cards. The original index uses compact ruled
title slips, so its result density is higher. A single returned recipe naturally
leaves unused paper; the production page does not import the reference's sample
collection. The current safe illustrated recipe placeholder also remains instead
of the prototype's supplied food photos.

The toolbar retains the production brand card, email and logout controls rather
than the reference's torn tags/account menu. The book sits slightly lower and has
somewhat different cover overhang, brass and page-stack thickness. Its static
thickness does not change with recipe count. The form retains stacked field panels
rather than the prototype's animated loose folio.

Login retains its existing verification and demonstration actions, making the
card taller than the original. Branding is MORI'S MIX rather than Pan's Scraps.
The cover's lettering is more prominent but its exact arrangement and scale differ.
A miniature cover appears at tablet width; phones omit it for readable form space,
whereas the original keeps a small cover above the card. The original's exact
page-turn and cover choreography remains absent, as detailed below.

These differences were assessed visually against the reference screenshots; passing
the geometry checks does not establish complete visual fidelity.

**7. Accessibility and responsive behavior**

At widths below 1100px or heights below 640px, the papers become one readable
vertical page flow with the binding on the left and bookmarks above the book.
768, 390 and 320px screenshots show no horizontal overflow. At 450px and below,
selectors and recipe cards use one column. Mobile content scrolls with the document
instead of nesting two narrow paper scrollers.

Existing native buttons, links, inputs, labels, accessible names, disabled states,
keyboard activation and error descriptions remain. Scrollable desktop papers are
named keyboard-focusable regions. Focus indicators, skip navigation, heading
structure, modal focus traps/restoration, reduced motion, long content and 200%
zoom are covered by the existing browser suites. The new screenshot harness also
scrolls controls into view and checks their horizontal containment inside the paper
and away from the binding. No screen-reader session or formal contrast audit was
performed in this pass.

**8. Validation results**

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass; generated screenshots/reports are excluded from ESLint |
| `pnpm type-check` | Pass |
| Full frontend tests | 374 passed, one documented baseline failure in `AuthFlow.test.tsx:167` |
| `pnpm build` | Pass; existing >500kB bundle advisory remains (746.61kB JS, 215.61kB gzip) |
| Auth browser suite | Pass: authentication/verification/session/logout, keyboard, responsive, reduced motion, 200% zoom |
| Journal shell browser suite | Pass: 1440/768/375/320px, history, direct editors, unsaved guards, focus and public routes |
| Recipe journal browser suite | Pass: 1440/768/390/320px, long detail content, actions and route focus/history |
| Recipe forms browser suite | Pass: create/edit/delete, validation/retry/pending, unsaved dialogs, long forms, 320px and zoom |
| Discovery browser suite | Pass: 1280/375/320px, BE-08 mappings, debounce, sorting, pagination and retry/focus |
| Mori dialogue browser suite | Pass: 1440/768/375/320px, keyboard, focus, choices, route cleanup, reduced motion and zoom |
| New screenshot/geometry harness | Pass: all five requested widths, four screens each, equal desktop pages, centered spine, no overflow, control access/binding clearance |
| Local Supabase Playwright runner | Could not start: native subprocess cannot resolve `supabase` (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`), including cleanup; no live/local backend acceptance result claimed |
| `git diff --check` | Pass |

The authentication failure expects two `getSession` calls and receives four;
`journal-review.md` and the earlier shell handoff document its reproduction on
`origin/main`. No auth behavior or test expectation was changed here. The first
test run, concurrent with browser/build work, also had four timing/element-wait
failures. The full one-worker rerun removed all four and retained only the known
baseline failure. Command: `pnpm exec vitest run --configLoader runner --maxWorkers=1`.

New browser regressions caught during this pass were corrected: the binding's
stacking context intercepted the dirty-form dialog; the initial content move
inherited a light heading color; narrow controls/cards were cramped. The final
screenshots and acceptance suites include those fixes. A screenshot-only loading
wait was increased from 5 to 30 seconds after one initial timeout during concurrent
validation; geometry and control assertions remain intact.

Logs are under `frontend/test-results/visual-fidelity/validation/`. The synthetic
browser suites make no production requests. Supabase auth implementation, API
contracts, query hooks/cache scoping, CRUD/BE-08 services, validation, backend code,
and Mori dialogue logic were not changed by this correction pass.

**9. Interaction follow-up proposal**

The Make prototype has an interactive closed cover, a 3D opening/closing sequence
with elastic release, directional page turns with front/back snapshots and moving
shadows, newer/older dog-ear collection navigation and arrow keys, recipe-to-recipe
turns, count-based page stacks, loose create-folio insertion, edit uncover/settle,
and deletion leaf removal with opening rings. MORI'S MIX currently has none of that
book navigation/transition machinery. This pass adds only static paper curvature,
aligned page edges, material shadows and bookmark hover/pressed/active polish.

A separate implementation should define a route-aware presentation layer after
React Router authorizes navigation. Keep one live route/form mounted; render any
outgoing visual copies as inert, hidden from assistive technology and unfocusable.
Define forward/back direction for browser history as well as links. Respect the
existing unsaved-change blocker before starting any animation, preserve drafts
and scroll/focus, and provide an immediate reduced-motion path. Add tests for
blocked navigation, Back/Forward, rapid repeated navigation, errors, account
changes, dialog focus and cleanup before attempting the prototype's full turns.
No new routing, pagination shortcuts or fragile snapshot animations were added here.

No commit, push, rebase, merge or PR was performed.
