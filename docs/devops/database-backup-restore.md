# Database Backup and Restore

This document tracks the DEVOPS-10 recovery path for Mori's Mix. It describes what the backup automation is intended to protect, what it does **not** protect, and what evidence is still required before the project can claim that database recovery is proven.

Related issue: #159.

## Evidence state

As of 2026-11-02:

- A dedicated private Cloudflare R2 bucket, `moris-mix-db-backups-prod`, is configured.
- A bucket-scoped R2 Account API token is configured with Object Read & Write access only to that bucket.
- The GitHub Environment `production-backup` contains the R2 backup credentials and bucket variable.
- The production Supabase organization is on the Free plan, so provider-managed daily-backup retention and PITR are not established as the project's recovery path.
- `.github/workflows/database-backup.yml` configures a main-only manual and weekly logical-backup job.
- The backup job shares the production release concurrency group so repository-managed production deployment/migration work cannot execute at the same time as a backup capture.
- The backup fails before upload if a pre/post comparison detects changes to role definitions, application schema, or the `supabase_migrations` ledger during the dump window.
- R2 verification re-downloads the uploaded archive and compares SHA-256, in addition to checking object size.
- **No successful backup run is claimed until a merged-main/manual workflow run actually creates, uploads, re-downloads, and verifies a private R2 object.**
- **No restore capability is claimed until a selected backup is restored and verified in an isolated safe target.**

## Production release gate

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f80187d8135bf05d16d5ace4c98f7f68b0a0738e6800926e5c30c2ddbb5d6f2d -->

The reusable production workflow fails the release explicitly unless the repository
variable `PRODUCTION_MIGRATION_RECOVERY_VERIFIED` is set to `true`. Leave it
unset until issue #155 records the recovery readiness decision and issue #159
records a successful private-backup round-trip and isolated restore drill,
including observed recovery exclusions. PR CI does not set this repository
variable or execute the production migration path.

<!-- /coderabbit-ai-generated:v1 -->

## Backup trigger and ownership

The workflow supports:

- manual `workflow_dispatch`, used for the first controlled backup and later operator checks;
- weekly schedule at Sunday 18:00 UTC / Monday 02:00 PHT.

The backup job has a source-controlled `github.ref == 'refs/heads/main'` guard, so a manual run selected from another ref does not receive or use the production-backup job path. The job also runs through the `production-backup` GitHub Environment and has repository `contents: read` permission only.

The backup uses the same `cloudflare-production` concurrency group as the existing production release job. This intentionally serializes backup capture with the repository-managed production deployment path. If production database migrations are added to that release job, they inherit the same serialization boundary without creating a second migration/backup lock.

GitHub Environment deployment-branch restrictions are a separate live repository setting. The source-controlled main guard is present in the workflow; the Environment restriction should also be checked by the operator before the first production backup. Do not claim that live Environment policy as independently verified unless it is actually inspected.

DevOps owns the schedule, workflow, secret/environment integration, R2 storage boundary, evidence, and restore drill. Backend owns production schema/data semantics. Restore acceptance that depends on application schema behavior should be reviewed with the backend owner rather than changing database behavior solely to make the recovery test pass.

## Credentials and configuration

Do not place values in source, issues, PR bodies, screenshots, logs, or this document.

Repository-level production Supabase configuration used by the backup job:

- secret `SUPABASE_ACCESS_TOKEN`
- secret `SUPABASE_DB_PASSWORD`
- variable `SUPABASE_PROJECT_REF`

The production migration path may also require `SUPABASE_DB_ROOT_CERT`. DEVOPS-10 does not create a second database password or a duplicate database URL. The backup workflow uses the repository's pinned Supabase CLI and its linked-project connection path rather than hard-coding a database connection string.

`production-backup` Environment configuration:

- secret `R2_BACKUP_ACCESS_KEY_ID`
- secret `R2_BACKUP_SECRET_ACCESS_KEY`
- secret `R2_BACKUP_ENDPOINT`
- variable `R2_BACKUP_BUCKET=moris-mix-db-backups-prod`

The R2 credentials are separate from recipe-image R2 credentials and are scoped to the database-backup bucket.

Sensitive values are injected only into the individual steps that need them. Checkout and CLI setup do not receive production database or R2 credentials. Supabase credentials are limited to configuration/link/dump steps; R2 credentials are limited to configuration/upload/verification steps.

## Backup contents and consistency gate

The workflow uses Supabase CLI `db dump`, which runs PostgreSQL dump tooling with Supabase-specific filtering. Supabase's supported logical-backup procedure uses separate role, schema, and data dumps rather than one all-inclusive CLI dump. Because separate PostgreSQL dump invocations do not share a synchronized snapshot automatically, the workflow does not treat command success alone as proof of a coherent bundle.

The bundle contains:

