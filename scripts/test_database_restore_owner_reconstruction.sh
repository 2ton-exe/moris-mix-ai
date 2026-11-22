#!/usr/bin/env bash
# Synthetic-only proof of Stage B rollback and separate catalog reconstruction.
set -euo pipefail

: "${PSQL_IMAGE:?The digest-pinned PostgreSQL 17 image is required}"
expected_psql_image='postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'
if [[ "$PSQL_IMAGE" != "$expected_psql_image" ]]; then
  printf '%s\n' 'Expected the repository-pinned PostgreSQL 17.11 image.' >&2
  exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
umask 077
root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/owner-restore-reconstruction.XXXXXX")"
sql_dir="$root/restore-verified-sql"
container_a="owner-restore-synthetic-a-$$"
container_b="owner-restore-synthetic-b-$$"

cleanup() {
  local original_status=$?
  trap - EXIT
  local failed=0 name
  for name in "$container_a" "$container_b"; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      docker rm -f -v "$name" >/dev/null 2>&1 || failed=1
    fi
    if docker container inspect "$name" >/dev/null 2>&1; then failed=1; fi
  done
  if [[ -e "$root" ]]; then
    rm -rf -- "$root" >/dev/null 2>&1 || failed=1
  fi
  if [[ -e "$root" ]]; then failed=1; fi
  if (( failed == 0 )); then
    printf '%s\n' 'synthetic-owner-cleanup=pass'
  else
    printf '%s\n' 'synthetic-owner-cleanup=fail' >&2
    if (( original_status == 0 )); then original_status=1; fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

mkdir -m 700 "$sql_dir"
python3 - "$root" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
sql = root / "restore-verified-sql"
components = {
    "roles.sql": b"CREATE ROLE owner_diag_synthetic NOLOGIN;\n",
    "schema.sql": (
        b"CREATE TABLE public.owner_diag_present (id integer PRIMARY KEY);\n"
    ),
    "history-schema.sql": (
        b"CREATE SCHEMA owner_diag_history;\n"
        b"CREATE TABLE owner_diag_history.events (id integer PRIMARY KEY);\n"
    ),
    "data.sql": (
        b"COPY public.owner_diag_absent (id) FROM stdin;\n"
        b"synthetic-copy-row-must-stay-private\n\\.\n"
    ),
    "history-data.sql": b"SELECT 1;\n",
}
hashes = {}
for name, content in components.items():
    path = sql / name
    path.write_bytes(content)
    os.chmod(path, 0o600)
    hashes[name] = hashlib.sha256(content).hexdigest()
manifest = "".join(f"{hashes[name]}  {name}\n" for name in components)
(sql / "component-checksums.sha256").write_text(manifest, encoding="ascii")
os.chmod(sql / "component-checksums.sha256", 0o600)
receipt = {
    "archive_sha256": "a" * 64,
    "archive_size_bytes": 1234,
    "data_sha256": hashes["data.sql"],
}
(root / "verified.json").write_text(json.dumps(receipt) + "\n", encoding="ascii")
os.chmod(root / "verified.json", 0o600)
init_sql = (
    "CREATE ROLE supabase_admin WITH LOGIN SUPERUSER PASSWORD 'synthetic';\n"
    "CREATE SCHEMA auth;\n"
    "CREATE TABLE auth.users (id integer PRIMARY KEY);\n"
)
(root / "init.sql").write_text(init_sql, encoding="ascii")
# The pinned PostgreSQL container reads this synthetic-only bind mount as its
# unprivileged `postgres` user; it contains no real credentials or backup data.
os.chmod(root / "init.sql", 0o644)
PY

client() {
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    --cap-drop ALL --security-opt no-new-privileges --read-only \
    --mount "type=bind,source=$root,target=/private,readonly" \
    --mount "type=bind,source=$sql_dir,target=/backup,readonly" \
    "$PSQL_IMAGE" psql "$@"
}

start_target() {
  local name="$1" port_line port attempt
  docker run --detach --name "$name" \
    --publish '127.0.0.1::5432/tcp' \
    --env POSTGRES_PASSWORD=synthetic \
    --mount "type=bind,source=$root/init.sql,target=/docker-entrypoint-initdb.d/00-owner-synthetic.sql,readonly" \
    "$PSQL_IMAGE" >/dev/null
  port_line="$(docker port "$name" 5432/tcp)"
  port="${port_line##*:}"
  if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || (( port < 1 || port > 65535 )); then
    return 1
  fi
  for attempt in {1..45}; do
    if client -X -q -A -t --no-password \
        -d "postgresql://postgres:synthetic@127.0.0.1:$port/postgres" \
        -c 'SELECT 1' > "$root/readiness.stdout" 2> "$root/readiness.stderr"; then
      printf '%s\n' "$port"
      return 0
    fi
    sleep 1
  done
  return 1
}

guard_target() {
  local port="$1" label="$2"
  local dsn="postgresql://postgres:synthetic@127.0.0.1:$port/postgres"
  python3 "$repo_root/scripts/owner_restore_diagnostic.py" guard --private-dir "$root"
  client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
    -f /private/target-before.sql -d "$dsn" \
    > "$root/$label-before.json" 2> "$root/$label-before.stderr"
  python3 "$repo_root/scripts/owner_restore_diagnostic.py" check-target \
    --private-dir "$root" --target-before "$root/${label}-before.json"
  rm -f -- "$root/target-before.sql"
}

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
restore_db_prefix='postgresql://supabase_admin:synthetic@127.0.0.1:'

# Target A reproduces Stage B's complete statement order and one transaction.
port_a="$(start_target "$container_a")"
dsn_a="${restore_db_prefix}${port_a}/postgres"
guard_target "$port_a" target-a
ulimit -f 128
if client -X -q --no-password --single-transaction -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -c "$require_admin" \
    -f /backup/roles.sql \
    -f /backup/schema.sql \
    -f /backup/history-schema.sql \
    -c 'SET session_replication_role = replica' \
    -f /backup/data.sql \
    -f /backup/history-data.sql -d "$dsn_a" \
    > "$root/stage-a.stdout" 2> "$root/stage-a.stderr"; then
  printf '%s\n' 'Synthetic Stage B failure was not reproduced.' >&2
  exit 1
else
  stage_a_status=$?
fi
if [[ "$stage_a_status" != 3 ]]; then
  printf '%s\n' 'Synthetic Stage B returned an unexpected client status.' >&2
  exit 1
fi
python3 "$repo_root/scripts/owner_restore_diagnostic.py" prepare \
  --private-dir "$root" --sql-dir "$sql_dir" --stderr "$root/stage-a.stderr"
python3 - "$root/candidate.json" <<'PY'
import json
from pathlib import Path
import sys

candidate = json.loads(Path(sys.argv[1]).read_text(encoding="ascii"))
error = candidate.get("error")
context = candidate.get("context")
parsed = context.get("candidate") if isinstance(context, dict) else None
relation = parsed.get("relation") if isinstance(parsed, dict) else None
if not (
    isinstance(error, dict)
    and error.get("sqlstate") == "42P01"
    and isinstance(context, dict)
    and context.get("location") == "copy-header"
    and isinstance(parsed, dict)
    and parsed.get("kind") == "copy"
    and parsed.get("columns") == ["id"]
    and relation == {
        "regclass": "public.owner_diag_absent",
        "schema": "public",
        "name": "owner_diag_absent",
    }
    and error.get("line") == 1
):
    raise SystemExit("Synthetic COPY attribution did not match its fixture")
print("synthetic-owner-copy-attribution=pass")
PY
rollback_state="$(client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
  -d "postgresql://postgres:synthetic@127.0.0.1:$port_a/postgres" \
  -c "SELECT concat((pg_catalog.to_regclass('public.owner_diag_present') IS NULL)::int, '|', (NOT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname='owner_diag_history'))::int, '|', (NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='owner_diag_synthetic'))::int)")"
