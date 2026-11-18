# PR #233 — Synchronized notebook page turns

Baseline: `7f08bde`, inspected in the existing `feat/MORI-01-companion` worktree. No original screen recording was available. Unrelated edits in the primary checkout were preserved.

## Confirmed causes

- `MoriCompanion` inferred flips from DOM mutations and started a separate 720 ms run; `page-turn.css` rotated paper over 580 ms. Positions followed notebook percentages rather than the sheet.
- The old `turn` mood reused cheer arms. It supplied neither a closing mitt nor a defined contact anchor.
- Footers and holes were outside captured paper. Single-page captures omitted the visible spread's scroll viewport.
- Destination capture had no cursor-data or measured-reading readiness acknowledgement. Completion removed the overlay while committing the route.
- Snapshot installation replaced face children, deleting the nested shading node. Tests asserted a running sprite and completion events rather than intermediate physical contact.

## Ownership and changed components

| Area | Components / modules | Responsibility |
| --- | --- | --- |
| Lifecycle | `JournalPageTurn`, `pageTurnMotion` | Snapshot preparation, one cancellable frame controller, settlement and cancellation |
| Companion | `MoriCompanion`, `Mori`, companion CSS | Explicit registration, articulated arm, open/closed mitt, projected attachment |
| Paper | `JournalShell`, shell/turn/reading composition CSS | Stable paper surfaces, binding geometry and fixed reading footer |
| Pagination | `JournalPagination`, layout contexts, reading/writing turns, collection pages | Separate paper slots, shared baseline and reserved targets |
| Callers | dashboard, recipe reading, measured reading pagination | Critical-data readiness, route acknowledgement and focus restoration |
| Verification | controller/reading/screen tests, browser geometry/reading/form/companion journeys | Lifecycle, contact, snapshots, routes, responsiveness and handoff |

The existing `requestPageTurn(direction, prepare, commit, expectedSearch?, cancel?)` contract remains. Writing still uses its existing event bridge because the live form owns its shell. A small external turn subscription allows that persistent form to defer focus until the shell is interactive. Route/provider topology did not change.

## Single 900 ms timeline

| Normalized progress | Stage |
| --- | --- |
| 0–.18 | Approach the upper outer corner |
| .18–.26 | Reach and close the mitt |
| .26–.38 | Pull; paper begins moving |
| .38–.82 | Turn through the binding |
| .82–.90 | Open the mitt and release |
| .90–1 | Settle and return toward the saved dock |

`turnFrame` is the authoritative progress calculation. The frame controller writes sheet rotation, arm rotation, mitt opacity, character transform, highlights and shadows through cached refs. Playback reads no layout and publishes no per-frame React state. The remaining companion observer handles modal visibility only.

The SVG shoulder is `(128,168)`; the mitt contact is `(148,190)` before arm rotation. Setup reads sprite offsets and scale once, cancels hover/idle transforms, and chooses mirroring and single-page scale before attachment. The character origin is the projected corner minus the transformed mitt offset; it is never independently clamped while gripping.

The shared perspective is 1800 CSS px. Its vertical origin is the top paper edge, keeping the contact reachable. Desktop Next rotates the right leaf −180°; Previous rotates the left leaf +180°. Joined backfaces make reverse content readable. The single-paper stationary destination is also a frozen snapshot, so late assets cannot change it behind the leaf. Single-page turns fold to ±90°, exchange prepared surfaces edge-on at progress .54, then unfold into the same pane. Both surfaces use the same corner anchor through that exchange.

Mori's original body, face, hat, apron, palette and decorative artwork remain. The new reach/open/closed-mitt artwork is SVG, not a running pose.

## Readiness, snapshots and settlement

Lifecycle: preparing → ready → animating → committing → complete, or cancellation before commitment. Concurrent requests are rejected throughout.

Outgoing surfaces are captured before preview preparation and installed before paint. Collection readiness waits for the required cursor results; failures cancel the preview and expose existing retry controls. Measured reading invalidates readiness while recalculating. The final overlay stays mounted until the expected path/search and content readiness agree, including readiness changes after the route commit. Cleanup disconnects readiness observation and cancels frame callbacks. Resize or reduced motion settles the accepted destination; reduced motion skips choreography.

Only inert visual DOM copies are added. Live form/provider owners persist. Copies preserve field values, selected options, canvas pixels where supported, nested scroll offsets and the full single-paper viewport. IDs/references are rewritten; snapshots are hidden from accessibility, unfocusable, disabled and without link/form actions. Content containers are separate from paper shading.

Noncritical images do not block navigation: their measured boxes remain reserved and unfinished images stay hidden in snapshots. Font preparation has a bounded wait in the turn controller. Snapshot-rendering failure after critical readiness uses immediate navigation instead of leaving a stuck animation.

Reading and writing focus restoration waits for settlement. Extremely short reading layouts use the existing complete-recipe scrolling fallback alongside the identity leaf rather than showing unavailable directions. Short-landscape toolbar rows are compacted, and the obsolete bottom reserve is removed so pagination clears the visible sprite. Empty companion wrapper space no longer intercepts clicks.

## Footer and binding

Each paper owns its footer and punched holes. Pagination uses a 52 px band with 44 px controls, 28 px desktop horizontal/bottom insets, a subtle separator, and matching number typography. Previous occupies the outer-left slot; Next occupies the outer-right slot; page information faces the spine. Missing actions leave the slot intact. Snapshot footer visibility follows the same progress value as the leaf, transferring ownership across the spine instead of showing duplicate actions on overlapping layers. Single-paper controls occupy one row. Save/exit/loading/retry controls remain above the band; Search & index stays in collection navigation and End of results stays with results status.

