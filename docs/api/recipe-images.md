# Recipe image upload API contract

This contract defines the authenticated request to authorize a Cloudflare R2 upload through a server-controlled ingress and the later request to verify and attach that upload to an owned recipe. BE-09 supplies the contract and shared validators. BE-13 implements bounded upload ingress, quota-controlled intent persistence, and expired staging-object cleanup. BE-14 implements attachment, private reads, and finalized-image deletion. Its migration and runtime behavior require independent verification.

Production readiness remains **BLOCKED** until BE-14 independently verifies R2 object size and content type before attachment and all required R2/Supabase configuration and migrations are deployed and verified. Production upload-signing deployment remains hard-disabled pending independent production readiness verification and authorization. The upload handler counts the actual request body before contacting R2, accepts no more than 10 MiB, and requires the count to match the stored intent. It then sends a payload-hash-bound, create-only R2 `PUT`; R2 atomically rejects a second write to an existing staging key. The handler rejects expired, consumed, attached, or cleanup-completed intents and compensates for an upload that becomes ineligible while R2 is processing it. Production behavior and R2 conditional-write compatibility have not been live-verified.

The bounded ingress implementation is shared with PR #190 and requires coordinated review before PR #188 is merged. Production signing and cleanup remain hard-disabled. BE-14 migration 20261107000016 must follow verified BE-13 migrations 09–15 through a separately authorized migration operation.

## Endpoint overview

| Method | Path | Operation | Success |
| --- | --- | --- | --- |
| `POST` | `/functions/v1/recipe-image-upload-url` | Authorize one short-lived image upload for an owned recipe | `200 OK`, `{ "upload": ... }` |
| `PUT` | `/functions/v1/recipe-image-upload-url?upload_id=<uuid>` | Upload raw bytes through authenticated, bounded server ingress | `201 Created`, `{ "upload": ... }` |
| `POST` | `/functions/v1/recipe-image-attach` | Verify an uploaded object and attach it to the recipe | `200 OK`, `{ "image": ... }` |
| `OPTIONS` | Either path | CORS preflight | `204 No Content` |

## Authentication and ownership

- The `POST` authorization request requires `Authorization: Bearer <supabase-access-token>`, the Supabase project `apikey`, and a JSON body. The `PUT` upload request requires the same authenticated user credentials and raw image bytes. The project key does not authenticate the user; the Bearer token is verified by the backend.
- The upload handler uses the shared `authenticateRequest()` boundary and derives ownership from its verified user context. The attach handler must do the same. Client-supplied `user_id` is never trusted.
- The upload authorization checks that `recipe_id` belongs to the authenticated user. The `PUT` handler rechecks that the upload intent belongs to the authenticated user and is still pending; the attach request checks ownership again. An upload does not authorize attachment by itself.
- Missing and foreign recipes have the same `404 RECIPE_NOT_FOUND` result. Never reveal whether another user’s recipe exists.
- `OPTIONS` is handled before authentication. The function entries in `supabase/config.toml` already set `verify_jwt = false` so unauthenticated preflight requests reach the handlers. This only disables gateway JWT validation; the upload handler calls `authenticateRequest()` for every `POST` and `PUT` before accessing user or storage data, and the attach handler must do the same. The Edge Function CORS policy allows `POST, PUT, OPTIONS` and `authorization`, `x-client-info`, `apikey`, and `content-type` headers for configured frontend origins.

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
- `byte_size` must be a positive integer no larger than 10 MiB. It is a declaration checked against the actual bytes received by the `PUT` handler; a mismatch is rejected before any R2 request. The handler also rejects a declared `Content-Length` that differs from the intent and counts streamed body chunks so missing or false length headers cannot bypass the limit. BE-13 limits each user to 10 upload authorizations per hour and 3 uncleared staging intents.
- Unknown fields are rejected. The caller cannot provide an owner ID, object key, `image_path`, or `image_url`.
- The authorization request accepts no query parameters. The returned upload URL contains only the server-issued `upload_id`; callers cannot select an object key, bucket, HTTP method, headers, or expiry.

### Success (`200 OK`)

Returns `Cache-Control: no-store` and a JSON `upload` object:

