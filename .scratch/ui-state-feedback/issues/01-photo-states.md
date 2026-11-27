# UI-05-01 — photo-states

Status: resolved
Blocked by: none

Implement the corresponding behavior and regression checks in [the spec](../spec.md).

## Answer
The shared uploader now groups a framed empty/current/selected photo area beside clear controls, replaces the cleared native filename display with Choose/Replace actions, and distinguishes selection from verified attachment. Failed replacements keep the current photo; verified attachment with unavailable display refresh has separate recovery copy. Existing R2 validation, signing, upload, attachment, retries, ownership, and feature gating are unchanged.

Regression evidence: the new selected-photo test first failed because the empty paragraph remained visible. All 30 image integration tests passed after the fix, as did frontend type checking, lint, and production build. Chromium desktop image journeys passed at 1100×640 and 1280×844 with first-photo frame/selected geometry assertions. Browser coverage uses isolated API/R2 responses rather than live storage.
