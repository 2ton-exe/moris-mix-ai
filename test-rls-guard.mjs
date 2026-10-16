import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [path.join(root, 'test-rls.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://test:test@127.0.0.2:1/test'
  },
  encoding: 'utf8',
  timeout: 5000
});

assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 1, result.stderr);
assert.match(result.stderr, /RLS tests only run against localhost by default/);
assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Connected to database|FAILED: RLS policy regression tests failed/);
console.log('✓ Remote DATABASE_URL is rejected before connecting.');
