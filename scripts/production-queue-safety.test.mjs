import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const step = (job, name) => job.steps.find(candidate => candidate.name === name);
const runNormalizeCopy = input => spawnSync('python3', ['scripts/normalize-pg-copy.py'], {
  input,
  encoding: 'utf8',
});
const normalizeCopy = input => {
  const result = runNormalizeCopy(input);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const production = workflow('reusable-production').jobs.deploy;
const backup = workflow('database-backup').jobs.backup;

test('production queue rejects stale revisions before the first production mutation', () => {
  assert.deepEqual(production.concurrency, {
    group: 'cloudflare-production',
    'cancel-in-progress': false,
    queue: 'max',
  });

  const staleGuard = step(production, 'Reject stale production revision');
  const firstMutation = step(production, 'Deploy recipes Edge Function');
  assert.ok(staleGuard, 'stale revision guard must exist');
  assert.ok(firstMutation, 'first production mutation must exist');
  assert.ok(production.steps.indexOf(staleGuard) < production.steps.indexOf(firstMutation));
  assert.equal(staleGuard.env.GH_TOKEN, '${{ github.token }}');
  assert.match(staleGuard.run, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/commits\/main"/);
  assert.match(staleGuard.run, /current_sha.*GITHUB_SHA/s);
  assert.match(staleGuard.run, /exit 1/);
});

test('backup queue preserves unique run attempts and private local verification files', () => {
  assert.deepEqual(backup.concurrency, {
    group: 'cloudflare-production',
    'cancel-in-progress': false,
    queue: 'max',
  });

  const bundle = step(backup, 'Create Supabase logical backup bundle');
  const verify = step(backup, 'Verify uploaded backup objects');
  assert.ok(bundle, 'backup bundle step must exist');
  assert.ok(verify, 'remote verification step must exist');
  assert.match(bundle.run, /backup_id="\$\{timestamp\}-\$\{short_sha\}-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.match(bundle.run, /"workflow_run_id": "\$GITHUB_RUN_ID"/);
  assert.match(bundle.run, /"workflow_run_attempt": "\$GITHUB_RUN_ATTEMPT"/);
  assert.match(verify.run, /umask 077/);
});

test('backup migration-ledger comparison ignores COPY row order but detects content changes', () => {
  const bundle = step(backup, 'Create Supabase logical backup bundle');
  assert.ok(bundle, 'backup bundle step must exist');
  assert.match(bundle.run, /normalize_history_data_dump\(\)/);
  assert.match(bundle.run, /python3 scripts\/normalize-pg-copy\.py/);
  assert.match(bundle.run, /history_before_normalized="\$consistency_dir\/history-data-before-normalized\.sql"/);
  assert.match(bundle.run, /history_after_normalized="\$consistency_dir\/history-data-after-normalized\.sql"/);
  assert.match(bundle.run, /normalize_history_data_dump "\$backup_dir\/history-data\.sql" > "\$history_before_normalized"/);
  assert.match(bundle.run, /normalize_history_data_dump "\$consistency_dir\/history-data-after\.sql" > "\$history_after_normalized"/);
  assert.match(bundle.run, /cmp -s "\$history_before_normalized" "\$history_after_normalized"/);

  const prefix = [
    '-- PostgreSQL database dump',
    'COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;',
    '',
  ].join('\n');
  const suffix = '\\.\n-- PostgreSQL database dump complete\n';

  const first = `${prefix}20261101000008\t{statement-b}\tharden\n20261031000007\t{statement-a}\tquota\n${suffix}`;
  const reordered = `${prefix}20261031000007\t{statement-a}\tquota\n20261101000008\t{statement-b}\tharden\n${suffix}`;
  const changed = `${prefix}20261031000007\t{statement-changed}\tquota\n20261101000008\t{statement-b}\tharden\n${suffix}`;

  assert.equal(normalizeCopy(first), normalizeCopy(reordered));
  assert.notEqual(normalizeCopy(first), normalizeCopy(changed));

  const malformed = `${prefix}20261101000008\t{statement-b}\tharden\n`;
  const malformedResult = runNormalizeCopy(malformed);
  assert.notEqual(malformedResult.status, 0);
  assert.match(malformedResult.stderr, /unterminated pg_dump COPY block/);
});

test('backup drift diagnostics classify differences without emitting SQL or row contents', () => {
  const bundle = step(backup, 'Create Supabase logical backup bundle');
  assert.match(bundle.run, /python3 scripts\/describe-pg-dump-diff\.py/);

  const dir = mkdtempSync(join(tmpdir(), 'backup-diff-test-'));
  try {
    const before = join(dir, 'before.sql');
    const after = join(dir, 'after.sql');
    writeFileSync(before, [
      '-- synthetic pg_dump header',
      'COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;',
      '1\tPRIVATE_SQL_MARKER\tfirst',
      '\\.',
      '',
    ].join('\n'));
    writeFileSync(after, [
      '-- synthetic pg_dump header',
      'COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;',
      '1\tDIFFERENT_PRIVATE_SQL_MARKER\tfirst',
      '\\.',
      '',
    ].join('\n'));
    const result = spawnSync('python3', ['scripts/describe-pg-dump-diff.py', before, after], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /before category=copy-row; after category=copy-row/);
    assert.match(result.stdout, /before COPY blocks=1; after COPY blocks=1/);
    assert.doesNotMatch(result.stdout, /PRIVATE_SQL_MARKER|DIFFERENT_PRIVATE_SQL_MARKER|supabase_migrations\.schema_migrations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('backup diagnostics report later COPY differences after header differences', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-diff-multiregion-'));
  try {
    const before = join(dir, 'before.sql');
    const after = join(dir, 'after.sql');
    writeFileSync(before, [
      '-- PRIVATE_HEADER_ONE',
      'COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;',
      '1\tPRIVATE_STATEMENT_ONE\tfirst',
      '\\.',
      '',
    ].join('\n'));
    writeFileSync(after, [
      '-- PRIVATE_HEADER_TWO',
      'COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;',
      '1\tPRIVATE_STATEMENT_TWO\tfirst',
      '\\.',
      '',
    ].join('\n'));
    const result = spawnSync('python3', ['scripts/describe-pg-dump-diff.py', before, after], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /first differing line=1; before category=outside-copy/);
    assert.match(result.stdout, /all differing line categories=copy-row->copy-row,outside-copy->outside-copy/);
    assert.doesNotMatch(result.stdout, /PRIVATE_HEADER|PRIVATE_STATEMENT|schema_migrations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
