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
- The private-image follow-up exercised a direct presigned R2 `PUT` in Chromium and WebKit at desktop and mobile viewports. It verified the R2 host/path contract, `Content-Type` and `If-None-Match` headers, absence of Supabase auth headers, recovery from a failed PUT, and attachment after retry. A separate local HTTP/2 probe confirmed Chromium and WebKit send the Blob's exact `Content-Length`; it did not contact Cloudflare R2.
- The foreign-cook image UI check used a second synthetic authenticated session and a mocked recipe-read `404`. It verified the page shows `Recipe unavailable`, the private image is absent, and the UI makes zero image-download requests. This verifies frontend behavior when recipe access is denied; it does not exercise Edge Function authorization. The separate Deno lifecycle test `private read signs only the owned recipe's final image and does not cache` in `supabase/functions/tests/recipe_image_lifecycle_test.ts` exercises the actual handler's owner check and passed in this review-fix run.
- The mobile CRUD regression journey asserts no horizontal overflow during create, detail, edit, and delete at `375×812`. The successful Chef flow also checks pantry entry, preview, reviewed-lineage save, and saved recipe detail at `375×812` in Chromium and WebKit.

## Findings and dispositions

### QA04-01 — WebKit canvas output was rejected by image upload

- **Severity:** P0 / release-blocking in the checked WebKit image flow
- **Environment:** Playwright WebKit `27.2`, macOS 27.0, `1280×844` and `375×844`
- **Reproduction:** Open the recipe edit page with an existing image, choose a PNG replacement, and upload it.
- **Expected:** The replacement is prepared and the upload begins.
- **Observed before fix:** WebKit's `canvas.toBlob(..., 'image/webp')` returned a PNG Blob. `prepareRecipeImage` accepted only `image/webp`, so the image panel rejected the file before upload.
- **Disposition:** Fixed in `frontend/src/recipes/imageApi.ts` to accept the existing JPEG/PNG/WebP allowlist for the actual encoder output. Upload intent and PUT use the Blob's actual MIME type. The UI journey now passes in WebKit with `image/png` and in Chromium with `image/webp`, at both recorded image viewports. The failed-upload retry also confirms that the current image remains visible until replacement succeeds.

### QA04-02 — Image upload rejected the R2 presigned object URL

- **Severity:** P0 / image upload blocker when `VITE_RECIPE_IMAGES=true`
- **Reproduction:** Request an upload intent, then send the selected image using the returned R2 URL.
- **Expected:** The browser validates the object-scoped R2 URL and sends the bytes to R2 using the signed headers, without Supabase credentials; a successful `PutObject` returns `200`.
- **Observed before fix:** The client required the upload Edge Function path and routed the byte PUT through the shared authenticated client, which rejected R2's origin and expected a JSON `201` response.
- **Disposition:** Fixed by signing the staging `PUT` URL in the upload authorization handler, validating its R2 host/path and IDs in the browser, using a direct request with no Supabase auth or API key headers, and accepting `200` (plus `412` for a completed retry). Regression coverage passed in Chromium and WebKit at `1280×844` and `375×844`. The storage response was mocked for these UI journeys; a synthetic local HTTP/2 probe confirmed browser `Content-Length` behavior. No signed upload from the configured app origin or live same-key retry rejection was exercised. Verify R2 CORS and signed-write compatibility before production enablement.

### QA04-03 — Recipe writes had no request-size or field-count bounds

- **Severity:** P1 / request and stored-data resource risk
- **Reproduction:** Submit an oversized create or update JSON body, or send text fields and recipe arrays beyond the API limits.
- **Expected:** Reject the streamed body before JSON parsing when it exceeds the recipe byte limit, and reject oversized fields or arrays at schema validation.
- **Observed:** The current `origin/main` implementation already enforces a 256 KiB streamed-body limit on create and update and caps recipe schema fields and collections. The gap was regression coverage for oversized PATCH requests and some create/update array bounds.
- **Disposition:** Existing guards were preserved. Tests now assert the PATCH byte limit and the create/update instruction and ingredient collection limits. The recipe handler suite passed with 207 tests and 2 opt-in hosted checks ignored.

No other reproducible product blocker or non-blocking product finding was found in the successfully launched environments. The Firefox runner failure is tracked as an environment limitation and is covered by the Linux CI matrix.

## Validation

| Check | Result |
| --- | --- |
| `pnpm run test:e2e:local -- --browser chromium` | Passed, 6/6; after adding the mobile Chef assertions, the changed Chef journey was rerun and passed |
| `pnpm run test:e2e:local -- --browser webkit` | Passed, 6/6; after adding the mobile Chef assertions, the changed Chef journey was rerun and passed |
| `node e2e/recipe-discovery.browser.mjs` | Passed at `1280×900`, `375×900`, and `320×900` |
| `node e2e/auth-ui.browser.mjs` | Passed; auth mobile cases at `390×900` and `320×900` |
| `pnpm run test:e2e:local -- --browser chromium --grep "AI Chef saves"` and WebKit equivalent | Both passed, 1/1 at `375×812`; pantry, preview, reviewed-lineage save, saved detail, and overflow checks |
| `QA04_BROWSER=chromium pnpm run test:e2e:qa04:images` | Direct signed R2 upload journey and foreign-cook denial UI check passed at `1280×844` and `375×844`; encoder output `image/webp`; no Supabase auth on R2 PUT; denied cook made zero image-download requests |
| `QA04_BROWSER=webkit pnpm run test:e2e:qa04:images` | Direct signed R2 upload journey and foreign-cook denial UI check passed at `1280×844` and `375×844`; encoder output `image/png`; no Supabase auth on R2 PUT; denied cook made zero image-download requests |
| `frontend/src/api/http.test.ts` and `frontend/src/recipes/RecipeImageIntegration.test.tsx` | Passed, 52 tests; covers credential-free R2 `200`, retry `412`, invalid hosts, and image replacement recovery |
| `supabase/functions/tests/r2_signing_test.ts` and `supabase/functions/tests/recipe_image_upload_url_test.ts` | Passed, 42 tests; validates direct URL signing, declared content length, response contract, and upload authorization |
| `supabase/functions/tests/recipes_test.ts` | Passed, 207 tests; 2 hosted integration tests ignored by opt-in configuration; includes streamed byte and schema-boundary cases |
| `deno test --node-modules-dir=auto --allow-env=ALLOWED_ORIGIN --filter "private read signs only" supabase/functions/tests/recipe_image_lifecycle_test.ts` | Passed, 1/1; actual handler returns 404 for a foreign cook's private image read |
| `pnpm run lint` | Passed |
| `pnpm run type-check` | Passed |
| `pnpm run build` | Passed; existing Zod annotation and chunk-size warnings only |
| `git diff --check` | Passed |
| Synthetic local HTTP/2 Blob upload probe | Chromium and WebKit both returned `200`; each sent `Content-Length: 163` for a 163-byte Blob. No live R2 request was made. |
| `pnpm run test` on candidate and clean `origin/main` | Both reported `544 passed, 33 failed` out of 577; failures are in the unchanged auth, Quick AI, and Chef suites. The focused auth setup failure is `TypeError: Cannot read properties of undefined (reading 'clear')` at `src/auth/CallbackIntegration.test.tsx:25:23`; Node also warns `localStorage is not available because --localstorage-file was not provided`. The clean-main baseline reproduces the same failure count under Node `v26.10.0`; CI uses Node 24, so CI will determine that environment's result. |

The local QA-04 issue record contains the same finding, fix, browser limitation, and validation dispositions.
