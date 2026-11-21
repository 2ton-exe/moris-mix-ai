#!/usr/bin/env bash
# Credential-free SQL compatibility probe. Do not use real backups or provider credentials.
set -euo pipefail

: "${PSQL_IMAGE:?The digest-pinned PostgreSQL client image is required}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
classifier="$script_dir/classify_restore_component.py"
root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/moris-restore-synthetic.XXXXXX")"
workdir="$root/local"
fixture="$root/fixtures"
mkdir -p "$fixture"
umask 077

cleanup() {
  local original_status=$?
  trap - EXIT
  if [[ -f "$workdir/supabase/config.toml" ]]; then
    if supabase stop --workdir "$workdir" --no-backup > /dev/null 2>&1; then
      printf '%s\n' 'synthetic-database-shutdown=pass'
    else
      printf '%s\n' '::warning::Disposable Supabase shutdown failed; runner teardown will recycle it.'
      original_status=1
    fi
  fi
  if rm -rf "$root" > /dev/null 2>&1; then
    printf '%s\n' 'synthetic-fixture-cleanup=pass'
  else
    printf '%s\n' 'synthetic-fixture-cleanup=fail' >&2
    original_status=1
  fi
  exit "$original_status"
}
trap cleanup EXIT

# Generate an independent local Supabase project. Never load repository or hosted config.
supabase init --workdir "$workdir"
python3 - "$workdir/supabase/config.toml" <<'PY'
from pathlib import Path
import re
import sys
import tomllib

p = Path(sys.argv[1])
updated, replacements = re.subn(
    r'(?m)^([ \t]*major_version[ \t]*=[ \t]*)(?:"[0-9]+"|[0-9]+)([ \t]*(?:#.*)?)$',
    r'\g<1>17\2',
    p.read_text(encoding='utf-8'),
)
if replacements != 1 or tomllib.loads(updated)['db']['major_version'] != 17:
    raise SystemExit('Disposable PostgreSQL 17 configuration failed')
p.write_text(updated, encoding='utf-8')
PY
supabase db start --workdir "$workdir"

local_db='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
server_version="$(psql "$local_db" -X -A -t -v ON_ERROR_STOP=1 -c 'SHOW server_version')"
[[ "$server_version" == 17.11* ]] || {
  echo "::error::Unexpected disposable PostgreSQL version: $server_version"
  exit 1
}
# The pinned CLI currently selects this server image. Fail if it drifts.
if ! docker ps --format '{{.Image}}' | grep -Eq '(^|/)supabase/postgres:17[.]11[.]0[.]006$'; then
  echo '::error::The expected Supabase PostgreSQL server image is not running'
  exit 1
fi

client=(docker run --rm --network host \
  --user "$(id -u):$(id -g)" --cap-drop ALL \
  --security-opt no-new-privileges --read-only \
  --mount "type=bind,source=$fixture,target=/backup,readonly" \
  "$PSQL_IMAGE")
"${client[@]}" psql --version

# The setting is tested on the exact pinned client/server pair.
"${client[@]}" psql -X -q -v ON_ERROR_STOP=1 \
  -c 'BEGIN; SET LOCAL session_replication_role = replica; ROLLBACK;' -d "$local_db"
echo 'Transaction-scoped replication-role probe passed.'

# Every SQL component is synthetic; these are not copies of production schemas.
cat > "$fixture/roles.sql" <<'SQL'
\restrict SyntheticRestoreGuard2026
CREATE ROLE devops_restore_synthetic NOLOGIN;
\unrestrict SyntheticRestoreGuard2026
SQL
cat > "$fixture/schema.sql" <<'SQL'
CREATE TABLE public.profiles (id integer PRIMARY KEY);
CREATE TABLE public.recipes (id integer PRIMARY KEY);
CREATE TABLE public.recipe_lineage (id integer PRIMARY KEY);
CREATE TABLE public.ai_usage_daily (id integer PRIMARY KEY);
CREATE TABLE public.ai_quota_reservations (id integer PRIMARY KEY);
SQL
cat > "$fixture/history-schema.sql" <<'SQL'
CREATE SCHEMA devops_restore_synthetic;
CREATE TABLE devops_restore_synthetic.schema_migrations (version text PRIMARY KEY);
SQL
cat > "$fixture/data.sql" <<'SQL'
COPY public.profiles (id) FROM stdin;
1
\.
COPY public.recipes (id) FROM stdin;
1
\.
COPY public.recipe_lineage (id) FROM stdin;
1
\.
COPY public.ai_usage_daily (id) FROM stdin;
1
\.
COPY public.ai_quota_reservations (id) FROM stdin;
1
\.
SQL
cat > "$fixture/history-data.sql" <<'SQL'
COPY devops_restore_synthetic.schema_migrations (version) FROM stdin;
20261114000000
20261114000001
\.
SQL