if [[ "$rollback_state" != '1|1|1' ]]; then
  printf '%s\n' 'Synthetic Stage B rollback state did not match.' >&2
  exit 1
fi
docker rm -f -v "$container_a" >/dev/null

# Target B is a fresh disposable cluster. Commit only the ordered pre-data
# prefix, then query its catalog independently of Target A's rolled-back state.
port_b="$(start_target "$container_b")"
dsn_b="${restore_db_prefix}${port_b}/postgres"
guard_target "$port_b" target-b
python3 - "$root/target-a-before.json" "$root/target-b-before.json" <<'PY'
import json
from pathlib import Path
import sys

first, second = (json.loads(Path(name).read_text(encoding="utf-8")) for name in sys.argv[1:])
if first.get("system_identifier") == second.get("system_identifier"):
    raise SystemExit("Synthetic reconstruction did not use a separate cluster")
PY
client -X -q --no-password --single-transaction -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate -c "$require_admin" \
  -f /backup/roles.sql \
  -f /backup/schema.sql \
  -f /backup/history-schema.sql \
  -c 'SET session_replication_role = replica' \
  -d "$dsn_b" > "$root/reconstruction.stdout" 2> "$root/reconstruction.stderr"
client -X -q -A -t --no-password -v ON_ERROR_STOP=1 \
  -f /private/catalog-after.sql -d "postgresql://postgres:synthetic@127.0.0.1:$port_b/postgres" \
  > "$root/catalog-after.json" 2> "$root/catalog-after.stderr"
