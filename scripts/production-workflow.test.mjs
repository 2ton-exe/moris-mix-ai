import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Use the YAML parser already installed with the locked frontend ESLint tooling.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const ci = workflow('ci');
const main = workflow('modular-main');
const production = workflow('reusable-production');
const release = production.jobs.deploy;
const edge = workflow('reusable-edge-api');
const step = (job, name) => job.steps.find(s => s.name === name);

// These conditions use only this small subset of Actions expressions. Execute the
// actual YAML expressions against fixtures so changes to the gate affect tests.
function condition(expression, overrides = {}) {
  const context = {
    success: () => true,
    vars: { MODULAR_PRODUCTION_ENABLED: 'true' },
    inputs: { owner: 'modular', 'frontend-exists': true },
    needs: { frontend: { outputs: { exists: 'true' } }, 'production-ownership': { outputs: { owner: 'modular' } } },
    github: { event_name: 'push', ref: 'refs/heads/main', repository: '2ton-exe/moris-mix-ai',
      workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/modular-main.yml@refs/heads/main' },
    format: (template, value) => template.replace('{0}', value),
    ...overrides,
  };
  const source = expression.replace(/inputs\.frontend-exists/g, 'inputs["frontend-exists"]')
    .replace(/needs\.production-ownership/g, 'needs["production-ownership"]');
  return Function(...Object.keys(context), `return (${source});`)(...Object.values(context));
}

test('all workflow YAML parses, including the reusable production contract', () => {
  for (const name of readdirSync('.github/workflows').filter(n => /\.ya?ml$/.test(n))) {
    assert.ok(load(readFileSync(`.github/workflows/${name}`, 'utf8')).jobs, name);
  }
  assert.deepEqual(Object.keys(production.on), ['workflow_call']);
  assert.deepEqual(production.permissions, { contents: 'read' });
});

test('legacy CI stays active with unchanged required validation names and release dependencies', () => {
  assert.deepEqual(Object.keys(ci.on), ['pull_request', 'push', 'workflow_dispatch']);
  assert.equal(ci.jobs.frontend.name, 'Frontend Checks');
  assert.equal(ci.jobs['test-db'].name, 'Database Tests');
  assert.equal(ci.jobs['test-edge-api'].name, 'Edge/API Tests');
  assert.deepEqual(ci.jobs.deploy.needs, ['frontend', 'test-db', 'test-edge-api', 'test-hosted-rls', 'production-ownership']);
  assert.equal(ci.jobs.deploy.uses, './.github/workflows/reusable-production.yml');
  assert.equal(ci.jobs.deploy.with.owner, 'legacy');
  assert.equal(condition(ci.jobs.deploy.if, { needs: { frontend: { outputs: { exists: 'true' } },
    'production-ownership': { outputs: { owner: 'legacy' } } } }), true);
  assert.equal(condition(release.if, { inputs: { owner: 'legacy', 'frontend-exists': true },
    vars: {}, github: { event_name: 'push', ref: 'refs/heads/main', repository: '2ton-exe/moris-mix-ai',
      workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/ci.yml@refs/heads/main' } }), true);
});

test('modular PR remains PR-only, with staging and no production call or credentials', () => {
  const pr = workflow('modular-pr-validation');
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

test('actual caller and callee guards reject PRs, other refs and failed validation', () => {
  assert.deepEqual(main.jobs.production.needs, ['frontend', 'test-db', 'test-edge-api', 'production-ownership']);
  assert.equal(main.jobs.production.uses, './.github/workflows/reusable-production.yml');
  assert.equal(main.jobs.production.with.owner, 'modular');
  for (const expression of [ci.jobs.deploy.if, main.jobs.production.if, release.if]) {
    const defaults = expression === ci.jobs.deploy.if
      ? { needs: { frontend: { outputs: { exists: 'true' } }, 'production-ownership': { outputs: { owner: 'legacy' } } } } : {};
    assert.equal(condition(expression, defaults), true);
    assert.equal(condition(expression, { ...defaults, success: () => false }), false);
    for (const event_name of ['pull_request', 'pull_request_target', 'workflow_run']) {
      assert.equal(condition(expression, { ...defaults, github: { event_name, ref: 'refs/heads/main' } }), false);
    }
    assert.equal(condition(expression, { ...defaults, github: { event_name: 'push', ref: 'refs/heads/other' } }), false);
  }
  assert.equal(condition(main.jobs.production.if, { needs: { frontend: { outputs: { exists: 'false' } },
    'production-ownership': { outputs: { owner: 'modular' } } } }), false);
  assert.equal(condition(release.if, { inputs: { owner: 'modular', 'frontend-exists': false } }), false);
  assert.equal(condition(release.if, { inputs: { owner: 'legacy', 'frontend-exists': true } }), false);
  for (const job of [main.jobs.production, main.jobs['test-edge-api'], edge.jobs['test-hosted-rls']]) {
    assert.notEqual(job['continue-on-error'], true);
    assert.doesNotMatch(job.if ?? '', /always\(|!cancelled\(/);
  }
});

function nodeSource(step) {
  return step.run.match(/node --input-type=module -e '([\s\S]*)'/)[1];
}

function ownership(flag) {
  const fixture = mkdtempSync(join(tmpdir(), 'moris-production-owner-'));
  try {
    const output = join(fixture, 'output');
    const env = { ...process.env, GITHUB_OUTPUT: output };
    delete env.MODULAR_PRODUCTION_ENABLED;
    if (flag !== undefined) env.MODULAR_PRODUCTION_ENABLED = flag;
    const select = step(main.jobs['production-ownership'], 'Select exact-string owner');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', nodeSource(select)], { env });
    assert.equal(result.status, 0, result.stderr?.toString());
    return readFileSync(output, 'utf8').trim().split('=')[1];
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}

function preflight(owner, flag) {
  const env = { ...process.env, DECLARED_OWNER: owner };
  delete env.MODULAR_PRODUCTION_ENABLED;
  if (flag !== undefined) env.MODULAR_PRODUCTION_ENABLED = flag;
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    nodeSource(step(release, 'Verify production ownership'))], { env }).status;
}

for (const [flag, expected] of [[undefined, 'legacy'], ['false', 'legacy'], ['true', 'modular'],
  ['TRUE', 'legacy'], ['', 'legacy'], ['True', 'legacy'], ['1', 'legacy'], ['true ', 'legacy']]) {
  test(`ownership truth table: ${flag === undefined ? 'unset' : JSON.stringify(flag)} -> ${expected}`, () => {
    const owner = ownership(flag);
    assert.equal(owner, expected);
    const needs = { frontend: { outputs: { exists: 'true' } }, 'production-ownership': { outputs: { owner } } };
    const legacy = condition(ci.jobs.deploy.if, { needs });
    const modular = condition(main.jobs.production.if, { needs });
    assert.equal(legacy, owner === 'legacy');
    assert.equal(modular, owner === 'modular');
    assert.equal(Number(legacy) + Number(modular), 1, 'exactly one eligible owner');
    assert.equal(preflight('legacy', flag), legacy ? 0 : 1);
    assert.equal(preflight('modular', flag), modular ? 0 : 1);
    assert.equal(preflight('unknown', flag), 1);
    assert.equal(preflight('MODULAR', flag), 1);
  });
}

test('ownership selection is identical in callers and preflight never requires retiring ci.yml', () => {
  assert.deepEqual(ci.jobs['production-ownership'], main.jobs['production-ownership']);
  const selector = ci.jobs['production-ownership'];
  assert.equal(selector.steps[0].env.MODULAR_PRODUCTION_ENABLED, '${{ vars.MODULAR_PRODUCTION_ENABLED }}');
  assert.equal(selector.outputs.owner, '${{ steps.select.outputs.owner }}');
  assert.deepEqual(selector.permissions, { contents: 'read' });
  assert.equal(condition(selector.if), true);
  assert.equal(condition(selector.if, { github: { event_name: 'pull_request', ref: 'refs/heads/main' } }), false);
  const guard = step(release, 'Verify production ownership');
  assert.equal(guard.if, undefined);
  assert.equal(guard.env.DECLARED_OWNER, '${{ inputs.owner }}');
  assert.equal(guard.env.MODULAR_PRODUCTION_ENABLED, '${{ vars.MODULAR_PRODUCTION_ENABLED }}');
  assert.doesNotMatch(guard.run, /existsSync|ci\.yml/);
  assert.ok(release.steps.indexOf(guard) < release.steps.indexOf(step(release, 'Validate production deployment configuration')));
});

test('failed/cancelled/skipped gating dependencies block both callers; E2E remains non-gating', () => {
  assert.ok(main.jobs['test-e2e']);
  for (const [caller, owner] of [[ci.jobs.deploy, 'legacy'], [main.jobs.production, 'modular']]) {
    assert.ok(!caller.needs.includes('test-e2e'));
    assert.ok(!caller.needs.includes('gate-evidence'));
    for (const dependency of caller.needs) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        const needs = Object.fromEntries(caller.needs.map(name => [name, { result: 'success', outputs: {} }]));
        needs.frontend.outputs.exists = 'true';
        needs['production-ownership'].outputs.owner = owner;
        needs[dependency].result = result;
        assert.equal(condition(caller.if, { needs, success: () => Object.values(needs).every(n => n.result === 'success') }), false);
      }
    }
    const needs = { frontend: { outputs: { exists: 'true' } }, 'production-ownership': { outputs: { owner } },
      'test-e2e': { result: 'failure' } };
    assert.equal(condition(caller.if, { needs }), true);
    assert.notEqual(caller['continue-on-error'], true);
  }
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
  assert.notEqual(edge.jobs['test-hosted-rls']['continue-on-error'], true);
});

test('single release body preserves order, explicit targets, smoke, evidence and lock', () => {
  // Assert the release contract from this checkout; CI need not have Git history.
  assert.deepEqual(release.env, {
    VITE_SUPABASE_URL: '${{ vars.VITE_SUPABASE_URL }}',
    VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}',
    VITE_SUPABASE_ANON_KEY: '${{ vars.VITE_SUPABASE_ANON_KEY }}',
    SMOKE_ENVIRONMENT: 'production',
    SMOKE_FRONTEND_URL: '${{ vars.PRODUCTION_FRONTEND_URL }}',
    SMOKE_SUPABASE_URL: '${{ vars.VITE_SUPABASE_URL }}',
    SMOKE_PROJECT_REF: '${{ vars.SUPABASE_PROJECT_REF }}',
    SMOKE_PUBLIC_KEY: '${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY || vars.VITE_SUPABASE_ANON_KEY }}',
    SMOKE_BACKEND_REVISION: '${{ vars.PRODUCTION_DEMO_RECIPE_REVISION }}',
  });
  const ordered = ['Validate production deployment configuration', 'Install frontend dependencies', 'Build frontend', 'Deploy recipes Edge Function',
    'Deploy to Cloudflare Workers', 'Verify production deployment URL', 'Production runtime smoke'];
  const positions = ordered.map(name => release.steps.indexOf(step(release, name)));
  assert.ok(positions.every((position, i) => position >= 0 && (!i || position > positions[i - 1])));
  for (const name of ordered) {
    assert.equal(step(release, name).if, undefined);
    assert.notEqual(step(release, name)['continue-on-error'], true);
  }
  const commands = release.steps.map(s => s.run ?? '').join('\n');
  assert.deepEqual([...commands.matchAll(/functions deploy (\S+)/g)].map(m => m[1]), ['recipes']);
  assert.doesNotMatch(commands, /db push|migration up|run-migrations|db:setup/);
  const configuration = step(release, 'Validate production deployment configuration');
  assert.deepEqual(configuration.env, {
    SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    SUPABASE_PROJECT_REF: '${{ vars.SUPABASE_PROJECT_REF }}',
  });
  assert.match(configuration.run, /configuration\(process\.env\)/);
  const install = step(release, 'Install frontend dependencies');
  assert.equal(install['working-directory'], 'frontend');
  assert.equal(install.run, 'pnpm install --frozen-lockfile');
  const build = step(release, 'Build frontend');
  assert.equal(build['working-directory'], 'frontend');
  assert.equal(build.run, 'pnpm build');
  const recipes = step(release, 'Deploy recipes Edge Function');
  assert.equal(recipes.id, 'deploy-recipes');
  assert.equal(recipes['working-directory'], 'frontend');
  assert.deepEqual(recipes.env, configuration.env);
  assert.match(recipes.run, /--workdir "\$GITHUB_WORKSPACE" functions deploy recipes/);
  assert.match(recipes.run, /--project-ref "\$SUPABASE_PROJECT_REF"/);
  assert.match(recipes.run, /--no-verify-jwt[\s\S]*--use-api[\s\S]*--yes/);
  assert.equal(step(release, 'Deploy to Cloudflare Workers').id, 'deploy-cloudflare');
  assert.equal(step(release, 'Deploy to Cloudflare Workers').uses, 'cloudflare/wrangler-action@v3');
  assert.equal(step(release, 'Deploy to Cloudflare Workers').with.command, 'deploy --config wrangler.jsonc');
  const verify = step(release, 'Verify production deployment URL');
  assert.equal(verify.id, 'verify-deployment');
  assert.equal(verify.env.DEPLOYMENT_URL, '${{ steps.deploy-cloudflare.outputs.deployment-url }}');
  assert.match(verify.run, /"\$\{DEPLOYMENT_URL%\/\}" != "\$\{SMOKE_FRONTEND_URL%\/\}"/);
  assert.equal(step(release, 'Production runtime smoke').id, 'runtime-smoke');
  assert.equal(step(release, 'Production runtime smoke').run, 'node scripts/runtime-smoke.mjs');
  assert.equal(step(release, 'Production runtime smoke').env.SMOKE_DEPLOYMENT_OUTCOME, '${{ steps.deploy-cloudflare.outcome }}');
  for (const name of ['Record production deployment and runtime outcomes', 'Preserve production runtime evidence']) {
    assert.equal(step(release, name).if, 'always()');
  }
  assert.deepEqual(step(release, 'Record production deployment and runtime outcomes').env, {
    RECIPES_OUTCOME: '${{ steps.deploy-recipes.outcome }}',
    CLOUDFLARE_OUTCOME: '${{ steps.deploy-cloudflare.outcome }}',
    URL_OUTCOME: '${{ steps.verify-deployment.outcome }}',
    SMOKE_OUTCOME: '${{ steps.runtime-smoke.outcome }}',
  });
  const artifact = step(release, 'Preserve production runtime evidence');
  assert.equal(artifact.uses, 'actions/upload-artifact@v4');
  assert.equal(artifact.with.path, 'runtime-smoke.json');
  assert.equal(artifact.with.name, 'production-runtime-smoke-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.equal(artifact.with['if-no-files-found'], 'warn');
  assert.deepEqual(release.concurrency, { group: 'cloudflare-production', 'cancel-in-progress': false });
  assert.deepEqual(release.permissions, { contents: 'read' });
  for (const caller of [ci.jobs.deploy, main.jobs.production]) {
    assert.deepEqual(Object.keys(caller.secrets).sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN']);
    for (const [key, value] of Object.entries(caller.secrets)) assert.equal(value, '${{ secrets.' + key + ' }}');
  }
});

test('main validation covers current authoritative Edge/API targets and mandatory hosted RLS', () => {
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
  assert.equal(edge.on.workflow_call.inputs['require-hosted-rls'].default, false);
  assert.equal(workflow('modular-pr-validation').jobs['test-edge-api'].with?.['require-hosted-rls'] ?? false, false);
  for (const name of ['Type-check Edge Function and tests', 'Run deterministic Edge/API tests']) {
    const current = step(ci.jobs['test-edge-api'], name).run.split(/\s+/).filter(s => s.startsWith('supabase/'));
    const reusable = step(edge.jobs['test-edge-api'], name).run.split(/\s+/);
    for (const target of current) assert.ok(reusable.includes(target), target);
    assert.ok(current.some(s => s.includes('extract_recipe_test.ts')));
    assert.ok(reusable.includes('supabase/functions/tests/extract_recipe_test.ts'));
    assert.ok(reusable.includes('supabase/functions/tests/recipe_image_schemas_test.ts'));
    if (name.startsWith('Type-check')) {
      assert.ok(reusable.includes('supabase/functions/extract-recipe/index.ts'));
      assert.ok(reusable.includes('supabase/functions/_shared/recipe-images/schemas.ts'));
    }
    const extras = reusable.filter(s => s.startsWith('supabase/') && !current.includes(s));
    assert.deepEqual(extras, name.startsWith('Type-check')
      ? ['supabase/functions/_shared/recipe-images/schemas.ts', 'supabase/functions/tests/recipe_image_schemas_test.ts']
      : ['supabase/functions/tests/recipe_image_schemas_test.ts']);
  }
  const hosted = edge.jobs['test-hosted-rls'];
  assert.equal(hosted.needs, 'test-edge-api');
  assert.notEqual(hosted['continue-on-error'], true);
  assert.match(hosted.if, /inputs.require-hosted-rls/);
  assert.deepEqual(hosted.steps, ci.jobs['test-hosted-rls'].steps);
  assert.equal(step(workflow('reusable-frontend').jobs.frontend, 'Test runtime smoke verifier (offline)').run,
    step(ci.jobs.frontend, 'Test runtime smoke verifier (offline)').run);
});

test('changed patch contains no literal credential patterns', () => {
  const tracked = spawnSync('git', ['diff', '--', '.github', 'scripts'], { encoding: 'utf8' });
  assert.equal(tracked.status, 0);
  const added = ['.github/production-cutover.md', '.github/workflows/reusable-production.yml',
    'scripts/production-workflow.test.mjs'].map(path => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(tracked.stdout + added,
    /(?:sb_secret_|sbp_|gh[pousr]_)[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
});
