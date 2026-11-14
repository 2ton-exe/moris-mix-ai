# MORI'S MIX UI-01 — Step 3B: Physical form pagination

November 1, 2026. Step 3B adds physical continuation pages to the production
create and edit recipe forms on `feat/UI-01-journal-redesign`. The journal shell,
leather cover, binding, page geometry and bookmark occlusion remain shared with
Steps 1–3A.

## Form pagination architecture

The form uses a section-aware leaf model in `frontend/src/recipe-form/physicalFormPages.ts`:

- Recipe identity, date, rating and personal notes stay together on the first
  leaf.
- Desktop leaves group two complete ingredient rows or two complete cooking
  steps. This keeps common recipes to a small number of continuation pages.
- Single-page layouts give every dynamic row its own leaf. At those widths the
  form does not stack an unbounded number of controls inside one paper page.
- Stable draft row keys anchor navigation, field errors, reordering and resize
  recalculation. The section group is recomputed from the current ordered draft.

This reuses the Step 3A book shell, `JournalFacingPage`, the page footer portal,
the compact reading-turn language, geometry checks and reduced-motion styles.
It deliberately does not reuse the read-only measurement pagination hook or move
live controls between measured DOM containers. Form data is interactive and
controlled, so pagination is based on stable section groups and the physical
form leaf has a bounded scrolling fallback when a long control or narrow height
needs it.

## Draft, validation and submission

`RecipeFormEditor` owns one controlled `RecipeEditorState`, one native form,
one dirty baseline and one submit handler. Only the currently visible page
fieldsets mount; page turns leave the form and draft mounted. Switching between
spread and single-leaf layouts resolves the active stable row key in the new
page model. Dynamic insertion, removal and reordering update the same draft;
focus is restored to the row or control where possible. Inputs are controlled,
so a page transition cannot erase values held by the browser DOM.

The existing Zod validation and API submission path remain authoritative. Each
validation path maps to the stable ingredient or instruction row, then to its
current page. Invalid submission opens that page and focuses the field. The
footer lists other pages with errors and lets the user visit them. Focusing a
field scrolls its bounded writing leaf into view. Server field violations use
the same path mapping; validation rules were not changed.

One footer Save submits every row and identity field, regardless of the current
page. Existing authenticated POST/PATCH hooks, pending state, duplicate-submit
guard, safe error message, retry draft, cache invalidation, success state and
Cancel action remain in place. Page turns update local presentation state only;
they do not save or call recipe APIs. The pathname-based unsaved-changes guard
therefore stays quiet during page turns and still protects real route exits and
browser navigation.

## Responsive behavior and accessibility

At desktop widths the journal presents coordinated facing pages. At
1024×900, 390×900 and 320×900 it presents one readable writing leaf at a time.
The footer keeps page number, Previous/Next, Save and Back to journal available
outside the leaf scroll region. Long titles wrap across up to three textarea
rows; long notes and method text retain their complete controlled values.

The page controls retain the Step 3A keyboard labels and reading-position
announcements. They expose visible focus styling, move focus to the new section
heading after turns, and honor reduced-motion preferences. Validation can
navigate to errors on inactive leaves. Page and form IDs are unique in the
visible DOM, with a single form and a single Save control.

## Implementation and tests

Main changes:

- Added `RecipeFormEditor.tsx`, `RecipeWritingTurns.tsx` and the section-aware
  `physicalFormPages.ts` model.
- Updated `RecipeForm.tsx`, `RecipeEditorFrame.tsx` and `journal/folio.css` for
  stable form state, layout changes, mobile focus and bounded paper leaves.
- Expanded `RecipeForm.test.tsx` and added `physicalFormPages.test.ts` for
  grouping, state retention, cross-page errors, row operations and submissions.
- Extended the isolated `recipe-forms.browser.mjs` and native
  `journal-zoom.browser.mjs` scenarios. Updated the Step 1, Step 2 and expanded
  journal browser audits to account for the single-leaf form and its bounded
  internal leaf scrollport.

Browser requests use synthetic auth sessions and intercepted recipe APIs. The
tests cover blank create, populated edit, long identity and notes, 18 ingredient
rows, 14 instructions, add/remove/reorder, reordering across spread boundaries,
invalid quantities on inactive pages, page focus, failure/retry, Save from the
first, middle and last pages, route-guard return, widths 1440/1280/1024/390/320,
200% native zoom, reduced motion and no input loss. No production Supabase writes
were made.

| Validation | Result |
| --- | --- |
| `pnpm lint` | Pass, no warnings |
| `pnpm type-check` | Pass |
| Full frontend Vitest | 405 passed; one existing auth spy-count failure out of 406 |
| `pnpm build` | Pass; Vite retains the existing >500 kB chunk advisory |
| Step 3B form browser suite | Pass: create/edit, validation, dynamic rows, retries, route guard, responsive widths and all-row saves |
| Other relevant browser suites | Pass: auth, shell, Steps 1/2/3A, expanded journal, visual fidelity, recipe journal, BE-08 discovery, Mori dialogue and native 200% zoom |
| `git diff --check` | Pass |

The existing failure is `src/auth/AuthFlow.test.tsx:167`: the test expects two
`auth.getSession` calls and observes four. It is the same independently
reproduced `origin/main` baseline recorded in
[journal-ui01-auth-baseline.md](journal-ui01-auth-baseline.md). Step 3B does not
change authentication code. The full run is retained at
`frontend/test-results/ui01-step3b/frontend-tests.log`.

The isolated browser suites exercise the form through intercepted authenticated
POST/PATCH requests; no local Supabase CRUD stack was started for this step.
They do not claim live backend acceptance or manual screen-reader certification.

## Before-and-after screenshots

The baseline captures were taken before Step 3B. The final captures show the
paired desktop writing leaves and single-page narrow layout:

| View | Before | After |
| --- | --- | --- |
| Blank create, 1440×900 | `frontend/test-results/ui01-step3b/before/create-form-1440.png` | `frontend/test-results/ui01-step3b/after/create-form-1440.png` |
| Long edit, 1440×900 | `frontend/test-results/ui01-step3b/before/long-form-1440.png` | `frontend/test-results/ui01-step3b/after/long-form-1440.png` |
| Long edit, narrow single page | `frontend/test-results/ui01-step3b/before/long-form-320.png` | `frontend/test-results/ui01-step3b/after/long-form-320.png` |

The after folder also contains a populated first spread, 200% reflow, route
guard, delete and collection captures.

## Remaining limitations and Step 4 readiness

Desktop leaves group two rows by a stable rule rather than measuring individual
field heights. Unusually long values can therefore show a short explanation and
use the leaf's bounded scrollport. Narrow views switch to one row per leaf.
Very long individual notes or instructions remain in their complete textareas
and can scroll inside those controls.

Step 4 has not begun. The form separates page navigation from draft state and
already centralizes turn requests, so it is ready for a later page-turn motion
implementation. Step 4 should animate only the paper presentation while keeping
the same controlled draft, visible focus, history behavior and reduced-motion
path; it should not animate or recreate the entire form subtree.
