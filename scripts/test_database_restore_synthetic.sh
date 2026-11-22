#!/usr/bin/env bash
# Credential-free SQL compatibility probe. Do not use real backups or provider credentials.
set -euo pipefail

: "${PSQL_IMAGE:?The digest-pinned PostgreSQL client image is required}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
classifier="$script_dir/classify_restore_component.py"
umask 077
root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/moris-restore-synthetic.XXXXXX")"
workdir="$root/local"
fixture="$root/restore-verified-sql"

cleanup() {
  local original_status=$?
  trap - EXIT
  if [[ -f "$workdir/supabase/config.toml" ]]; then
    if supabase stop --workdir "$workdir" --no-backup > /dev/null 2>&1; then
      printf '%s\n' 'synthetic-database-shutdown=pass'
    else
      printf '%s\n' '::warning::Disposable Supabase shutdown failed; runner teardown will recycle it.'
      if (( original_status == 0 )); then original_status=1; fi
    fi
  fi
  if rm -rf "$root" > /dev/null 2>&1 && [[ ! -e "$root" ]]; then
    printf '%s\n' 'synthetic-fixture-cleanup=pass'
  else
    printf '%s\n' 'synthetic-fixture-cleanup=fail' >&2
    if (( original_status == 0 )); then original_status=1; fi
  fi
  exit "$original_status"
}
trap cleanup EXIT
mkdir -p "$fixture"

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
client_version="$("${client[@]}" psql --version)"
server_version="$("${client[@]}" psql -X -A -t --no-password -v ON_ERROR_STOP=1 \
  -c 'SHOW server_version' -d "$local_db")"
if [[ ! "$client_version" =~ ^psql[[:space:]]\(PostgreSQL\)[[:space:]]17[.]11([[:space:]]|$) ||
      ! "$server_version" =~ ^17[.]11([[:space:]]|$) ]]; then
  echo '::error::Expected PostgreSQL 17.11 client and server'
  exit 1
fi
echo 'Synthetic client/server version=17.11'

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

# Run the actual protected replay and verification commands against synthetic
# files only. No archive, Environment, or workflow dispatch is involved.
python3 - "$script_dir/../.github/workflows" "$root" <<'PY'
from pathlib import Path
import sys
import textwrap

workflows, target = map(Path, sys.argv[1:])
for workflow, step, output in (
    ("stage-b", "Restore SQL transactionally using patched PostgreSQL 17 client", "admin-restore"),
    ("stage-b", "Validate restored application counts and migration versions", "aggregates"),
    ("role-diagnostic", "Record bounded role patterns and replay diagnostics", "role-replay"),
):
    source = (workflows / f"database-restore-{workflow}.yml").read_text(encoding="utf-8")
    _, body = source.split(f"      - name: {step}\n        shell: bash\n        run: |\n")
    (target / f"{output}.sh").write_text(textwrap.dedent(body.split("\n      - name:", 1)[0]),
                                       encoding="utf-8")
PY

run_restore_step() (
  cd "$script_dir/.." || exit 1
  # Use a separate Bash process so the checked-in step keeps its own errexit.
  RUNNER_TEMP="$root" GITHUB_STEP_SUMMARY="$root/synthetic-summary.md" \
    bash --noprofile --norc -c '
      substitute_db="$2"
      admin_db="$3"
      if [[ -n "$substitute_db" ]]; then
        docker() {
          local args=("$@") index
          for index in "${!args[@]}"; do
            if [[ "${args[index]}" == "$admin_db" ]]; then
              args[index]="$substitute_db"
            fi
          done
          command docker "${args[@]}"
        }
      fi
      source "$1"
    ' bash "$root/$1.sh" "${2:-}" "$admin_db" > "$root/step.out" 2> "$root/step.err"
)

require_clean_restore() {
  if [[ "$(principal_query "$admin_db" \
      "SELECT (to_regclass('public.profiles') IS NULL
               AND to_regclass('supabase_migrations.schema_migrations') IS NULL
               AND NOT EXISTS (SELECT FROM pg_roles
                               WHERE rolname IN ('devops_restore_synthetic', 'devops_restore_reader')))::int")" != 1 ]]; then
    echo '::error::Synthetic administrative replay did not preserve the clean baseline'
    exit 1
  fi
}

cat > "$fixture/roles.sql" <<SQL
\echo SYNTHETIC_ADMIN_FILES_REACHED
\restrict SyntheticRestoreGuard2026
CREATE ROLE devops_restore_synthetic NOLOGIN;
CREATE ROLE devops_restore_reader NOLOGIN;
GRANT devops_restore_synthetic TO devops_restore_reader;
GRANT SET ON PARAMETER $parameter TO devops_restore_reader;
\unrestrict SyntheticRestoreGuard2026
SQL
# Cover source ownership plus explicit read access on admin-owned objects.
cat >> "$fixture/schema.sql" <<'SQL'
ALTER TABLE public.profiles OWNER TO postgres;
GRANT SELECT ON public.recipes, public.recipe_lineage, public.ai_usage_daily,
  public.ai_quota_reservations TO postgres;
