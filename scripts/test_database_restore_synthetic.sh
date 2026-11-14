#!/usr/bin/env bash
# Credential-free SQL compatibility probe. Do not use real backups or provider credentials.
set -euo pipefail

: "${PSQL_IMAGE:?The digest-pinned PostgreSQL client image is required}"
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
SELECT 1 / 0; -- Deliberate synthetic failure; remove for successful trial.
SQL
cat > "$fixture/history-data.sql" <<'SQL'
COPY devops_restore_synthetic.schema_migrations (version) FROM stdin;
20261114000000
20261114000001
\.
SQL

restore() {
  "${client[@]}" psql -X -q --single-transaction -v ON_ERROR_STOP=1 \
    -f /backup/roles.sql \
    -f /backup/schema.sql \
    -f /backup/history-schema.sql \
    -c 'SET session_replication_role = replica' \
    -f /backup/data.sql \
    -f /backup/history-data.sql \
    -d "$local_db"
}

# First, require a script failure and check that the earlier CREATE/COPY rolled back.
if restore > "$root/negative.log" 2>&1; then
  echo '::error::Deliberate synthetic SQL failure unexpectedly succeeded'
  exit 1
else
  code=$?
fi
[[ "$code" == 3 ]] || {
  echo "::error::Expected psql ON_ERROR_STOP exit code 3; received $code"
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
echo 'Deliberate SQL error: exit 3, transaction rollback verified.'

# Remove only the deliberately injected synthetic failure; keep all COPY fixtures.
grep -Fv 'SELECT 1 / 0; -- Deliberate synthetic failure' "$fixture/data.sql" > "$root/data-ok.sql"
mv "$root/data-ok.sql" "$fixture/data.sql"
restore > "$root/positive.log" 2>&1 || {
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
echo 'Synthetic compatibility probe passed. No private archive or managed-schema compatibility is claimed.'
