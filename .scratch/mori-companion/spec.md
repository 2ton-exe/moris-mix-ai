# Mori in-app companion

Status: ready-for-agent
Labels: ready-for-agent
Date: 2026-11-17

## Problem Statement

Mori currently appears as decorative SVG artwork and a dashboard-only, optional note launcher. The character does not accompany the user's recipe work or visibly respond to photo uploads, successful saves, or problems requiring attention. The user wants a lively, optional companion inspired by Codex Pet that belongs visually to Mori's Mix AI and responds honestly to actual application activity.

## Solution

Replace the current interactive note launcher and dialogue with one draggable Mori companion throughout signed-in recipe pages. Preserve Mori's rat chef design, palette, and SVG artwork while adding expressive poses, body movement, and smooth transitions. Clicking Mori opens a speech bubble attached to his position, with screen-specific guidance and explicit actions; an open-mouth pose and gentle mouth motion make the response feel spoken.

Mori stays where placed, starts near the bottom-right, and uses a smaller edge-docked presentation on phones. Users drag the character itself or use arrow keys to reposition him; position is remembered on the current device. Motion is quiet, silent, and compatible with reduced-motion preferences. Existing recipe controls, validation, and error messages remain usable independently of Mori.

This delivery follows the existing browsing, photo upload, recipe save, Quick AI Entry extraction, and AI Chef generation workflows. Mori reflects those real frontend operations and confirmed outcomes; it does not simulate activity or introduce separate AI workflows.

## User Stories

1. As a signed-in cook, I want Mori available across recipe browsing, detail, creation, and editing, so that the companion follows my recipe work.
2. As a cook, I want Mori to retain its existing rat chef appearance and journal colors, so that it feels part of Mori's Mix AI.
3. As a cook browsing saved recipes, I want a quiet idle animation, so that Mori feels alive without demanding attention.
4. As a cook preparing or uploading a recipe photo, I want Mori to appear curious while the real operation is pending, so that its behavior reflects my activity.
5. As a cook saving a recipe, I want Mori to celebrate only after persistence is confirmed, so that its feedback is trustworthy.
6. As a cook whose save fails, I want clear guidance and the existing recovery controls, so that celebration cannot conceal a failure.
7. As a cook encountering an upload problem, I want Mori to signal the problem and explain an available next step, so that I can recover.
8. As a cook with an invalid form submission or another required action, I want a quiet attention signal, so that I can discover what needs my input.
9. As a cook, I want resolved problems to stop controlling Mori's expression, so that old errors do not look current.
10. As a cook with overlapping activities, I want unresolved problems to take precedence, so that useful guidance is not hidden by idle or success feedback.
11. As a cook, I want a brief celebration to return to the current applicable activity, so that Mori does not remain permanently excited.
12. As a cook, I want to click Mori to read contextual guidance, so that explanations appear when I choose to engage.
13. As a cook with an empty collection or no search matches, I want relevant guidance preserved from the current note experience, so that the replacement remains useful.
14. As a cook, I want save, retry, and recipe-changing actions to require my explicit choice, so that Mori cannot change my work automatically.
15. As a cook, I want to drag Mori himself to a comfortable position, so that I can keep important recipe content clear.
16. As a cook, I want a completed drag to move Mori without opening his guidance, so that dragging feels predictable.
17. As a returning cook, I want my chosen position restored on this device, so that I do not need to rearrange Mori every visit.
18. As a cook resizing or rotating my screen, I want Mori and his speech bubble to remain reachable, so that a saved position cannot strand the controls.
19. As a cook on a phone, I want a smaller edge-docked companion, so that limited space remains useful for recipes.
20. As a keyboard user, I want to open, close, and move Mori without dragging, so that the companion remains accessible.
21. As a keyboard user, I want predictable focus and Escape dismissal, so that interacting with Mori does not trap me or interrupt editing.
22. As a screen-reader user, I want meaningful operation statuses announced without repeated animation narration, so that feedback stays useful.
23. As a user who prefers reduced motion, I want a still, expressive pose and immediately readable guidance, so that the feature does not require animation.
24. As a cook, I want short cooking-themed messages without sound or unsolicited roaming, so that Mori adds personality without interrupting work.
25. As a cook navigating away or signing out, I want obsolete activity and messages cleared, so that Mori cannot report work from a previous screen or session.
26. As a cook, I want all recipe functions to work when position storage is unavailable, so that Mori's preferences never block recipe work.
27. As a visitor, I want public and authentication pages to retain their existing presentation, so that the companion belongs to the signed-in workspace.