```json
{
  "upload": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "url": "https://<supabase-project>.supabase.co/functions/v1/recipe-image-upload-url?upload_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "method": "PUT",
    "headers": { "Content-Type": "image/jpeg" },
    "expires_at": "2026-10-26T10:10:00Z"
  }
}
```

The backend generates a fresh staging key and a distinct server-only final key, and binds both keys to the upload UUID, verified owner, recipe UUID, content type, declared size, and expiry. The returned URL points to the authenticated Supabase Edge Function, not to R2. The final key is never returned or exposed to client writes.

The browser sends the raw file bytes to `upload.url` using `PUT`, the returned `Content-Type`, and its authenticated Supabase request headers. It does not send JSON or multipart form data. The Edge Function buffers at most 10 MiB, checks the actual byte count against the intent, and only then forwards the payload to R2. The backend signs the actual SHA-256 payload and includes the R2 create-only `If-None-Match: *` condition. The R2 credentials, bucket endpoint, and object keys remain server-side; the URL is not an R2 bearer capability. Do not log the URL or show it in UI errors. Attachment never points `recipes.image_path` at the client-writable staging key.

The upload handler verifies the stored owner, pending state, cleanup state, content type, byte-size declaration, actual body length, and expiry before contacting R2. It refuses new uploads during the final 30 seconds before intent expiry, uses a bounded R2 request timeout, and checks the intent again after a successful write. A conditional R2 `PUT` allows at most one successful object creation for a key while that object exists; repeats return `409 UPLOAD_ALREADY_USED`. If cleanup or expiry wins during an in-flight write, the handler attempts a compensating deletion and the existing staging reconciliation remains the recovery path. This is defense against overwrite and replay at the application boundary; live R2 integration and timeout behavior still require non-production verification. Successful ingress returns `201 Created`; storage failures return sanitized `503 STORAGE_UNAVAILABLE` responses.

The upload URL uses the server-configured `RECIPE_IMAGE_UPLOAD_ORIGIN` when present. `SUPABASE_URL` remains the server-side API address. Set the public origin to `http://127.0.0.1:54321` for a local runtime using internal `http://kong:8000`. Invalid origin configuration fails before reserving an upload intent.

## Upload bytes

Send the raw image bytes to the returned URL with `PUT`, `Authorization: Bearer <supabase-access-token>`, the Supabase project `apikey`, and the exact `Content-Type` returned by the authorization response. Do not send JSON or multipart data. The request body must contain exactly the intent's `byte_size` bytes and may not exceed 10 MiB. `Content-Length` is checked when present; the server also counts streamed bytes when it is absent. Compressed request bodies and range requests are rejected.

Successful upload returns `201 Created` with `{ "upload": { "id": "<upload-id>", "received": true } }`. A repeated upload that finds an existing R2 object returns `409 UPLOAD_ALREADY_USED`. Expired or cleanup-completed intents return `410 UPLOAD_EXPIRED`. R2 failure returns `503 STORAGE_UNAVAILABLE`; a client may retry the same intent, but an ambiguous write that already reached R2 will be rejected as already used. Attachment remains the separate BE-14 operation.

## Verify and attach an upload

### Request

`POST /functions/v1/recipe-image-attach`

