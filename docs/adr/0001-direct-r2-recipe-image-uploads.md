# ADR-0001: Direct presigned uploads for recipe images

**Status:** Accepted for implementation; production deployment remains blocked
**Date:** 2026-11-15

## Context

PR #190 replaced the original direct browser-to-R2 upload with an authenticated
Edge Function proxy. That transport counted and bounded the request body, but
the browser contract became incompatible with R2 presigned object URLs: the
client required the Edge Function path, attached Supabase credentials, and
expected a JSON `201` response. The current upload requirement calls for the
browser to send image bytes directly to R2 using the returned signed headers.

Recipe create and update already enforce a 256 KiB streamed JSON-body limit
before parsing and use schemas that cap text fields and collection sizes. Those
guards remain unchanged.

## Decision

- Keep upload authorization, recipe ownership checks, intent persistence, and
  per-user quotas in the authenticated Edge Function.
- Return a ten-minute presigned R2 `PUT` URL for the intent's staging object.
  Bind the method, object path, declared `Content-Length`, `Content-Type`, and
  `If-None-Match: *` condition into its SigV4 signature.
- Validate the returned URL in the browser against the Cloudflare R2 host and
  the current owner, recipe, and upload IDs before sending bytes.
- Send the prepared image `Blob` directly to R2 with the returned
  `Content-Type` and `If-None-Match` headers. Send no Supabase Bearer token or
  project API key. Fetch derives `Content-Length` from the Blob; that value
  must match the signed intent size.
- Treat R2 `200 OK` as a successful write. Treat `412 Precondition Failed` as
  a possible successful earlier attempt and let the authenticated attachment
  operation verify the stored object before association.
- Keep the bucket private and configure R2 CORS for the frontend origin, `PUT`,
  `Content-Type`, and `If-None-Match`. The previous proxy URL handler remains
  available for already-issued in-flight URLs during rollout.

## Consequences

- The browser upload no longer traverses Supabase Auth or the Edge Function for
  image bytes. The presigned URL is a short-lived bearer capability and must
  not be logged or shown in UI errors. Its SigV4 credential scope includes the
  non-secret R2 access-key ID; the secret signing key stays server-side.
- Attachment remains the trust boundary for actual object size, MIME type, and
  image structure. The signature binds the request's content length to the
  authorized 10 MiB maximum, and attachment independently checks R2 metadata
  and bytes.
- R2 bucket CORS and direct signed PUT behavior are not verified against live
  storage. Production upload signing remains hard-disabled until an operator
  verifies the bucket configuration and performs the required non-production
  upload checks.
- The authenticated-proxy transport accepted for PR #190 remains historical;
  its approval does not cover this direct-upload revision or authorize
  production deployment.

## References

- [Recipe image API contract](../api/recipe-images.md)
- [Frontend upload integration](../frontend/recipe-image-upload.md)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [AWS S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
