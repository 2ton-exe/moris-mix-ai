# Mori companion

Mori is an optional companion shared by signed-in recipe and AI pages. It replaces
the dashboard's inline note and the older floating feature chooser. Decorative
rat chef SVG illustrations and the branding emblem remain independent.

## Real activity

Workflow owners supply activity and guidance to a shared presentation context.
Browsing is idle, photo preparation/upload is curious, extraction is working,
and Chef generation is thinking. A confirmed recipe save briefly celebrates.
Actionable errors and required input take precedence; clearing or unmounting the
owning workflow clears its activity. Requests and their results never wait for
animation. Mori does not issue requests, retry, save, or edit automatically.

The current integration checkout already contains extraction and Chef screens;
the older checkout inspected during the initial interview did not. Those existing
workflows are connected without adding AI features or changing API contracts.

## Interaction

**Talk to Mori** opens a nonmodal contextual panel with guidance, available
workflow actions, and links to Quick AI Entry and AI Chef. The panel provides
movement buttons, reset, and hide. A dedicated drag handle supports pointer
capture and arrow keys; movement remains within the viewport. Phones use a
smaller character docked at an edge. **Show Mori** restores the hidden companion.
Position and visibility are stored on this device; unavailable or malformed
storage falls back to defaults without blocking recipe work.

Automatic activity changes do not open the panel or move focus. Opening focuses
the panel heading, Escape/close restores focus, and focus is not trapped. Existing
workflow loading, error, validation, and confirmation messages remain authoritative.
Movement feedback uses a polite status region; decorative animation is not
announced. Reduced motion disables character motion. No sound, roaming, generated
conversation, or companion operation history is introduced.

The companion remains outside public/authentication pages and yields to modal
dialogs. Its provider is keyed to the authenticated user, so transient activity
cannot survive an account change. Route-specific activity and guidance are scoped
to their owners while position and visibility survive recipe navigation.

## Verification

The application browser seam uses synthetic sessions and intercepted API responses.
The existing Mori browser journey covers keyboard operation, pointer positioning,
hide/show persistence, viewport reachability, route scope, narrow layouts, and
reduced motion without production services. Component integration tests cover
activity ownership/precedence and actual workflow status transitions. Existing
shell and Chef browser journeys retain feature navigation and focus checks.

Run from the frontend directory with the repository's Node 24 runtime:

```sh
pnpm test
pnpm lint
pnpm build
node e2e/mori-dialogue.browser.mjs
node e2e/journal-shell.browser.mjs
node e2e/ai-chef.browser.mjs
```

The browser script keeps its existing filename so external acceptance commands
continue to work. Screenshots are written to the temporary directory printed by
the script. Automated semantic checks do not substitute for a manual screen-reader
session or physical-device testing.
