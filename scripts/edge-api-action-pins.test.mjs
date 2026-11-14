import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Reuse the locked frontend ESLint dependency's YAML parser.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');

for (const jobName of ['test-edge-api', 'test-hosted-rls']) {
  test(`Edge/API ${jobName} pins every external action to an immutable commit SHA`, () => {
    const workflow = load(readFileSync('.github/workflows/reusable-edge-api.yml', 'utf8'));
    const externalActions = (workflow.jobs[jobName]?.steps ?? []).filter(step =>
      typeof step.uses === 'string' && !step.uses.startsWith('./'),
    );
    assert.ok(externalActions.length > 0, `Edge/API job ${jobName} must have actions to verify`);

    for (const step of externalActions) {
      assert.match(
        step.uses,
        /^[^@\s]+@[a-f0-9]{40}$/,
        `Edge/API ${jobName}/${step.name ?? 'action'} must use an immutable full-length commit SHA`,
      );
    }
  });
}
