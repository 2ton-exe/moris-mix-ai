# FE-12 private recipe-image upload integration

**Status** — PR #210 uses object-scoped, presigned R2 `PUT` URLs for new uploads. The PR owner confirmed fresh BE-13 and FE-12 acceptance on 2026-11-15; owner-specific confirmation URLs were not supplied. The approvals recorded for PR #190 cover authenticated Edge Function ingress only. See [ADR-0001](../adr/0001-direct-r2-recipe-image-uploads.md).

## Browser rollout gates

The image panel and image endpoint requests are disabled unless
`VITE_RECIPE_IMAGES=true`. Production builds default to `false`. On an enabled
release the production workflow checks the deployed database migrations and
deploys the matching image handlers before it publishes the build. Follow the
[production rollout](../devops/deployment-runbook.md#enable-private-recipe-images)
to verify R2 and bring up staging cleanup before enabling the UI.

This changes the earlier authenticated Edge Function byte-upload path to a
direct browser-to-R2 `PUT`. The browser sends the signed `Content-Type` and
`If-None-Match` headers and derives the signed `Content-Length` from its Blob;
R2 bucket CORS must allow the app origin, `PUT`, and those headers. No signed
upload from the app origin or live same-key retry rejection has been verified.

Upload authorization idempotency has a separate compatibility gate:
`VITE_RECIPE_IMAGE_UPLOAD_IDEMPOTENCY` defaults to `false`, and the browser omits
`request_id` unless the flag is exactly `true`. Production reads the same-named
repository variable and falls back to `false`, so this client remains compatible
with a deployed signer that still has the older strict request schema. Keep the
variable unset or `false` until migrations `20261115000020` through
`20261115000022` and their prerequisite upload-intent migrations are applied,
the updated `recipe-image-upload-url`
signer is deployed and verified to accept `request_id`, and the protected
`Modular Main Recipe Image Readiness` job passes in the same release run. The
readiness verifier checks database state. After
verifying the deployed signer, an authorized operator can set the repository
variable to `true` and run a production release to deliver the idempotency-aware client.

## Upload requirements

Request an upload intent for an owned, saved recipe through authenticated
`POST /functions/v1/recipe-image-upload-url`. Send the selected image's actual
byte size and supported MIME type. Images must be JPEG, PNG, or WebP and no
larger than 10 MiB. The response contains an R2 URL scoped to one staging
object, the exact signed `Content-Type` and `If-None-Match: *` headers, the
declared byte size, and its expiry.

Validate that the URL uses the Cloudflare R2 endpoint and matches the current
owner, recipe, and upload IDs before sending bytes. Upload the exact `Blob`
using `PUT` and the returned headers. Send no Supabase Bearer token or project
API key to R2. The browser sets `Content-Length` from the Blob; its value is
bound into the signature. Do not send JSON or multipart form data, and never
log or display the presigned URL.

R2 bucket CORS must allow the deployed frontend origin, `PUT`, and the
`Content-Type` and `If-None-Match` request headers. The bucket remains private;
the presigned URL is a short-lived bearer capability for only one staging
object. The URL expires with its ten-minute upload intent.

## Results and retry requirements

- Show pending state until the upload and attachment requests complete.
- On R2 `200 OK`, continue through the separate BE-14 verification and
  attachment request.
- On R2 `412 Precondition Failed`, treat the write as a possible successful
  prior attempt and continue to attachment. BE-14 verifies the stored bytes
  before the image is shown.
- On a network failure or storage `5xx`, allow a bounded user-controlled retry
  of the same URL. If the first request stored the object, the retry returns
  `412` and follows the verification path above.
- If the URL has expired, request a new intent only if backend quota permits.
- On attachment `409 UPLOAD_BYTES_MISSING`, upload the bytes again using the
  same intent, then retry attachment.
- On attachment `409 UPLOAD_NOT_READY`, do not resend bytes; wait and retry
  attachment.
- On attachment `404 UPLOAD_NOT_FOUND`, request a new intent only if backend
  quota permits.
- Preserve the current recipe image until verification and attachment succeed.
  A successful upload alone does not update recipe metadata.

The authenticated-proxy behavior recorded in [the API contract](../api/recipe-images.md)
and [owner decision #104](https://github.com/2ton-exe/moris-mix-ai/issues/104#issuecomment-6721071406)
is historical for this transport. The PR owner confirmed the BE-13 and FE-12
owners' acceptance on 2026-11-15; the prior upload approvals do not cover
direct R2 transport. This acceptance does not authorize production deployment
or configure bucket CORS.