replication_command='SET session_replication_role = replica'
restore() {
  "${client[@]}" psql -X -q -A -t --single-transaction -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate \
    -f /backup/roles.sql \
    -f /backup/schema.sql \
    -f /backup/history-schema.sql \
    -c "$replication_command" \
    -f /backup/data.sql \
    -f /backup/history-data.sql \
    -d "$local_db"
}

expect_failure() {
  local case_name="$1" expected_code="$2" expected_component="$3"
  local expected_category="${4:-unknown}" expected_statement="${5:-unknown}"
  local code details component category statement rolled_back
  if restore > "$root/negative.log" 2> "$root/negative.stderr"; then
    echo '::error::Deliberate synthetic SQL failure unexpectedly succeeded'
    exit 1
  else
    code=$?
  fi
  [[ "$code" == "$expected_code" ]] || {
    printf '::error::Synthetic case %s expected exit %d; received %d\n' "$case_name" "$expected_code" "$code"
    exit 1
  }
  # Ensure an earlier unrelated script error cannot satisfy a negative trial.
  if [[ "$expected_code" == 3 ]] && ! grep -Fxq 'SYNTHETIC_FAILURE_REACHED' "$root/negative.log"; then
    echo '::error::Synthetic trial stopped before the intended failing statement'
    exit 1
  fi
  details='unknown unknown unknown'
  if [[ "$code" == 3 ]]; then
    details="$(python3 "$classifier" --details "$root/negative.stderr" "$code" \
      "$fixture/roles.sql" 2> /dev/null)" || details='unknown unknown unknown'
  fi
  read -r component category statement extra <<< "$details"
  [[ -z "${extra:-}" ]] || {
    echo '::error::Synthetic classifier returned unexpected output'
    exit 1
  }
  [[ "$component $category $statement" == \
     "$expected_component $expected_category $expected_statement" ]] || {
    printf '::error::Synthetic case %s returned unexpected fixed diagnostic labels\n' "$case_name"
    exit 1
  }
  rolled_back="$("${client[@]}" psql -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT (to_regclass('public.profiles') IS NULL AND
                to_regclass('devops_restore_synthetic.schema_migrations') IS NULL AND
                NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devops_restore_synthetic'))::integer" \
    -d "$local_db")"
  [[ "$rolled_back" == 1 ]] || {
    echo '::error::Synthetic restore did not roll back created tables/role'
    exit 1
  }
  printf 'Synthetic case %s: exit=%d component_hint=%s untrusted_error_category_hint=%s untrusted_statement_class_hint=%s; rollback verified.\n' \
    "$case_name" "$code" "$component" "$category" "$statement"
}

# Each failure uses the unchanged command order and a clean rolled-back baseline.
for component in roles.sql schema.sql history-schema.sql data.sql history-data.sql; do
  cp "$fixture/$component" "$root/component-base.sql"
  printf '\n\\echo SYNTHETIC_FAILURE_REACHED\nSELECT 1 / 0;\n' >> "$fixture/$component"
  expect_failure "$component" 3 "$component"
  cp "$root/component-base.sql" "$fixture/$component"
done

