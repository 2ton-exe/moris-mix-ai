import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { classify, classifyGit, outputLines } from './ci-path-classifier.mjs';

const classifyComplete = (input, count = 1) => classify(input, { complete: true, expectedCount: count });
for (const [name, input, expected, count = 1] of [
  ['docs prose', 'M\0docs/example.md\0', true],
  ['README', 'M\0README.md\0', true],
  ['added prose', 'A\0docs/new.md\0', true],
  ['nested prose', 'M\0docs/devops/pipeline-metrics.md\0', true],
  ['frontend', 'M\0frontend/src/App.tsx\0', false],
  ['function', 'M\0supabase/functions/recipes/index.ts\0', false],
  ['migration', 'A\0supabase/migrations/new.sql\0', false],
  ['workflow', 'M\0.github/workflows/modular-main.yml\0', false],
  ['GitHub markdown', 'M\0.github/production-cutover.md\0', false],
  ['script', 'M\0scripts/pr-secretary.mjs\0', false],
  ['lockfile', 'M\0pnpm-lock.yaml\0', false],
  ['mixed', 'M\0docs/example.md\0M\0frontend/src/App.tsx\0', false, 2],
  ['unknown root', 'M\0CONTRIBUTING.md\0', false],
  ['docs rename', 'R100\0docs/old.md\0docs/new.md\0', true],
  ['edited docs rename', 'R075\0docs/old.md\0docs/new.md\0', true],
  ['rename docs to code', 'R100\0docs/old.md\0frontend/new.ts\0', false],
  ['rename code to docs', 'R100\0frontend/old.ts\0docs/new.md\0', false],
  ['delete code', 'D\0frontend/old.ts\0', false],
  ['delete docs', 'D\0docs/old.md\0', false],
  ['non-prose in docs', 'M\0docs/config.json\0', false],
  ['JSONC', 'M\0wrangler.jsonc\0', false],
  ['TOML', 'M\0supabase/config.toml\0', false],
  ['docs script', 'M\0docs/example.mjs\0', false],
  ['docs YAML', 'M\0docs/config.yaml\0', false],
  ['code disguised with markdown suffix', 'M\0docs/example.ts.md\0', false],
  ['markdown outside allowlist', 'M\0frontend/README.md\0', false],
  ['type change', 'T\0docs/example.md\0', false],
  ['unknown status', 'X\0docs/example.md\0', false],
  ['missing terminator', 'M\0docs/example.md', false],
  ['truncated rename', 'R100\0docs/example.md\0', false],
  ['traversal', 'M\0docs/../README.md\0', false],
  ['absolute', 'M\0/docs/example.md\0', false],
  ['backslash', 'M\0docs\\example.md\0', false],
  ['newline filename', 'M\0docs/example\n.md\0', false],
  ['duplicates', 'M\0docs/example.md\0M\0docs/example.md\0', false, 2],
  ['empty diff', '', false],
  ['null input', null, false],
]) test(`Stage A: ${name}`, () => {
  const decision = classifyComplete(input, count);
  assert.equal(decision.docs_only, String(expected));
  for (const gate of ['frontend', 'database', 'edge_api']) assert.equal(decision[gate], expected ? 'noop' : 'run');
  // Stage A deliberately leaves E2E/staging behavior and reporting unchanged.
  assert.equal(decision.e2e, 'run');
  assert.equal(decision.staging, 'run');
  assert.match(decision.reason, /^[A-Za-z -]+$/);
});

test('incomplete evidence never yields a no-op', () => {
  const diff = 'M\0docs/example.md\0';
  for (const options of [{}, { complete: false, expectedCount: 1 }, { complete: true },
    { complete: true, expectedCount: 2 }, { complete: true, expectedCount: 0 }]) {
    assert.equal(classify(diff, options).docs_only, 'false');
  }
  assert.match(outputLines(classify(diff)), /^docs_only=false\nfrontend=run\ndatabase=run\nedge_api=run\n/);
  assert.equal(classify(diff, null).docs_only, 'false');
  assert.equal(classifyGit(null).docs_only, 'false');
});

test('Git collection uses the PR merge base and fails closed on incomplete evidence', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'moris-ci-paths-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Classifier test');
    git('config', 'user.email', 'classifier@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'README.md'), 'Initial prose\n');
    git('add', '.'); git('commit', '-m', 'base');
    git('switch', '-c', 'docs-change');
    writeFileSync(join(cwd, 'docs/example.md'), 'New prose\n');
    git('add', '.'); git('commit', '-m', 'docs');
    const head = git('rev-parse', 'HEAD');
    git('switch', 'main');
    writeFileSync(join(cwd, 'code.js'), 'export {};\n');
    git('add', '.'); git('commit', '-m', 'base advances independently');
    const base = git('rev-parse', 'HEAD');
    git('switch', 'docs-change');
    const input = { cwd, base, head, expectedCount: 1, eventName: 'pull_request' };
    assert.equal(classifyGit(input).docs_only, 'true');
    const event = join(cwd, 'event.json');
    const output = join(cwd, 'output');
    writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head }, changed_files: 1 } }));
    const cli = spawnSync(process.execPath, [resolve('scripts/ci-path-classifier.mjs')], {
      cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'pull_request' },
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(readFileSync(output, 'utf8'), /^docs_only=true\n/);
    for (const patch of [{ expectedCount: 2 }, { base: 'f'.repeat(40) }, { base: '--all' },
      { eventName: 'push' }, { head: base }, { cwd: join(cwd, 'missing') }]) {
      assert.equal(classifyGit({ ...input, ...patch }).docs_only, 'false');
    }
    // A changed mode is not confidently regular prose, even with an .md suffix.
    git('update-index', '--chmod=+x', 'docs/example.md');
    git('commit', '-m', 'mode changes');
    assert.equal(classifyGit({ ...input, head: git('rev-parse', 'HEAD') }).docs_only, 'false');
    git('switch', 'docs-change');
    const shallow = join(cwd, '.git/shallow');
    writeFileSync(shallow, git('rev-parse', 'HEAD') + '\n');
    assert.equal(classifyGit({ ...input, head: git('rev-parse', 'HEAD') }).docs_only, 'false');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('CLI missing/malformed event writes full validation to GITHUB_OUTPUT without secrets', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'moris-ci-path-cli-'));
  try {
    const event = join(cwd, 'event.json');
    const output = join(cwd, 'output');
    writeFileSync(event, '{invalid');
    const result = spawnSync(process.execPath, [resolve('scripts/ci-path-classifier.mjs')], {
      cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output,
        GITHUB_EVENT_NAME: 'pull_request', GH_TOKEN: 'must-not-appear' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, 'utf8'), /^docs_only=false\n/);
    assert.doesNotMatch(result.stdout + result.stderr, /must-not-appear/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
