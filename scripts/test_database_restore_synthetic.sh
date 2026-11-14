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

cleanup() {
  local original_status=$?
  trap - EXIT
  if [[ -f "$workdir/supabase/config.toml" ]]; then
    if ! supabase stop --workdir "$workdir" --no-backup > /dev/null 2>&1; then
      printf '%s\n' '::warning::Disposable Supabase shutdown failed; runner teardown will recycle it.'
      original_status=1
    fi
  fi
  rm -rf "$root"
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
  "${client[@]}" psql -X -q --single-transaction -v ON_ERROR_STOP=1 \
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
  local case_name="$1" expected_code="$2" expected_hint="$3" code hint rolled_back
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
  hint=unknown
  if [[ "$code" == 3 ]]; then
    hint="$(python3 "$classifier" "$root/negative.stderr" "$code" 2> /dev/null)" || hint=unknown
  fi
  case "$hint" in
    roles.sql|schema.sql|history-schema.sql|data.sql|history-data.sql|unknown) ;;
    *) hint=unknown ;;
  esac
  [[ "$hint" == "$expected_hint" ]] || {
    printf '::error::Synthetic case %s returned unexpected component_hint=%s\n' "$case_name" "$hint"
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
  printf 'Synthetic case %s: exit=%d component_hint=%s; rollback verified.\n' "$case_name" "$code" "$hint"
}

# Each failure uses the unchanged command order and a clean rolled-back baseline.
for component in roles.sql schema.sql history-schema.sql data.sql history-data.sql; do
  cp "$fixture/$component" "$root/component-base.sql"
  printf '\n\\echo SYNTHETIC_FAILURE_REACHED\nSELECT 1 / 0;\n' >> "$fixture/$component"
  expect_failure "$component" 3 "$component"
  cp "$root/component-base.sql" "$fixture/$component"
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
echo 'Synthetic compatibility probe passed. No private archive or managed-schema compatibility is claimed.'