- `roles.sql` — CLI-filtered custom-role dump;
- `schema.sql` — CLI-filtered application schema dump;
- `data.sql` — CLI-filtered logical data dump using COPY format;
- `history-schema.sql` — `supabase_migrations` schema needed to preserve migration history;
- `history-data.sql` — `supabase_migrations` data;
- `component-checksums.sha256`;
- `backup-metadata.json` with source revision/project/timestamp/scope and the consistency-gate result.

During capture, the workflow:

1. holds the same repository concurrency lock used by the production release job;
2. captures roles, schema, migration history, and the logical data dump;
3. re-dumps roles, schema, and migration history after the data dump;
4. compares normalized pre/post outputs, ignoring only PostgreSQL's generated `\restrict`/`\unrestrict` guard-key lines so random per-dump keys do not create false drift;
5. refuses to package or upload the archive if any compared component changed.

This is a fail-closed drift check around Supabase's supported multi-file backup flow. It prevents a detected production migration or out-of-band DDL/role change from silently producing an accepted bundle. It is not described as PostgreSQL `--snapshot` synchronization across the separate CLI commands.

The resulting archive is uploaded to a date- and revision-qualified R2 key. A separate JSON evidence object records the archive size and SHA-256 checksum without containing database rows or credentials.

After upload, the workflow checks the remote object size, downloads the archive back from private R2, recomputes SHA-256, and requires it to match the locally created archive. The evidence JSON object's existence is also checked.

Production SQL dumps and the archive are **not** uploaded as normal GitHub Actions artifacts.

## Recovery boundary and known exclusions

This is a **PostgreSQL logical backup**, not a complete snapshot of every Supabase/Cloudflare resource.

Until the first dump and restore drill prove otherwise, do not claim full recovery of Supabase-managed schemas such as `auth` or `storage`. Supabase CLI applies special filtering to managed/internal schemas, and current Supabase documentation has different backup/migration flows depending on the restore target. The first recovery drill must record exactly what is restored rather than assuming coverage from configuration alone.

The database backup does not independently recover:

- Supabase Storage object bytes;
- Cloudflare R2 recipe-image objects;
- deployed Edge Functions;
- JWT/API keys and provider secrets;
- Auth provider configuration;
- SMTP/email configuration;
- Cloudflare Worker configuration;
- DNS or custom-domain settings.

Recipe-image storage and database-backup storage remain separate recovery concerns.

## First backup verification

After the workflow is merged to `main` and all required secrets/variables are confirmed by name:

1. Verify the `production-backup` Environment's deployment-branch policy is restricted appropriately; do not record secret values.
2. Manually dispatch **Production Database Backup** from `main`.
3. Confirm the workflow identifies the intended production project without printing credentials.
4. Confirm the shared production concurrency boundary is active and no repository-managed production release/migration overlaps the capture.
5. Confirm the normalized role/schema/migration-history pre/post consistency comparisons pass.
6. Confirm the archive and evidence JSON upload to `moris-mix-db-backups-prod`.
7. Confirm the remote object size equals the local archive size and the re-downloaded archive SHA-256 equals the locally recorded SHA-256.
8. Record the workflow run ID, source SHA, timestamp, R2 object key, archive size, and SHA-256 in #159.
9. Do not post SQL contents, archive contents, passwords, tokens, user rows, or auth data as evidence.

A configured workflow is not a backup. Completion of these steps proves only backup creation/upload/round-trip integrity verification.

## Restore drill — pending execution

The restore drill must use an isolated disposable target. It must **not** restore over:

- production project `gtbwblxskctpsqhbpebg`;
- the hosted `moris-mix-be04-rls-test` project used by CI.

The preferred target is an isolated local Supabase-compatible environment because it can be destroyed after verification and does not risk shared hosted data. The exact restore commands will be finalized against the first real backup and current Supabase restore guidance before execution.

The drill must, at minimum:

1. download one selected R2 backup using the bucket-scoped credential;
2. verify the downloaded archive SHA-256 against the recorded evidence object;
3. restore only into the isolated target;
4. verify expected application tables/schema and the Supabase migration ledger;
5. compare non-sensitive aggregate facts such as table row counts where appropriate, without printing private rows;
6. record managed-schema coverage or exclusions actually observed;
7. prove production remained unchanged by the drill;
8. destroy/reset the disposable target after evidence is captured.

A backup upload is not restore proof. DEVOPS-10 remains open until this drill succeeds and another teammate can follow the tested procedure.

## Failure handling

If configuration is missing or the workflow is dispatched from a non-main ref, production backup execution is blocked. If role/schema/migration-history drift is detected during capture, bundle creation fails before packaging/upload. If backup creation fails, no backup should be reported for that run. If upload fails, the job fails visibly and the runner cleanup step removes the local dump files. If remote size or re-downloaded SHA-256 verification fails, treat the uploaded object as unverified and investigate before using it for recovery.

Do not weaken database TLS, expose dump contents, make the bucket public, reuse recipe-image credentials, bypass the consistency gate, or restore into a shared/production database to make the task pass.