## Implementation Decisions

- Reuse the existing React, TypeScript, SVG character, journal primitives, typography, color tokens, and scoped CSS animation patterns. Preserve the rat chef's proportions and identity. This is original in-app artwork inspired by Codex Pet's companion behavior.
- Mount one companion at the shared signed-in recipe workspace boundary. Keep its position stable across recipe route changes; clear route-specific guidance, stale operations, and pending animation timers when their owners disappear. Clear transient session state on sign-out or account change.
- Replace the dashboard note launcher and dialogue with the companion's attached speech bubble. Preserve useful empty-collection, no-match, and collection guidance and relevant existing navigation actions. Avoid duplicate interactive companion surfaces. Decorative Mori illustrations and the separate branding emblem remain.
- Extend existing grouped SVG geometry and transform-based CSS animations for richer idle, curious, attention, confused, and celebrating behavior. Use still poses when reduced motion is enabled. Avoid an animation dependency unless an existing installed facility is necessary.
- Read activity from the owning frontend workflow's actual state and confirmed outcomes. The companion is presentation, not a second request, persistence, authentication, or validation owner. Do not infer progress from arbitrary timers or intercept all network traffic to guess activity.
- Prefer the smallest shared activity interface needed by the recipe workspace, recipe editor, and photo upload surface. Keep current operations associated with their owner so resolved, superseded, aborted, and unmounted operations cannot leave stale feedback.

| Application activity | Companion behavior | Delivery boundary |
| --- | --- | --- |
| Browsing saved recipes or no higher-priority state | Idle | Included |
| Preparing and uploading a recipe photo | Curious | Included where the existing photo feature is available |
| Recipe save pending | Quiet active feedback from actual save status | Included; exact pose is an implementation detail |
| Confirmed recipe save | Brief celebration | Included for create and edit |
| Actionable upload/save failure | Confused with safe contextual guidance | Included |
| Existing validation or other explicit user action required | Wave/request attention | Included |
| Quick AI Entry extraction pending | Working | Included; existing workflow |
| AI Chef generation pending | Thinking | Included; existing workflow |
| AI response fails validation | Confused | Included when surfaced by an existing workflow |

- Precedence is unresolved actionable problem or required input, then active work, then brief save celebration, then idle. Do not queue stale celebrations to play after a problem is resolved. Completion immediately reflects the applicable current state; never delay an operation or its result to finish an animation.
- Attention uses quiet animation and existing status/error copy. Do not auto-open the guidance bubble or move focus when activity changes. Resolve attention when the underlying problem resolves; distinguish cancellation from failure.
- Clicking Mori opens a labelled, nonmodal speech bubble with a tail pointing toward the character. Keep guidance short and predefined; no model calls generate companion messages. Use a speaking pose while the bubble is open and respect reduced motion. Provide only actions supported by the current screen. Retry, navigation, saving, and editing remain explicit user actions through existing workflow owners.
- Keep existing loading, validation, save confirmation, and error surfaces. Mori supplements them and remains optional. Underlying recipe and image error handling, cancellation, retry behavior, and confirmation requirements remain authoritative.
- Start near the bottom-right and clamp the companion and speech bubble into the usable viewport after drag, preference restoration, resize, orientation changes, and zoom/reflow. Phones use a smaller edge-docked presentation. Prevent clipping, horizontal page overflow, and inaccessible bubble actions. Respect existing modal focus and layering so Mori cannot interfere with required dialogs.
- Support pointer/touch dragging anywhere on Mori's character and a documented keyboard positioning interaction. Provide accessible names and open/close controls. Treat a completed drag as positioning rather than a click. Do not provide hide or reset-position controls.
- Persist only Mori's position on the current device using the existing browser platform. Ignore legacy visibility preferences and treat unavailable or malformed position values as a recoverable default; recipe workflows must still work. Store no recipe text, images, tokens, or operation history in companion preferences. Cross-device synchronization is not required.
- Preserve focus on task controls during automatic updates. Opening the bubble provides a sensible focus target, closing it restores focus appropriately, and Escape dismisses it. Do not trap keyboard focus. Announce meaningful state transitions without repeating animated copy or duplicating existing status announcements.
- Respect the current architectural boundary: authenticated recipe, image, and AI operations remain owned by existing APIs and server-side handlers. This change introduces no backend endpoint, database schema, Gemini call, quota mutation, or automatic recipe write.
- Update related documentation and existing tests that assume a dashboard-only note or an inline panel below the journal. That placement is intentionally superseded by the agreed floating companion design.