SQL
cat > "$fixture/history-schema.sql" <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
GRANT USAGE ON SCHEMA supabase_migrations TO postgres;
GRANT SELECT ON supabase_migrations.schema_migrations TO postgres;
SQL
sed 's/devops_restore_synthetic[.]schema_migrations/supabase_migrations.schema_migrations/' \
  "$fixture/history-data.sql" > "$root/history-data.sql"
cp "$root/history-data.sql" "$fixture/history-data.sql"

require_clean_restore
for rejected in wrong-identity unavailable; do
  case "$rejected" in
    wrong-identity) db="$local_db"; expected_exit=1; phase=restore ;;
    unavailable)
      db='postgresql://devops_restore_missing_login:postgres@127.0.0.1:54322/postgres'
      expected_exit=2
      phase=connection
      ;;
  esac
  status=0
  run_restore_step admin-restore "$db" || status=$?
  if [[ "$status" != "$expected_exit" ]] ||
      ! grep -Fq "phase=$phase category=" "$root/step.out" ||
      grep -Fq 'SYNTHETIC_ADMIN_FILES_REACHED' "$root/private-restore-result.log"; then
    printf '::error::Synthetic administrative rejection failed: %s\n' "$rejected"
    exit 1
  fi
  if [[ "$rejected" == wrong-identity ]] &&
      ! grep -Fxq 'ERROR:  42501' "$root/private-restore-stderr.log"; then
    echo '::error::Synthetic wrong identity did not reach the administrative guard'
    exit 1
  fi
  require_clean_restore
  printf 'synthetic-admin-rejection=%s exit=%d sql-files-skipped=yes\n' "$rejected" "$status"
done

# The role-only probe also rejects the wrong login without publishing flags.
status=0
run_restore_step role-replay "$local_db" || status=$?
if [[ "$status" != 1 || -e "$root/synthetic-summary.md" ]] ||
    ! grep -Fxq '::error::Local role attribute probe failed' "$root/step.out"; then
  echo '::error::Synthetic role diagnostic did not reject the wrong identity'
  exit 1
fi
require_clean_restore
echo 'synthetic-admin-role-diagnostic=expected-failure wrong-identity=yes summary-absent=yes'

# The diagnostic must publish the guarded admin's flags even on SQL failure.
cp "$fixture/roles.sql" "$root/roles.sql"
echo 'GRANT devops_restore_missing TO devops_restore_synthetic;' >> "$fixture/roles.sql"
status=0
run_restore_step role-replay || status=$?
if [[ "$status" != 1 ]] ||
    ! grep -Fq 'superuser=1 ' "$root/synthetic-summary.md" ||
    ! grep -Fq 'replay=failed category=undefined-object' "$root/synthetic-summary.md" ||
    grep -Fq 'SYNTHETIC_ADMIN_FILES_REACHED' "$root/step.out" "$root/step.err" "$root/synthetic-summary.md"; then
  echo '::error::Synthetic administrative role diagnostic failed'
  exit 1
fi
require_clean_restore
cp "$root/roles.sql" "$fixture/roles.sql"
echo 'synthetic-admin-role-diagnostic=pass failed-replay-reported=yes rollback=pass'

# Exercise the checked-in Stage B diagnostic on a real notice and bad COPY value.
cp "$fixture/data.sql" "$root/admin-data.sql"
cat >> "$fixture/data.sql" <<'SQL'
SET LOCAL client_min_messages = notice;
DO $synthetic$ BEGIN
  RAISE NOTICE 'SYNTHETIC_PRIVATE_COPY_NOTICE';
END $synthetic$;
COPY public.recipes (id) FROM stdin;
SYNTHETIC_PRIVATE_INVALID_INTEGER
\.
SQL
status=0
run_restore_step admin-restore || status=$?
if [[ "$status" != 3 ]] ||
    ! grep -Eq '^psql:/backup/data[.]sql:[0-9]+: NOTICE:  00000$' "$root/private-restore-stderr.log" ||
    ! grep -Eq '^psql:/backup/data[.]sql:[0-9]+: ERROR:  22P02$' "$root/private-restore-stderr.log" ||
    ! grep -Fxq '::error::Restore diagnostic: phase=restore category=sql-script exit_code=3 component_hint=data.sql untrusted_error_category_hint=invalid-text-representation untrusted_statement_class_hint=unknown; private output suppressed' "$root/step.out" ||
    grep -Eq 'SYNTHETIC_PRIVATE_|psql:/backup/|22P02' "$root/step.out" "$root/step.err"; then
  echo '::error::Synthetic data COPY failure did not produce the expected redacted diagnostic'
  exit 1
