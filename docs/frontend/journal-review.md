# UI-01 Phase F — Discovery and cross-phase accessibility review

The visual conclusions below are superseded by the
[screenshot-based correction report](journal-visual-corrections.md), which records
the layout and discovery styling defects missed in this earlier review.

Phase F reviewed Phases A–E and confirmed that the authenticated discovery
screen already received the journal presentation in Phase D. Its UI, query hook,
adapter, API contract, and route were left intact. This phase extends isolated
browser coverage and adds a lightweight semantic audit to the existing browser
suites.

## Discovery integration review

Reviewed `RecipeDashboardPage`, `DiscoveryControls`, `useDiscoveryControls`,
`useRecipeDiscovery`, `apiSource`, discovery query keys, recipe cards/states,
and `recipe-journal.css` against the local Make source at
`../figma-make-reference/src/features/discovery.tsx` and associated screen,
paper, and decoration styles.

The controls already use a textured sage paper panel, labeled search and sort
fields, the journal's burgundy focus color, and an explanatory disabled filter
control. Search modes and rating sort are enabled from the BE-08 adapter's
advertised capabilities. Result cards, loading skeletons, safe errors/retries,
pagination, and the end state share the scrapbook page style. No duplicated
controls or second discovery query path were added.

The Figma reference gates search and sort because its prototype has no live
search service. MORI'S MIX keeps its completed backend-supported controls active;
the reference's paper framing and restrained decoration carry over without
reintroducing the prototype's mock services or sample data.

## Preserved behavior

- Title, ingredient, and combined search map through the existing BE-08 adapter
  to its established `title` and `ingredient` parameters.
- Newest and rating ordering remain server-side. Search remains debounced by
  300 ms, and each query starts from its first page.
- Cursor pagination continues to use the server continuation and Load More.
  Query cancellation, retries, account-scoped keys, and stale-response
  protection remain in the existing TanStack Query implementation.
- Unsupported standalone filters remain disabled with an explanation. No local
  filtering/sorting, offset fallback, endpoint, adapter, or business logic was
  introduced or changed.

## Cross-phase consistency and accessibility

Desktop screenshots of login, dashboard, detail, create form, and delete note
were reviewed together. They consistently use the MORI'S MIX identity, wood and
leather shell, parchment textures, bookmark colors, paper controls, established
typefaces, and burgundy focus treatment. The dashboard search panel is already
styled as a restrained sage stationery card. No confirmed visual inconsistency
required product CSS changes.

`frontend/e2e/journal-accessibility-audit.mjs` adds a small Playwright DOM check
for accessible names on visible controls, one page-level H1 and non-skipping
heading levels, described errors on invalid fields, and names/modal semantics on
dialogs. Existing browser suites also exercise visible keyboard focus, password
visibility, dirty-form and delete dialog traps/restoration, result retry focus,
pagination focus recovery, direct routes/history, narrow layouts, long content,
and reduced motion. The checks do not replace a full WCAG audit or axe scan.

No screen-reader or other assistive-technology session was performed. Visual
contrast and reading order were reviewed in the browser, but a dedicated
color-contrast analyzer was not run. Browser coverage includes 320 px and 200%
zoom on the relevant auth, journal, detail, and form routes.

## Performance

The sequential production build passes and emits a 738.49 kB JavaScript chunk
(213.20 kB gzip), above Vite's 500 kB advisory. A read-only Rollup module report
shows the bundle is dominated by existing React DOM, Supabase JS and its auth,
PostgREST, storage, and realtime modules, React Router, Zod, and TanStack Query.
The application-specific largest modules are the existing recipe form and Mori
illustration code. The shipped 20/67/75 kB local fonts and 115/226 kB desk/leather
textures are the intentional Phase A materials.

Phase F added no runtime dependency, font, texture, or other production asset;
`package.json` and the lockfile remain unchanged. No safe small change would
materially address the warning, so application architecture and auth/session
composition were left alone. The bundle advisory remains a follow-up rather
than being suppressed.

## Verification

| Check | Result |
| --- | --- |
| Lint | Pass |
| TypeScript type-check | Pass |
| Full frontend suite | 367 passed; one known `AuthFlow.test.tsx:167` baseline failure |
| Production build | Pass; 738.49 kB raw / 213.20 kB gzip JS chunk advisory |
| Discovery browser acceptance | Pass at 1280, 375, and 320 px: title/ingredient/combined mapping, sort, debounced input, pending, empty, error/retry, cursor pagination, focus recovery, and no overflow |
| Auth browser acceptance | Pass: login/signup/verification, session restore, logout, validation, focus, reduced motion, and 200% zoom |
| Journal shell browser acceptance | Pass at 1440, 768, 375, and 320 px: route aliases, Back/Forward, direct editors, focus, dirty blocker, public routes, and logout |
| Dashboard/detail browser acceptance | Pass at 1440, 768, 390, and 320 px, including empty/offline/retry, long content, direct links, focus/history, and 200% zoom |
| Recipe form/delete browser acceptance | Pass: create/edit validation and mutations, dirty blocker, dialogs, retries, 320 px, 200% zoom, and reduced motion |
| `git diff --check` | Pass |

Every browser harness uses synthetic auth and intercepted example-origin recipe
requests. They do not contact production Supabase or create real recipes.

The sole full-suite failure is the previously confirmed
`AuthFlow.test.tsx:167` session-restoration expectation (expects two
`getSession` calls, receives four), independently reproduced on `origin/main`.
No auth tests or behavior were changed. One shell-browser run transiently failed
its bookmark focus assertion at the narrowest size; the standalone rerun passed
all four sizes. No product defect or repeatable test failure was found.

## Files changed in Phase F

- `frontend/e2e/recipe-discovery.browser.mjs`: adds BE-08 UI mapping, debounce,
  search mode, sort, pending/empty/error, retry-focus, and result assertions.
- `frontend/e2e/journal-accessibility-audit.mjs`: lightweight semantic browser
  check reused by existing auth, shell, recipe, form, and discovery suites.
- Existing auth, shell, recipe, and form browser scripts: call the semantic
  check on their relevant screens and dialogs; the shell focus failure now
  includes viewport/control diagnostics.
- `frontend/README.md`: links this review and discovery acceptance command.

Phases A–E source changes remain in the shared uncommitted worktree.

## Recommended Phase G — Mori dialogue

First define an opt-in, accessible Mori companion surface and decide what
real, authorized recipe context it may receive. Specify a supported response
service contract before connecting any AI provider. Keep recipe editing,
navigation, and search fully usable without the companion; provide keyboard
access, announced responses, reduced-motion behavior, and clear controls to
open, close, and dismiss the conversation. Do not ship a simulated response
path as a substitute for a real service.
