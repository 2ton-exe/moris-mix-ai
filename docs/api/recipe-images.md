# Recipe image upload API contract

This contract defines the authenticated request to authorize a direct Cloudflare R2 upload and the later request to verify and attach that upload to an owned recipe. BE-09 supplies the contract and shared validators. BE-13 implements upload signing and pending upload-intent storage. Attachment, private reads, deletion, and cleanup remain future work under BE-14 and its approved integration contracts.

Production readiness is **BLOCKED** until actual upload-size enforcement or an approved mitigation with quotas or rate limits and reliable cleanup is established and implemented. BE-13 validates declared sizes only. This implementation introduces no size-enforcement workaround and must not be deployed as a production-ready image flow.

## Endpoint overview

| Method | Path | Operation | Success |
| --- | --- | --- | --- |
| `POST` | `/functions/v1/recipe-image-upload-url` | Authorize one short-lived image upload for an owned recipe | `200 OK`, `{ "upload": ... }` |
| `POST` | `/functions/v1/recipe-image-attach` | Verify an uploaded object and attach it to the recipe | `200 OK`, `{ "image": ... }` |
| `OPTIONS` | Either path | CORS preflight | `204 No Content` |

## Authentication and ownership

- Both `POST` requests require `Authorization: Bearer <supabase-access-token>`, the Supabase project `apikey`, and a JSON body. The project key does not authenticate the user; the Bearer token is verified by the backend.
- The upload handler uses the shared `authenticateRequest()` boundary and derives ownership from its verified user context. The future attach handler must do the same. Client-supplied `user_id` is never trusted.
- The upload-signing request checks that `recipe_id` belongs to the authenticated user before authorizing a `PUT`. The attach request checks ownership again; signing does not authorize attachment by itself.
- Missing and foreign recipes have the same `404 RECIPE_NOT_FOUND` result. Never reveal whether another user’s recipe exists.
- `OPTIONS` is handled before authentication. The function entries in `supabase/config.toml` already set `verify_jwt = false` so unauthenticated preflight requests reach the handlers. This only disables gateway JWT validation; the upload handler calls `authenticateRequest()` for every `POST` before accessing user or storage data, and the future attach handler must do the same. The Edge Function CORS policy allows `POST, OPTIONS` and `authorization`, `x-client-info`, `apikey`, and `content-type` headers for configured frontend origins.

## Request an upload URL

### Request

`POST /functions/v1/recipe-image-upload-url`

```json
{
  "recipe_id": "99999999-9999-9999-9999-999999999999",
  "content_type": "image/jpeg",
  "byte_size": 245760
}
```

- `recipe_id` is the stable UUID primary key of the recipe.
- `content_type` must be `image/jpeg`, `image/png`, or `image/webp`. SVG and other formats are not supported.
- `byte_size` must be a positive integer no larger than 10 MiB. It is a client declaration, not proof of the uploaded bytes, and does not limit R2 ingress. The future implementation must enforce the 10 MiB cap before R2 accepts the `PUT` body or apply an agreed mitigation for oversized uploads, including upload quotas or rate limits and reliable cleanup of oversized or rejected staging objects. Attachment must always verify the actual R2 size and reject objects over the limit.
- Unknown fields are rejected. The caller cannot provide an owner ID, object key, `image_path`, or `image_url`.
- Upload signing accepts no query parameters. Callers cannot override the HTTP method, signed headers, or expiration.

### Success (`200 OK`)

Returns `Cache-Control: no-store` and a JSON `upload` object:

```json
{
  "upload": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "url": "https://<r2-s3-endpoint>/<signed-put-url>",
    "method": "PUT",
    "headers": { "Content-Type": "image/jpeg" },
    "expires_at": "2026-10-26T10:10:00Z"
  }
}
```

