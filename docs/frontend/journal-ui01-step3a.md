# UI-01 Step 3A — physical recipe continuation pages

November 1, 2026. Work remains on `feat/UI-01-journal-redesign`. The incoming
Step 1 and Step 2 working tree is preserved. No branch, commit, staging, push,
rebase, merge or PR operation is included. Form pagination and animation remain
separate milestones.

## Architecture and reference

Reviewed `journal-ui01-step1.md`, `journal-ui01-step2.md`, the shared shell,
facing/footer portals, detail/demo routes, collection return state and responsive
overflow rules. Reinspected the sibling `../figma-make-reference`, particularly
`src/journal/book.tsx`, `src/features/recipe.tsx`, `src/ui/kit.tsx` and
`src/styles/{book,paper}.css`. The original uses fixed physical paper, compact
page-turn controls, footer actions and a single-page transition below 1100px.
Its recipe body scrolls; continuation pagination is an intentional extension.
No prototype services or mock data are imported into production.

`RecipeReading` is shared by authenticated detail and public demonstration
reading. It constructs ordered semantic units from validated frontend recipe
data. `useReadingPagination` measures their real DOM; `paginateReading` packs
whole units into leaves; `readingSpreads` groups those leaves for the responsive
layout. `JournalReadingTurns` presents the existing small page-turn treatment.
No pagination dependency is added.

## Semantic boundaries and completeness

- Each ingredient is one indivisible unit. Amount descriptions retain priority
  over numeric quantity/unit presentation, as in Step 2.
- Instructions are copied and sorted by backend `step`, preserving supplied
  numbers, complete text and stable ordering of equal-numbered steps. Cached
  recipe data is never mutated.
- Notes break at blank-line paragraph boundaries. Delimiters remain attached to
  their paragraphs; concatenating their displayed text reconstructs the exact
  original note, including whitespace and long unbroken words.
- The complete supported flavor-score group is one unit. Identity retains the
  full title, illustration, cooked date, rating and missing-rating treatment.
- Empty ingredients, instructions and notes retain explicit empty states.

An unusually tall ingredient, instruction, note paragraph or flavor group stays
whole on a leaf. Its outlined, named, keyboard-focusable region says “Long entry
· scroll to continue” and permits scrolling to the end. Text is never sliced by
character count, ellipsized or discarded to fit the page. This is the deliberate
bounded fallback for an indivisible unit, rather than a claimed sentence-split
continuation engine.

## Measuring paper capacity

The fixed live body dimensions already exclude running headings, request
feedback and the shell's measured footer reserve. Desktop uses the smaller
available width and height of the two leaves so either can contain a segment.
A small pixel clearance covers padding and rounding. Both live content columns
use the measured text width so line wrapping agrees with the bank. The bank renders the same
semantic markup, CSS, fonts and width as live content. It is offscreen,
`visibility: hidden`, `aria-hidden` and inert: it neither appears in the
accessibility tree nor receives focus.

Each unit is measured with a section heading. Packing charges the heading at
the start of a leaf or section, subtracts it for subsequent entries in the same
section, and includes the actual inter-entry spacing. Boundaries use rendered
heights, not character estimates. Continuation labels, item/step counts, taped
note padding and the wrapped fallback notice are measured too. Oversized-region
limits subtract their actual heading, decoration and notice overhead.
The complete content is initially available
in bounded scrolling paper until fonts and measurement are ready.

`ResizeObserver` watches fixed body capacity and the independent measurement
bank, not the paginated output. Measurements are coalesced to animation frames;
unchanged results do not update state. `document.fonts.ready` and later
`loadingdone` events handle initial and subsequent font settlement. Cleanup
disconnects observers/listeners and cancels the scheduled frame; late callbacks
check disposal before touching layout, including under Strict Mode.
Recipe content changes invalidate the previous layout immediately.

## Presentation, navigation and history

The first desktop spread keeps identity on the left and begins ingredients,
method, notes and flavor scores on the right. Further spreads fill the left
then right leaves with remaining content. Identity is not repeated. Section
headings repeat subtly at continuation boundaries; a small folio and running
heading retain the paper hierarchy. Leather boards, equal-width desktop leaves,
sheet edges, binding and bookmark occlusion retain Step 1 geometry.

Below 1100px, or at the source's short-height transition, only one live readable
leaf is shown at a time. Identity comes first, then all content leaves in order.
The original paper background still covers the full physical book, with actions
and navigation reserved beneath the reading body.

Previous Page / Next Page are ordinary focusable buttons in the established
page-turn style, with native disabled states. The current-page indicator has a
polite atomic live announcement. It counts displayed spreads on desktop and
individual leaves on narrow layouts; the left folio supplies the physical leaf
position. Buttons support Tab/Enter/Space; focused paper
also supports Left/Right and Page Up/Page Down. Inputs, links, buttons and long
entry scroll regions retain their own keys. Focus moves to the start of the
reading spread after a turn. Existing visible focus rules remain in force.
There is no page-turn animation, including with reduced motion.

