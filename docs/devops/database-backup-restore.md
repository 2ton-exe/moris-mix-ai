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
8. Record only the workflow run link and fixed outcomes in public issue #159. Keep the source revision, timestamp, R2 object key, archive size, SHA-256, and other backup identifiers in the restricted owner-controlled record.
9. Do not post SQL contents, archive contents, passwords, tokens, user rows, auth data, or backup identifiers in public GitHub evidence.

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

For the current #159 selection, Stage B accepts Backup #7 only and is restricted to ordinary recovery. It cannot select Backup #4 or provide the private statement/catalog evidence required by #276/#280. Before either secret is provisioned or changed, an independent reviewer must receive the exact proposed UTF-8 manifest bytes through the restricted owner channel, reconcile the Backup #7 entry against the successful producer run and evidence in the restricted record, and independently compute the SHA-256 of those exact bytes. Set `RESTORE_CANDIDATES_JSON` to those bytes and `RESTORE_CANDIDATE_MANIFEST_SHA256` to that independently computed lowercase digest as separate protected-environment secrets. Do not read back, print, or publish either secret. Stage B compares the exact received bytes with the separate digest and fails before any R2 request if either is missing or mismatched. Any later change requires the same independent review again. The digest detects byte drift after review; it is not provenance proof by itself. Keep the manifest and digest private.

Stage B isolates the disposable containers but does not deny outbound TCP/DNS from the runner host; it observes and reports that connectivity. This is a residual risk for ordinary Backup #7 recovery and must be explicitly accepted by the protected-run approver. It does not meet the stricter #276/#280 owner-diagnostic network requirements.

### Disposable restore principal

The [credential-free PostgreSQL 17 experiment](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44866128120)
reproduced SQLSTATE `42501` for synthetic membership and parameter grants as
local `postgres`, which had `CREATEROLE` and `CREATEDB` but lacked superuser
privileges. Both grants succeeded as local `supabase_admin`, and the failed
transactions rolled back. This explains a possible cause of the archived
restore failure. The exact statement in Backup #4 remains unverified.

Stage B and the role-only diagnostic use `supabase_admin` only on the freshly
started disposable PostgreSQL 17 target at `127.0.0.1`. Before opening the
first SQL file, the pinned client checks the login, effective role and superuser
flag in the same replay session. An unavailable login or failed identity check
stops replay. The supplied SQL is still replayed in its original order and in one
fail-fast transaction. The archive remains immutable, and access still requires
the protected `database-restore-drill` Environment.

Stage B still checks the five application counts and migration version set as
local `postgres`. Synthetic fixtures exercise both restored ownership and
explicit read grants. If that role cannot read the restored tables, or its row
visibility produces different counts, verification fails. Objects with implicit
ownership can take the replay role as owner. Backup #7 is the selected candidate for the ordinary #159 recovery drill; its success does not diagnose or resolve Backup #4's failure under #276/#280. The drill
does not establish recovery of excluded managed services or Storage objects.

## Failure handling

If configuration is missing or the workflow is dispatched from a non-main ref, production backup execution is blocked. If role/schema/migration-history drift is detected during capture, bundle creation fails before packaging/upload. If backup creation fails, no backup should be reported for that run. If upload fails, the job fails visibly and the runner cleanup step removes the local dump files. If remote size or re-downloaded SHA-256 verification fails, treat the uploaded object as unverified and investigate before using it for recovery.

For a PostgreSQL script failure (`restore` exit code 3), Stage B may emit the
existing `component_hint` and two additional **untrusted** hints for a uniquely
framed `roles.sql` error: a category mapped from the fixed SQLSTATE allowlist
(`42501`, `42704`, `42710`) and a conservative statement class for a recognized
single-line role-membership `GRANT`, `ALTER ROLE ... SET`, `CREATE ROLE`, or
`ALTER ROLE` with boolean role attributes. Creation supports an optional boolean
attribute list; password, connection-limit and validity clauses remain unsupported. The statement lookup
uses only the verified `roles.sql` file and the reported line number, which may
identify the statement's ending line. Unsupported forms and unreadable role
files produce an `unknown` statement class; malformed or ambiguous records and
over-bound stderr produce only `unknown` labels. Each of the three role error
categories identifies one allowlisted SQLSTATE.

For `data.sql` only, a sole SQLSTATE-only `ERROR` can also produce an untrusted
category hint, even with canonical `NOTICE` or `WARNING` records before or after
it. The allowlist covers COPY format, data conversion and encoding, constraint
violations, insufficient privilege, and missing tables or columns. Unsupported
codes or message severities, malformed or ambiguous records, and out-of-bounds
logs leave the category `unknown`. Stage B does not inspect data statements or
rows to produce this hint, and the statement class remains `unknown`.

All hints are investigative leads. An identical forged record remains
indistinguishable from a genuine one. Raw diagnostic records, line numbers, SQL,
row contents, and identifiers stay private. The diagnostic preserves the
restore's original exit status, and disposable target cleanup always runs.

Do not weaken database TLS, expose dump contents, make the bucket public, reuse recipe-image credentials, bypass the consistency gate, or restore into a shared/production database to make the task pass.

## Migration-history consistency comparison

