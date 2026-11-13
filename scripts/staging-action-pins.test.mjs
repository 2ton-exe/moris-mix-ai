import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Reuse the locked frontend ESLint dependency's YAML parser.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');

test('staging deploy and smoke jobs pin every external action to an immutable commit SHA', () => {
  const staging = load(readFileSync('.github/workflows/reusable-staging.yml', 'utf8'));
  for (const jobName of ['deploy', 'smoke']) {
    const steps = staging.jobs[jobName]?.steps ?? [];
    const externalActions = steps.filter(step =>
      typeof step.uses === 'string' && !step.uses.startsWith('./'),
    );
    assert.ok(externalActions.length > 0, `Staging job ${jobName} must have actions to verify`);

    for (const step of externalActions) {
      assert.match(
        step.uses,
        /^[^@\s]+@[a-f0-9]{40}$/,
        `Staging ${jobName}/${step.name ?? 'action'} must use an immutable full-length commit SHA`,
      );
    }
  }
});