`?read=<semantic-unit>` is separate from collection `leaf`/`entry` parameters
and opaque backend cursors. Turning adds a browser history entry and retains
all other search parameters, hash and route state. Back/Forward and reload
restore the same unit. Resizing finds the new leaf containing that anchor;
page counts may change without changing the URL anchor. Invalid or removed
anchors fall back safely to the first reading spread. Current unit identifiers
are section ordinals: insertion/reordering within an updated section preserves
the ordinal rather than tracking the identity of an individual ingredient.

Collection return links preserve Step 2's search/view/sort/entry location and
selected-card focus. Browser Back from the collection restores the prior reading
URL. No recipe-to-recipe control or server cursor is repurposed for reading.
The DOM-aware React Router provider enables synchronous page-turn commits;
ordinary route navigation retains its existing behavior.

## Before and after scrolling

Before: the entire desktop ingredients/method/notes column scrolled within one
leaf; narrow layouts scrolled identity and all content together.

After: normal semantic entries fill successive leaves without body scrolling.
Narrow layouts turn from identity to subsequent content leaves. Scrollable body
safety remains, along with explicit bounded regions for oversized entries and
long identity/title content. No global recipe `overflow: hidden` is introduced,
and typography is not reduced to force content onto a leaf.

Below 160px of usable body height (or 80px text width), page subdivision is not
considered readable. The page explicitly says “Page space is limited. Scroll
this paper to continue reading.” Narrow layouts retain identity followed by one
complete scrolling content leaf. In windows at most 450px tall, a 180px minimum
inner page prevents the reading body from collapsing beneath the footer. The
existing single-paper scrollport then also makes the footer reachable. Turning
resets both this scrollport and the body to the new leaf's beginning. This is a
deliberate high-zoom/short-window safety fallback, not hidden or missing content.

## Public demonstration

The existing `DemoRecipePage` already delegates successful responses to
`RecipeReading`, so it receives the same engine without replacing its request
or response. `/demo-recipe` remains public and uses `/functions/v1/demo-recipe`.
Cancellation, loading, safe errors, retry and home navigation remain intact.
The demo renders the fields supplied by its existing validated response contract;
no Figma recipe or invented personal notes are substituted.

## Files in this milestone

| Files | Change |
| --- | --- |
| `frontend/src/recipes/RecipeReading.tsx` | Shared semantic reading content, leaves, anchors, keyboard behavior and fallback regions |
| `frontend/src/recipes/readingPagination.ts` | Whole-entry packing and responsive spread grouping |
| `frontend/src/recipes/useReadingPagination.ts` | Font-aware DOM measurement, resize/content invalidation and bounded fallback |
| `frontend/src/journal/JournalReadingTurns.tsx` | Compact Previous/Next, disabled states and live page indicator |
| `frontend/src/journal/reading-pages.css` | Reading-only paper capacity, continuation and fallback styling |
| `frontend/src/main.tsx` | Reading stylesheet and DOM-aware router provider |
| `frontend/src/recipes/readingPagination.test.ts`, `RecipeReading.test.tsx` | Completeness, oversized entries, route state/history, keyboard and reflow tests |
| `frontend/e2e/journal-step3a.browser.mjs`, `reading-pages.mjs` | Real browser content, geometry, resize, history, fallback and native zoom acceptance |
| `frontend/e2e/recipe-journal.browser.mjs` | Read complete content through page turns instead of assuming one scrollable recipe |
| `frontend/e2e/journal-expanded.browser.mjs` | Exclude invisible measurement content from visible-paper geometry checks |
| This report | Architecture, limits, validation and Step 3B recommendation |

## Validation

Browser evidence and logs live under ignored
`frontend/test-results/ui01-step3a/`. Fixtures and synthetic
sessions exist only in isolated intercepted browser responses, never app data.

The dedicated acceptance suite reads every semantic unit once, in order, through
eight cases: short content, 36 ingredients, 25 reversed input steps, one enormous
step, 22 note paragraphs, missing optional fields, an unusually long title, and
mixed content with a long unbroken note. It checks 1440×900, 1280×900, 1024×900,
390×900 and 320×900; native Chrome 200% zoom covers private and public reading.
It also checks full text, bounded-scroll endpoints, equal desktop geometry,
in-book footers, keyboard controls, reduced motion, direct URLs, reload,
Back/Forward, responsive anchors, public retry and collection focus restoration.
Page turns must make no additional recipe or server-cursor requests. All thirteen
new unit tests exercise packing completeness, oversized entries, unmeasurable
capacity, responsive grouping, history/state, data updates and invalid anchors.