fi
require_clean_restore
cp "$root/admin-data.sql" "$fixture/data.sql"
echo 'synthetic-admin-data-diagnostic=pass category=invalid-text-representation rollback=pass'

# Phase 1A: run the checked-in Stage B step for each synthetic 42P01 case.
# The baseline lives across restore transactions to distinguish rollback from setval.
if ! principal_query "$admin_db" \
    'CREATE SCHEMA phase276_baseline;
     CREATE TABLE phase276_baseline.rows (id integer);
     CREATE SEQUENCE phase276_baseline.seq START WITH 11;' > "$root/phase276-setup.out"; then
  echo '::error::Synthetic 42P01 baseline setup failed'
  exit 1
fi
cp "$fixture/schema.sql" "$root/phase276-schema.sql"
cat >> "$fixture/schema.sql" <<'SQL'
CREATE SCHEMA phase276;
CREATE SEQUENCE phase276.transient_seq;
CREATE TABLE phase276.copy_target (payload text);
CREATE FUNCTION phase276.check_row() RETURNS trigger LANGUAGE plpgsql AS $check$
BEGIN
  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'Unexpected replication role';
  END IF;
  IF NEW.payload = 'fail-row' THEN
    PERFORM 1 FROM phase276.missing_dependency;
  END IF;
  RETURN NEW;
END;
$check$;
CREATE TRIGGER check_row BEFORE INSERT ON phase276.copy_target
  FOR EACH ROW EXECUTE FUNCTION phase276.check_row();
ALTER TABLE phase276.copy_target ENABLE ALWAYS TRIGGER check_row;
SQL

require_phase276_rollback() {
  local case_name="$1" expected_sequence state
  require_clean_restore
  expected_sequence='11|f'
  [[ "$case_name" != missing-sequence ]] || expected_sequence='23|t'
  if ! state="$(principal_query "$admin_db" \
      "SELECT (to_regnamespace('phase276') IS NULL
               AND NOT EXISTS (SELECT FROM phase276_baseline.rows))::int, last_value, is_called
       FROM phase276_baseline.seq")" || [[ "$state" != "1|$expected_sequence" ]]; then
    printf '::error::Synthetic 42P01 case %s rollback or sequence-state check failed\n' "$case_name"
    exit 1
  fi
}

location_test="$script_dir/test_database_restore_failure_locations.py"
phase276_cases=(missing-copy-target copy-header-expression row-dependency-short
    row-dependency-streamed unsupported-sql ambiguous-record missing-sequence)
for case_name in "${phase276_cases[@]}"; do
  python3 "$location_test" write "$case_name" "$root"
  status=0
  run_restore_step admin-restore || status=$?
  if [[ "$status" != 3 ]]; then
    printf '::error::Synthetic 42P01 case %s expected exit 3; received %d\n' "$case_name" "$status"
    exit 1
  fi
  python3 "$location_test" check "$case_name" "$root"
  require_phase276_rollback "$case_name"
done

# Phase 1B: retain Phase 1A controls and replay the same failures with a
# supported dump prefix. Capture all catalog replay output under the same trap.
if ! principal_query "$admin_db" \
    "SELECT pg_catalog.setval('phase276_baseline.seq', 11, false)" > "$root/phase276-reset.out"; then
  echo '::error::Synthetic Phase 1B sequence reset failed'
  exit 1
fi

phase276_catalog_probe() {
  # Rebuild only the preceding schema components in a fresh transaction.
  # ON_ERROR_STOP closes the session on errors, causing a rollback.
  "${client[@]}" psql -X -qAt --no-password -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
    -c 'BEGIN' \
    -c "DO \$guard\$ BEGIN
          IF current_user <> 'supabase_admin' OR session_user <> 'supabase_admin'
              OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
          THEN RAISE insufficient_privilege;
          END IF;
        END \$guard\$;" \
    -f /backup/roles.sql -f /backup/schema.sql -f /backup/history-schema.sql \
    -c 'SET session_replication_role = replica' -f /backup/phase276-catalog.sql \
    -c 'ROLLBACK' -d "$admin_db" > "$root/phase276-catalog.out" 2> "$root/phase276-catalog.err"
}