# Exercise actual psql role-file errors with invented names/settings. The marker
# is a complete one-line SQL statement so the bounded lookup can validate its prefix.
cp "$fixture/roles.sql" "$root/roles-base.sql"
cat >> "$fixture/roles.sql" <<'SQL'
SELECT 'SYNTHETIC_FAILURE_REACHED';
GRANT devops_restore_synthetic_missing_group TO devops_restore_synthetic;
SQL
expect_failure role-membership-undefined-role 3 roles.sql undefined-object role-membership-grant
cp "$root/roles-base.sql" "$fixture/roles.sql"
cat >> "$fixture/roles.sql" <<'SQL'
SELECT 'SYNTHETIC_FAILURE_REACHED';
ALTER ROLE devops_restore_synthetic SET moris_mix_missing_restore_setting TO 'x';
SQL
expect_failure role-setting-undefined-parameter 3 roles.sql undefined-object alter-role-set
cp "$root/roles-base.sql" "$fixture/roles.sql"

# The named grantor exists but has no ADMIN OPTION on the group.
cat >> "$fixture/roles.sql" <<'SQL'
CREATE ROLE devops_synthetic_group NOLOGIN;
CREATE ROLE devops_synthetic_member NOLOGIN;
GRANT devops_restore_synthetic TO postgres WITH SET TRUE;
SET ROLE devops_restore_synthetic;
SELECT 'SYNTHETIC_FAILURE_REACHED';
GRANT "devops_synthetic_group" TO "devops_synthetic_member" WITH INHERIT TRUE GRANTED BY "devops_restore_synthetic";
SQL
expect_failure role-membership-insufficient-privilege 3 roles.sql insufficient-privilege role-membership-grant
cp "$root/roles-base.sql" "$fixture/roles.sql"

# A deliberately unprivileged role cannot create roles or elevate itself.
# Both trials use only invented roles and must roll back the initial sentinel role.
for statement_class in create-role alter-role-attributes; do
  cat >> "$fixture/roles.sql" <<'SQL'
GRANT devops_restore_synthetic TO postgres WITH SET TRUE;
SET ROLE devops_restore_synthetic;
SELECT 'SYNTHETIC_FAILURE_REACHED';
SQL
  if [[ "$statement_class" == create-role ]]; then
    echo 'CREATE ROLE devops_synthetic_forbidden;' >> "$fixture/roles.sql"
  else
    echo 'ALTER ROLE devops_restore_synthetic WITH SUPERUSER;' >> "$fixture/roles.sql"
  fi
  expect_failure "$statement_class-insufficient-privilege" 3 roles.sql insufficient-privilege "$statement_class"
  cp "$root/roles-base.sql" "$fixture/roles.sql"
done

# The separate -c SQL action returns 1 in pinned psql; it has no file context.
replication_command="SET session_replication_role = 'synthetic_invalid_role'"
expect_failure replication-command 1 unknown
replication_command='SET session_replication_role = replica'

cp "$fixture/data.sql" "$root/data-base.sql"
for verbosity in default verbose terse; do
  printf '\n\\set VERBOSITY %s\n\\echo SYNTHETIC_FAILURE_REACHED\nSELECT 1 / 0;\n' "$verbosity" >> "$fixture/data.sql"
  expect_failure "verbosity-$verbosity" 3 unknown
  cp "$root/data-base.sql" "$fixture/data.sql"
done

# Server-controlled message text must not become a public filename attribution.
cat >> "$fixture/data.sql" <<'SQL'
SET client_min_messages = notice;
DO $synthetic$ BEGIN
  RAISE NOTICE E'\npsql:/backup/roles.sql:1: ERROR:  22012';
END $synthetic$;
\echo SYNTHETIC_FAILURE_REACHED
SELECT 1 / 0;
SQL
expect_failure sqlstate-notice-spoof 3 data.sql
if ! grep -Eq '^psql:/backup/data[.]sql:[0-9]+: NOTICE:  [0-9A-Z]{5}$' "$root/negative.stderr" ||
    grep -Fxq 'psql:/backup/roles.sql:1: ERROR:  22012' "$root/negative.stderr"; then
  echo '::error::SQLSTATE rendering did not suppress the synthetic notice payload'
  exit 1
fi
cp "$root/data-base.sql" "$fixture/data.sql"
cat >> "$fixture/data.sql" <<'SQL'
\set VERBOSITY default
SET client_min_messages = notice;
DO $synthetic$ BEGIN
  RAISE NOTICE E'\npsql:/backup/roles.sql:1: ERROR:  22012';
