# UI-01 physical journal UX corrections

Branch: `feat/UI-01-journal-redesign`. Changes remain uncommitted. This report
supersedes the detached-sheet presentation described in
`journal-expanded-experience.md`.

## Root cause and sizing correction

The old stage considered width alone (`min(100% - 176px, 1120px)`). Its spread
had an aspect ratio but an automatic grid row, and both leaves imposed
`min-height: min-content` with visible overflow. Long controls, recipes, and
forms could therefore stretch the spread beyond its nominal ratio. The desk
also added 20px top padding, a toolbar, 28px toolbar spacing, and 56px bottom
padding. Single-page rules imposed another 560px page minimum. Tabs started
outside the leather cover rather than inside the paper edge.

The desktop stage now derives paper height from the smallest of:

```css
min(720px, calc(100dvh - 138px), calc((100vw - 192px) / 1.52))
```

Stage width includes the cover and a 92px tab reserve. Cover height is paper
height plus 36px. The two grid columns have equal flexible widths, a 26px gutter,
and `minmax(0, 1fr)` rows. Leaves have zero content minimum height and their own
scrollports, so content cannot size the book. Desk padding and toolbar spacing
are smaller. No book scaling or global font reduction is used.

At widths below 1000px or heights below 640px, the book switches to one leaf.
A desk container query also handles CSS zoom, which can reduce available
content width without changing viewport media queries. The single-page
scrollport has a readable 460px minimum; unusually short or zoomed viewports
can scroll the desk vertically to reach the frame. Horizontal scrolling is
unnecessary. Optional Mori guidance remains in document flow below the book.

## Measured desktop geometry at 100% zoom

Values are CSS pixels from rendered Chromium rectangles, rounded to two decimals.
The book rectangle includes the cover; exposed tabs are measured separately.

| Viewport | Book x, y | Book width x height | Cover + tabs width | Left / right page width | Page height | Spine center x | Book bottom |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1440 x 900 | 107.80, 82 | 1132.39 x 756 | 1224.97 | 534.19 / 534.20 | 720 | 673.98 | 838 |
| 1366 x 768 | 139.20, 82 | 995.59 x 666 | 1088.18 | 465.80 / 465.80 | 630 | 637.00 | 748 |
| 1280 x 720 | 132.69, 82 | 922.62 x 618 | 1015.21 | 429.31 / 429.31 | 582 | 594.00 | 700 |
| 1024 x 768 | 31, 82 | 870 x 583.36 | 962.58 | 403 / 403 | 547.36 | 466 | 665.36 |

Page width differences and spine offsets are below 0.02px. Every desktop cover
and tab fits the viewport, including its bottom edge. Measurements include
client/scroll widths and heights for each leaf, the binding and the mobile
scrollport, plus exposed-tab hit tests for every captured journal route.
Raw evidence: `frontend/test-results/physical-journal/measurements.json`.

390 x 844 and 320 x 740 use the single-page fallback. Neither introduces
browser-level horizontal overflow. Native 200% browser zoom uses a temporary
Chrome profile, a 1440 x 900 outer window, a measured 712 x 402 CSS viewport,
and device pixel ratio 2. This is distinct from the additional 720 x 450
effective-viewport and CSS-zoom checks. The native test records these values
and asserts that no CSS zoom is applied.

## Tabs, routing, and content compositions

Tabs are positioned on the book using its shared page-height variable, 24px
inside the right paper edge before rotation. Their measured roots overlap the
paper by about 25.63px and 21.63px. Adjacent tabs overlap by 5px and stagger by
4px, with small opposing rotations, layered paper shadows, and shaded roots.
The active or keyboard-focused tab has a higher stacking order. Tab roots live
outside the leaf scroll clips, while labels sit in the exposed clickable area.
The geometry audit uses `elementFromPoint` on that exposed area. On narrow
layouts tabs attach to the top paper edge, with exposed 44px-or-larger targets.

All existing authenticated destinations and selection rules are preserved,
including no selected section while editing. Public Home/About remain and a
Demo recipe tab identifies the public demonstration section.

`JournalShell` now always renders leather, page edges, binding, and paper. Its
composition modes are `journal`, `reading`, `writing`, and `demo`; the detached
expanded-sheet branch is removed. Shared content styles live in
`journal-compositions.css`.

- Browsing: existing equal facing pages, two compact previews per leaf, search,
  sort, journal pagination, and server cursor continuation.
- Reading: return navigation, title, rating, artwork, actions, and ingredients
  on the left; complete method, personal notes, flavor scores, and folio on the
  right. Each leaf scrolls independently on desktop.
- Writing: return navigation and introduction on the left; the original
  create/edit form on the right, with readable full-width fields. The same
  form instance survives responsive changes.
- Demonstration: public introduction, return action, recipe title, artwork,
  and ingredients on the left; instructions, flavor scores, and rating/date
  on the right. The existing demo API, loading/error/retry flow, and public
  authentication boundary are preserved.

The React Router paths, query/cache boundaries, CRUD adapters, validation,
unsaved-change state machine, deletion confirmation, and Mori dialogue logic
are unchanged by these corrections.

## Overflow, keyboard, and focus

