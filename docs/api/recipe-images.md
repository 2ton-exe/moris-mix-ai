# Recipe image upload API contract

This contract defines the authenticated request to authorize a direct Cloudflare R2 upload and the later request to verify and attach that upload to an owned recipe. BE-09 supplies the contract and shared validators. BE-13 implements upload signing, quota-controlled intent persistence, and expired staging-object cleanup. Attachment, private reads, and finalized-image deletion remain future work under BE-14 and its approved integration contracts.

Production readiness remains **BLOCKED** until BE-14 verifies actual R2 object size before attachment and all required R2/Supabase configuration and migrations are deployed and verified. BE-13 applies a bounded-risk quota and cleanup mitigation; it does not cap bytes accepted by R2.

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
- `byte_size` must be a positive integer no larger than 10 MiB. It is a client declaration, not proof of the uploaded bytes, and does not limit R2 ingress. BE-13 limits each user to 10 signing requests per hour and 3 uncleared staging intents. These concurrency-safe limits bound outstanding object count but do not cap bytes accepted by R2 or repeated writes to an unexpired staging key. An oversized object may reach R2 until its URL expires and cleanup runs. Attachment must verify actual R2 size and reject objects over the limit.
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

Expired-intent cleanup transactionally changes an expired `pending` intent to terminal `expired` before deleting its staging object. It skips non-pending states. If a `finalizing` lease expires, recover it only after the enforced maximum copy duration, then re-evaluate whether it should return to `pending` or become `expired`. Retry object deletion from the terminal intent record if cleanup fails. BE-13 implements only the pending-to-expired staging cleanup path; BE-14 must preserve this state fence and add its finalization lease behavior in its own migration and handlers.

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
| `429 Too Many Requests` | `UPLOAD_RATE_LIMITED` | `Upload signing limit reached. Please try again later.` | The user has requested 10 upload URLs within the last hour. |
| `429 Too Many Requests` | `UPLOAD_QUOTA_EXCEEDED` | `Too many image uploads are pending. Please try again later.` | The per-user outstanding-intent cap is exhausted. |
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
- BE-13 cleanup claims only expired `pending` intents transactionally, marks them terminal `expired`, then deletes their staging objects. It skips every non-pending state. R2 deletion failures are retained with exponential backoff capped at one hour and eight attempts; terminal failures remain recorded and make scheduled runs fail until investigated. Delete the prior attached final key captured by the serialized recipe update; do not infer it from an earlier, unlocked read. BE-14 remains responsible for actual size and content-type verification before attachment, finalized-object lifecycle, and finalization lease recovery.

## BE-13 implementation and deployment dependencies

The upload function checks `recipes` through the verified user's request-scoped client, selecting only `id, user_id` and filtering both fields. It never updates the recipe image. After validation and ownership authorization, it generates the upload UUID, staging key, and a final key with a separate random UUID. It signs locally, atomically applies the per-user quotas and inserts the pending intent, then returns the capability only after persistence succeeds. Persistence failures return no capability.

`public.recipe_image_upload_intents` stores the upload UUID, owner and recipe UUIDs, both keys, content type, declared size, signing time, expiry, state, cleanup attempts, lease, and safe failure category. It has RLS enabled and forced, no browser policies, and all table privileges revoked from `PUBLIC`, `anon`, and `authenticated`. The backend service role can select rows and execute narrowly scoped security-definer RPCs for quota-controlled creation and cleanup; it cannot insert or update rows directly. It is never used for recipe ownership queries. SQL constraints validate types, declared sizes, key scoping, the ten-minute lifetime, and cleanup-state consistency. Records deliberately have no cascading recipe/user foreign keys: deleting a recipe or account must not erase the only record of uncollected R2 objects or change existing recipe deletion behavior. BE-14 must reauthorize attachment and extend the lifecycle state machine with finalization leases in its own migration and handlers.

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
| `RECIPE_IMAGE_CLEANUP_TOKEN` | Dedicated server-only bearer token for scheduled cleanup invocation |

Provision these through backend deployment secrets, never frontend environment variables. The implementation targets `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` and does not accept a caller-supplied endpoint. Keep public bucket access disabled and use credentials restricted to the intended bucket and required object operations. Configure bucket CORS for approved frontend origins, `PUT`, and `Content-Type`. CORS does not prevent use of a leaked capability outside a browser.

Production cleanup deployment and invocation are explicitly disabled in the production workflows. This prevents the Edge Function from being deployed by the production release or called by its schedule before production prerequisites have been independently checked. GitHub Actions variables cannot enable either path; the workflow conditions are hard-disabled. The function remains available for non-production use.

Production cleanup deployment and invocation remain disabled through hard-coded `if: false` workflow conditions. No GitHub Actions variable can activate either path. A separately authorized change must follow independent production verification before changing these conditions.

Before any future activation, an authorized operator must verify migrations `20261102000009` through `20261102000014` in the intended production project, including the upload-intent and staging-reconciliation tables, all cleanup and reconciliation RPCs, and grants/RLS that deny browser-role access while granting only the required `service_role` privileges. Confirm project identity and check the deployed function configuration, server-only cleanup token, and bucket-scoped R2 delete and `ListObjectsV2` permissions. Repository migration files and CI results do not prove production readiness; automatic production migration delivery remains outstanding.