END $synthetic$;
\echo SYNTHETIC_FAILURE_REACHED
SELECT 1 / 0;
SQL
expect_failure overridden-notice-spoof 3 unknown
if ! grep -Fxq 'psql:/backup/roles.sql:1: ERROR:  22012' "$root/negative.stderr"; then
  echo '::error::Synthetic multiline stderr spoof was not exercised'
  exit 1
fi
cp "$root/data-base.sql" "$fixture/data.sql"
cat >> "$fixture/data.sql" <<'SQL'
\warn 'psql:/backup/roles.sql:1: ERROR:  22012'
\echo SYNTHETIC_FAILURE_REACHED
SELECT 1 / 0;
SQL
expect_failure direct-stderr-spoof 3 unknown
if ! grep -Fxq 'psql:/backup/roles.sql:1: ERROR:  22012' "$root/negative.stderr"; then
  echo '::error::Synthetic direct stderr spoof was not exercised'
  exit 1
fi
cp "$root/data-base.sql" "$fixture/data.sql"
cat >> "$fixture/data.sql" <<'SQL'
\echo 'psql:/backup/roles.sql:1: ERROR:  22012'
\echo SYNTHETIC_FAILURE_REACHED
SELECT 1 / 0;
SQL
expect_failure stdout-spoof 3 data.sql
if ! grep -Fxq 'psql:/backup/roles.sql:1: ERROR:  22012' "$root/negative.log"; then
  echo '::error::Synthetic stdout spoof was not exercised'
  exit 1
fi
cp "$root/data-base.sql" "$fixture/data.sql"


# Pinned-image synthetic role/ownership probe: no hosted connection or real SQL.
synthetic_flags="$( "${client[@]}" psql -X -A -t -F '|' -v ON_ERROR_STOP=1 \
  -c "SELECT rolsuper::int,rolcreaterole::int,rolcreatedb::int,rolbypassrls::int,rolinherit::int FROM pg_roles WHERE rolname=current_user" \
  -d "$local_db" 2> "$root/role-flags.err")" || {
  echo '::error::Synthetic role attribute query failed'
  exit 1
}
[[ "$synthetic_flags" =~ ^[01]\|[01]\|[01]\|[01]\|[01]$ ]] || {
  echo '::error::Unexpected synthetic role attribute result'
  exit 1
}
echo 'Synthetic role attribute booleans verified.'
# Separate creation from transfer: the captured permission failure must be
# caused by ALTER OWNER, not an unrelated CREATE TABLE failure.
if ! "${client[@]}" psql -X -q -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE public.devops_owner_probe (id integer);' \
  -d "$local_db" > "$root/owner-create.out" 2> "$root/owner-create.err"; then
  echo '::error::Synthetic owner probe table setup failed'
  exit 1
fi
owner_before="$("${client[@]}" psql -X -Atq -v ON_ERROR_STOP=1 \
  -c "SELECT (pg_get_userbyid(relowner) = current_user)::int FROM pg_class WHERE oid = 'public.devops_owner_probe'::regclass;" \
  -d "$local_db" 2> "$root/owner-before.err")" || {
  echo '::error::Synthetic owner probe baseline query failed'
  exit 1
}
[[ "$owner_before" == 1 ]] || {
  echo '::error::Synthetic ownership baseline unexpectedly differs'
  exit 1
}
# The pinned local Supabase image is expected to reject this exact transfer.
# Its outcome is explicitly asserted; do not treat either result as a pass.
if "${client[@]}" psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  -c 'BEGIN; ALTER TABLE public.devops_owner_probe OWNER TO supabase_admin; ROLLBACK;' \
  -d "$local_db" > "$root/owner-probe.out" 2> "$root/owner-probe.err"; then
  echo '::error::Unexpected successful synthetic ALTER OWNER transfer'
  exit 1
elif ! grep -Fxq 'ERROR:  42501' "$root/owner-probe.err"; then
  echo '::error::Synthetic ALTER OWNER failed outside the expected SQLSTATE category'
  exit 1
