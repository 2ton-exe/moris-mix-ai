# UI-01 Phase E — Recipe forms and delete flow

Phase E adapts the existing create/edit recipe forms, unsaved-navigation
confirmation, and delete confirmation to the MORI'S MIX journal presentation.
The application stays on its existing React Router routes and keeps the form,
validation, API, mutation, and cache logic already used by FE-05/FE-06.

## Presentation

- Create and edit use the shared Phase B `JournalShell` and Phase A paper,
  stamp, and Mori components. The same editor frame wraps both routes.
- Form sections use parchment panels, labeled headings, sage ingredient and
  instruction rows, burgundy controls, and the existing Fraunces/Figtree/Caveat
  typography and design tokens.
- The Save/Cancel panel is part of the normal form flow at the end of the sheet.
  Long forms scroll with the journal page; the action panel does not overlay or
  cover fields.
- The existing single React Router blocker now opens a stationery-style
  alertdialog. Keep Editing, Discard Changes, Escape, focus trapping, and focus
  restoration retain the existing navigation confirmation semantics.
- Delete confirmation keeps the recipe name, destructive warning, pending
  state, retryable safe error, and cancel/delete actions in a torn-note style.

## Functional boundaries

The form fields, Zod rules, dynamic row ordering, recipe create/update requests,
delete request, success navigation, and TanStack Query invalidation/reconciliation
remain owned by the existing components and hooks. No API, Supabase, backend,
route, authentication, or cache infrastructure changed. Delete remains
server-confirmed before removing the recipe from the collection. No sample data
or image-upload behavior was added.

`frontend/e2e/recipe-forms.browser.mjs` serves an isolated browser harness with
synthetic account state and intercepts recipe requests at a local example origin.
It does not contact Supabase or make production writes.

## Verification

| Check | Result |
| --- | --- |
| Lint (`pnpm lint`) | Pass |
| TypeScript (`pnpm type-check`) | Pass |
| Focused recipe form/page/delete tests | 84 passed |
| Full frontend suite | 367 passed; 1 known baseline failure |
| Production build | Pass; Vite reports a 738 kB JS chunk-size advisory |
| Form/delete browser acceptance | Pass: validation, rows and order, pending/failure/retry/success, navigation guard focus, populated edit, long content, 320 px layout, 200% zoom, reduced motion, and delete cancellation/retry/204 |
| Journal shell browser acceptance | Pass at 1440, 768, 375, and 320 px |
| Dashboard/detail browser acceptance | Pass at desktop and narrow viewports, with long content, empty/offline/retry, history, and reduced motion |
| `git diff --check` | Pass; Git emitted only line-ending conversion notices for modified files |

The known failure remains `src/auth/AuthFlow.test.tsx:167`, which expects two
`getSession` calls but observes four during session restoration. It is the
independently reproduced `origin/main` baseline failure. No auth code or tests
were changed in Phase E.

## Figma fidelity and next phase

The form and dialogs carry forward the Figma reference's parchment, tape,
handwritten labels, Mori illustrations, layered stationery, and burgundy/sage
palette. The app uses its real route-driven forms and one long, scrollable
worksheet rather than the prototype's simulated recipe store or page engine, so
this is a close visual adaptation rather than a pixel-level copy.

### Recommended Phase F

Run a final cross-phase visual and accessibility review with real supported
browsers and assistive technology, then prioritize any remaining keyboard,
contrast, zoom, or responsive issues. Treat recipe photo support as a separate
product/API decision before adding upload UI; the current backend contract does
not supply an upload flow.