The backend generates a fresh staging key and a distinct server-only final key, and binds both keys to the upload UUID, verified owner, recipe UUID, content type, declared size, and expiry. The signed URL authorizes a `PUT` only to the staging key for 10 minutes and requires the returned method and headers exactly. It uses the R2 S3 API endpoint. The final key is never returned or signed for client writes.

The browser uploads the raw file bytes directly to `upload.url`; it does not send JSON or multipart form data to R2. A presigned URL is a temporary bearer capability: anyone who obtains it can reuse it until it expires. Attachment therefore never points `recipes.image_path` at the client-writable staging key. Do not log the URL, show it in UI errors, or treat it as a permanent image URL. The secret access key remains server-side. Standard S3 presigned URLs necessarily expose the account endpoint, bucket, staging object path, and access-key ID in `X-Amz-Credential`; these are not returned as separate response fields. The independently randomized final key is never returned or signed for client writes. Issue #104's credential/key acceptance criterion must be interpreted with this unavoidable protocol limitation.

The signature binds `PUT`, the staging path, `host`, `Content-Type`, and a 600-second expiry using SigV4 with region `auto`, service `s3`, and `UNSIGNED-PAYLOAD`. It does not prove that the body is an image or bind its byte count. Unrelated transport headers can still be present; requiring the returned headers means the signed headers must match, not that all other HTTP headers are prohibited. URLs expire relative to the signing timestamp, rounded down to the second. Signing is entirely local and does not establish R2 availability; signing and configuration failures return a safe `500 INTERNAL_ERROR`. A `503 STORAGE_UNAVAILABLE` is reserved for future operations that actually contact R2.

## Verify and attach an upload

### Request

`POST /functions/v1/recipe-image-attach`

