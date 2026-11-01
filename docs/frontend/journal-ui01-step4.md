# MORI'S MIX UI-01 — Step 4: Physical page turns

Completed November 1, 2026 on `feat/UI-01-journal-redesign`. The pre-existing
Steps 1–3B working tree was preserved. No branch, commit, push, rebase, merge,
staging, or PR operation was performed.

## Reference behavior verified

The local Make source was verified at `../figma-make-reference`. I inspected
`src/journal/book.tsx`, `src/journal/snapshot.ts`, `src/state/journalUi.tsx`,
`src/styles/book.css`, `src/styles/motion.css`, and `src/styles/tokens.css`.
`BookProvider` derives turn direction from page position and coordinates old
and committed-page snapshots. The spread turn is 820ms; the single-page turn is
620ms. Both use `cubic-bezier(.45, .05, .22, 1)`. Forward turns rotate the old
right leaf to `-180deg`; backward turns rotate the old left leaf to `180deg`,
around the binding-side edge. Both use separate front/back faces, reveal and
landing shadow casts, changing face lighting, and the new page on the reverse
face. Single-page mode uses the reference's `-160deg`/fade choreography and
does not create a small two-page spread. Its breakpoint is below 1100px or below
640px tall. The source clears its transition after the animation duration plus
a short completion buffer. Its reduced-motion provider requests 240ms for a
turn; motion CSS collapses leaf animations to 1ms while retaining a 220ms ghost
fade. MORI'S MIX commits immediately and does not mount the 3D leaf.

The existing cover has a separate choreography involving the leather cover,
page block, strap, boards, and rings. It is outside this pagination change and
is proposed as a separate follow-up.

## Implementation

The reusable transition manager and inert snapshot layer are in
`frontend/src/journal/JournalPageTurn.tsx`; its styles are in
`frontend/src/journal/page-turn.css`, imported by `frontend/src/main.tsx`.
`JournalShell` owns the manager and places the layer above the live leaves and
below the binding hardware. The rings sit at z-index 25, the turn layer at 20,
live paper at 10, and bookmarks at 9, preserving the Step 1 occlusion order.
The leaf uses the existing source-sized page variables, centered-binding
perspective, direction-specific transform origin, two faces, paper edge, and
directional shading. The forward and reverse midpoint renders at 1440×900 have
the same computed rotation matrix, origin, easing, and 410ms animation time as
the original Make render.

Collection pagination animates only valid in-route page changes. Recipe reading
continuation and form continuation pages use the same layer and correct
direction. The form uses an event bridge to request a turn from its existing
editor; the form/provider tree does not move into the journal shell. Route-level
bookmark changes keep their existing guards and are not animated. A blocked
navigation shows the guard without a turn, and route-level animation remains a
separate architectural follow-up.

Snapshots are presentation-only copies. They carry current form values and
scroll positions, have duplicate IDs and references neutralized, lose event
attributes and test hooks, and make controls disabled and unfocusable. The whole
layer is `aria-hidden`, inert, and pointer-transparent; it is removed on
`animationend`, timeout fallback, route interruption, layout change, reduced
motion, or unmount. It never owns draft or query state. One controlled form,
stable ingredient/step identities, validation state, pending saves, query cache,
and cursor/search state remain with the live application. Navigation controls
lock during a turn. Existing page indicators and heading/focus recovery remain
authoritative.

With `prefers-reduced-motion: reduce`, the manager commits the page immediately
and does not mount the 3D layer. The 1024px layout uses the single-page turn;
390px and 320px remain readable and keyboard navigable. Keyboard initiated
reading turns and form validation focus restoration are covered by browser
acceptance.

## Visual evidence

`frontend/test-results/ui01-step4/comparison.html` is the paired original/current
Chromium gallery at 1440×900. It includes before, 410ms forward midpoint,
completed forward, 410ms backward midpoint, and completed backward frames.
`frontend/test-results/ui01-step4/single-page-comparison.html` pairs the
original and current 480ms frames at 390×900. Another capture shows the 1440px
reduced-motion result. `frontend/test-results/ui01-step4/mori-forward-backward.webm`
records the local current-app interaction. `measurements.json` records both
animations' transforms, origins, durations, easing, face counts, and snapshot
counts. All API requests in this browser script are intercepted; its one POST
is an in-memory test stub, with no production Supabase write.

The motion and binding alignment match the source closely. Remaining visual
differences are the intended MORI'S MIX page composition, cards, hardware and
toolbar, rather than the reference's recipe-card content and prototype chrome.
At 390px the existing app toolbar reserves more vertical room: its page is
328×694px versus the source's 328×756px, while both use the single-page
breakpoint and the turn transform and binding-side origin match. The app keeps
the corrected Step 1 book geometry and bookmarks tucked beneath the paper.

## Validation

- `pnpm lint`: passed.
- `pnpm type-check`: passed.
- Full Vitest run: 408 passed, 1 known baseline failure out of 409. The unchanged
  `src/auth/AuthFlow.test.tsx:167` expects two `auth.getSession` calls but sees
  four; this is tracked in `journal-ui01-auth-baseline.md`.
- `pnpm build`: passed; Vite retains its existing advisory for the 795KB JS
  bundle.
- Browser acceptance passed: auth UI, journal shell, recipe journal, recipe
  forms, discovery, Mori dialogue, expanded journal, native zoom, visual
  fidelity, Step 1 after, Step 2 after, Step 3A, and this Step 4 suite.
- `git diff --check`: passed.

Focused Step 4 coverage verifies forward/backward direction and completion,
rapid-turn locking, first/last collection bounds, snapshot cleanup and safety,
one live form with draft/order preserved, single-page timing, route interruption
and blocked navigation, reduced motion, focus recovery, save from a continuation
page, and no reading refetch during turns. The existing form and reading suites
cover validation focus, dynamic row ordering, save/retry, cursor boundaries,
responsive layout, and 200% zoom.

**Cover choreography remains a separate follow-up.**