attribution_test="$script_dir/test_database_restore_data_failure.py"
for case_name in "${phase276_cases[@]}"; do
  python3 "$attribution_test" write "$case_name" "$root"
  status=0
  run_restore_step admin-restore || status=$?
  if [[ "$status" != 3 ]]; then
    printf '::error::Synthetic Phase 1B case %s expected exit 3; received %d\n' "$case_name" "$status"
    exit 1
  fi
  catalog_expected="$(python3 "$attribution_test" check "$case_name" "$root")"
  case "$catalog_expected" in
    candidate-absent|candidate-present)
      if ! phase276_catalog_probe ||
          ! printf 'SYNTHETIC_ADMIN_FILES_REACHED\n%s\n' "$catalog_expected" |
                cmp -s - "$root/phase276-catalog.out"; then
        echo '::error::Synthetic Phase 1B catalog corroboration failed'
        exit 1
      fi
      rm -f "$fixture/phase276-catalog.sql"
      ;;
    not-probed)
      [[ ! -e "$fixture/phase276-catalog.sql" ]]
      ;;
    *)
      echo '::error::Synthetic Phase 1B unexpected catalog label'
      exit 1
      ;;
  esac
  require_phase276_rollback "$case_name"
  printf 'Synthetic Phase 1B case %s: attribution=pass catalog=%s rollback=pass\n' \
    "$case_name" "$catalog_expected"
done
if ! principal_query "$admin_db" \
    'DROP TABLE phase276_baseline.rows; DROP SEQUENCE phase276_baseline.seq; DROP SCHEMA phase276_baseline;' \
    > "$root/phase276-cleanup.out"; then
  echo '::error::Synthetic 42P01 baseline cleanup failed'
  exit 1
fi
cp "$root/phase276-schema.sql" "$fixture/schema.sql"
cp "$root/admin-data.sql" "$fixture/data.sql"
echo 'Synthetic 42P01 rollback and sequence state verified; baseline removed.'

# Fail after all five components have been reached, then replay pristine fixtures.
echo 'SELECT 1 / 0;' >> "$fixture/history-data.sql"
status=0
run_restore_step admin-restore || status=$?
if [[ "$status" != 3 ]] ||
    ! grep -Fq 'exit_code=3 component_hint=history-data.sql ' "$root/step.out" ||
    ! grep -Eq '^psql:/backup/history-data[.]sql:[0-9]+: ERROR:  22012$' "$root/private-restore-stderr.log"; then
  echo '::error::Synthetic administrative restore did not reach the intended SQL failure'
  exit 1
fi
require_clean_restore
cp "$root/history-data.sql" "$fixture/history-data.sql"
echo 'synthetic-admin-replay=expected-failure exit=3 sqlstate=22012 rollback=pass'

if ! run_restore_step admin-restore ||
    ! grep -Fq 'Transactional isolated SQL restore passed.' "$root/step.out" ||
    grep -Fq 'SYNTHETIC_ADMIN_FILES_REACHED' "$root/step.out" "$root/step.err"; then
  echo '::error::Synthetic administrative restore failed'
  exit 1
fi
effects="$(principal_query "$admin_db" \
  "SELECT (pg_has_role('devops_restore_reader', 'devops_restore_synthetic', 'MEMBER')
           AND has_parameter_privilege('devops_restore_reader', '$parameter', 'SET')
           AND (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.profiles'::regclass) = 'postgres'
           AND (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.recipes'::regclass) = 'supabase_admin')::int")"
[[ "$effects" == 1 ]] || {
  echo '::error::Synthetic administrative replay did not preserve expected grants and owners'
  exit 1
}
echo 'synthetic-admin-replay=pass membership=pass parameter=pass ownership=pass'

if ! run_restore_step aggregates ||
    ! grep -Fq 'Five application table counts and the migration version set match the backup.' "$root/step.out"; then
  echo '::error::Synthetic postgres aggregate verification failed after administrative replay'
  exit 1
fi
echo 'synthetic-postgres-aggregates=pass'

# Supabase can give postgres read access through predefined roles and default
# grants. Remove those paths in this throwaway fixture and verify the effective ACL.
if ! principal_query "$admin_db" \
    'REVOKE pg_read_all_data FROM postgres;
     REVOKE SELECT ON public.recipes FROM PUBLIC, postgres, anon, authenticated, service_role;' \
    > "$root/revoke.out" ||
    [[ "$(principal_query "$admin_db" \
      "SELECT has_table_privilege('postgres', 'public.recipes', 'SELECT')::int")" != 0 ]]; then
  echo '::error::Synthetic postgres negative ACL fixture still allows reads or could not be prepared'
  exit 1
fi
status=0
run_restore_step aggregates || status=$?
if [[ "$status" != 1 ]] || ! grep -Fxq '::error::Database aggregate verification query failed' "$root/step.out"; then
  echo '::error::Synthetic postgres verification did not fail closed without read access'
  exit 1
fi
echo 'synthetic-postgres-aggregates=expected-failure missing-select=yes'
echo 'Synthetic compatibility probe passed. No private archive or managed-schema compatibility is claimed.'
