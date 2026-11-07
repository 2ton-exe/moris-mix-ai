# Mori dialogue UI foundation (UI-01 Phase G)

Phase G adds an optional, inline dialogue note to the authenticated recipe index. It reuses the Phase A `Mori` illustration, `PaperCard`, `Stamp`, existing type and color tokens, and the Phase B journal shell. The note is deliberately not mounted on create/edit forms, recipe detail, or modal dialogs.

## Presentation interface

`frontend/src/journal/MoriDialogue.tsx` exports the reusable `MoriDialogue` surface and `MoriDialogueLauncher`, plus these presentation types:

- `MoriDialogueLine`: stable line `id`, `speaker`, `text`, optional `MoriMood` expression, and optional choices.
- `MoriDialogueChoice`: stable choice `id`, visible `label`, and optional `nextLineId` referencing another supplied line.
- `MoriDialogueStatus`: `ready`, `pending`, `error`, or `complete`.
- `MoriDialogueProps`: supplied lines/copy, optional pending/error/retry/complete callbacks, typewriter preference, and a required close callback.

The component owns only ephemeral presentation state: current line, typewriter reveal progress, completion, and closing animation. Callers provide every line and action. The launcher's `start-recipe` choice navigates to the existing `/app/recipes/new` route; all other navigation or mutations must remain caller-owned. There is no dialogue persistence, global provider, generated response, or network request.

The dashboard's predetermined guidance covers an empty collection, no search matches, and a loaded collection. It is shown only after collection data is available and starts closed. It makes no claim to know recipe contents beyond the existing screen state.

## Interaction and accessibility

- Opening moves focus to Mori's speaker heading. Closing restores focus to the launcher.
- Escape closes the note. It is a labelled `region`, not a modal dialog; keyboard focus remains free to move through the page.
- The full text is exposed once through a polite status region while visual text animates. “Show full message” reveals the rest immediately; choices are available during typing.
- Reduced-motion preference disables the typewriter and CSS transitions/animations.
- Long lines wrap, action rows wrap, and the portrait moves above the text at very narrow widths.
- A route change unmounts the inline note and clears its timers.

## Future service coordination

FE-08 through FE-11 may use this UI as a presentation surface after their owning teams agree on the service contract. Coordinate those requirements with backend/full-stack owners before implementation. Decisions still needed include authenticated request/response shape, provenance and confidence metadata, pending/error/retry semantics, limits and cancellation, data retention/privacy, and whether a user must review and confirm extracted or generated recipe data before any save request. UI-01 does not define that contract and does not send AI requests or write recipes.

## Validation record

The component unit tests cover opening, dismissal, focus restoration, choices, completion, typewriter skip, reduced motion, long copy, route unmount, and the absence of network writes. `frontend/e2e/mori-dialogue.browser.mjs` uses a synthetic local session and intercepted read-only GET requests to exercise keyboard behavior, responsive widths, empty guidance, reduced motion, 200% zoom, and route changes without contacting production Supabase.

Screen-reader output was reviewed through DOM semantics and status-region behavior; no manual screen-reader session was performed.
