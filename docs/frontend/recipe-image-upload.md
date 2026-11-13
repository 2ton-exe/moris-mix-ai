# FE-12 private recipe-image upload integration

**Status** — BE-13 backend contract approved by Ramos on 2026-11-08 in [#104](https://github.com/2ton-exe/moris-mix-ai/issues/104#issuecomment-6721071406). The FE-12 author has approved this revised upload contract. This is API-contract approval only; it does not authorize production deployment or cleanup.

## Upload requirements

The browser requests an upload intent for an owned, saved recipe through authenticated `POST /functions/v1/recipe-image-upload-url`. Send the selected file's actual byte size and supported MIME type using the [backend API contract](../api/recipe-images.md). The file must be JPEG, PNG, or WebP and at most 10 MiB. If an approved client conversion policy is used, complete conversion before declaring size and type, then upload those exact bytes.

Use the returned `upload.url` and its declared method and content type. Send the raw file bytes with `PUT`, the signed-in user's Bearer token, and the Supabase project API key. The proposed upload destination is the authenticated Edge Function. All R2 signing and storage requests occur on the backend. The URL expires after ten minutes and the server stops admitting uploads during its final 30 seconds.

## Results and retry requirements

- Show pending state until the upload request completes.
- On `201`, retain the returned upload ID and proceed through the separately approved BE-14 verification and attachment contract.
- On `409 UPLOAD_ALREADY_USED`, stop resending bytes. An object already exists for that intent. Recover through the approved verification/attachment flow, which must validate that object before showing it as the saved recipe image.
- On `409 UPLOAD_IN_PROGRESS`, stop concurrent sends and wait for the active request. A crashed request can retain its reservation until expiry. Request a new intent only after quota permits.
- On `410 UPLOAD_EXPIRED`, stop using the expired intent. Request another only if the backend quota permits.
- On an ambiguous network failure or `503 STORAGE_UNAVAILABLE`, allow a bounded user-controlled retry of the same eligible intent. The backend permits a retry only after confirming the staging object is missing. If the previous write succeeded, recovery returns `409`.
- On validation or authorization failure, show the safe API error and require correction or authentication before retry.
- Preserve the current recipe image until verification and attachment succeed. A successful upload alone does not update recipe metadata.

## Acceptance and rollout evidence

The FE-12 author approved authenticated raw-byte requests, supported MIME types, actual size limits, expiry, duplicate responses, ambiguous retries, and preservation of the existing image on failure. Browser integration and live R2 behavior still require independent verification.

This specification replaces the original direct browser-to-R2 presigned PUT requirement with the approved shared contract. BE-13 approval is recorded in [#104](https://github.com/2ton-exe/moris-mix-ai/issues/104#issuecomment-6721071406), and FE-12 author acceptance has been received. These approvals cover the API contract only. Production signing and cleanup remain hard-disabled pending independent readiness verification and separate authorization. See the [API contract and production prerequisites](../api/recipe-images.md#approved-upload-contract-and-migration-ownership-decisions).
