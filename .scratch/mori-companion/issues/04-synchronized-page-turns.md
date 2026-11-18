# MORI-01 — Synchronize notebook paper and Mori's hand

Status: resolved
Type: task

Spec: ../spec.md
PR: https://github.com/2ton-exe/moris-mix-ai/pull/233

Replace the detached character run and CSS flip with one 900 ms controller. Preserve collection/reading/writing routes and live form ownership. Include target readiness, location acknowledgement, inert paper snapshots, an articulated gripping mitt, shared pagination slots, and spine-derived binding geometry.

## Acceptance

- One cancellable controller drives paper, hand, pose, lighting and release.
- Rendered hand/corner separation <= 2 CSS px while attached, both directions and layouts.
- Fixed spine and settled aperture alignment <= 1 CSS px.
- Destination data precedes motion; route commitment and cancellation are exactly once.
- Snapshots preserve forms, canvas, images and visible scroll positions without owning controls/providers.
- Stable footer band; collection navigation/status outside pagination.
- Repeated input, resize, reduced motion, keyboard, failure/retry and persistent forms work.
- Inspect intermediate captures and real-speed recordings; document coverage gaps.

## Comments

Baseline verified at clean PR head 7f08bde. Original referenced recording unavailable. Implementation and verification report: docs/qa/MORI-01-page-turns.md (added with delivery).

## Answer

Implemented the shared controller, projected SVG grip, readiness/settlement lifecycle, stable paper snapshots, footer slots and binding geometry. Unit/integration (645), lint/build and available Chromium/WebKit journeys passed. Intermediate frames and real-speed recordings were inspected. See the verification report for commands, evidence and explicit unavailable coverage.
