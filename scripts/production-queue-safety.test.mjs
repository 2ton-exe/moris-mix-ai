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

test('restricted backup metadata is masked before use and remains available within the job', () => {
  const bundle = step(backup, 'Create Supabase logical backup bundle');
  const verify = step(backup, 'Verify uploaded backup objects');
  assert.ok(bundle, 'backup bundle step must exist');
  assert.ok(verify, 'backup verification step must exist');

  const protectedNames = [
    'backup_id',
    'backup_dir',
    'consistency_dir',
    'archive',
    'evidence',
    'object_prefix',
    'object_key',
    'evidence_key',
    'generated_at',
  ];
  const initialMask = bundle.run.indexOf('for protected_value in');
  const firstPathUse = bundle.run.indexOf('mkdir -p "$backup_dir"');
  assert.ok(initialMask >= 0 && initialMask < firstPathUse, 'paths and identifiers must be masked before file and dump operations');
  const maskRegistration = bundle.run.slice(initialMask, firstPathUse);
  for (const name of protectedNames) {
    assert.ok(maskRegistration.includes(`"$${name}"`), `${name} must be registered with add-mask`);
  }

  const archiveDigest = bundle.run.indexOf('mask_workflow_value "$archive_sha256"');
  assert.ok(archiveDigest > bundle.run.indexOf('archive_sha256="$(sha256sum'));
  assert.ok(archiveDigest < bundle.run.indexOf('>> "$GITHUB_OUTPUT"'));
  const archiveSize = bundle.run.indexOf('archive_size_bytes="$(stat -c');
  const archiveSizeMask = bundle.run.indexOf('mask_workflow_value "$archive_size_bytes"');
  assert.ok(archiveSizeMask > archiveSize, 'archive size must be masked after calculation');
  assert.ok(archiveSizeMask < bundle.run.indexOf('>> "$GITHUB_OUTPUT"'), 'archive size must be masked before becoming a step output');
  assert.doesNotMatch(bundle.run, /mask_workflow_value "\$short_sha"/);

  const verificationPathMask = verify.run.indexOf('mask_workflow_value "$verify_copy"');
  const verificationMaskHelper = verify.run.indexOf('mask_workflow_value() {');
  assert.ok(verificationMaskHelper >= 0 && verificationMaskHelper < verificationPathMask, 'verification step must define its own mask helper');
  assert.ok(verificationPathMask > verify.run.indexOf('verify_copy="'));
  assert.ok(verificationPathMask < verify.run.indexOf('aws s3 cp'));
  const remoteDigestMask = verify.run.indexOf('mask_workflow_value "$remote_sha256"');
  assert.ok(remoteDigestMask > verify.run.indexOf('remote_sha256="$(sha256sum'));
  assert.ok(remoteDigestMask < verify.run.indexOf('if [[ "$remote_sha256"'));
  const remoteSizeMask = verify.run.indexOf('mask_workflow_value "$remote_size"');
  assert.ok(remoteSizeMask > verify.run.indexOf('if ! remote_size="$(aws s3api head-object'));
  assert.ok(remoteSizeMask < verify.run.indexOf('if [[ "$remote_size"'));

  const frontend = workflow('reusable-frontend').jobs.frontend;
  const registerProbe = step(frontend, 'Register a synthetic Actions mask and output');
  const consumeProbe = step(frontend, 'Verify masked synthetic output propagation');
  assert.ok(registerProbe, 'runner-level masking probe must run in existing frontend CI');
  assert.ok(consumeProbe, 'runner-level same-job output check must run in existing frontend CI');
  assert.ok(frontend.steps.indexOf(registerProbe) < frontend.steps.indexOf(consumeProbe));
  assert.match(registerProbe.run, /printf '::add-mask::%s\\n'/);
  assert.match(registerProbe.run, />> "\$GITHUB_OUTPUT"/);
  assert.equal(consumeProbe.env.MASKED_SYNTHETIC_VALUE, '${{ steps.synthetic-mask-probe.outputs.value }}');
  assert.match(consumeProbe.run, /test "\$MASKED_SYNTHETIC_VALUE" = "\$expected"/);
  assert.match(consumeProbe.run, /printf 'Same-job synthetic output propagated under mask:/);
});

test('public backup summary contains only fixed outcomes and no backup identifiers', () => {
  const summary = step(backup, 'Record backup evidence');
  assert.ok(summary, 'backup evidence summary step must exist');

  for (const name of ['GENERATED_AT', 'OBJECT_KEY', 'ARCHIVE_SIZE', 'ARCHIVE_SHA256']) {
    assert.equal(Object.hasOwn(summary.env ?? {}, name), false, `${name} must stay out of the public summary`);
  }
  assert.doesNotMatch(JSON.stringify(summary.env), /SUPABASE_PROJECT_REF|GITHUB_SHA|OBJECT_KEY|ARCHIVE_SIZE|ARCHIVE_SHA256/i);
  assert.doesNotMatch(summary.run, /source revision|project ref|generated at|R2 object key|archive size|SHA-256|run id|GITHUB_SHA|GITHUB_RUN_ID|SUPABASE_PROJECT_REF|GENERATED_AT|backup_id|object_key|evidence_key|OBJECT_KEY|ARCHIVE_SIZE|ARCHIVE_SHA256/i);
  assert.match(summary.run, /Bundle creation and consistency gate: \$\{BUNDLE_OUTCOME\}/);
  assert.match(summary.run, /Private R2 upload: \$\{UPLOAD_OUTCOME\}/);
  assert.match(summary.run, /Remote size\/checksum verification: \$\{VERIFY_OUTCOME\}/);
});

test('private R2 CLI failures publish only fixed labels', () => {
  const upload = step(backup, 'Upload backup bundle to private R2');
  const verify = step(backup, 'Verify uploaded backup objects');
  assert.ok(upload, 'private R2 upload step must exist');
  assert.ok(verify, 'private R2 verification step must exist');

  const syntheticFailure = (run, failAction) => {
    const syntheticEnv = {
      FAIL_AWS_ACTION: failAction,
      R2_BACKUP_BUCKET: 'synthetic-bucket-sentinel',
      R2_BACKUP_ENDPOINT: 'https://synthetic-endpoint.invalid',
      AWS_ACCESS_KEY_ID: 'synthetic-access-key-sentinel',
      AWS_SECRET_ACCESS_KEY: 'synthetic-secret-key-sentinel',
      ARCHIVE_PATH: '/synthetic/archive-sentinel.tar.gz',
      EVIDENCE_PATH: '/synthetic/evidence-sentinel.json',
      OBJECT_KEY: 'synthetic-object-key-sentinel',
      EVIDENCE_KEY: 'synthetic-evidence-key-sentinel',
      EXPECTED_SIZE: '123',
      EXPECTED_SHA256: 'synthetic-checksum-sentinel',
      RUNNER_TEMP: '/synthetic-runner-temp',
      GITHUB_RUN_ID: 'synthetic-run-id',
      GITHUB_RUN_ATTEMPT: '1',
    };
    // The local shell harness has no Actions command processor; the CI probe tests real runner masking.
    const runnerNeutralRun = run.replace(/printf '::add-mask::%s\\n' "\$value"/g, ': "$value"');
    const harness = [
      ...Object.entries(syntheticEnv).map(([name, value]) => `export ${name}='${value}'`),
      'mask_workflow_value() { return 0; }',
      'aws() {',
      '  local aws_action=unknown',
      '  if [[ "$1" == s3 && "$2" == cp ]]; then',
      '    if [[ "$3" == "$ARCHIVE_PATH" ]]; then aws_action=archive-upload; fi',
      '    if [[ "$3" == "$EVIDENCE_PATH" ]]; then aws_action=evidence-upload; fi',
      '    if [[ "$3" == "s3://${R2_BACKUP_BUCKET}/${OBJECT_KEY}" ]]; then aws_action=archive-download; fi',
      '  elif [[ "$1" == s3api && "$2" == head-object ]]; then',
      '    if [[ "$6" == "$OBJECT_KEY" ]]; then aws_action=archive-head; fi',
      '    if [[ "$6" == "$EVIDENCE_KEY" ]]; then aws_action=evidence-head; fi',
      '  fi',
      '  if [[ "$aws_action" == "$FAIL_AWS_ACTION" ]]; then',
      '    printf "%s\\n" "SYNTHETIC_AWS_SENTINEL $* $AWS_SECRET_ACCESS_KEY"',
      '    printf "%s\\n" "SYNTHETIC_AWS_STDERR_SENTINEL $* $AWS_ACCESS_KEY_ID" >&2',
      '    return 41',
      '  fi',
      '  if [[ "$aws_action" == archive-head ]]; then',
      '    printf "%s\\n" "$EXPECTED_SIZE"',
      '  fi',
      '  return 0',
      '}',
      'sha256sum() { printf "%s  %s\\n" "$EXPECTED_SHA256" "${1:-}"; }',
      runnerNeutralRun,
    ].join('\n');

    const shell = process.platform === 'win32' ? 'wsl.exe' : 'bash';
    const shellArgs = process.platform === 'win32'
      ? ['-d', 'Ubuntu', '--', 'bash', '-e', '-u', '-o', 'pipefail', '-s']
      : ['--noprofile', '--norc', '-e', '-u', '-o', 'pipefail', '-s'];
    return spawnSync(shell, shellArgs, {
      input: harness,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
      },
    });
  };

  const cases = [
    { run: upload.run, failAction: 'archive-upload', message: '::error::Private R2 archive upload failed.' },
    { run: upload.run, failAction: 'evidence-upload', message: '::error::Private R2 evidence upload failed.' },
    { run: verify.run, failAction: 'archive-head', message: '::error::Private R2 archive metadata verification failed.' },
    { run: verify.run, failAction: 'archive-download', message: '::error::Private R2 archive download for verification failed.' },
    { run: verify.run, failAction: 'evidence-head', message: '::error::Private R2 evidence object verification failed.' },
  ];

  for (const scenario of cases) {
    const result = syntheticFailure(scenario.run, scenario.failAction);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.stdout, `${scenario.message}\n`);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SYNTHETIC_|synthetic-(?:bucket|endpoint|access-key|secret-key|archive|evidence|object-key|checksum|run-id)/i);
  }
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