```json
{
  "recipe_id": "99999999-9999-9999-9999-999999999999",
  "upload_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

The backend resolves the staging and final namespace from the authenticated owner, recipe UUID, and upload intent. The request cannot provide an `object_key`, `image_path`, or `image_url`. The intent must belong to this owner and recipe. A pending intent may be claimed only before expiry; an already attached intent remains replayable after its upload URL expires and returns its stored result. A `finalizing` intent with a live lease returns `409 UPLOAD_NOT_READY`. A `finalizing` intent with an expired lease is reclaimable by a new attach request, which atomically replaces its attempt token and lease, even if the upload URL has since expired. The pointer commit requires the current token so the prior worker cannot commit. An expired pending or terminal intent returns `404 UPLOAD_NOT_FOUND`. Only the backend uses attempt-specific final keys during attachment.

Before associating the image, the backend verifies that the staging object exists and that its stored content type and streamed byte size match the upload intent and allowed limits. It checks JPEG start/frame/end markers, PNG chunk boundaries and CRCs including IHDR/IDAT/IEND, or WebP RIFF boundaries and image chunks. These structural checks reject common malformed or truncated inputs but do not decode pixels or prove that every supported image is safe to render. No full decoder is available within the current dependency/runtime constraints. Clients should rely on normal browser image decoding and safe image elements; SVG and script-capable formats are not accepted.

Before accessing R2, a database transaction claims an unexpired `pending` intent by changing it to `finalizing` and assigning a unique attempt token and lease. A live lease returns `409 UPLOAD_NOT_READY`; an expired pending or terminal intent returns `404 UPLOAD_NOT_FOUND`. A lease-expired `finalizing` intent can be reclaimed by atomically replacing its attempt token and lease so an earlier worker cannot commit.

After claiming the intent, persist its attempt-specific final key and mark the copy as started before issuing the copy with a source-match condition on the staging object's verified ETag. If the staging object changed, the conditional copy fails; do not attach it unless the current object is revalidated. Verify the finalized object's stored content type and byte size. Each attempt writes to a different key, so a delayed copy from an expired attempt cannot overwrite the winning attempt's object. The database commit requires the current attempt token and verified attempt record. The client has no signed write capability for final keys, so reuse of the staging URL cannot change an attached image.

Different upload intents for the same recipe may finalize concurrently, but their pointer swaps serialize on the recipe row. In one database transaction, update the recipe image path only if the intent is still `finalizing` with the same attempt token and the attempt is verified, mark both records attached, and record the previous final key for retryable cleanup. If that state fence fails, leave the recipe path unchanged. Delete only the recorded previous key after commit; never derive it from an earlier unlocked read. If finalization fails, return the intent to `pending` only while the same token owns it and it remains unexpired; otherwise leave it for lease recovery. Replaying a completed upload returns its stored result without another copy or pointer change. Clean up staging objects after the URL expires; deleting one earlier does not revoke the signed URL, which can recreate it until expiry.

Expired-intent cleanup transactionally changes an expired `pending` intent to terminal `expired` before deleting its staging object. It skips non-pending states. BE-13 owns this staging cleanup path and retains its existing state fence. BE-14 recovers expired finalization leases using attempt records; it does not assume a local timeout or aborted request cancels an R2 copy.

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

The response contains no standalone object key or URL. The temporary `PUT` URL is never stored in `recipes.image_url`; the finalized server-only object key is stored in the internal `recipes.image_path` field after verification and copy.

## Request a private image download URL

`POST /functions/v1/recipe-image-download-url` accepts `{ "recipe_id": "<uuid>" }`. The authenticated caller must own the recipe. The server reads `recipes.image_path` internally and signs only a valid `recipe-images/final/` key; callers cannot select object keys. A recipe with no finalized image returns `404 IMAGE_NOT_FOUND`.

The `200 OK` JSON response contains a presigned R2 `GET` URL and `expires_at`. It has `Cache-Control: no-store`; the URL expires after 60 seconds and pins the verified `Content-Type` and a generic inline filename in its signed response overrides. BE-14 owns private GET signing. An issued URL is a temporary bearer capability and remains usable until expiry, subject to the object still existing. Clearing or replacing the association does not revoke an issued URL. Signed URLs are never logged or included in recipe responses.

## Delete a recipe image

`POST /functions/v1/recipe-image-delete` accepts `{ "recipe_id": "<uuid>" }`. Only the recipe owner may delete its image. The transaction locks the recipe, clears `image_path`, and records the former final key in a durable cleanup queue. Deleting an already-empty association on an existing owned recipe is idempotent and returns `204 No Content`. A missing or foreign recipe returns `404 RECIPE_NOT_FOUND`. R2 deletion occurs after the transaction and cannot roll back the database change.

Deleting a recipe through the existing `DELETE /recipes/:id` endpoint also records its current finalized key through a database delete trigger. The cleanup queue has no cascading recipe or user foreign key, so recipe and account deletion cannot erase the only cleanup record.

## Finalized-object cleanup

Replacement, explicit image deletion, and recipe deletion enqueue server-generated attempt keys in a separate BE-14 queue. Every copy attempt has a durable cleanup record before copy starts. A completed, non-ambiguous output uses bounded retries (up to eight attempts with exponential delay capped at one hour); terminal failures remain recorded for investigation. If a copy may still complete after its request ends, its cleanup record stays in `watching`: bounded batches retry at hourly intervals indefinitely, even when a delete reports the object missing. This avoids treating a local timeout or one successful delete as proof that no late object can appear. No broad final-prefix listing is used. Each claim checks that the key is not currently referenced by a recipe; direct browser writes to `image_path` are rejected by a database trigger. Cleanup cannot roll back an image association change.

The BE-14 cleanup function uses a separate bearer token, `RECIPE_IMAGE_FINAL_CLEANUP_TOKEN` (at least 32 characters), and is not scheduled or deployed by the BE-13 production workflows. Production cleanup remains disabled pending a separately reviewed activation change. Deterministic recovery uses persisted per-attempt keys and cleanup records; broad final-prefix reconciliation is not included. Deleting an upload intent also abandons and records any unfinished attempts before cascades can remove the intent lease used by recovery.

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
| `404 Not Found` | `UPLOAD_NOT_FOUND` | `Upload not found.` | Upload intent is unknown or belongs to another owner. |
| `409 Conflict` | `UPLOAD_ALREADY_USED` | `Upload has already been received.` | R2 create-only condition found a staging object for this intent; an upload cannot replace it. |
| `410 Gone` | `UPLOAD_EXPIRED` | `Upload is no longer available.` | The intent is expired, no longer pending, or cleanup has completed. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only POST, PUT and OPTIONS methods are supported.` | Unsupported method on the upload endpoint. Includes `Allow: POST, PUT, OPTIONS`. |
| `409 Conflict` | `UPLOAD_NOT_READY` | `Uploaded image is not ready for attachment.` | The staging object is absent or changed, or another request currently owns the intent's finalizing lease; retry later. |
| `422 Unprocessable Content` | `INVALID_IMAGE` | `Uploaded image metadata is invalid.` | Actual object type or size does not match the intent and contract. |
| `503 Service Unavailable` | `AUTH_SERVICE_RATE_LIMITED` | `Authentication service is temporarily unavailable. Please try again later.` | Supabase Auth returns `429 Too Many Requests` during token verification. A validated `Retry-After` header is propagated when supplied; invalid or absent values are omitted. |
| `503 Service Unavailable` | `STORAGE_UNAVAILABLE` | `Image storage is temporarily unavailable.` | R2 is temporarily unreachable. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Other unexpected configuration, database, or storage failure. |