The first three real private-backup runs failed before R2 upload. Run #3
([Actions evidence](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42194021625))
reported that the pre/post history dumps had 9 COPY rows and one COPY block
each; all differences were outside COPY rows. This establishes a mismatch
in non-row dump output, not the specific text responsible for it.

The history comparator now sorts COPY rows and excludes only non-executable
full-line SQL comments, blank lines, and correctly paired generated psql
restrict guards. Executable statements, COPY table/column headers, row
contents, multiplicity, and terminators remain compared. Malformed COPY
or restrict guards fail closed. Role and schema drift comparisons remain
unchanged. These transformations run only on temporary comparison streams:
the original data/role/schema dumps used for restoration are never rewritten.

Offline regression tests run in the existing Frontend Checks CI context.
The change is **not** backup or restore proof: after review, merge, and a
successful production workflow run, verify the R2 round trip and then perform
the isolated restore drill before closing #159 or unblocking #154.

## Role-only protected diagnostic (proposed; not restore proof)

Stage B #6 ([run 44661836114](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44661836114))
failed transactional replay with bounded untrusted labels:
component roles.sql, SQLSTATE category insufficient-privilege, statement class unknown.
This does not identify the failing statement.

The separate manual Database Restore Role Diagnostic workflow is a
**protected role-only exercise, not a full recovery drill**. It preserves the selected immutable Backup #4,
its R2 and component checksum verification, disposable PostgreSQL 17 target,
pinned PostgreSQL client, main-only and protected-environment gates, and
always-run cleanup. It replays only the verified roles.sql using Stage B's
local administrative principal and the same fail-fast transaction flags.
It does not restore application schema
or data, and its run must never be counted as recovery evidence.

The runner emits only fixed attribute booleans for the local connection role,
the count of exact single-line public Supabase grant patterns, counts of
single-line ALTER ... OWNER TO supabase_admin candidates by broad object type,
and coarse untrusted error labels. The public labels never include private
SQL text, role identifiers or SQL line numbers. All private stderr remains
on the disposable runner until cleanup; generated labels are investigative
hints, not authenticated proof of root cause. Unsupported multi-line forms
are not ruled out by a zero static count. The attribute flags describe the
guarded local administrative principal used for replay.

Any later compatibility transformation must be limited to independently
confirmed failing statements, maintain the original archive and checksum
identity, and document resulting role/ownership semantics. In particular,
verify the owner and permission behavior of SECURITY DEFINER functions and
the implications of excluded managed schemas. This diagnostic does not
authorize silently excluding roles, SQL statements or ownership grants.

### Role-only diagnostic interpretation (pending independent review)

A role-only diagnostic that reaches a SQL error reports its sanitized findings
and finishes with a **failed** workflow conclusion; a green Actions result
cannot indicate a failed `roles.sql` replay. Even a successful role-only
replay does **not** verify schema/data recovery.

Single-line static patterns are indicative, not exhaustive. The public
`doc_grant` count matches only the canonical documented Supabase grant,
while `grantor_candidates` includes the canonical match and other recognized
single-line role-membership GRANTs with a real `GRANTED BY` clause. It excludes
lookalike text in quoted identifiers and trailing comments. Both counts may
miss multi-line or unsupported grant forms.
Ownership candidates include quoted and unquoted `supabase_admin` spellings.
If static parsing encounters unsupported input, it reports the fixed
`counts=unavailable` value without blocking the more informative role-only
replay. That sentinel is not a successful static pattern check.

A future protected diagnostic adds an optional `membership` label for the
failing statement only. `match` means that statement matches the existing
conservative single-line role-membership GRANT grammar, while `unclassified`
means it does not match; this **does not establish** that the GRANT affects
object privileges. `not-applicable` means the attributed statement is not a
GRANT, and `unknown` means attribution was not established. These labels
never reveal identifiers or SQL and do not prove the permission root cause.

The proposed `grant_type` label describes only the statement attributed by a
validated replay error. `parameter-grant` means it matches the supported
single-line PostgreSQL 17 configuration-parameter GRANT syntax.
`role-membership-grant` means it matches the existing strict membership
grammar. Success and unattributed, unsupported, or ambiguous statements use
`other-or-unknown`. The label reveals no parameter names, role identifiers,
or SQL. It describes syntax only and leaves the required privileges and
permission root cause unverified.

## Owner-run private restore inspection (not recovery proof)

Issue #280 adds a separate owner-controlled local procedure for bounded
`data.sql` failure inspection. It replays the exact Stage B single transaction
on one disposable PostgreSQL 17 target, then uses a separate fresh target for
the committed pre-data reconstruction and catalog query. Before private SQL,
it requires a second owner’s approval, provider-level ingress and egress
denial, and verified host/container firewall probes. Follow the
[owner restore diagnostic runbook](owner-restore-diagnostic.md) on a temporary
isolated Linux VM. Its standard-library verifier reuses the protected
workflow's archive identity and component-checksum checks; its local helper
keeps the exact statement and catalog snapshot private and emits only a fixed
investigative label. This path does not use GitHub logs or artifacts, does not
authorize a production dispatch, and does not establish restore or production
recovery. The host network guard uses the system `nftables` and `iproute2`
tools; no Python or Node package is added.