fi
owner_after="$("${client[@]}" psql -X -Atq -v ON_ERROR_STOP=1 \
  -c "SELECT (pg_get_userbyid(relowner) = current_user)::int FROM pg_class WHERE oid = 'public.devops_owner_probe'::regclass;" \
  -d "$local_db" 2> "$root/owner-after.err")" || {
  echo '::error::Synthetic ownership rollback query failed'
  exit 1
}
[[ "$owner_after" == 1 ]] || {
  echo '::error::Synthetic ALTER OWNER did not preserve initial object ownership'
  exit 1
}
"${client[@]}" psql -X -q -v ON_ERROR_STOP=1 \
  -c 'DROP TABLE public.devops_owner_probe;' -d "$local_db" \
  > "$root/owner-cleanup.out" 2> "$root/owner-cleanup.err" || {
  echo '::error::Synthetic owner probe table cleanup failed'
  exit 1
}
echo 'Synthetic ALTER OWNER 42501 isolated; baseline ownership and cleanup verified.'

# Positive control: restore all original fixtures, then check the persisted data.
restore > "$root/positive.log" 2> "$root/positive.stderr" || {
  echo '::error::Synthetic restore failed; synthetic-only SQL log kept off Actions output'
  exit 1
}

counts="$("${client[@]}" psql -X -A -t -F '|' -v ON_ERROR_STOP=1 \
  -c "SELECT
         (SELECT count(*) FROM public.profiles),
         (SELECT count(*) FROM public.recipes),
         (SELECT count(*) FROM public.recipe_lineage),
         (SELECT count(*) FROM public.ai_usage_daily),
         (SELECT count(*) FROM public.ai_quota_reservations),
         (SELECT count(*) FROM devops_restore_synthetic.schema_migrations),
         (SELECT string_agg(version, ',' ORDER BY version)
          FROM devops_restore_synthetic.schema_migrations)" \
  -d "$local_db")"
[[ "$counts" == '1|1|1|1|1|2|20261114000000,20261114000001' ]] || {
  echo '::error::Synthetic application counts or migration versions differ from fixtures'
  exit 1
}
echo 'Five synthetic application counts and two migration versions verified.'
echo 'Component hints are untrusted evidence; identical forged records cannot be authenticated.'

# Compare both principals on the existing disposable server. Do not reuse
# this administrative connection for any hosted database or private replay.
admin_db='postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres'
principal_query() {
  "${client[@]}" psql -X -qAt -F '|' --no-password -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -d "$1" -c "$2" 2> "$root/principal-query.err"
}

check_principal() {
  local role="$1" db="$2" expected_superuser="$3" flags
  if flags="$(principal_query "$db" \
      "SELECT rolsuper::int, rolcreaterole::int, rolcreatedb::int
       FROM pg_roles WHERE rolname = current_user
         AND current_user = '$role' AND session_user = '$role'")" &&
      [[ "$flags" =~ ^[01]\|[01]\|[01]$ ]]; then
    if [[ "$flags" == "$expected_superuser|1|1" ]]; then
      printf 'principal-attributes role=%s superuser=%s createrole=1 createdb=1 result=pass\n' \
        "$role" "$expected_superuser"
      return 0
    fi
    printf 'principal-attributes role=%s flags=%s result=unexpected\n' "$role" "$flags"
  else
    printf 'principal-attributes role=%s result=connection-or-identity-failure\n' "$role"
  fi
  return 1
}

failed=0
check_principal postgres "$local_db" 0 || failed=1
check_principal supabase_admin "$admin_db" 1 || failed=1
[[ "$failed" == 0 ]] || exit 1

if ! principal_query "$admin_db" \
    'CREATE ROLE devops_principal_group NOLOGIN; CREATE ROLE devops_principal_grantee NOLOGIN;' \
    > "$root/principal-setup.out"; then
  echo 'principal-fixture-setup=fail'
  exit 1
fi