```json
{
  "recipe_id": "99999999-9999-9999-9999-999999999999",
  "upload_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

The backend resolves the staging and final keys from the authenticated owner, recipe UUID, and upload intent. The request cannot provide an `object_key`, `image_path`, or `image_url`. The intent must belong to this owner and recipe. A pending intent may be claimed only before expiry; an already attached intent remains replayable after its upload URL expires and returns its stored result. A `finalizing` intent with a live lease returns `409 UPLOAD_NOT_READY`. A `finalizing` intent with an expired lease is reclaimable by a new attach request, which must atomically replace its attempt token and lease, even if the upload URL has since expired. The pointer commit must require the new token so the prior worker cannot commit. An expired pending or terminal intent returns `404 UPLOAD_NOT_FOUND`. Only the backend uses the final key during attachment.

Before associating the image, the backend verifies that the staging object exists and that its stored content type and actual byte size match the upload intent and allowed limits. A content-type metadata value alone does not prove that the bytes decode as an image; a later read or processing boundary must validate or normalize the bytes before rendering them.

Before any R2 operation, a database transaction must claim only an unexpired `pending` intent by changing it to `finalizing` and assigning a unique attempt token and lease. If another request already owns a live `finalizing` lease, return `409 UPLOAD_NOT_READY`; return `404 UPLOAD_NOT_FOUND` for an expired pending or terminal intent. The implementation must enforce a maximum copy duration and set the lease longer than that duration. Recovery may reclaim a `finalizing` intent only after its lease expires, atomically replacing its attempt token and lease so an earlier worker cannot commit.

After claiming the intent, capture the staging object's ETag while verifying its type and size, then copy it to the intent's distinct final key with a source-match condition on that ETag. If the staging object changed, the conditional copy fails; do not attach it unless the current object is revalidated. Verify the finalized object's stored content type and byte size. The client has no signed write capability for the final key, so reuse of the staging URL cannot change an attached image.

Different upload intents for the same recipe may finalize concurrently, but their pointer swaps must serialize on the recipe row. In one database transaction, update the recipe image path only if the intent is still `finalizing` with the same attempt token, mark it `attached`, and record the previous final key for retryable cleanup. If that state fence fails, leave the recipe path unchanged. Delete only the recorded previous key after commit; never derive it from an earlier unlocked read. If finalization fails, return the intent to `pending` only while the same token owns it and it remains unexpired; otherwise leave it for lease recovery. Retrying uses the same final key. Clean up staging objects after the URL expires; deleting one earlier does not revoke the signed URL, which can recreate it until expiry.

Expired-intent cleanup must transactionally change an expired `pending` intent to terminal `expired` before deleting its staging or orphan final keys. It must skip `finalizing` and `attached` intents. If a `finalizing` lease expires, recover it only after the enforced maximum copy duration, then re-evaluate whether it should return to `pending` or become `expired`. Retry object deletion from the terminal intent record if cleanup fails.

### Success (`200 OK`)

Returns a JSON `image` object. Its `byte_size` is the verified stored size and `uploaded_at` is an ISO 8601 UTC timestamp.

```json
{
  "image": {
    "recipe_id": "99999999-9999-9999-9999-999999999999",
    "content_type": "image/jpeg",
    "byte_size": 245760,
    "uploaded_at": "2026-10-26T10:04:00Z"
  }
}
```

The response contains no standalone object key or URL. A future image-read contract defines image delivery separately. The temporary `PUT` URL is never stored in `recipes.image_url`; the finalized server-only object key is stored in the internal `recipes.image_path` field after verification and copy.

The attach operation is idempotent for the same completed upload and recipe. After verifying that the caller owns the recipe and the intent belongs to that caller and recipe, replaying an already attached intent returns its stored result even after the upload URL expires; it does not copy the staging object again or change the recipe's current image path, so it cannot replace a newer image. First attachment updates the recipe image path and upload-intent state together. A failed or incomplete upload leaves the current image unchanged. If a new image replaces the current one, the database pointer changes only after verification and finalization; deleting the previous final object happens after commit and cannot undo the new association.

## Shared validation

The shared backend schemas validate the upload request, attach request, and metadata response. Recipe and upload IDs are UUIDs; content type is the three-value allowlist above; `byte_size` is an integer from 1 through 10 MiB; `uploaded_at` is an ISO 8601 UTC timestamp. Request schemas reject unknown fields so callers cannot select ownership or storage paths.

The frontend-facing wire names are `recipe_id`, `content_type`, `byte_size`, `upload_id`, and `uploaded_at`. Browser code consumes this documented contract and does not import Deno-specific modules.

## Errors

Function errors use the existing JSON envelope `{ "error": { "code": "...", "message": "..." } }`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. `VALIDATION_ERROR` may also include safe `details` entries shaped as `{ path, code, message }`, following the recipe API contract. Error messages never include R2 bodies, credentials, object keys, SQL details, or stack traces.

| HTTP status | Code | Message | When |
| --- | --- | --- | --- |
| `400 Bad Request` | `INVALID_JSON` | `Request body must be a valid JSON object.` | Request body is empty, malformed JSON, or not a plain JSON object. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid recipe image request.` | Invalid UUID, image type, declared size, or unknown request fields. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Missing or invalid authentication credentials.` | Missing, invalid, or expired Bearer token. |
| `404 Not Found` | `RECIPE_NOT_FOUND` | `Recipe not found.` | Recipe is missing or belongs to another user. |
| `404 Not Found` | `UPLOAD_NOT_FOUND` | `Upload not found.` | Upload intent is unknown, expired while pending, or belongs to another owner or recipe. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only POST and OPTIONS methods are supported.` | Unsupported method on either endpoint. Includes `Allow: POST, OPTIONS`. |
| `409 Conflict` | `UPLOAD_NOT_READY` | `Uploaded image is not ready for attachment.` | The staging object is absent or changed, or another request currently owns the intent's finalizing lease; retry later. |
| `422 Unprocessable Content` | `INVALID_IMAGE` | `Uploaded image metadata is invalid.` | Actual object type or size does not match the intent and contract. |
| `503 Service Unavailable` | `AUTH_SERVICE_RATE_LIMITED` | `Authentication service is temporarily unavailable. Please try again later.` | Supabase Auth returns `429 Too Many Requests` during token verification. A validated `Retry-After` header is propagated when supplied; invalid or absent values are omitted. |
| `503 Service Unavailable` | `STORAGE_UNAVAILABLE` | `Image storage is temporarily unavailable.` | R2 is temporarily unreachable. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Other unexpected configuration, database, or storage failure. |