Attach, download, and delete handlers also return `405 METHOD_NOT_ALLOWED` for unsupported methods with `Allow: POST, OPTIONS`.

## CORS

- The Edge Function handles unauthenticated `OPTIONS` requests before calling `authenticateRequest()`. It allows `POST, PUT, OPTIONS` and the headers listed in Authentication and ownership.
- Browser uploads now target Supabase Edge Function ingress, so R2 bucket CORS is not part of the upload request. Edge Function CORS must allow only the deployed frontend origin in production. CORS is not authentication; the handler verifies the user's bearer token and upload intent.
- A failed or expired upload does not authorize attachment. A second write to a successfully created staging key returns `409`; the client must start a new intent instead of retrying that upload ID.

## Storage and recipe association

- One primary image is supported per recipe, matching the current recipe model. The stable recipe UUID, verified owner ID, and random upload UUID scope distinct staging and final keys; titles and filenames do not define storage identity.
- The implementation stores only the finalized key internally in `recipes.image_path`. It never stores the temporary `PUT` URL in `recipes.image_url` or returns a storage path as image metadata.
- The implementation binds each upload UUID server-side to its owner, recipe, staging key, final key, content type, declared size, expiry, state (`pending`, `finalizing`, `attached`, or terminal `expired`), and, while finalizing, an attempt token and lease. It uses the request-scoped RLS-aware Supabase client, not a service-role client, for user-owned recipe operations.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:bb8ad3b178b62e51aa7b49baaa1b75763023fe2031c50f77a10a4447175fa04e -->