## Testing Decisions

- The user confirmed the primary seam: exercise the signed-in application through the existing browser harness, drive actual UI actions against controlled API responses, and verify visible companion behavior, keyboard controls, persistence, and responsive layout.
- Good tests assert what a user can observe: current activity, guidance, usable controls, focus, reachable placement, and request outcomes. Do not assert internal component structure, event names, exact SVG coordinates, CSS class names, or arbitrary animation frame timing.
- Adapt the existing Mori dialogue browser journey and recipe discovery tests for the replacement, retaining synthetic sessions, controlled responses, keyboard checks, responsive checks, and unexpected-network detection. The former inline placement assertion must be replaced with viewport reachability and usable page controls.
- Reuse recipe image integration and recipe form/save test patterns to hold requests pending, resolve them, reject them, and exercise existing recovery actions. Extend controlled browser routes for explicitly initiated writes; old dialogue tests' GET-only assumption must not prevent testing real UI save/upload actions against mocks.
- Cover browsing/idle, photo preparation/upload/curious, create and edit saves, confirmed celebration, unsuccessful save without celebration, upload failure, invalid form submission, problem resolution, retry, cancellation, and navigation during pending work. Respect the existing rule that create-page photo attachment becomes available only after a recipe has an ID.
- Cover precedence using controlled pending and failed operations. Add narrowly focused component integration tests only where timing or overlap is difficult to exercise reliably at the browser seam; assert output and interaction rather than reducer implementation.
- Verify pointer and touch positioning across the character, click versus drag, keyboard repositioning, restoration after reload, legacy hidden-preference migration, default recovery from corrupt/unavailable storage, viewport resizing, and narrow-screen docking.
- Verify bubble focus and Escape handling, the tail's connection to Mori, meaningful status semantics, reduced motion, keyboard-only operation, long message wrapping, mobile widths including 320 CSS pixels, and 200% zoom/reflow. Check that existing save controls, form fields, and dialogs remain usable with the bubble open.
- Check that the floating companion is absent from public/authentication pages, decorative artwork remains, route changes retain preferences but clear obsolete activity, and sign-out clears transient state.
- Assert that opening guidance, animating, and dragging Mori create no extra API or AI requests and no recipe writes. Explicit workflow actions retain existing request contracts and confirmation boundaries.
- Run focused affected frontend tests, frontend type/lint/build checks, and relevant browser acceptance. Record screenshot evidence for desktop, mobile, open bubble, and reduced-motion states. Distinguish automated accessibility semantics from any manual assistive-technology verification actually performed.

## Out of Scope

- The pasted storybook loading screen, walking miniature world, automatically flipping notebook, parallax scenery, and cycling typewriter loading experience.
- Adding new AI extraction, generation, or refinement screens, changing AI API contracts, or introducing image-to-recipe extraction. Existing Quick AI Entry and AI Chef workflows are included.
- Replacing the rat chef with a new character, copying Codex Pet artwork, sprite-sheet generation, external desktop pets, or operating-system overlays.
- Removing decorative Mori illustrations, the Mori emblem, or branding.
- Autonomous saves, retries, recipe changes, AI calls, or navigation; sound; unsolicited roaming; gamification or companion needs.
- Cross-device preference synchronization, backend preference storage, new analytics, and storing companion conversation history.
- Backend API, authentication, data schema, image feature rollout, storage, quota, or production configuration changes.

## Further Notes

- Scope comes from three accepted interview rounds: companion instead of the storybook loader, preserved character identity, replacement of interactive dialogue only, existing frontend workflows first, signed-in recipe scope, local preferences, explicit actions, accessible mobile behavior, precedence, and restrained personality.
- The requester explicitly accepted the application-level browser testing seam. Implementation is part of this change; deployment remains out of scope.
- Current photo upload attaches a recipe image; it does not invoke Gemini extraction. Existing extraction accepts a text brain dump. Backend extraction and generation support does not establish frontend activity to display.
- The existing architecture decision for server-side Gemini, validated previews, and explicit confirmation before persistence remains in force. The dashboard-only inline dialogue documentation describes the prior presentation, which this design intentionally replaces.
- The workspace already contains in-progress recipe and photo changes. Implement against the actual checkout and preserve those changes; this spec does not imply ownership of or permission to discard them.
- Refinement remains outside scope where no distinct workflow exists. Do not build unused service adapters or expose unavailable AI actions.