Desktop leaves are named keyboard-focusable regions with thin, subtle
scrollbars and scroll padding. The main spread does not add a nested scrollbar.
On narrow screens leaf overflow becomes visible and the spread provides the
only content scrollbar. Binding and tabs sit outside it and remain stationary.
Existing journal pagination is retained instead of loading every recipe into
one long index.

Native focus scrolling reveals validation errors and newly added rows. Facing
content uses a single live portal destination across breakpoints. Its initial
attachment restores a route heading's focus if moving it into the portal
detached that focus. Existing card focus restoration, return/search state,
history guards, and modal keyboard behavior remain intact. Fixed confirmation
dialogs still cover the viewport above the binding and tabs.

## Screenshot evidence

Open [the gallery](../../frontend/test-results/physical-journal/index.html).
It contains browsing, reading, create, edit, demo, Home, About, fallback,
authentication, and verification captures across the six requested viewports;
demo loading/error captures; effective-viewport zoom captures; and native Chrome
200% zoom captures. Files are generated locally and ignored by Git.

Representative corrected views:

- [1440 x 900 browsing](../../frontend/test-results/physical-journal/1440-journal.png)
- [1366 x 768 reading](../../frontend/test-results/physical-journal/1366-recipe-sheet.png)
- [1280 x 720 create](../../frontend/test-results/physical-journal/1280-create-sheet.png)
- [1024 x 768 edit](../../frontend/test-results/physical-journal/1024-edit-sheet.png)
- [1024 x 768 demo](../../frontend/test-results/physical-journal/1024-demo-sheet.png)
- [390px journal](../../frontend/test-results/physical-journal/390-journal.png)
- [320px create](../../frontend/test-results/physical-journal/320-create-sheet.png)
- [Native 200% reading](../../frontend/test-results/physical-journal/native-200-detail.png)

## Validation

Checks ran sequentially. The final browser run executed every isolated browser
suite in order; logs are in `frontend/test-results/physical-journal/*.log`.

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm type-check` | Pass |
| Full frontend suite, `pnpm test --maxWorkers=1` | 382 passed; one known baseline auth failure |
| `pnpm build` | Pass; existing bundle-size advisory |
| Journal shell browser suite | Pass; deep links, reload, history, sections, guarded navigation, assets, modal bounds, logout, CSS zoom |
| Recipe journal browser suite | Pass; full/long content, final ingredient and notes reachable, fixed cover/binding during desktop scrolling, focus, history, errors, deletion |
| Recipe forms browser suite | Pass; dynamic rows, validation, focus, guards, CRUD, pending/retry, 18 ingredients/14 steps, 320px, CSS zoom, reduced motion |
| Recipe discovery browser suite | Pass; BE-08 search/sort/scopes, debounce, cursors, error/retry/end states and return focus |
| Auth UI browser suite | Pass; login/signup, PKCE/callback states, recovery, protected return, session restoration, responsive keyboard behavior |
| Mori dialogue browser suite | Pass; dialogue choices, keyboard/focus, cleanup, no obstruction, reduced motion and CSS zoom |
| Existing visual fidelity browser suite | Pass; rendered geometry, local resources, paper control containment and reachability |
| Focused physical journal/geometry suite | Pass; all six requested viewport sizes, equal leaves, centered spine, cover-and-tab union bounds, exposed-tab hit tests, active stacking, all four workflows, drafts on resize, history, return/search state, cursor pagination, demo loading/error/retry, public/fallback/auth route coverage |
| Native Chrome 200% browser suite | Pass; real zoom, five compositions, validation focus in viewport, added-field focus, modal keyboard trap, demo return, measured geometry |
| `git diff --check` | Pass |
| Local Supabase Playwright runner | Could not launch: Windows subprocess returns `spawn pnpm ENOENT` for stack start and cleanup; no backend test executed and no stack launched |

The gallery contains 81 actual rendered captures; every referenced image exists.
All six viewport compositions and the corrected native-zoom captures were
visually inspected. Geometry is asserted on each captured journal route.

One parallel full-unit run also timed out waiting for deletion feedback. That
test passed in the initial parallel run, the final complete single-worker run,
and the browser deletion suites. No reproducible new UI regression remains.

The known `AuthFlow.test.tsx:167` failure is separate: its restored-session spy
expects two `getSession` calls and observes four. Previous UI-01 baseline review
reproduced it on `origin/main`; this change does not alter authentication or the
test expectation. The production build also retains its existing bundle-size
advisory. Browser suites use production components/routes, synthetic local auth,
and intercepted fixture responses; they do not claim live Supabase acceptance.

## Reference differences and remaining decisions

The local `../figma-make-reference` source and its original screenshots were
reviewed alongside the supplied Make URL. Figma returned the Make source links;
its screenshot/session tools do not support Make files, so the supplied local
reference screenshots were used for visual review.

The real application retains MORI'S MIX branding, its actual route set, REST
data, and existing Mori recipe artwork. It does not reproduce Make's cover
opening, 3D page-turn choreography, or snapshot transition system. Readable
scrolling leaves replace animated page snapshots for long recipes/forms. These
are deliberate presentation adaptations, not unfinished functional decisions.
There are no unresolved decisions blocking this correction. No commit, push,
rebase, merge, or pull request has been performed.