# Pick a built-in setting on which postgres holds neither privilege. Otherwise
# PostgreSQL can return success with a warning and apply no grant at all.
if ! parameter="$(principal_query "$admin_db" \
    "SELECT name FROM (VALUES ('log_min_messages', 1), ('log_statement', 2),
                              ('log_min_error_statement', 3), ('session_replication_role', 4))
                     AS settings(name, priority)
     WHERE NOT has_parameter_privilege('postgres', name, 'SET')
       AND NOT has_parameter_privilege('postgres', name, 'ALTER SYSTEM')
       AND NOT has_parameter_privilege('devops_principal_grantee', name, 'SET')
     ORDER BY priority LIMIT 1")"; then
  parameter=
fi

principal_state() {
  principal_query "$admin_db" \
    "SELECT (to_regnamespace('devops_principal_$1') IS NOT NULL)::int, ($2)::int"
}

principal_replay() {
  local kind="$1" role="$2" db="$3" privilege="$4" expected="$5"
  local status=0 sqlstate=none grant_line=no state error
  local record='^psql:/backup/principal[.]sql:([12]): ERROR:  ([0-9A-Z]{5})$'
  "${client[@]}" psql -X -q --no-password --single-transaction -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -f /backup/principal.sql -d "$db" \
    > "$root/principal.out" 2> "$root/principal.err" || status=$?
  if (( status != 0 )); then
    sqlstate=unclassified
    error="$(< "$root/principal.err")"
    if [[ "$error" =~ $record ]]; then
      sqlstate="${BASH_REMATCH[2]}"
      [[ "${BASH_REMATCH[1]}" != 2 ]] || grant_line=yes
    fi
  fi
  if ! state="$(principal_state "$kind" "$privilege")" || [[ ! "$state" =~ ^[01]\|[01]$ ]]; then
    state='unknown|unknown'
  fi
  printf 'principal-grant kind=%s role=%s exit=%d sqlstate=%s grant-line=%s marker=%s granted=%s\n' \
    "$kind" "$role" "$status" "$sqlstate" "$grant_line" "${state%|*}" "${state#*|}"
  [[ "$status:$sqlstate:$grant_line:$state" == "$expected" ]]
}

compare_principals() {
  local kind="$1" grant_sql="$2" revoke_sql="$3" privilege="$4"
  local result=0
  if [[ "$(principal_state "$kind" "$privilege")" != '0|0' ]]; then
    printf 'principal-grant kind=%s baseline=fail\n' "$kind"
    return 1
  fi
  printf 'CREATE SCHEMA devops_principal_%s;\n%s;\n' "$kind" "$grant_sql" > "$fixture/principal.sql" ||
    return 1
  # Reset the effects of the administrative control before testing postgres
  # on the exact same file and verifying failed transaction rollback.
  principal_replay "$kind" supabase_admin "$admin_db" "$privilege" '0:none:no:1|1' || result=1
  if ! principal_query "$admin_db" "$revoke_sql; DROP SCHEMA IF EXISTS devops_principal_$kind;" \
      > "$root/principal-reset.out" || [[ "$(principal_state "$kind" "$privilege")" != '0|0' ]]; then
    printf 'principal-grant kind=%s reset=fail\n' "$kind"
    return 1
  fi
  principal_replay "$kind" postgres "$local_db" "$privilege" '3:42501:yes:0|0' || result=1
  return "$result"
}

compare_principals membership \
  'GRANT devops_principal_group TO devops_principal_grantee' \
  'REVOKE devops_principal_group FROM devops_principal_grantee' \
  "pg_has_role('devops_principal_grantee', 'devops_principal_group', 'MEMBER')" || failed=1
case "$parameter" in
  log_min_messages|log_statement|log_min_error_statement|session_replication_role)
    compare_principals parameter \
      "GRANT SET ON PARAMETER $parameter TO devops_principal_grantee" \
      "REVOKE SET ON PARAMETER $parameter FROM devops_principal_grantee" \
      "has_parameter_privilege('devops_principal_grantee', '$parameter', 'SET')" || failed=1
    ;;
  *)
    echo 'principal-grant kind=parameter baseline=fail'
    failed=1
    ;;
esac
if (( failed )); then
  echo 'synthetic-principal-comparison=fail'
  exit 1
fi
echo 'synthetic-principal-comparison=pass'
echo 'Synthetic compatibility probe passed. No private archive or managed-schema compatibility is claimed.'
