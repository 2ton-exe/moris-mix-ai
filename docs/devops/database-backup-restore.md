# Database Backup and Restore

This document tracks the DEVOPS-10 recovery path for Mori's Mix. It describes what the backup automation is intended to protect, what it does **not** protect, and what evidence is still required before the project can claim that database recovery is proven.

Related issue: #159.

## Evidence state

As of 2026-11-02:

- A dedicated private Cloudflare R2 bucket, `moris-mix-db-backups-prod`, is configured.
- A bucket-scoped R2 Account API token is configured with Object Read & Write access only to that bucket.
- The GitHub Environment `production-backup` contains the R2 backup credentials and bucket variable.
- The production Supabase organization is on the Free plan, so provider-managed daily-backup retention and PITR are not established as the project's recovery path.
- `.github/workflows/database-backup.yml` configures a manual and weekly logical-backup job.
- **No successful backup run is claimed until a merged-main/manual workflow run actually creates, uploads, and verifies a private R2 object.**
- **No restore capability is claimed until a selected backup is restored and verified in an isolated safe target.**

## Backup trigger and ownership

The workflow supports:

- manual `workflow_dispatch`, used for the first controlled backup and later operator checks;
- weekly schedule at Sunday 18:00 UTC / Monday 02:00 PHT.

The job runs through the `production-backup` GitHub Environment and has repository `contents: read` permission only.

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

## Backup contents

The workflow uses Supabase CLI `db dump`, which runs PostgreSQL dump tooling with Supabase-specific filtering. The bundle contains:

- `roles.sql` — CLI-filtered custom-role dump;
- `schema.sql` — CLI-filtered application schema dump;
- `data.sql` — CLI-filtered logical data dump using COPY format;
- `history-schema.sql` — `supabase_migrations` schema needed to preserve migration history;
- `history-data.sql` — `supabase_migrations` data;
- `component-checksums.sha256`;
- `backup-metadata.json` with source revision/project/timestamp/scope only.

The resulting archive is uploaded to a date- and revision-qualified R2 key. A separate JSON evidence object records the archive size and SHA-256 checksum without containing database rows or credentials.

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

1. Manually dispatch **Production Database Backup** from `main`.
2. Confirm the workflow identifies the intended production project without printing credentials.
3. Confirm all logical dump steps succeed.
4. Confirm the archive and evidence JSON upload to `moris-mix-db-backups-prod`.
5. Confirm the R2 `head-object` size equals the local archive size reported by the workflow.
6. Record the workflow run ID, source SHA, timestamp, R2 object key, archive size, and SHA-256 in #159.
7. Do not post SQL contents, archive contents, passwords, tokens, user rows, or auth data as evidence.

A configured workflow is not a backup. Completion of these steps proves only backup creation/upload/metadata verification.

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

If backup creation fails, no backup should be reported for that run. If upload fails, the job fails visibly and the runner cleanup step removes the local dump files. If remote-object verification fails, treat the uploaded object as unverified and investigate before using it for recovery.

Do not weaken database TLS, expose dump contents, make the bucket public, reuse recipe-image credentials, or restore into a shared/production database to make the task pass.
