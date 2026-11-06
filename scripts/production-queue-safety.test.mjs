import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const step = (job, name) => job.steps.find(candidate => candidate.name === name);

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