python3 - "$root/target-b-before.json" "$root/catalog-after.json" <<'PY'
import json
from pathlib import Path
import sys

before, after = (json.loads(Path(name).read_text(encoding="utf-8")) for name in sys.argv[1:])
if not (
    isinstance(before, dict)
    and isinstance(after, dict)
    and before.get("server_version_num", 0) // 10000 == 17
    and before.get("database") == "postgres"
    and before.get("auth_users_present") is True
    and before.get("public_recipes_absent") is True
    and before.get("public_profiles_absent") is True
    and after.get("system_identifier") == before.get("system_identifier")
    and after.get("server_version_num", 0) // 10000 == 17
    and after.get("database") == "postgres"
    and after.get("auth_users_present") is True
    and isinstance(after.get("candidate"), dict)
    and after["candidate"].get("sequence_present") is None
    and after["candidate"].get("relkind") is None
    and after["candidate"].get("missing_columns") == []
    and after["candidate"].get("relation_present") is False
    and after["candidate"].get("schema") is None
    and after["candidate"].get("name") is None
    and after["candidate"].get("kind") == "copy"
    and after["candidate"].get("requested_relation") == "public.owner_diag_absent"
):
    raise SystemExit("Synthetic catalog reconstruction did not match its fixture")
print("synthetic-owner-catalog-state=pass")
PY
label="$(python3 "$repo_root/scripts/owner_restore_diagnostic.py" finalize \
  --private-dir "$root" --target-before "$root/target-b-before.json" \
  --catalog-after "$root/catalog-after.json")"
printf 'synthetic-owner-diagnostic-label=%s\n' "$label"
if [[ "$label" != 'header-target-absent' ]]; then
  printf '%s\n' 'Synthetic private diagnostic label was not corroborated.' >&2
  exit 1
fi
printf '%s\n' 'synthetic-stage-b-rollback=pass'
printf '%s\n' 'synthetic-separate-catalog-reconstruction=pass'

# Prove the reconstructed objects are disposable before container teardown.
client -X -q --no-password -v ON_ERROR_STOP=1 -d "$dsn_b" \
  -c 'DROP TABLE IF EXISTS public.owner_diag_present CASCADE; DROP SCHEMA IF EXISTS owner_diag_history CASCADE; DROP ROLE IF EXISTS owner_diag_synthetic;' \
  > "$root/object-cleanup.stdout" 2> "$root/object-cleanup.stderr"
clean_state="$(client -X -q -A -t --no-password -v ON_ERROR_STOP=1 -d "$dsn_b" \
  -c "SELECT concat((pg_catalog.to_regclass('public.owner_diag_present') IS NULL)::int, '|', (NOT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname='owner_diag_history'))::int, '|', (NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='owner_diag_synthetic'))::int)")"
if [[ "$clean_state" != '1|1|1' ]]; then
  printf '%s\n' 'Synthetic reconstruction cleanup state did not match.' >&2
  exit 1
fi