- BE-13 cleanup claims expired `pending` and `attached` intents transactionally, marks pending intents terminal `expired`, and preserves the attached state and replay result while deleting staging objects. Attached intents use the same cleanup retries and health reporting; successful deletion releases their outstanding-upload quota. It skips `finalizing` intents and all unexpired intents. Attached records are retained for replay. R2 deletion failures are retained with exponential backoff capped at one hour and eight attempts; terminal failures remain recorded and make scheduled runs fail until investigated. Delete the prior attached final key captured by the serialized recipe update; do not infer it from an earlier, unlocked read. BE-14 remains responsible for actual size and content-type verification before attachment, finalized-object lifecycle, and finalization lease recovery.

<!-- /coderabbit-ai-generated:v1 -->

## BE-13 implementation and deployment dependencies

The upload function checks `recipes` through the verified user's request-scoped client, selecting only `id, user_id` and filtering both fields. It never updates the recipe image. After validation and ownership authorization, it generates the upload UUID, staging key, and a final key with a separate random UUID. It signs locally, atomically applies the per-user quotas and inserts the pending intent, then returns the capability only after persistence succeeds. Persistence failures return no capability.

`public.recipe_image_upload_intents` stores the upload UUID, owner and recipe UUIDs, both keys, content type, declared size, signing time, expiry, state, cleanup attempts, lease, and safe failure category. It has RLS enabled and forced, no browser policies, and all table privileges revoked from `PUBLIC`, `anon`, and `authenticated`. The backend service role can select rows and execute narrowly scoped security-definer RPCs for quota-controlled creation and cleanup; it cannot insert or update rows directly. It is never used for recipe ownership queries. SQL constraints validate types, declared sizes, key scoping, the ten-minute lifetime, and cleanup-state consistency. Records deliberately have no cascading recipe/user foreign keys: deleting a recipe or account must not erase the only record of uncollected R2 objects or change existing recipe deletion behavior. BE-14 reauthorizes attachment and extends the lifecycle state machine with finalization leases in migration 20261107000016 and its handlers.

Required backend configuration:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Existing Supabase project endpoint |
| `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | Existing public project key used with the verified user's token |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only credential for protected intent persistence |
| `R2_ACCOUNT_ID` | Cloudflare account ID used to derive the canonical R2 S3 endpoint |
| `R2_BUCKET_NAME` | Private recipe-image R2 bucket name |
| `R2_ACCESS_KEY_ID` | Protected S3 access-key identifier for the recipe-image bucket |
| `R2_SECRET_ACCESS_KEY` | Secret S3 signing key for the recipe-image bucket |
| `ALLOWED_ORIGIN` | Deployed frontend origin for the existing Edge Function CORS helper |
| `RECIPE_IMAGE_FINAL_CLEANUP_TOKEN` | Separate Supabase runtime bearer secret, at least 32 characters, required for BE-14 final-object cleanup |
| `RECIPE_IMAGE_UPLOAD_ORIGIN` | Browser-reachable Supabase API origin such as `https://<project-ref>.supabase.co` or `http://127.0.0.1:54321`. Required for local/self-hosted runtimes whose `SUPABASE_URL` is internal. No path, credentials, query, or fragment. Defaults to `SUPABASE_URL` for hosted deployments. |
| `RECIPE_IMAGE_CLEANUP_TOKEN` | Dedicated server-only bearer token for scheduled cleanup invocation |

Use the existing `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` settings in the Supabase Edge Function runtime. Do not add R2 values to frontend settings or GitHub Actions. The account ID must be exactly 32 lowercase hexadecimal characters; the signer derives `https://<account-id>.r2.cloudflarestorage.com` and rejects invalid account IDs. The bucket name and account ID are non-secret configuration; the access-key ID and secret must remain server-side. Supabase runtime values are project-level and available to deployed Edge Functions, not isolated per function. Keep public bucket access disabled and use a key restricted to the intended image bucket. Upload ingress requires the R2 `PutObject` operation including `If-None-Match: *`; cleanup, while still disabled, also needs staging-object deletion and prefix-scoped listing. Browser upload traffic goes through the Edge Function, so R2 bucket CORS is not required for uploads. Configure the Edge Function CORS origin to the approved frontend only.

The signer does not read `R2_IMAGE_*` aliases or `R2_BACKUP_*` settings, and it has no fallback to another credential set. The backup workflow continues to use its separate `R2_BACKUP_*` secrets and bucket.