Reproduce from `frontend` with `pnpm lint`, `pnpm type-check`,
`pnpm exec vitest run --configLoader runner --maxWorkers=1 --reporter=dot`,
`pnpm build` and `node e2e/journal-step3a.browser.mjs`. The original browser suites
remain runnable through their existing `e2e/*.browser.mjs` entry points.

| Check | Result |
| --- | --- |
| Lint | Pass |
| Type-check | Pass |
| Full frontend tests, one worker | 400 passed; one existing auth baseline failure out of 401 |
| New unit coverage | All 13 tests pass, included in the full run |
| Production build | Pass; existing >500kB bundle advisory remains |
| New continuation browser acceptance | 51 reading scenarios pass: 40 normal viewport/content combinations, one public retry/return case and 10 native-zoom private/demo cases |
| Existing auth, shell, recipe journal, forms, BE-08 discovery and Mori dialogue browser suites | All pass |
| Existing expanded, native zoom, visual fidelity, Step 1 and Step 2 browser suites | All pass |
| `git diff --check` | Pass; new untracked milestone files also checked without staging |

All eleven existing browser suites and the new continuation suite pass. The
[browser results](../../frontend/test-results/ui01-step3a/browser-results.json),
[reading measurements](../../frontend/test-results/ui01-step3a/measurements.json)
and [screenshot gallery](../../frontend/test-results/ui01-step3a/index.html)
are retained. The gallery includes initial/continuation views for each content
case and complete, unscaled native browser captures.

Native zoom uses an isolated Chrome profile with browser zoom at 200%, not CSS
zoom or a page transform. Each row passes private mixed content and public demo
reading, complete ordering, keyboard End access to fallback endpoints, visible
focus, in-book return/turn controls and no horizontal document overflow:

| Native window width, height 900 | Observed CSS viewport | DPR | Reading behavior |
| --- | --- | --- | --- |
| 1440 | 712×402 | 2 | Identity then complete content, bounded short-height fallback |
| 1280 | 632×402 | 2 | Same |
| 1024 | 504×402 | 2 | Same; inner paper scroll also reaches the footer |
| 796 | 390×402 | 2 | Same; tests the phone reading width at native zoom |
| 656 | 320×402 | 2 | Same; tests the minimum requested reading width at native zoom |

Browser chrome accounts for the difference between physical window dimensions
and CSS viewport dimensions. At 100%, all five requested 900px-high viewports
retain fully visible book bounds; ordinary entries fit their leaves without
body scrolling. All API content remains accessible. Page changes produce no
extra recipe/cursor requests and no browser runtime errors. DOM semantics and
keyboard behavior are verified; no manual screen-reader session or cross-browser
certification is claimed. No live Supabase/backend acceptance result is claimed.

The pre-existing authentication unit-test failure is documented separately in
[journal-ui01-auth-baseline.md](journal-ui01-auth-baseline.md). Its expectation
and authentication implementation are unchanged.

## Known fallback cases

- An ingredient, instruction, note paragraph or flavor group taller than a leaf
  receives one complete, labeled scrolling region. Sentence-level subdivision
  of an individual entry is not implemented.
- Extremely long titles retain bounded identity-page scrolling so all title,
  date and rating content remains accessible.
- A very short or narrow reading area retains complete paper scrolling with a
  visible explanation. The native 200% cases use this deliberate fallback.
- Unsettled fonts or unavailable measurements retain the complete scrolling
  reading hierarchy until measured pagination is available.
- Removed/invalid anchors return to the first spread. After insertion/reordering
  within a section, anchors preserve their ordinal position, not an immutable
  ingredient/paragraph identity that the API does not supply.

## Step 3B design handoff

Keep one controlled draft and one native form around both physical leaves.
Paginate whole structured ingredient rows and whole step editors using stable
draft row keys, reserving footer/error space before measurement. Keep title,
cooked date and rating together where feasible. Keep a long notes textarea as
one controlled field with bounded editing rather than duplicating fragments
across pages.

Map each Zod/server validation path to its row key and containing leaf; reveal
that leaf before focusing the invalid field. Recompute after add/remove/reorder
and viewport changes while retaining the focused row and selection. Save the
entire draft independently of which fields are visible. Keep Save, pending/error
feedback and unsaved-change guards authoritative. Internal turns must not fire
the leave-editor guard, while real route changes still do. Plan history and
draft restoration explicitly; retain the complete scrolling form fallback until
validation focus, dirty guards and native submission pass browser acceptance.

The Step 3B implementation, responsive behavior, validation routing, browser
acceptance and screenshots are documented in
[journal-ui01-step3b.md](journal-ui01-step3b.md). Step 4 page-turn animation has
not begun.
