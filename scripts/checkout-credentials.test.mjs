import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Reuse the YAML parser available through the locked frontend ESLint tooling.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');

const validationWorkflows = [
  'reusable-frontend.yml',
  'reusable-database.yml',
  'reusable-edge-api.yml',
  'reusable-e2e.yml',
  'reusable-staging.yml',
  'database-backup.yml',
];

for (const file of validationWorkflows) {
  test(`${file} disables checkout credential persistence`, () => {
    const workflow = load(readFileSync(`.github/workflows/${file}`, 'utf8'));
    const checkouts = Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) =>
      (job.steps ?? [])
        .filter(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
        .map(step => ({ jobName, step })),
    );

    assert.ok(checkouts.length > 0, `${file} must contain an explicit checkout to validate`);
    for (const { jobName, step } of checkouts) {
      assert.equal(
        step.with?.['persist-credentials'],
        false,
        `${file}/${jobName}: ${step.name ?? 'checkout'} must not persist GitHub credentials`,
      );
    }
  });
}