After those checks are recorded, a separately reviewed workflow change may authorize deployment and invocation. Provision `RECIPE_IMAGE_CLEANUP_TOKEN` as a Supabase Edge Function secret and protected GitHub Actions secret. The cleanup function processes at most 40 deletions per invocation: up to 25 expired-intent objects and 15 staging-reconciliation objects, with up to 5 concurrent deletes; failures retry with exponential delay capped at one hour for at most eight attempts. To disable cleanup, restore `if: false` on both production workflow paths. The current production schema, RPCs, grants, function deployment, cleanup secrets, and R2 permissions have not been independently verified. No production readiness is claimed.


Each scheduled cleanup invocation also scans one page of `recipe-images/staging/` using the S3-compatible `ListObjectsV2` operation with a 25-object maximum. Its opaque continuation token and scan lease are stored in the database. After reaching the end, the next invocation starts a new full scan. This repeated scan is required because an already-started PUT can finish after a DELETE; a later listing can rediscover that staging key and enqueue deletion again. Reconciliation deletes only staging keys that have no upload intent or whose intent is expired and whose intent cleanup is complete. It excludes pending, finalizing, and attached intents. It claims at most 15 outstanding object deletions per invocation, oldest tasks first, so queued work from earlier pages is drained while the cursor advances. Per-key claims, leases, bounded retries, terminal failure reporting, and 30-day retention are stored separately from upload intents. Completed reconciliation records and terminal failures are retained for 30 days; a still-present object discovered after its failure record is pruned is retried as a new task. Final image keys are rejected by both listing-key validation and the deletion signer.

R2 listing capability has not been verified for the configured access key. Before enabling this code in an environment, an authorized operator must confirm that its existing bucket-scoped credential can perform `ListObjectsV2` on the intended bucket and prefix, in addition to the existing object upload and delete operations. The repository does not expand credential permissions. Cloudflare documents bucket-scoped token permissions and S3-compatible listing in [R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/) and [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/). If listing is not permitted, reconciliation records the failure and scheduled cleanup reports an unhealthy run; grant the minimum compatible bucket-scoped permission through the approved credential process before activation.

The production schema, RPCs, grants, function deployment, cleanup secrets, and bucket-scoped delete/list permissions have not been independently verified by this change. Cleanup remains disabled until the operator checks are recorded and a separately authorized workflow change activates it. No live infrastructure is modified here. Production readiness also remains blocked on BE-14 actual-object metadata verification before attachment. Client compression is not an enforcement control.

Private-read signing is unresolved: Issues [#104](https://github.com/2ton-exe/moris-mix-ai/issues/104) and [#105](https://github.com/2ton-exe/moris-mix-ai/issues/105) require an agreed endpoint split and delivery contract, and BE-09 leaves delivery separate. No download route or GET signing capability is implemented in BE-13.

## BE-13 verification

Run focused offline tests using already available dependencies:

```powershell
deno test --cached-only --frozen-lockfile --node-modules-dir=manual --allow-env supabase/functions/tests/r2_signing_test.ts supabase/functions/tests/recipe_image_upload_url_test.ts supabase/functions/tests/recipe_image_upload_cleanup_test.ts supabase/functions/tests/recipe_image_schemas_test.ts
pnpm test:migrations
```

The signing tests use three fixed synthetic PUT vectors generated independently with Node's `createHash`/`createHmac`, plus a separate Node crypto verifier for mutations of the method, object, host, signed content type, credential scope, signing date, signed-header list, and expiry. Cleanup signing tests verify object scoping and method binding. Handler tests mock Supabase Auth, ownership, quota responses, cleanup RPCs, and R2 deletion while running local signing. Migration unit tests inspect privilege and concurrency declarations; the optional PostgreSQL lifecycle test exercises concurrent quota reservations, exclusive cleanup claims, state fences, and retry recovery. Live R2, deployed authentication/RLS, and production migration application remain unverified. No network permission is granted to ordinary tests.

Local verification results for the approved mitigation are reported with the implementation change; the PostgreSQL lifecycle suite remains opt-in and was not run unless a safe local database was available.

```powershell
$env:RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION = 'false'
deno test --cached-only --frozen-lockfile --node-modules-dir=manual --allow-env --allow-read=fixtures/demo-recipe.json supabase/functions/tests/demo_recipe_test.ts supabase/functions/tests/auth_test.ts supabase/functions/tests/recipes_test.ts supabase/functions/tests/ai_contracts_test.ts supabase/functions/tests/candidate_token_test.ts supabase/functions/tests/eval_dataset_test.ts supabase/functions/tests/cross_user_rls_lineage_test.ts supabase/functions/tests/recipe_image_schemas_test.ts supabase/functions/tests/gemini_adapter_test.ts supabase/functions/tests/extract_recipe_test.ts supabase/functions/tests/generate_recipe_test.ts supabase/functions/tests/recipe_context_test.ts supabase/functions/tests/r2_signing_test.ts supabase/functions/tests/recipe_image_upload_url_test.ts supabase/functions/tests/recipe_image_upload_cleanup_test.ts
```

The following checks passed for the listed TypeScript files, along with `git diff --check`:

```powershell
$be13Files = @('supabase/functions/_shared/recipe-images/r2.ts', 'supabase/functions/_shared/recipe-images/uploadIntents.ts', 'supabase/functions/_shared/recipe-images/uploadCleanup.ts', 'supabase/functions/recipe-image-upload-url/index.ts', 'supabase/functions/recipe-image-upload-cleanup/index.ts', 'supabase/functions/tests/r2_signing_test.ts', 'supabase/functions/tests/recipe_image_upload_url_test.ts', 'supabase/functions/tests/recipe_image_upload_cleanup_test.ts')
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
