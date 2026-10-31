import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Use the YAML parser already installed with the locked frontend ESLint tooling.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
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
    inputs: { 'frontend-exists': true },
    needs: { frontend: { outputs: { exists: 'true' } } },
    github: { event_name: 'push', ref: 'refs/heads/main', repository: '2ton-exe/moris-mix-ai',
      workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/modular-main.yml@refs/heads/main' },
    format: (template, value) => template.replace('{0}', value),
    ...overrides,
  };
  const source = expression.replace(/inputs\.frontend-exists/g, 'inputs["frontend-exists"]')
    .replace(/inputs\.require-hosted-rls/g, 'inputs["require-hosted-rls"]');
  return Function(...Object.keys(context), `return (${source});`)(...Object.values(context));
}

test('all workflow YAML parses, including the reusable production contract', () => {
  for (const name of readdirSync('.github/workflows').filter(n => /\.ya?ml$/.test(n))) {
    assert.ok(load(readFileSync(`.github/workflows/${name}`, 'utf8')).jobs, name);
  }
  assert.deepEqual(Object.keys(production.on), ['workflow_call']);
  assert.deepEqual(production.permissions, { contents: 'read' });
});

test('legacy CI is intentionally absent; modular main is the only production caller', () => {
  assert.equal(existsSync('.github/workflows/ci.yml'), false);
  assert.deepEqual(Object.keys(main.on), ['push', 'workflow_dispatch']);
  assert.deepEqual(main.on.push.branches, ['main']);
  assert.deepEqual(main.permissions, { contents: 'read' });
  assert.deepEqual(main.jobs.production.permissions, { contents: 'read' });
  assert.equal(main.jobs['production-ownership'], undefined);
  assert.equal(main.jobs['gate-evidence'], undefined);
  assert.equal(production.on.workflow_call.inputs.owner, undefined);
  const callers = [];
  for (const name of readdirSync('.github/workflows').filter(n => /\.ya?ml$/.test(n))) {
    const source = readFileSync(`.github/workflows/${name}`, 'utf8');
    assert.doesNotMatch(source, /MODULAR_PRODUCTION_ENABLED/);
    for (const job of Object.values(load(source).jobs)) {
      if (job.uses === './.github/workflows/reusable-production.yml') callers.push(name);
    }
  }
  assert.deepEqual(callers, ['modular-main.yml']);
});

