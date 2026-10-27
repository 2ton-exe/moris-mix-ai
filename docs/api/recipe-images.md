# Recipe image upload API contract

This contract defines the authenticated request to authorize a direct Cloudflare R2 upload and the later request to verify and attach that upload to an owned recipe. BE-09 adds the contract and shared validators only; the production endpoints are future work.

## Endpoint overview

| Method | Path | Operation | Success |
| --- | --- | --- | --- |
| `POST` | `/functions/v1/recipe-image-upload-url` | Authorize one short-lived image upload for an owned recipe | `200 OK`, `{ "upload": ... }` |
| `POST` | `/functions/v1/recipe-image-attach` | Verify an uploaded object and attach it to the recipe | `200 OK`, `{ "image": ... }` |
| `OPTIONS` | Either path | CORS preflight | `204 No Content` |

## Authentication and ownership

- Both `POST` requests require `Authorization: Bearer <supabase-access-token>`, the Supabase project `apikey`, and a JSON body. The project key does not authenticate the user; the Bearer token is verified by the backend.
- The future handler must use the shared `authenticateRequest()` boundary and derive ownership from its verified user context. Client-supplied `user_id` is never trusted.
- The upload-signing request checks that `recipe_id` belongs to the authenticated user before authorizing a `PUT`. The attach request checks ownership again; signing does not authorize attachment by itself.
- Missing and foreign recipes have the same `404 RECIPE_NOT_FOUND` result. Never reveal whether another user’s recipe exists.
- `OPTIONS` is handled before authentication. The future function entries in `supabase/config.toml` must set `verify_jwt = false` so unauthenticated preflight requests reach the handlers. This only disables gateway JWT validation; each handler still calls `authenticateRequest()` for every `POST` before accessing user or storage data. The Edge Function CORS policy allows `POST, OPTIONS` and `authorization`, `x-client-info`, `apikey`, and `content-type` headers for configured frontend origins.

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

The browser uploads the raw file bytes directly to `upload.url`; it does not send JSON or multipart form data to R2. A presigned URL is a temporary bearer capability: anyone who obtains it can reuse it until it expires. Attachment therefore never points `recipes.image_path` at the client-writable staging key. Do not log the URL, show it in UI errors, or treat it as a permanent image URL. The R2 access key ID and secret access key remain server-side.

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

## References

- The authenticated recipe REST contract defines recipe UUIDs, owner checks, safe error handling, and the internal/private distinction for `image_path` and `image_url`.
- The authenticated session contract defines Bearer verification and the RLS-aware request-scoped client.
- Cloudflare R2 documentation: [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/), [S3 `CopyObject` support and conditions](https://developers.cloudflare.com/r2/api/s3/extensions/), and [AWS SDK v3 `Content-Type` signing](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
