# Owner-run private restore diagnostic

This procedure investigates a bounded PostgreSQL restore failure for [issue
#276](https://github.com/2ton-exe/moris-mix-ai/issues/276). It is separate from
the protected GitHub workflow and does not establish production recovery. The
helper supports attributable `data.sql` failures only. Unsupported, malformed,
or ambiguous evidence remains `other/unknown`.

Sequence attribution supports standalone `SELECT pg_catalog.setval` with a
schema-qualified sequence name, a decimal integer, and a boolean literal, and
standalone `ALTER SEQUENCE ... RESTART [WITH integer]` on a schema-qualified
name. The helper emits `sequence` only for SQLSTATE `42P01` when the reconstructed
catalog confirms the named relation is absent.

The procedure intentionally uses two disposable PostgreSQL targets. Target A
replays the complete Stage B command in its original single transaction. A
failure rolls back the schema changes, so Target B is a fresh cluster used for
a separate committed reconstruction of the ordered pre-data components and a
private catalog query. Never treat Target B as the post-failure state of
Target A.

## 1. Record independent approval before the real run

This is a manual VM session; approval of a GitHub Actions environment does not
approve it. Before minting credentials or downloading a real archive, record a
go/no-go in the restricted owner-controlled change record:

- The database owner is the operator. A second authorized backend/database or
  security owner independently approves the exact reviewed repository commit,
  selected backup identity, two R2 object paths, 15-minute credential TTL, VM
  image, replay plan, and cleanup. The approval record specifies the temporary
  egress window's exact start and end in UTC, a maximum duration of 15 minutes,
  its actual network scope, the control-plane operator, and how closure will be
  confirmed. The R2 object list restricts credential access, not network
  destinations. Claim destination-level network restriction only when the
  provider supports and enforces it; otherwise record the broader VM egress
  scope and obtain explicit approval for it.
- Name a trusted control-plane operator with out-of-band provider access. This
  operator owns both parent-token revocation and opening, closing, and
  confirming closure of the provider egress window. They must remain available
  throughout the window and every abort path. Egress closure is a separate
  control-plane action and must not wait for successful credential revocation
  or depend on the VM cleanup trap.
- Before any credential is minted, handed off, or used, confirm that the named
  operator is present on a separate provider session, has working out-of-band
  access, knows the approved deadline and expected completion signal, and can
  open and close the approved egress rule and verify its state. Name the person
  responsible for provider-side VM, encrypted-volume, snapshot, and key
  destruction; verify that person can act through the provider control plane if
  the VM or guest session is unavailable. The independent approver and both
  operators must be reachable for the whole window and abort procedure. If any
  of these prerequisites is missing, do not mint credentials or open egress.
- The approver confirms provider ingress and egress denial plus verified local
  host and Docker egress denial before any private SQL runs, and that the
  operator has an out-of-band provider console before applying the host
  firewall.
- Record the approval and later the sanitized result in a restricted internal
  record. Do not put approval details, backup identity, raw findings, or
  credentials in GitHub, this repository, Actions logs, or Codex chats.
- If an independent approver, the required network controls, or the cleanup
  path is unavailable, stop. Issue #280 and the existing GitHub environment
  approval do not authorize a real backup run by themselves.

## 2. Prepare the temporary Linux VM

Use a temporary Ubuntu 24.04 VM controlled by the database owner, with an
encrypted ephemeral volume mounted at `/mnt/encrypted-ephemeral`. Keep external
inbound access denied throughout the session and use the provider console or
serial console for out-of-band management. Install dependencies and pull both
pinned images before any private backup bytes arrive. After those pulls, deny
outbound traffic. Reopen it only for the separately approved transfer window
and the two exact R2 objects in Section 3. The named control-plane operator
opens the window only after confirming the approved start time, end time, and
network scope, then closes it at successful transfer completion, the approved
deadline, or any abort. Do not inspect the archive or open SQL during the
transfer window.

Before minting credentials, verify that the private mount is actually backed by
an encrypted ephemeral volume and that Docker's effective data root, PostgreSQL
volumes, container logs, and any other storage that may hold private data are
also on encrypted disposable storage. Prevent unencrypted swap, snapshots and
persistent backups of this VM. Record only the sanitized pass/fail result in
the restricted preflight record. If any storage boundary is unverified, stop.

Install or verify the dependencies before handling the backup:

- Supabase CLI `2.122.0`, Docker Engine and Compose support, AWS CLI v2, Python
  3, `nftables`, `iproute2`, and `nsenter` from `util-linux`.
- The pinned client image
  `postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`.
- The local Supabase server image expected from the pinned CLI:
  `supabase/postgres:17.11.0.006`.

The Python tools use only the standard library; no Python or Node package is
added. Docker and the pinned images must be available before outbound egress is
denied.

Use a clean checkout of the independently approved repository commit and run
the commands below from its root. Verify the checkout matches the approved
commit before minting R2 credentials:

```bash
REVIEWED_COMMIT='<approved 40-character commit SHA>'
test "$(git rev-parse HEAD)" = "$REVIEWED_COMMIT"
test -z "$(git status --porcelain)"
```

Open a Bash session from the provider console and create the private root on
the encrypted volume:

```bash
set -euo pipefail
set +o history
umask 077
export LC_ALL=C
PRIVATE_BASE=/mnt/encrypted-ephemeral
PRIVATE="$(mktemp -d "$PRIVATE_BASE/restore-diagnostic.XXXXXX")"
chmod 700 "$PRIVATE"
private_real="$(realpath -e "$PRIVATE")"
base_real="$(realpath -e "$PRIVATE_BASE")"
private_name="${private_real#"$base_real"/}"
if [[ "$private_real" != "$base_real/"* || "$private_name" == */* \
    || "$private_name" != restore-diagnostic.* ]]; then
  printf '%s\n' 'Private path is not a direct child of the encrypted mount.' >&2
  exit 1
fi
workdir_a="$PRIVATE/target-a"
workdir_b="$PRIVATE/target-b"
cleanup() {
  local status=$? private_real base_real private_name workdir
  trap - EXIT
  set +e
  for workdir in "$workdir_b" "$workdir_a"; do
    if [[ -f "$workdir/supabase/config.toml" ]]; then
      supabase stop --workdir "$workdir" --no-backup >/dev/null 2>&1 || status=1
    fi
  done
  private_real="$(realpath -e "$PRIVATE" 2>/dev/null)"
  base_real="$(realpath -e "$PRIVATE_BASE" 2>/dev/null)"
  private_name="${private_real#"$base_real"/}"
  if [[ "$private_real" == "$base_real/"* && "$private_name" != */* \
      && "$private_name" == restore-diagnostic.* ]]; then
    rm -rf -- "$private_real" || status=1
  else
    status=1
  fi
  [[ ! -e "$PRIVATE" ]] || status=1
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  exit "$status"
}
trap cleanup EXIT
```

Keep the backup, verified SQL, receipts, psql output, and inspection report in
`$PRIVATE`. Do not put them in the checkout or Codex workspace.

## 3. Mint and use a narrowly scoped R2 credential

Do not call the credentials API, hand off child credentials, or use them until
all Section 1 approvals and Section 2 VM/storage preflight checks are complete.
The credential-free rehearsal must also have passed before any real credential
is minted.

On a trusted owner-controlled machine, call Cloudflare's Temporary Credentials
API (`POST /client/v4/accounts/{account_id}/r2/temp-access-credentials`). Use a
dedicated, bucket-scoped, read-only parent R2 S3 API token for this one run.
The request must contain exactly the archive and matching evidence object
keys, with no prefix scope:

```json
{
  "bucket": "moris-mix-db-backups-prod",
  "parentAccessKeyId": "<dedicated per-run parent key id>",
  "permission": "object-read-only",
  "objects": [
    "<BACKUP_PREFIX>/<ARCHIVE_NAME>",
    "<BACKUP_PREFIX>/<EVIDENCE_NAME>"
  ],
  "ttlSeconds": 900
}
```

The response contains a temporary access key ID, secret, and session token.
Transfer only those three values and the R2 endpoint to the VM through an
approved private handoff. Keep both the Cloudflare API token used to call the
endpoint and the parent R2 secret on the trusted control-plane machine. Do not
print or paste the response.

Cloudflare documents a maximum TTL of seven days, path scoping through
`objects`, and immediate invalidation of derived temporary credentials when
the parent R2 S3 API token is revoked. There is no documented per-child revoke
operation, so the parent must be dedicated to this run and revoked after the
two downloads. The 900-second TTL is the backstop. If it expires early, stop
and get a new approval and credential; do not extend it silently.

Open the transfer window only at its approved UTC start and after confirming
its recorded network scope. If destination-level filtering is unavailable, do
not describe the broader VM egress rule as destination-restricted.

On successful completion of both downloads, close the provider egress window
immediately through the control plane, then independently revoke the dedicated
parent R2 token. Confirm both closure and revocation in the restricted record
before archive verification. Closing egress must not wait for revocation to
succeed. Unsetting the child credential variables is not revocation.

On any failure or interruption, track three separate obligations: close and
confirm provider egress, revoke and confirm the dedicated parent token, and
destroy the VM and private-data storage under Section 7. The control-plane
operator closes egress immediately and handles token revocation as a separate
action. Start provider-side data cleanup promptly; do not wait for successful
revocation. This applies to a failed or partial download, transfer timeout or
approved deadline, manual abort, failed or delayed revocation, and VM or
session loss. Do not retry with the same credential, rely on TTL alone, inspect
partial downloads, verify the archive, start a target, or run SQL. If egress
closure cannot be confirmed, stop and follow the provider-side isolation and
destruction procedure in Section 7. If parent-token revocation cannot be
confirmed, leave it recorded as an open security concern, notify the
independent approver, and continue private-data destruction without inspecting
or using the backup.

Before any real access, complete a credential-free abort rehearsal with the
database owner, control-plane operator, and independent approver. Walk each
failure below and confirm the stated stop behavior; do not create credentials,
open provider egress, or use backup data during this rehearsal:

| Rehearsed outcome | Egress closure obligation | Credential revocation obligation | Private-data cleanup obligation and pass condition |
| --- | --- | --- | --- |
| Both approved downloads succeed | Close immediately and confirm before archive verification. | Revoke independently and confirm before inspecting the archive. | After the approved inspection, destroy the VM, volume, snapshots, and key under Section 7; record this separately. |
| Credential mint or private handoff fails | If the window is open, close it immediately and confirm. | Revoke any minted parent independently; record unresolved status. | Destroy any VM/volume that may contain private material without waiting for revocation. Do not retry or inspect objects. |
| Archive or evidence download fails or is partial | Close immediately and confirm. | Revoke independently; record unresolved status. | Destroy the VM and any partial private data without waiting for revocation; do not inspect either object. |
| Transfer reaches its approved deadline or times out | Close at the deadline regardless of VM command state. | Revoke independently; record unresolved status. | Initiate provider-side VM and storage destruction even if the command or guest session remains active; do not retry. |
| Operator aborts or the VM/session is lost | Close from the separate provider session and confirm. | Revoke independently of VM access; record unresolved status. | Use provider controls to destroy the VM and private storage without relying on the guest trap or waiting for revocation. |
| Parent-token revocation fails or is delayed | Close and confirm without waiting for revocation. | Keep revocation open as a security concern and notify the approver; do not treat TTL as confirmation. | Begin VM, volume, snapshot, and key destruction promptly. No archive or SQL inspection may continue. |
| Egress closure cannot be confirmed | Keep closure unconfirmed and escalate; provider-isolate the VM immediately. Do not mark closure complete based only on VM loss. | Attempt revocation separately and record its status. | Destroy the VM and private storage through the provider control plane without waiting for either control to be confirmed. |

The rehearsal verifies operator sequencing only. It does not prove provider
firewall behavior, credential revocation, or VM destruction; those controls
must still be independently verified before the real run. See Cloudflare's
[temporary credentials guide](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)
and [create credentials API](https://developers.cloudflare.com/api/resources/r2/subresources/temporary_credentials/methods/create/).

From the VM, enter the child credentials without echo or shell-history entry:

```bash
read -r -s -p 'Temporary R2 access key: ' AWS_ACCESS_KEY_ID; printf '\n'
read -r -s -p 'Temporary R2 secret key: ' AWS_SECRET_ACCESS_KEY; printf '\n'
read -r -s -p 'Temporary R2 session token: ' AWS_SESSION_TOKEN; printf '\n'
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
R2_RESTORE_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
```

Set the expected identity values from the reviewed constants in
`.github/workflows/database-restore-stage-b.yml` and the independent backup
record in #159. Do not derive expected values only from the downloaded
evidence. Set `BACKUP_SHA256`, `BACKUP_SIZE`, `BACKUP_RUN_ID`,
`BACKUP_ATTEMPT`, `BACKUP_SOURCE_SHA`, `BACKUP_SOURCE_PROJECT`,
`BACKUP_PREFIX`, `ARCHIVE_NAME`, and `EVIDENCE_NAME`, then set:

```bash
export BACKUP_SHA256 BACKUP_SIZE BACKUP_RUN_ID BACKUP_ATTEMPT
export BACKUP_SOURCE_SHA BACKUP_SOURCE_PROJECT BACKUP_PREFIX ARCHIVE_NAME
export GITHUB_REPOSITORY=2ton-exe/moris-mix-ai
R2_BUCKET=moris-mix-db-backups-prod
```

Download only the two approved objects:

```bash
aws s3 cp "s3://${R2_BUCKET}/${BACKUP_PREFIX}/${ARCHIVE_NAME}" \
  "$PRIVATE/restore-selected.tar.gz" --endpoint-url "$R2_RESTORE_ENDPOINT" \
  --only-show-errors --no-progress
aws s3 cp "s3://${R2_BUCKET}/${BACKUP_PREFIX}/${EVIDENCE_NAME}" \
  "$PRIVATE/restore-selected.json" --endpoint-url "$R2_RESTORE_ENDPOINT" \
  --only-show-errors --no-progress
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN R2_RESTORE_ENDPOINT
```

The control-plane operator must close the approved transfer window and
independently revoke the dedicated parent R2 token. Confirm both actions in the
restricted record; unsetting the environment variables alone is not
revocation. Do not proceed with archive inspection or SQL if either action
cannot be confirmed or if the parent is shared and cannot be safely revoked.
Keep inbound access denied and use the provider console or serial console to
confirm all external egress is denied before archive verification, extraction,
target startup, or SQL access.
If closure cannot be applied and independently confirmed, stop without
inspecting the archive and immediately use provider controls to isolate the VM
and begin the destruction procedure in Section 7. If revocation cannot be
confirmed, stop without inspecting the archive, record the revocation as an
open security concern, and begin Section 7 private-data destruction without
waiting for revocation to succeed.

Verify the downloaded archive and extract only the checksummed SQL components:

```bash
python3 scripts/verify_restore_archive.py \
  --archive "$PRIVATE/restore-selected.tar.gz" \
  --evidence "$PRIVATE/restore-selected.json" \
  --target "$PRIVATE/restore-verified-sql"
rm -f -- "$PRIVATE/restore-selected.tar.gz" "$PRIVATE/restore-selected.json"
```

The verifier checks the independent archive hash and size, backup identity,
archive member set, metadata, and five component checksums. If it fails, stop;
do not replay any SQL.

## 4. Start Target A and verify network isolation

Create a fresh local Supabase project in the private root and pin it to
PostgreSQL 17:

```bash
PSQL_IMAGE=postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
local_db='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
configure_pg17_target() {
  local target_workdir="$1"
  supabase init --workdir "$target_workdir"
  python3 - "$target_workdir/supabase/config.toml" <<'PY'
from pathlib import Path
import re
import sys
import tomllib

path = Path(sys.argv[1])
original = path.read_text(encoding="utf-8")
updated, count = re.subn(
    r'(?m)^([ \t]*major_version[ \t]*=[ \t]*)(?:"[0-9]+"|[0-9]+)([ \t]*(?:#.*)?)$',
    r"\g<1>17\2",
    original,
)
if count != 1 or tomllib.loads(updated)["db"]["major_version"] != 17:
    raise SystemExit("Disposable PostgreSQL 17 configuration failed")
path.write_text(updated, encoding="utf-8")
PY
  supabase db start --workdir "$target_workdir"
}
configure_pg17_target "$workdir_a"
```

Confirm the expected local PostgreSQL server image is running. Identify the
single bridge network created for this Supabase project; stop if the match is
ambiguous:

```bash
mapfile -t db_networks < <(docker network ls --filter driver=bridge \
  --filter name=supabase_network_ --format '{{.Name}}')
if [[ "${#db_networks[@]}" != 1 ]]; then
  printf '%s\n' 'Could not uniquely identify the local Supabase bridge.' >&2
  exit 1
fi
DB_NETWORK="${db_networks[0]}"
docker ps --format '{{.Image}}' | grep -Eq '(^|/)supabase/postgres:17[.]11[.]0[.]006$'
```

The provider-level deny-all policy must already be active after the object
transfer and credential revocation. Before any private SQL, reconfirm through
the provider console that external inbound and outbound IPv4 and IPv6 traffic
are denied. Then install and verify the local host and Docker firewall rules.
The helper drops host egress except
loopback and traffic to local Docker bridges, drops forwarded container egress
while allowing container-to-container forwarding, probes four fixed external
IP endpoints from both host and the selected Supabase bridge, and verifies the
local PostgreSQL connection still works:

```bash
sudo python3 scripts/owner_restore_network_guard.py apply \
  --docker-network "$DB_NETWORK" --psql-image "$PSQL_IMAGE" --local-dsn "$local_db"
sudo python3 scripts/owner_restore_network_guard.py verify \
  --docker-network "$DB_NETWORK" --psql-image "$PSQL_IMAGE" --local-dsn "$local_db"
```

Both commands must succeed, and the provider console must show the external
ingress and egress deny policy active. The network guard fails closed on a
reachable endpoint, an unexpected Docker driver or interface, a weakened
firewall allowlist, or a failed local database probe. If any check fails, do
not run the target guard or private SQL; destroy the VM and volume. Keep the VM
on the provider console because only the provider layer controls external
inbound access.

Define the pinned, read-only psql client wrapper and guard Target A before the
first backup SQL file is opened:

```bash
client() {
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    --cap-drop ALL --security-opt no-new-privileges --read-only \
    --mount "type=bind,source=$PRIVATE,target=/private,readonly" \
    --mount "type=bind,source=$PRIVATE/restore-verified-sql,target=/backup,readonly" \
    "$PSQL_IMAGE" psql "$@"
}
client --version
python3 scripts/owner_restore_diagnostic.py guard --private-dir "$PRIVATE"
client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
  -f /private/target-before.sql -d "$local_db" \
  > "$PRIVATE/target-a-before.json" 2> "$PRIVATE/target-a-before.stderr"
python3 scripts/owner_restore_diagnostic.py check-target \
  --private-dir "$PRIVATE" --target-before "$PRIVATE/target-a-before.json"
```

The target guard requires PostgreSQL 17, the local `postgres` database, the
Supabase `auth.users` baseline, and absent `public.recipes` and
`public.profiles` sentinels. If it fails, stop.

## 5. Replay the exact Stage B transaction on Target A

Use the same connection role, identity check, component order, fail-fast flags,
single transaction, and replication-role command as
`.github/workflows/database-restore-stage-b.yml`. The only differences are
private file paths and the local target. Keep both output streams owner-only.
The shell's 64 KiB file-size limit and the helper's 64 KiB parser limit bound
each captured stream.

```bash
restore_db='postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres'
require_admin="$(cat <<'SQL'
DO $restore_identity$
BEGIN
  IF current_user <> 'supabase_admin' OR session_user <> 'supabase_admin'
      OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
  THEN
    RAISE insufficient_privilege USING MESSAGE = 'Unexpected local restore identity';
  END IF;
END;
$restore_identity$;
SQL
)"
ulimit -f 128
if client -X -q --no-password --single-transaction -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -c "$require_admin" \
    -f /backup/roles.sql \
    -f /backup/schema.sql \
    -f /backup/history-schema.sql \
    -c 'SET session_replication_role = replica' \
    -f /backup/data.sql \
    -f /backup/history-data.sql -d "$restore_db" \
    > "$PRIVATE/target-a.stdout" 2> "$PRIVATE/target-a.stderr"; then
  printf '%s\n' 'The failure was not reproduced; leave the cause unknown.'
  exit 1
else
  restore_status=$?
fi
if [[ "$restore_status" != 3 ]]; then
  printf '%s\n' 'Unexpected psql failure; leave the cause unknown.'
  exit 1
fi
python3 scripts/owner_restore_diagnostic.py prepare \
  --private-dir "$PRIVATE" \
  --sql-dir "$PRIVATE/restore-verified-sql" \
  --stderr "$PRIVATE/target-a.stderr"
client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
  -f /private/target-before.sql -d "$local_db" \
  > "$PRIVATE/target-a-after.json" 2> "$PRIVATE/target-a-after.stderr"
python3 scripts/owner_restore_diagnostic.py check-target \
  --private-dir "$PRIVATE" --target-before "$PRIVATE/target-a-after.json"
python3 - "$PRIVATE/target-a-before.json" "$PRIVATE/target-a-after.json" <<'PY'
import json
from pathlib import Path
import sys

before, after = (json.loads(Path(name).read_text(encoding="utf-8")) for name in sys.argv[1:])
if before != after:
    raise SystemExit("Target A did not return to its clean pre-replay state")
PY
rm -f -- "$PRIVATE/target-before.sql"
```

The raw PostgreSQL error and exact statement remain private. The helper accepts
only one bounded `data.sql` error record and checksum-matched SQL. If it cannot
attribute the statement safely, it will later emit `other/unknown`.

Stop Target A. Start Target B in a new work directory so it receives a fresh
PostgreSQL cluster and a different system identifier:

```bash
supabase stop --workdir "$workdir_a" --no-backup
configure_pg17_target "$workdir_b"
```

After confirming the expected server image, identify Target B's bridge and
verify the already installed firewall against it. The installed rules cover
Docker bridges by interface class, and provider ingress and egress denial
remains active:

```bash
mapfile -t db_networks_b < <(docker network ls --filter driver=bridge \
  --filter name=supabase_network_ --format '{{.Name}}')
if [[ "${#db_networks_b[@]}" != 1 ]]; then
  printf '%s\n' 'Could not uniquely identify Target B bridge.' >&2
  exit 1
fi
DB_NETWORK_B="${db_networks_b[0]}"
docker ps --format '{{.Image}}' | grep -Eq '(^|/)supabase/postgres:17[.]11[.]0[.]006$'
sudo python3 scripts/owner_restore_network_guard.py verify \
  --docker-network "$DB_NETWORK_B" --psql-image "$PSQL_IMAGE" --local-dsn "$local_db"
python3 scripts/owner_restore_diagnostic.py guard --private-dir "$PRIVATE"
client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
  -f /private/target-before.sql -d "$local_db" \
  > "$PRIVATE/target-b-before.json" 2> "$PRIVATE/target-b-before.stderr"
python3 scripts/owner_restore_diagnostic.py check-target \
  --private-dir "$PRIVATE" --target-before "$PRIVATE/target-b-before.json"
```

Confirm the targets are distinct without printing either system identifier:

```bash
python3 - "$PRIVATE/target-a-before.json" "$PRIVATE/target-b-before.json" <<'PY'
import json
from pathlib import Path
import sys

first, second = (json.loads(Path(name).read_text(encoding="utf-8")) for name in sys.argv[1:])
if first["system_identifier"] == second["system_identifier"]:
    raise SystemExit("Target B is not a separate PostgreSQL cluster")
PY
```

## 6. Reconstruct the pre-data catalog on Target B

Replay only the ordered prefix through `history-schema.sql` as
`supabase_admin`, in one committed transaction, with the same identity check
and replication-role setting. Do not replay `data.sql` or `history-data.sql`
on Target B:

```bash
client -X -q --no-password --single-transaction -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate -c "$require_admin" \
  -f /backup/roles.sql \
  -f /backup/schema.sql \
  -f /backup/history-schema.sql \
  -c 'SET session_replication_role = replica' \
  -d "$restore_db" \
  > "$PRIVATE/reconstruction.stdout" 2> "$PRIVATE/reconstruction.stderr"
```

Generate and execute the bounded catalog query on Target B, using the same
local cluster and database guard:

```bash
client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
  -f /private/catalog-after.sql -d "$local_db" \
  > "$PRIVATE/catalog-after.json" 2> "$PRIVATE/catalog-after.stderr"
python3 scripts/owner_restore_diagnostic.py finalize \
  --private-dir "$PRIVATE" \
  --target-before "$PRIVATE/target-b-before.json" \
  --catalog-after "$PRIVATE/catalog-after.json"
```

The last command prints one fixed label. Review `$PRIVATE/inspection.txt` only
on the VM with the independently approving backend/database owner. Corroborate
the private failing statement and the Target B catalog facts before reporting
any label. A label is not root-cause proof. If the label is
`other/unknown`, evidence is incomplete, or owners disagree, report unknown
and stop. Never paste the private report or raw diagnostic into GitHub, AI
chats, Actions logs, artifacts, or shared storage.

## 7. Cleanup

The local EXIT trap stops both local stacks and removes the private root after
validating its path under the encrypted mount. It is best-effort local cleanup;
it cannot close provider egress, revoke the parent token, or destroy a lost VM.

Track and record these obligations separately; none is evidence that another
has completed. On a normal success path, both egress closure and token
revocation must still be confirmed before archive inspection, as required in
Section 3. If that gate fails, stop inspection and start cleanup as described
below.

1. **Egress closure — trusted control-plane operator.** Close the provider rule
   at successful transfer completion, the approved deadline, or any abort, and
   confirm its state through the provider control plane. Do not wait for token
   revocation or rely on the guest cleanup trap. If closure cannot be confirmed,
   keep that status open, escalate, and provider-isolate the VM immediately.
2. **Parent-token revocation — trusted control-plane operator.** Revoke the
   dedicated parent independently and record confirmation. If revocation fails
   or remains unconfirmed, keep it open as a security concern and notify the
   independent approver. Do not treat TTL or unsetting child variables as
   revocation. Unconfirmed revocation stops further credential or archive use,
   but must not delay private-data destruction.
3. **Private-data destruction — named provider-resource operator.** After the
   authorized private inspection on the normal success path, destroy the
   temporary VM, encrypted volume, snapshots, Docker storage, private files,
   and dedicated ephemeral encryption key through provider controls. On any
   abort, no-go, or failure that stops authorized inspection, begin this
   destruction promptly, independently of revocation confirmation, and do not
   depend on the VM session or EXIT trap. If egress closure is unconfirmed or
   the VM/session is lost, use provider-side isolation and destruction
   immediately. Confirm destruction separately in the restricted record.

Only the sanitized fixed label and non-sensitive approval/cleanup record may be
retained. Do not resume or inspect private data after an abort or while egress
closure is unconfirmed. If any control cannot be confirmed, leave that
obligation open, follow the approved provider-side abort procedure, and notify
the independent approver; unresolved credential revocation does not block
destruction of private data.

## Synthetic coverage

The PR's credential-free unit tests exercise archive verification, input
bounds, output redaction, target guards, fixed-label classification, firewall
rule validation, host and Docker egress probes, and local database reachability.
The PostgreSQL synthetic integration replays the Stage B command against a
synthetic failure, proves its transaction rolls back, reconstructs catalog
state on a separate target, checks the fixed label, and removes both targets
and private files. The credential-free abort rehearsal above covers transfer
and control-plane failure decisions without testing a provider firewall,
credential revocation, or VM destruction. These checks do not access R2 or use
the production backup.
