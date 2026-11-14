# QA-04 cross-browser and mobile bug bash

Run date: 2026-11-15 (local)

## Scope and setup

The candidate was based on `origin/main` at `8bfbd485`. Checks used synthetic local Supabase accounts, deterministic AI fixtures, and browser-intercepted image API/storage responses. No production account, Gemini request, recipe data, or R2 storage was used. The image journey generated a tiny local image and served synthetic image bytes from `.test` hosts.

The repository has no documented browser support policy. This report records the exact browser engines and viewports exercised; it does not add a support commitment. The mobile checks used CSS viewports, not physical phones.

Host: macOS 27.0, Apple Silicon (`arm64`); Node `v26.10.0`; pnpm `10.34.9`; Playwright `1.64.1`.

## Recorded browser and viewport matrix

| Browser | Version | Core/feature viewports | Image viewports | Result |
| --- | --- | --- | --- | --- |
| Playwright Chromium | `156.0.8078.4` | Desktop `1280×720`; mobile `375×812` | `1280×844`, `375×844` | Core `6/6`; image journeys passed at both widths |
| Playwright WebKit | `27.2` | Desktop `1280×720`; mobile `375×812` | `1280×844`, `375×844` | Core `6/6`; image journeys passed at both widths |
| Chrome channel (auth and discovery checks) | `157.0.8103.79` | Auth: `1440×900`; discovery: `1280×900`, `375×900`, `320×900` | Auth: `390×900`, `320×900` | Auth and discovery journeys passed at all recorded widths |
| Playwright Firefox | Could not launch on this host | Not run | Not run | Browser process exited with `Could not find profile folder`; this is a local runner limitation, not a product finding |

The E2E workflow now installs Chromium, Firefox, and WebKit on Ubuntu and runs the core and image journeys in all three engines. The macOS Firefox launch failure leaves Firefox product behavior unobserved locally; the updated Linux CI matrix is the validation gate for it.

## Flows exercised

- Existing local Supabase Playwright journeys passed in Chromium and WebKit: sign-in, recipe create/read/edit/rate/delete, cross-account recipe access, Quick AI Entry extraction with explicit save, Chef preview/save with reviewed lineage, and recoverable provider/extraction failures.
- Existing recipe discovery browser check passed in Chrome at desktop, narrow mobile, and extra-narrow mobile widths. It checked search and sort, pagination, empty and retry states, keyboard focus recovery, logout, and horizontal overflow.
- Existing synthetic-auth browser check passed in Chrome for sign-in, signup, verification pending/success/expired, session restoration, logout, keyboard/focus and recovery behavior. Mobile cases ran at `390×900` and `320×900`.
- The private-image UI check used intercepted, synthetic API/storage responses. It loaded the current image, selected and previewed a replacement, injected a failed upload, verified the previous image remained visible, retried, and verified the replacement appeared. It also checked for page errors and horizontal overflow.
- The mobile CRUD regression journey asserts no horizontal overflow during create, detail, edit, and delete at `375×812`. The successful Chef flow also checks pantry entry, preview, reviewed-lineage save, and saved recipe detail at `375×812` in Chromium and WebKit.

## Findings and dispositions

### QA04-01 — WebKit canvas output was rejected by image upload

- **Severity:** P0 / release-blocking in the checked WebKit image flow
- **Environment:** Playwright WebKit `27.2`, macOS 27.0, `1280×844` and `375×844`
- **Reproduction:** Open the recipe edit page with an existing image, choose a PNG replacement, and upload it.
- **Expected:** The replacement is prepared and the upload begins.
- **Observed before fix:** WebKit's `canvas.toBlob(..., 'image/webp')` returned a PNG Blob. `prepareRecipeImage` accepted only `image/webp`, so the image panel rejected the file before upload.
- **Disposition:** Fixed in `frontend/src/recipes/imageApi.ts` to accept the existing JPEG/PNG/WebP allowlist for the actual encoder output. Upload intent and PUT use the Blob's actual MIME type. The UI journey now passes in WebKit with `image/png` and in Chromium with `image/webp`, at both recorded image viewports. The failed-upload retry also confirms that the current image remains visible until replacement succeeds.

No other reproducible product blocker or non-blocking product finding was found in the successfully launched environments. The Firefox runner failure is tracked as an environment limitation and is covered by the Linux CI matrix.

## Validation

| Check | Result |
| --- | --- |
| `pnpm run test:e2e:local -- --browser chromium` | Passed, 6/6; after adding the mobile Chef assertions, the changed Chef journey was rerun and passed |
| `pnpm run test:e2e:local -- --browser webkit` | Passed, 6/6; after adding the mobile Chef assertions, the changed Chef journey was rerun and passed |
| `node e2e/recipe-discovery.browser.mjs` | Passed at `1280×900`, `375×900`, and `320×900` |
| `node e2e/auth-ui.browser.mjs` | Passed; auth mobile cases at `390×900` and `320×900` |
| `pnpm run test:e2e:local -- --browser chromium --grep "AI Chef saves"` and WebKit equivalent | Both passed, 1/1 at `375×812`; pantry, preview, reviewed-lineage save, saved detail, and overflow checks |
| `QA04_BROWSER=chromium pnpm run test:e2e:qa04:images` | Passed at `1280×844` and `375×844`; encoder output `image/webp` |
| `QA04_BROWSER=webkit pnpm run test:e2e:qa04:images` | Passed at `1280×844` and `375×844`; encoder output `image/png` |
| `pnpm run lint` | Passed |
| `pnpm run type-check` | Passed |
| `pnpm run build` | Passed; existing Zod annotation and chunk-size warnings only |
| `git diff --check` | Passed |
| `pnpm run test` on candidate and clean `origin/main` | Both reported `544 passed, 33 failed` out of 577; failures are in the unchanged auth, Quick AI, and Chef suites. The focused auth setup failure is `TypeError: Cannot read properties of undefined (reading 'clear')` at `src/auth/CallbackIntegration.test.tsx:25:23`; Node also warns `localStorage is not available because --localstorage-file was not provided`. The clean-main baseline reproduces the same failure count under Node `v26.10.0`; CI uses Node 24, so CI will determine that environment's result. |

The local QA-04 issue record contains the same finding, fix, browser limitation, and validation dispositions.
