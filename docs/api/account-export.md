# Owned recipe data export draft

`GET /functions/v1/account-export` requires a Supabase Bearer access token and the existing public project API key. The shared authentication boundary verifies the caller. Every query uses that caller's RLS-scoped client. Query parameters are rejected.

The downloadable JSON contains `version`, `exported_at`, owned `recipes`, and `lineage` connecting exported recipes. Recipe content, notes, ratings, and timestamps are included. Stored image keys, signed URLs, image binaries, authentication data, and internal quota records are excluded. Responses use `Cache-Control: no-store`.

Queries paginate in stable ID order with 100 rows per request. Each table is limited to 10,000 rows and the response is limited to 10 MiB. Exceeding a limit returns `413 EXPORT_TOO_LARGE` without a partial download. Database failures return `503 EXPORT_UNAVAILABLE` without database details. Concurrent edits can affect the paginated result. This draft does not provide a transactionally consistent snapshot.

## Remaining acceptance work

Issue #108 explicitly remains a draft while P0 work and FS-05 cleanup are unfinished. Account deletion is pending a reviewed design covering authentication revocation, related records, staging and final objects, cleanup retries, and recovery after partial failure. This draft exposes no account-deletion operation. It adds no deployment job or production migration.

Before approval, validate export ownership and pagination against a dedicated non-production database, review export limits and snapshot expectations, and complete the account-deletion acceptance criteria or explicitly approve export-only scope. Issue #108 must remain open for the incomplete scope.