## CORS

- The Edge Function handles unauthenticated `OPTIONS` requests before calling `authenticateRequest()`. It allows `POST, OPTIONS` and the headers listed in Authentication and ownership.
- Configure R2 bucket CORS for the deployed frontend origins only, allow `PUT`, and allow the headers returned in `upload.headers` (currently `Content-Type`). CORS does not authorize access; the signed URL does.
- A failed R2 upload does not call the attach endpoint. The client must request a new upload URL if the current URL expires.

## Storage and recipe association

- One primary image is supported per recipe, matching the current recipe model. The stable recipe UUID, verified owner ID, and random upload UUID scope distinct staging and final keys; titles and filenames do not define storage identity.
- The future implementation stores only the finalized key internally in `recipes.image_path`. It never stores the temporary `PUT` URL in `recipes.image_url` or returns a storage path as image metadata.
- The future implementation binds each upload UUID server-side to its owner, recipe, staging key, final key, content type, declared size, expiry, state (`pending`, `finalizing`, `attached`, or terminal `expired`), and, while finalizing, an attempt token and lease. It uses the request-scoped RLS-aware Supabase client, not a service-role client, for user-owned recipe operations.
- Expired pending uploads, staging objects after their URL expiry, and replaced final objects need cleanup in the future upload implementation. Cleanup must claim only expired `pending` intents transactionally before deleting their staging or orphan final keys, skip `finalizing` and `attached` intents, and retry failed object deletions. Delete the prior attached final key captured by the serialized recipe update; do not infer it from an earlier, unlocked read. Deleting a staging object before URL expiry does not revoke the signed URL, which can recreate the object. Cleanup failures must not roll back or break a successful recipe association. Before deployment, DevOps and full-stack owners must confirm ingress-size enforcement or approve and implement the agreed oversized-upload mitigation above.

## BE-13 implementation and deployment dependencies

The upload function checks `recipes` through the verified user's request-scoped client, selecting only `id, user_id` and filtering both fields. It never updates the recipe image. After validation and ownership authorization, it generates the upload UUID, staging key, and a final key with a separate random UUID. It signs locally, inserts the pending intent, and returns the capability only after persistence succeeds. Persistence failures return no capability.

`public.recipe_image_upload_intents` stores the upload UUID, owner and recipe UUIDs, both keys, content type, declared size, signing time, expiry, and `pending` state. It has RLS enabled and forced, no browser policies, and all table privileges revoked from `PUBLIC`, `anon`, and `authenticated`. Only the backend service role receives `SELECT, INSERT`; it is never used for recipe ownership queries. SQL constraints validate types, sizes, key scoping, and the ten-minute lifetime. Records deliberately have no cascading recipe/user foreign keys: deleting a recipe or account must not erase the only record of uncollected R2 objects or change existing recipe deletion behavior. BE-14 must reauthorize attachment and implement lifecycle transitions, leases, and reliable cleanup in its own migration and handlers. No attachment state transitions or cleanup jobs are implemented here.