One spine geometry defines page edges, hinge, hole inset, gold loop endpoints and all six vertical positions. Rear arcs are behind the paper at depth 20; front gold segments are above the moving leaf at depth 50. The animated layer occupies depth 40. Gold stays fixed while cloned apertures travel with the leaf. Single-page holes use the paper viewport rather than scrolling with body content.

## Verification

- `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=2`: **645 tests passed across 44 files**. Node 26's experimental storage global must be disabled for the repository's browser-storage mocks.
- `pnpm lint`, `pnpm build`, and `git diff --check`: passed.
- `node e2e/mori-dialogue.browser.mjs`: Chromium companion/AI Chef persistence and turn matrix; both directions in collection, reading and writing; 1440/768/375/320 px and 720×450; delayed cursor preparation, failure/retry, rapid input, keyboard/focus, reduced motion, resize, public demonstration, real-speed recordings and 4× CPU throttling.
- `MORI_BROWSER=webkit MORI_EXTENDED_ONLY=1 node e2e/mori-dialogue.browser.mjs`: WebKit collection/reading and short-landscape matrix, both directions, contact/binding/handoff, interruption, retries, public demo and real-speed writing. The full companion/AI Chef matrix and CPU throttle run are Chromium coverage.
- `node e2e/recipe-forms.browser.mjs`: passed creation/editing, validation focus, draft persistence, 18 ingredients/14 steps, cross-spread reordering, saves/retries, delete recovery, keyboard boundaries, 1440/1280/1024/390/320 px, short windows and 200% reflow.
- `node e2e/journal-shell.browser.mjs`: passed shell geometry, route aliases, detail/reload, history, dirty guards, focus, recovery, local materials, sign-out and public routes at 1440/768/375/320 px.
- `node e2e/recipe-journal.browser.mjs`: passed illustrated collection/detail, long reading content, history, action/dialog behavior, account isolation, initial-list/cached-refresh recovery and offline data navigation at 1440/768/375/320 px. The local Vite route module is warmed before the offline-data test; cold offline loading of uncached application code is not covered.

The browser harness pauses sampled turns at their first frame, then seeks deterministic normalized progress. It independently measures the SVG mitt through `getScreenCTM()` and the CSS-transformed corner through viewport geometry. It requires <=2 CSS px contact separation and <=1 CSS px spine/settled aperture drift. Final snapshot-to-live card/unit/footer positions must agree within 2 CSS px, and pagination must remain visible. Real-speed and throttled turns run with sampling disabled.

Measured maxima and sample totals are retained in the accompanying engine JSON files.

| Engine | Contact samples | Max hand/corner separation | Max spine drift | Max settled aperture error |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 899 | 0.008 px | 0.000 px | 0.029 px |
| WebKit | 667 | 1.111 px | 0.000 px | 0.442 px |

 Intermediate states and uninterrupted recordings were inspected for grip, front/reverse orientation, moving holes, ring occlusion, visible footers, shading and final continuity. The unit suite covers exactly-once commit/cancel, overlap, route interruption, unmount, delayed readiness, failed preparation, late settlement acknowledgement, reduced motion, resize, preserved form values/scroll and incomplete images.

During development, the old transition-event assertions, late-readiness settlement race, validation-focus timing and mobile footer clipping failed verification and were corrected. An overloaded parallel run hit an unrelated auth wait timeout; the clean full run above passed.

The first remote Chromium CRUD run also exposed an ambiguous writing-progress locator after splitting the footer. It now selects the exact right-side navigation and its canonical live counter, including review flows.

Two legacy browser assumptions were also updated: the shell has three section links and no Mori feature chooser; reading now scrolls inside its body while the footer stays fixed. A stale transparent-delete-button color assertion was removed; target, focus, confirmation and recovery assertions remain.

## Evidence

Seven inspected states include approach, grab, pull, edge-on, reverse/incoming face, release and settle. Recordings show uninterrupted 900 ms turns in both directions with a persistent draft.

- [Desktop Next frames](evidence/mori-page-turns/1440-forward.jpg)
- [Desktop Previous frames](evidence/mori-page-turns/1440-backward.jpg)
- [375 px Next frames](evidence/mori-page-turns/375-forward.jpg)
- [375 px Previous frames](evidence/mori-page-turns/375-backward.jpg)
- [Desktop recording](evidence/mori-page-turns/1440-real-speed.webm)
- [375 px recording](evidence/mori-page-turns/375-real-speed.webm)
- [Short landscape](evidence/mori-page-turns/720-landscape.jpg)
- [Chromium measurements](evidence/mori-page-turns/chromium-measurements.json) · [WebKit measurements](evidence/mori-page-turns/webkit-measurements.json)

## Limits and unavailable coverage

- Firefox could not launch in this environment. The original-reference comparison journey could not run because the required sibling `figma-make-reference` checkout is absent.
- All API/browser journeys use isolated fixtures and synthetic sessions. Hosted backend behavior and real low-powered hardware were not tested; 4× CPU throttling is a functional check, not an FPS benchmark.
- Paper is a rigid hinged sheet with illustrated thickness/shading, not a deforming curl or volumetric binding simulation. The 900 ms approach/return is brisk, especially from a manually placed distant dock. The new mitt poses were visually inspected here; no independent art-direction sign-off is claimed.
- Original-recording comparison and canvas-based recipe artwork were not visually tested (the current illustrations are SVG). Protected canvases retain their reserved box if copying fails. No additional external Mori asset is required by this implementation.
