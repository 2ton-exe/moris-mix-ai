# Mori companion

Mori is an optional companion shared by signed-in recipe and AI pages. It replaces
the dashboard's inline note and the older floating feature chooser. The
bookplate keeps its static emblem. Modal confirmations may show Mori while the
companion is suspended.

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

**Talk to Mori** opens a nonmodal speech bubble with a short page label, safe
page-specific guidance, and an action only when that action belongs to the
current workflow. Recipe identifiers, recipe content, and account details are
not copied into the companion message. The bubble stays beside Mori with a tail
pointing toward him, and flips above or below only when the viewport leaves too
little room at either side. While it is open, Mori uses an open-mouth speaking
pose with a small motion. Reduced motion keeps the pose still. Drag Mori's
character to reposition him; when focused, use the arrow keys. Position is
stored on this device; unavailable or malformed storage falls back to defaults
without blocking recipe work.

Automatic activity changes do not open the bubble or move focus. Opening focuses
the bubble heading, Escape/close restores focus, and focus is not trapped. Existing
workflow loading, error, validation, and confirmation messages remain authoritative.
Movement feedback uses a polite status region; decorative animation is not
announced. A drag does not also activate the Talk button. No sound, roaming,
generated conversation, or companion operation history is introduced.

Desktop pagination has one transaction for the paper and Mori’s motion.
Next and Previous walk to opposite outer paper edges. Mori approaches, aligns,
grips, pulls, releases as the sheet settles, and walks back to rest. The rendered
paper bounds and the gap between ring groups determine the path. The sheet’s
projected edge anchor drives the mitt while Mori’s feet stay planted. Six approved
walking frames per direction advance by distance on a shared ground baseline.
Page snapshots keep their existing handoff to live content. Reduced motion
commits without the character or paper animation. Compact layouts retain their
existing turn motion.

See the [directional atlas and artwork inventory](../../frontend/src/assets/journal/README.md#moris-directional-atlas).

The companion remains outside public/authentication pages and yields to modal
dialogs. Its provider is keyed to the authenticated user, so transient activity
cannot survive an account change. Route-specific activity and guidance are scoped
to their owners while Mori's position survives recipe navigation.

## Verification

The application browser seam uses synthetic sessions and intercepted API responses.
The existing Mori browser journey covers keyboard operation, character dragging,
position persistence, bubble reachability, route scope, narrow layouts, and
reduced motion without production services. Desktop turn samples check facing
against foot travel, ring clearance, stationary paper before contact, the mitt
against the moving edge, and snapshot handoff. Component integration tests cover
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