Required backend configuration:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Existing Supabase project endpoint |
| `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | Existing public project key used with the verified user's token |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only credential for protected intent persistence |
| `R2_ACCOUNT_ID` | Cloudflare account ID used to derive the HTTPS S3 endpoint |
| `R2_BUCKET_NAME` | Externally supplied private R2 bucket |
| `R2_ACCESS_KEY_ID` | S3 access-key identifier for that bucket |
| `R2_SECRET_ACCESS_KEY` | Server-only S3 signing secret |
| `ALLOWED_ORIGIN` | Deployed frontend origin for the existing Edge Function CORS helper |

Provision these through backend deployment secrets, never frontend environment variables. The implementation targets `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` and does not accept a caller-supplied endpoint. Keep public bucket access disabled and use credentials restricted to the intended bucket and required object operations. Configure bucket CORS for approved frontend origins, `PUT`, and `Content-Type`. CORS does not prevent use of a leaked capability outside a browser.

The migration is supplied for review only; applying it, configuring secrets/CORS, creating resources, and deploying functions require separate authorization. BE-13 creates none of those external resources. Even with valid configuration, production readiness remains blocked by the actual-size enforcement/mitigation requirement above. Client compression is not an enforcement control.

Private-read signing is unresolved: Issues [#104](https://github.com/2ton-exe/moris-mix-ai/issues/104) and [#105](https://github.com/2ton-exe/moris-mix-ai/issues/105) require an agreed endpoint split and delivery contract, and BE-09 leaves delivery separate. No download route or GET signing capability is implemented in BE-13.

## BE-13 verification

Run focused offline tests using already available dependencies:

```powershell
deno test --cached-only --frozen-lockfile --node-modules-dir=manual --allow-env supabase/functions/tests/r2_signing_test.ts supabase/functions/tests/recipe_image_upload_url_test.ts supabase/functions/tests/recipe_image_schemas_test.ts
pnpm test:migrations
```

The signing tests use three fixed synthetic PUT vectors generated independently with Node's `createHash`/`createHmac`, plus a separate Node crypto verifier for mutations of the method, object, host, signed content type, credential scope, signing date, signed-header list, and expiry. They do not reuse production canonicalization or Web Crypto HMAC helpers. The handler tests mock Supabase Auth, ownership queries, and intent persistence while running real local Web Crypto signing. Migration tests inspect privilege and RLS declarations; they do not prove database execution or deployed role behavior. Live R2, deployed authentication/RLS, and migration application remain unverified. No network permission is granted to these ordinary tests.

Local verification on November 2, 2026: focused tests passed with 39 tests (27 new signing/handler tests and 12 existing image-schema tests). The broader command below passed with 452 tests, zero failures, and six live integration tests ignored. `pnpm test:migrations` passed its unit/safety suites and skipped database lifecycle execution because it was not opted in. The initial focused run found a malformed base64url JWT test fixture; it was corrected before the passing runs.

```powershell
$env:RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION = 'false'
deno test --cached-only --frozen-lockfile --node-modules-dir=manual --allow-env --allow-read=fixtures/demo-recipe.json supabase/functions/tests/demo_recipe_test.ts supabase/functions/tests/auth_test.ts supabase/functions/tests/recipes_test.ts supabase/functions/tests/ai_contracts_test.ts supabase/functions/tests/candidate_token_test.ts supabase/functions/tests/eval_dataset_test.ts supabase/functions/tests/cross_user_rls_lineage_test.ts supabase/functions/tests/recipe_image_schemas_test.ts supabase/functions/tests/gemini_adapter_test.ts supabase/functions/tests/extract_recipe_test.ts supabase/functions/tests/generate_recipe_test.ts supabase/functions/tests/recipe_context_test.ts supabase/functions/tests/r2_signing_test.ts supabase/functions/tests/recipe_image_upload_url_test.ts
```

The following checks passed for the five new TypeScript files, along with `git diff --check`:

```powershell
$be13Files = @('supabase/functions/_shared/recipe-images/r2.ts', 'supabase/functions/_shared/recipe-images/uploadIntents.ts', 'supabase/functions/recipe-image-upload-url/index.ts', 'supabase/functions/tests/r2_signing_test.ts', 'supabase/functions/tests/recipe_image_upload_url_test.ts')
deno check --cached-only --frozen-lockfile --node-modules-dir=manual @be13Files
deno fmt --check @be13Files
deno lint --rules-exclude=no-import-prefix @be13Files
git diff --check
```

Default Deno 2.9 lint flags the repository's existing inline `npm:`/`https:` import convention under `no-import-prefix`; the same finding was reproduced on the unchanged BE-09 schema. The lint invocation excludes only that rule and does not change source conventions or dependency configuration. Existing dependencies emit a `punycode` deprecation warning during tests.

## WebP conversion investigation only

Recommended follow-up: convert optionally in the browser before requesting a signing URL. Decode the selected JPEG/PNG, enforce an approved pixel/dimension budget, render to a canvas, and request `toBlob` with `image/webp` and an agreed quality policy. Inspect the actual returned Blob MIME type, byte size, and visual preview; unsupported encoders can fall back to PNG or fail. Prefer the original approved image when conversion is unsupported, larger, or fails the quality policy. Only after choosing the exact bytes should the browser request signing with that Blob's `content_type` and `byte_size`, then upload that same Blob. This can reduce both upload bandwidth and stored bytes without adding dependencies or server infrastructure. Lossy conversion cannot guarantee identical quality, and browser encoders, device memory, image orientation, transparency, and color handling require representative-image testing. Avoid retaining both originals and converted copies in R2 unless a separately approved requirement needs them.

WebP is not guaranteed to be smaller for every image, particularly small or already optimized inputs. Google's [compression study](https://developers.google.com/speed/webp/docs/webp_study) reports average improvements on its tested datasets, not a guarantee for this application's images. Compare actual output bytes and validate acceptable quality rather than assuming a percentage saving. Browser encoding behavior and fallback are documented in [Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob).

The current allowlist already includes WebP, so optional pre-upload conversion needs no BE-13 wire-schema change: declared metadata must describe the selected output. Making WebP mandatory would require a separate contract decision about unsupported browsers, fallback, dimensions, and quality. Client conversion is untrusted and cannot replace BE-14's actual-object verification or the unresolved ingress enforcement/mitigation. Backend decoding or normalization before rendering also remains a separate security requirement.

Backend conversion is not established as feasible within the existing deployed runtime and dependency constraints. There is no installed image codec in this repository. A synthetic in-memory probe on the available Deno 2.9.7 runtime found `OffscreenCanvas`, but requesting `convertToBlob({ type: 'image/webp' })` returned `image/png`; the initial uninitialized-canvas probe also required a rendering context. This does not establish capabilities of the deployed Supabase Edge Runtime. [Deno's canvas documentation](https://docs.deno.com/runtime/reference/web_platform_apis/#offscreencanvas) documents limited contexts and PNG encoding; do not assume a native WebP encoder is available. Generic stream compression is not image transcoding.

Cloudflare [Images bindings](https://developers.cloudflare.com/images/optimization/binding/) can transform private R2 bytes and output WebP, and Cloudflare provides an [upload transformation example](https://developers.cloudflare.com/images/tutorials/optimize-user-uploaded-image/). That approach needs separately approved Images enablement/billing and Worker/binding infrastructure, which this repository does not supply. R2 alone does not transcode PUT uploads. Post-upload processing would still upload/store the original first, add processing and cleanup complexity, and save storage only after deleting the original safely; delivery-only transformations do not shrink the stored original.

Track optional client conversion as a separate frontend/FE-12 issue with an approved compression policy. Any required trusted normalization during attachment must be agreed separately with BE-14, including how transformed final metadata differs from the original upload intent. No conversion, frontend changes, Workers, or external resource changes are implemented in BE-13.

## References

- The authenticated recipe REST contract defines recipe UUIDs, owner checks, safe error handling, and the internal/private distinction for `image_path` and `image_url`.
- The authenticated session contract defines Bearer verification and the RLS-aware request-scoped client.
- Cloudflare R2 documentation: [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/), [S3 `CopyObject` support and conditions](https://developers.cloudflare.com/r2/api/s3/extensions/), and [AWS SDK v3 `Content-Type` signing](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