Production cleanup deployment and invocation are explicitly disabled in the production workflows. This prevents the Edge Function from being deployed by the production release or called by its schedule before production prerequisites have been independently checked. GitHub Actions variables cannot enable either path; the workflow conditions are hard-disabled. The function remains available for non-production use.

Modular Main has a separate, manual migration-only operation for the seven image-upload migrations `20261102000009` through `20261106000015`. An authorized operator must dispatch the workflow from `main`, set `apply-image-migrations` to `true`, provide a successful Stage B restore-drill run from `main` completed within the previous 24 hours, and receive approval from the protected GitHub Environment `recipe-image-upload-production`. The job validates the production project reference and required database credentials, rejects a stale revision, checks that exactly the seven approved migrations are pending or already applied, previews pending changes, applies them, and verifies migration history afterward. It does not deploy any Edge Function; selecting migration-only also skips the regular production release job for that dispatch. Missing credentials, restore evidence, partial or unexpected migration state, migration failure, or stale source revision stops the operation. This checkout does not contain the required Stage B workflow, so the restore-evidence gate remains unsatisfied until that approved workflow is available on `main` and a successful run is recorded. The regular production push and release behavior are unchanged. The staging workflow deploys only the Cloudflare Worker and does not deploy Supabase Edge Functions.

The migration-only job reads `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` as secrets from the protected GitHub Environment, and `SUPABASE_PROJECT_REF` as an Environment variable. The separate upload-signing readiness verifier is not run by this migration-only operation. Its future activation prerequisites include `SUPABASE_DATABASE_URL`, `SUPABASE_DATABASE_CA_CERT`, `SUPABASE_SERVICE_ROLE_KEY`, and `UPLOAD_SIGNING_READINESS_ATTESTATION=verified` as Environment secrets, plus `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`, and `PRODUCTION_FRONTEND_URL` as variables. The database URL must use either `postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres` or the Supabase session-pooler form `postgresql://postgres.<project-ref>:<password>@aws-<number>-<region>.pooler.supabase.com:5432/postgres`. The password must be URL-encoded. Only the configured project's direct hostname or a session-pooler hostname, port `5432`, database path `/postgres`, and optional `sslmode=require`, `verify-ca`, or `verify-full` query parameter are accepted. The separate CA certificate must come from the intended production project's Database Settings. The readiness connection uses strict TLS certificate and hostname verification.

The readiness script independently checks database migration history for `20261102000009` and `20261102000010`, the intended project reference, upload-intent table columns, forced RLS, browser-role denials, service-role table privileges, and the `public.create_recipe_image_upload_intent` security-definer RPC and grants. It validates the public and service-role Supabase keys, then performs read-only database catalog queries and fails before deployment on missing or mismatched state. It does not receive, validate, or synchronize any R2 runtime value.

GitHub Actions cannot verify the R2 values stored in Supabase. Before any future signing activation, an authorized operator must independently confirm that all four existing R2 runtime settings are configured for the intended project, the account ID, derived endpoint, and bucket match, the bucket is private, and the key is scoped to that bucket with `PutObject` using conditional writes plus the cleanup delete/list operations if cleanup is separately enabled. The access key ID and secret are not sent to the GitHub job. The signer deployment job and its step both remain hard-disabled; migration-only approval does not authorize signing deployment. Non-empty settings and successful CI do not prove correct credentials or production readiness. Invalidate any readiness attestation if the verified configuration changes or becomes uncertain.

Rotate the R2 key by creating a replacement key scoped to the same bucket and updating `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` together in the Supabase Edge Function runtime. Since the Edge Function now performs the R2 `PUT`, an authorized operator must validate the replacement using a controlled upload through the Edge Function and confirm that R2 stored the disposable staging object before revoking the previous key. An authorization response alone does not contact R2 and cannot prove that the replacement credentials work. Do not perform a production upload while production signing remains hard-disabled or without explicit authorization. Do not add a fallback to the old key. Keep the old key valid until any in-flight upload and cleanup requests have finished, then revoke it.