test('modular PR remains PR-only, with staging and no production call or credentials', () => {
  const pr = workflow('modular-pr-validation');
  assert.deepEqual(Object.keys(pr.on), ['pull_request']);
  assert.deepEqual(pr.on.pull_request.branches, ['main']);
  for (const [id, callerName, calleeName, reusable] of [
    ['frontend', 'Modular Frontend', 'Frontend Checks', 'reusable-frontend'],
    ['test-db', 'Modular Database', 'Database Tests', 'reusable-database'],
    ['test-edge-api', 'Modular Edge/API', 'Edge/API Tests', 'reusable-edge-api'],
  ]) {
    assert.equal(pr.jobs[id].name, callerName);
    assert.equal(pr.jobs[id].uses, `./.github/workflows/${reusable}.yml`);
    assert.equal(main.jobs[id].uses, pr.jobs[id].uses);
    assert.equal(workflow(reusable).jobs[id].name, calleeName);
  }
  assert.equal(pr.jobs.staging.uses, './.github/workflows/reusable-staging.yml');
  for (const job of Object.values(pr.jobs)) {
    assert.notEqual(job.uses, './.github/workflows/reusable-production.yml');
    assert.notEqual(job.uses, './.github/workflows/reusable-cloudflare.yml');
    for (const name of Object.keys(job.secrets ?? {})) {
      assert.ok(!['SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].includes(name));
    }
  }
});

test('actual modular caller and callee guards reject PRs, other refs and failed validation', () => {
  assert.deepEqual(main.jobs.production.needs, ['frontend', 'test-db', 'test-edge-api']);
  assert.equal(main.jobs.production.uses, './.github/workflows/reusable-production.yml');
  assert.deepEqual(main.jobs.production.with, { 'frontend-exists': "${{ needs.frontend.outputs.exists == 'true' }}" });
  for (const expression of [main.jobs.production.if, release.if]) {
    assert.equal(condition(expression), true);
    assert.equal(condition(expression, { success: () => false }), false);
    for (const event_name of ['pull_request', 'pull_request_target', 'workflow_run']) {
      assert.equal(condition(expression, { github: { event_name, ref: 'refs/heads/main' } }), false);
    }
    assert.equal(condition(expression, { github: { event_name: 'push', ref: 'refs/heads/other' } }), false);
    assert.equal(condition(expression, { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/other' } }), false);
  }
  assert.equal(condition(main.jobs.production.if, { needs: { frontend: { outputs: { exists: 'false' } } } }), false);
  assert.equal(condition(release.if, { inputs: { 'frontend-exists': false } }), false);
  for (const caller of ['ci.yml', 'modular-pr-validation.yml', 'other.yml']) {
    assert.equal(condition(release.if, { github: { event_name: 'push', ref: 'refs/heads/main',
      repository: '2ton-exe/moris-mix-ai', workflow_ref: `2ton-exe/moris-mix-ai/.github/workflows/${caller}@refs/heads/main` } }), false);
  }
  assert.equal(condition(release.if, { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main',
    repository: '2ton-exe/moris-mix-ai', workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/modular-main.yml@refs/heads/main' } }), true);
  for (const job of [main.jobs.production, main.jobs['test-edge-api'], edge.jobs['test-hosted-rls']]) {
    assert.notEqual(job['continue-on-error'], true);
    assert.doesNotMatch(job.if ?? '', /always\(|!cancelled\(/);
  }
});

test('failed/cancelled/skipped gating dependencies block production; E2E remains non-gating', () => {
  const caller = main.jobs.production;
  assert.ok(main.jobs['test-e2e']);
  assert.ok(!caller.needs.includes('test-e2e'));
  assert.ok(!caller.needs.includes('gate-evidence'));
  for (const dependency of caller.needs) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = Object.fromEntries(caller.needs.map(name => [name, { result: 'success', outputs: {} }]));
      needs.frontend.outputs.exists = 'true';
      needs[dependency].result = result;
      assert.equal(condition(caller.if, { needs, success: () => Object.values(needs).every(n => n.result === 'success') }), false);
    }
  }
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.equal(condition(caller.if, { needs: { frontend: { outputs: { exists: 'true' } }, 'test-e2e': { result } } }), true);
  }
  assert.notEqual(caller['continue-on-error'], true);
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
  for (const guard of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'supabase/config.toml',
    'https://${SUPABASE_PROJECT_REF}.supabase.co']) assert.ok(configuration.run.includes(guard), guard);
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
  for (const caller of [main.jobs.production]) {
    assert.deepEqual(Object.keys(caller.secrets).sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN']);
    for (const [key, value] of Object.entries(caller.secrets)) assert.equal(value, '${{ secrets.' + key + ' }}');
  }
});

test('main validation covers current authoritative Edge/API targets and mandatory hosted RLS', () => {
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
  assert.equal(edge.on.workflow_call.inputs['require-hosted-rls'].default, false);
  assert.equal(workflow('modular-pr-validation').jobs['test-edge-api'].with?.['require-hosted-rls'] ?? false, false);
  for (const name of ['Type-check Edge Function and tests', 'Run deterministic Edge/API tests']) {
    // Explicit contract replaces parity against the retired workflow. Keep all
    // current recipe, auth, AI and recipe-image targets independently asserted.
    const targets = step(edge.jobs['test-edge-api'], name).run.split(/\s+/).filter(s => s.startsWith('supabase/'));
    const tests = ['demo_recipe', 'auth', 'recipes', 'ai_contracts', 'eval_dataset', 'cross_user_rls_lineage',
      'recipe_image_schemas', 'gemini_adapter', 'extract_recipe', 'generate_recipe', 'recipe_context']
      .map(name => `supabase/functions/tests/${name}_test.ts`);
    const expected = name.startsWith('Type-check') ? [
      'supabase/functions/_shared/auth.ts', 'supabase/functions/_shared/ai/recipeContext.ts',
      'supabase/functions/_shared/recipe-images/schemas.ts',
      ...['demo-recipe', 'auth-session', 'recipes', 'extract-recipe', 'generate-recipe'].map(name => `supabase/functions/${name}/index.ts`),
      'supabase/functions/tests/auth_rls_integration_test.ts', ...tests,
    ] : tests;
    assert.deepEqual(targets.sort(), expected.sort());
  }
  const hosted = edge.jobs['test-hosted-rls'];
  assert.equal(hosted.needs, 'test-edge-api');
  assert.notEqual(hosted['continue-on-error'], true);
  assert.match(hosted.if, /inputs.require-hosted-rls/);
  assert.deepEqual(hosted.permissions, { contents: 'read' });
  assert.equal(condition(hosted.if, { inputs: { 'require-hosted-rls': true } }), true);
  assert.equal(condition(hosted.if, { inputs: { 'require-hosted-rls': false } }), false);
  for (const github of [{ event_name: 'pull_request', ref: 'refs/heads/main' },
    { event_name: 'push', ref: 'refs/heads/other' }]) {
    assert.equal(condition(hosted.if, { inputs: { 'require-hosted-rls': true }, github }), false);
  }
  const integration = step(hosted, 'Run hosted RLS integration tests');
  assert.equal(integration.env.REQUIRE_HOSTED_RLS_INTEGRATION, 'true');
  assert.equal(integration.if, undefined);
  assert.match(integration.run, /deno test .*--allow-env --allow-net --filter "hosted integration"/);
  for (const target of ['cross_user_rls_lineage_test.ts', 'recipe_context_test.ts']) assert.ok(integration.run.includes(target));
  assert.equal(step(workflow('reusable-frontend').jobs.frontend, 'Test runtime smoke verifier (offline)').run,
    'node --test scripts/runtime-smoke.test.mjs');
  assert.equal(step(workflow('reusable-frontend').jobs.frontend, 'Test production workflow safety (offline)').run,
    'node --test scripts/production-workflow.test.mjs');
});

test('cutover files contain no literal credential patterns', () => {
  const cutoverPaths = [
    '.github/production-cutover.md',
    '.github/workflows/modular-pr-validation.yml',
    '.github/workflows/pr-secretary.yml',
    '.github/workflows/modular-main.yml',
    '.github/workflows/reusable-edge-api.yml',
    '.github/workflows/reusable-frontend.yml',
    '.github/workflows/reusable-production.yml',
    'scripts/production-workflow.test.mjs',
    'scripts/pr-secretary.mjs',
    'scripts/pr-secretary.test.mjs',
    'docs/api/auth-session.md',
    'docs/architecture/sprint-1-adr.md',
    'docs/development-setup.md',
    'docs/devops/deployment-runbook.md',
    'docs/devops/modular-workflows.md',
    'docs/devops/observability-audit.md',
    'docs/devops/pipeline-metrics.md',
    'docs/devops/pr-secretary.md',
  ];
  const contents = cutoverPaths.map(path => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(contents,
    /(?:sb_secret_|sbp_|gh[pousr]_|github_pat_)[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
});
