import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const main = workflow('modular-main');
const production = workflow('reusable-production');
const release = production.jobs.deploy;
const edge = workflow('reusable-edge-api');
const pr = workflow('modular-pr-validation');
const step = (job, name) => job.steps.find(s => s.name === name);

function condition(expression, overrides = {}) {
  const context = {
    success: () => true,
    inputs: { 'frontend-exists': true },
    needs: { frontend: { outputs: { exists: 'true' } } },
    github: {
      event_name: 'push',
      ref: 'refs/heads/main',
      repository: '2ton-exe/moris-mix-ai',
      workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/modular-main.yml@refs/heads/main',
    },
    format: (template, value) => template.replace('{0}', value),
    ...overrides,
  };
  const source = expression.replace(/inputs\.frontend-exists/g, 'inputs["frontend-exists"]');
  return Function(...Object.keys(context), `return (${source});`)(...Object.values(context));
}

test('all workflow YAML parses and legacy ci.yml is retired', () => {
  assert.equal(existsSync('.github/workflows/ci.yml'), false);
  for (const name of readdirSync('.github/workflows').filter(n => /\.ya?ml$/.test(n))) {
    assert.ok(load(readFileSync(`.github/workflows/${name}`, 'utf8')).jobs, name);
  }
  assert.deepEqual(Object.keys(production.on), ['workflow_call']);
  assert.deepEqual(production.permissions, { contents: 'read' });
});

test('modular PR remains PR-only and cannot call production', () => {
  assert.deepEqual(Object.keys(pr.on), ['pull_request']);
  assert.equal(pr.jobs.staging.uses, './.github/workflows/reusable-staging.yml');
  for (const job of Object.values(pr.jobs)) {
    assert.notEqual(job.uses, './.github/workflows/reusable-production.yml');
    assert.notEqual(job.uses, './.github/workflows/reusable-cloudflare.yml');
    for (const name of Object.keys(job.secrets ?? {})) {
      assert.ok(!['SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].includes(name));
    }
  }
});

test('modular main is the sole production caller and keeps required validation gates', () => {
  assert.deepEqual(Object.keys(main.on), ['push', 'workflow_dispatch']);
  assert.equal(main.jobs.frontend.name, 'Modular Main Frontend');
  assert.equal(main.jobs['test-db'].name, 'Modular Main Database');
  assert.equal(main.jobs['test-edge-api'].name, 'Modular Main Edge/API');
  assert.equal(main.jobs.production.name, 'Modular Main Production');
  assert.deepEqual(main.jobs.production.needs, ['frontend', 'test-db', 'test-edge-api']);
  assert.equal(main.jobs.production.uses, './.github/workflows/reusable-production.yml');
  assert.deepEqual(Object.keys(main.jobs.production.with), ['frontend-exists']);
  assert.equal(main.jobs['production-ownership'], undefined);
  assert.equal(main.jobs['gate-evidence'], undefined);
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
});

test('production guards reject PRs, other refs, failed validation and missing frontend', () => {
  for (const expression of [main.jobs.production.if, release.if]) {
    assert.equal(condition(expression), true);
    assert.equal(condition(expression, { success: () => false }), false);
    for (const event_name of ['pull_request', 'pull_request_target', 'workflow_run']) {
      assert.equal(condition(expression, { github: { event_name, ref: 'refs/heads/main' } }), false);
    }
    assert.equal(condition(expression, { github: { event_name: 'push', ref: 'refs/heads/other' } }), false);
  }
  assert.equal(condition(main.jobs.production.if, { needs: { frontend: { outputs: { exists: 'false' } } } }), false);
  assert.equal(condition(release.if, { inputs: { 'frontend-exists': false } }), false);
  assert.equal(condition(release.if, {
    github: {
      event_name: 'push',
      ref: 'refs/heads/main',
      repository: '2ton-exe/moris-mix-ai',
      workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/other.yml@refs/heads/main',
    },
  }), false);
  for (const job of [main.jobs.production, main.jobs['test-edge-api'], edge.jobs['test-hosted-rls']]) {
    assert.notEqual(job['continue-on-error'], true);
    assert.doesNotMatch(job.if ?? '', /always\(|!cancelled\(/);
  }
});

test('cutover variable and legacy owner contract are removed from the permanent release path', () => {
  const mainText = readFileSync('.github/workflows/modular-main.yml', 'utf8');
  const productionText = readFileSync('.github/workflows/reusable-production.yml', 'utf8');
  assert.doesNotMatch(mainText, /MODULAR_PRODUCTION_ENABLED|legacy|production-ownership/);
  assert.doesNotMatch(productionText, /MODULAR_PRODUCTION_ENABLED|inputs\.owner|DECLARED_OWNER|ci\.yml/);
  assert.equal(production.on.workflow_call.inputs.owner, undefined);
  assert.equal(step(release, 'Verify production ownership'), undefined);
});

test('single release body preserves explicit targets, smoke, evidence and production lock', () => {
  const ordered = [
    'Validate production deployment configuration',
    'Install frontend dependencies',
    'Build frontend',
    'Deploy recipes Edge Function',
    'Deploy to Cloudflare Workers',
    'Verify production deployment URL',
    'Production runtime smoke',
  ];
  const positions = ordered.map(name => release.steps.indexOf(step(release, name)));
  assert.ok(positions.every((position, i) => position >= 0 && (!i || position > positions[i - 1])));
  for (const name of ordered) {
    assert.equal(step(release, name).if, undefined);
    assert.notEqual(step(release, name)['continue-on-error'], true);
  }
  const commands = release.steps.map(s => s.run ?? '').join('\n');
  assert.deepEqual([...commands.matchAll(/functions deploy (\S+)/g)].map(m => m[1]), ['recipes']);
  assert.doesNotMatch(commands, /db push|migration up|run-migrations|db:setup/);
  assert.equal(step(release, 'Deploy to Cloudflare Workers').uses, 'cloudflare/wrangler-action@v3');
  assert.equal(step(release, 'Production runtime smoke').run, 'node scripts/runtime-smoke.mjs');
  for (const name of ['Record production deployment and runtime outcomes', 'Preserve production runtime evidence']) {
    assert.equal(step(release, name).if, 'always()');
  }
  assert.deepEqual(release.concurrency, { group: 'cloudflare-production', 'cancel-in-progress': false });
  assert.deepEqual(release.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(main.jobs.production.secrets).sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN']);
});

test('main release keeps mandatory hosted RLS while E2E stays non-gating', () => {
  assert.ok(main.jobs['test-e2e']);
  assert.ok(!main.jobs.production.needs.includes('test-e2e'));
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
  assert.equal(edge.on.workflow_call.inputs['require-hosted-rls'].default, false);
  assert.equal(pr.jobs['test-edge-api'].with?.['require-hosted-rls'] ?? false, false);
  const hosted = edge.jobs['test-hosted-rls'];
  assert.equal(hosted.needs, 'test-edge-api');
  assert.notEqual(hosted['continue-on-error'], true);
  assert.match(hosted.if, /inputs.require-hosted-rls/);
});

test('cleanup files contain no literal credential patterns', () => {
  const paths = [
    '.github/production-cutover.md',
    '.github/workflows/modular-main.yml',
    '.github/workflows/reusable-edge-api.yml',
    '.github/workflows/reusable-frontend.yml',
    '.github/workflows/reusable-production.yml',
    'docs/devops/modular-workflows.md',
    'scripts/production-workflow.test.mjs',
  ];
  const contents = paths.map(path => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(contents,
    /(?:sb_secret_|sbp_|gh[pousr]_|github_pat_)[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
});