The signer quota permits at most three uncleared intents per user. Migration `20261102000010_recipe_image_upload_lifecycle.sql` counts `pending`, `finalizing`, `attached`, and `expired` intents while `cleanup_status <> 'complete'`. Because cleanup deployment and invocation are both hard-disabled, an expired intent does not release quota merely when its URL expires; successful cleanup must mark it complete. Enabling signing before operational cleanup or a separately verified safe quota-release design could block users after three uncleared intents. Signing deployment does not enable cleanup.

Production signing remains hard-disabled in both the deployment job and deployment step. The Edge Function now enforces actual request-body size before R2 ingress and R2 create-only writes prevent overwriting an existing staging key. A separate production review and non-production live R2 verification remain required before signing can be authorized. Cleanup remains disabled, so expired intents can continue consuming the three-intent quota until successful cleanup marks them complete; cleanup readiness and quota recovery must be verified before any signing rollout. Applying migrations does not deploy or activate signing. Verifying migrations or R2 configuration alone does not authorize production deployment.

Production cleanup deployment and invocation remain disabled through hard-coded `if: false` workflow conditions. No GitHub Actions variable can activate either path. A separately authorized change must follow independent production verification before changing these conditions.

Before any future activation, an authorized operator must verify migrations `20261102000009` through `20261102000014` and `20261106000015_recipe_image_attached_staging_cleanup.sql` in the intended production project. Verify all cleanup and reconciliation RPCs introduced or updated by those migrations, including `public.claim_expired_recipe_image_uploads`, `public.finish_recipe_image_upload_cleanup`, `public.recipe_image_upload_cleanup_health`, and `public.claim_recipe_image_staging_reconciliation_objects`. Migration 15 is required so expired attached intents become eligible for staging cleanup while preserving attached state and replay information, successful cleanup releases the corresponding upload quota, finalized objects remain protected, and staging objects are not deleted while their upload URLs remain valid. Independently verify grants/RLS deny browser-role access while granting only required `service_role` privileges. Confirm project identity and check the deployed function configuration, server-only cleanup token, and bucket-scoped R2 delete and `ListObjectsV2` permissions. Production cleanup must not be activated unless migration 15 and its RPC behavior have been independently verified in the intended production Supabase project. The manual migration-only operation is proposed in dependency PR #190 and requires separate review and authorization before use; repository migration files and CI results do not prove production readiness.

After those checks are recorded, a separately reviewed workflow change may authorize deployment and invocation. Provision `RECIPE_IMAGE_CLEANUP_TOKEN` as a Supabase Edge Function secret and protected GitHub Actions secret. The cleanup function processes at most 40 deletions per invocation: up to 25 expired-intent objects plus 15 staging-reconciliation objects, with up to 5 concurrent deletes; failures retry with exponential delay capped at one hour for at most eight attempts. To disable cleanup, restore `if: false` on both production workflow paths. The current production schema, RPCs, grants, function deployment, cleanup secrets, and R2 permissions have not been independently verified. No production readiness is claimed.



Each scheduled cleanup invocation also scans one page of `recipe-images/staging/` using the S3-compatible `ListObjectsV2` operation with a 25-object maximum. Its opaque continuation token and scan lease are stored in the database. After reaching the end, the next invocation starts a new full scan. This repeated scan is required because an already-started PUT can finish after a DELETE; a later listing can rediscover that staging key and enqueue deletion again. <!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:7a7bccdc4a08a4a68b0633f82a026b2736b8e4bb2999b9d3d0c2d8b4f95170d6 -->

Reconciliation deletes only staging keys that have no upload intent or whose intent is `expired` or `attached`, whose URL has expired, and whose intent cleanup is complete. It excludes pending and finalizing intents, and attached intents before URL expiry or cleanup completion.

<!-- /coderabbit-ai-generated:v1 --> It claims at most 15 outstanding object deletions per invocation, oldest tasks first, so queued work from earlier pages is drained while the cursor advances. Per-key claims, leases, bounded retries, terminal failure reporting, and 30-day retention are stored separately from upload intents. Completed reconciliation records and terminal failures are retained for 30 days; a still-present object discovered after its failure record is pruned is retried as a new task. Final image keys are rejected by both listing-key validation and the deletion signer.

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
- Cloudflare R2 documentation: [S3 conditional operations](https://developers.cloudflare.com/r2/api/s3/extensions/), [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/), and [bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/).
