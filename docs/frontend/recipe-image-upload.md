# FE-12 private recipe-image upload integration

**Status** — New uploads use object-scoped, presigned R2 `PUT` URLs. This direct-upload revision supersedes the authenticated proxy transport documented in PR #190; see [ADR-0001](../adr/0001-direct-r2-recipe-image-uploads.md). Production signing and cleanup remain disabled pending their separate readiness checks and authorization.

## Browser rollout gate

The image panel and image endpoint requests are disabled unless
`VITE_RECIPE_IMAGES=true`. The production build sets the flag to `true` per
owner direction, so the next production release exposes the image UI to users.
This does not verify R2 access or bucket CORS, deploy the upload-signing or
cleanup functions, or enable cleanup. Production R2 behavior and cleanup
readiness remain unverified.

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

The existing authenticated-proxy behavior recorded in [the API contract](../api/recipe-images.md)
and [owner decision #104](https://github.com/2ton-exe/moris-mix-ai/issues/104#issuecomment-6721071406)
is historical. This revision restores direct R2 uploads at the user's explicit
direction; it does not authorize production deployment or configure bucket
CORS.
