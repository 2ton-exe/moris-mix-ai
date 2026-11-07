import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCACertificates } from 'node:tls';
import { getSupabaseDatabaseCaCertificates, getSupabaseDatabaseConnection } from './supabase-database-target.mjs';

// Use the YAML parser already installed with the locked frontend ESLint tooling.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const main = workflow('modular-main');
const production = workflow('reusable-production');
const release = production.jobs.deploy;
const edge = workflow('reusable-edge-api');
const scheduledCleanup = workflow('recipe-image-upload-cleanup');
const step = (job, name) => job.steps.find(s => s.name === name);

// These conditions use only this small subset of Actions expressions. Execute the
// actual YAML expressions against fixtures so changes to the gate affect tests.
function condition(expression, overrides = {}) {
  if (typeof expression === 'boolean') return expression;
  const context = {
    actionsStringEqual: (left, right) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase(),
    success: () => true,
    vars: {},
    inputs: { 'frontend-exists': true },
    needs: { frontend: { outputs: { exists: 'true' } } },
    github: { event_name: 'push', ref: 'refs/heads/main', repository: '2ton-exe/moris-mix-ai',
      workflow_ref: '2ton-exe/moris-mix-ai/.github/workflows/modular-main.yml@refs/heads/main' },
    format: (template, value) => template.replace('{0}', value),
    ...overrides,
  };
  const source = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/inputs\.docs-only/g, 'inputs["docs-only"]')
    .replace(/needs\.(test-db|test-edge-api)/g, 'needs["$1"]')
    .replace(/inputs\.frontend-exists/g, 'inputs["frontend-exists"]')
    .replace(/inputs\.deploy-upload-signing/g, 'inputs["deploy-upload-signing"]')
    .replace(/inputs\.require-hosted-rls/g, 'inputs["require-hosted-rls"]')
    // Actions compares strings without case sensitivity (unlike JavaScript).
    .replace(/(vars\.RECIPE_IMAGE_CLEANUP_ENABLED) == ('true')/g, 'actionsStringEqual($1, $2)');
  return Function(...Object.keys(context), `return (${source});`)(...Object.values(context));
}

test('all workflow YAML parses, including the reusable production contract', () => {
  for (const name of readdirSync('.github/workflows').filter(n => /\.ya?ml$/.test(n))) {
    assert.ok(load(readFileSync(`.github/workflows/${name}`, 'utf8')).jobs, name);
  }
  assert.deepEqual(Object.keys(production.on), ['workflow_call']);
  assert.deepEqual(production.permissions, { contents: 'read' });
});

test('Supabase database targets accept only the direct endpoint or project-bound session pooler', () => {
  const projectRef = 'gtbwblxskctpsqhbpebg';
  const direct = getSupabaseDatabaseConnection(
    `postgresql://postgres:local-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    projectRef,
  );
  assert.equal(direct.host, `db.${projectRef}.supabase.co`);
  assert.equal(direct.port, 5432);
  assert.equal(direct.user, 'postgres');
  const pooled = getSupabaseDatabaseConnection(
    `postgresql://postgres.${projectRef}:local-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
    projectRef,
  );
  assert.equal(pooled.host, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(pooled.port, 5432);
  assert.equal(pooled.user, `postgres.${projectRef}`);

  for (const target of [
    `postgresql://postgres:local-password@db.otherproject.supabase.co:5432/postgres`,
    `postgresql://postgres.${projectRef}:local-password@attacker.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.otherproject:local-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:local-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres:local-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres:local-password@db.${projectRef}.supabase.co:5433/postgres`,
    `postgresql://postgres:local-password@db.${projectRef}.supabase.co/postgres`,
    `postgresql://postgres:local-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=disable`,
  ]) assert.throws(() => getSupabaseDatabaseConnection(target, projectRef));
});

test('Supabase database TLS requires a valid CA and retains Node trusted roots', () => {
  const trustedCertificates = getCACertificates('default');
  const caCertificates = getSupabaseDatabaseCaCertificates(trustedCertificates[0]);
  assert.ok(caCertificates.length > trustedCertificates.length);
  assert.equal(caCertificates.at(-1), trustedCertificates[0]);
  for (const invalid of [undefined, '', 'not a PEM certificate', '-----BEGIN CERTIFICATE-----invalid-----END CERTIFICATE-----']) {
    assert.throws(() => getSupabaseDatabaseCaCertificates(invalid), /CA certificate is missing or invalid/);
  }
});

test('legacy CI is intentionally absent; modular main is the only production caller', () => {
  assert.equal(existsSync('.github/workflows/ci.yml'), false);
  assert.deepEqual(Object.keys(main.on), ['push', 'workflow_dispatch']);
  assert.deepEqual(main.on.push.branches, ['main']);
  assert.deepEqual(main.on.workflow_dispatch.inputs['deploy-upload-signing'], {
    description: 'Reserved upload-signing deployment request; the production job is hard-disabled',
    required: false,
    default: false,
    type: 'boolean',
  });
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
  assert.deepEqual(main.jobs.production.with, {
    'frontend-exists': "${{ needs.frontend.outputs.exists == 'true' }}",
  });
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
    'Deploy extract-recipe Edge Function', 'Deploy generate-recipe Edge Function',
    'Deploy recipe image upload cleanup Edge Function', 'Deploy to Cloudflare Workers', 'Verify production deployment URL', 'Verify deployed AI routes', 'Production runtime smoke',
    'Record production deployment and runtime outcomes', 'Preserve production runtime evidence', 'Preserve production AI route evidence'];
  const positions = ordered.map(name => release.steps.indexOf(step(release, name)));
  assert.ok(positions.every((position, i) => position >= 0 && (!i || position > positions[i - 1])));
  for (const name of ordered.slice(0, -3).filter(name => name !== 'Deploy recipe image upload cleanup Edge Function')) {
    assert.equal(step(release, name).if, undefined);
    assert.notEqual(step(release, name)['continue-on-error'], true);
  }
  const commands = release.steps.map(s => s.run ?? '').join('\n');
  assert.deepEqual([...commands.matchAll(/functions deploy (\S+)/g)].map(m => m[1]), ['recipes', 'extract-recipe', 'generate-recipe', 'recipe-image-upload-cleanup']);
  assert.doesNotMatch(commands, /db push|migration up|run-migrations|db:setup/);
  assert.doesNotMatch(commands, /secrets set|AI_EXTRACT_ENABLED|AI_GENERATE_ENABLED|GEMINI_API_KEY|AI_CANDIDATE_TOKEN_SECRET/);
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
  const frontendPackage = JSON.parse(readFileSync('frontend/package.json', 'utf8'));
  assert.match(frontendPackage.devDependencies.supabase, /^\d+\.\d+\.\d+$/);
  for (const target of ['recipes', 'extract-recipe', 'generate-recipe']) {
    const deploy = step(release, `Deploy ${target} Edge Function`);
    assert.equal(deploy.id, `deploy-${target}`);
    assert.equal(deploy['working-directory'], 'frontend');
    assert.deepEqual(deploy.env, configuration.env);
    assert.ok(deploy.run.includes(`pnpm exec supabase --workdir "$GITHUB_WORKSPACE" functions deploy ${target}`));
    assert.match(deploy.run, /--project-ref "\$SUPABASE_PROJECT_REF"/);
    assert.match(deploy.run, /--no-verify-jwt[\s\S]*--use-api[\s\S]*--yes/);
    assert.doesNotMatch(deploy.run, /--prune|--all|latest|npx/);
  }
  const cleanup = step(release, 'Deploy recipe image upload cleanup Edge Function');
  assert.equal(cleanup.if, false);
  assert.equal(cleanup.id, 'deploy-recipe-image-cleanup');
  assert.equal(cleanup['working-directory'], 'frontend');
  assert.deepEqual(cleanup.env, configuration.env);
  assert.match(cleanup.run, /--workdir "\$GITHUB_WORKSPACE" functions deploy recipe-image-upload-cleanup/);
  assert.match(cleanup.run, /--project-ref "\$SUPABASE_PROJECT_REF"/);
  assert.match(cleanup.run, /--no-verify-jwt[\s\S]*--use-api[\s\S]*--yes/);
  assert.doesNotMatch(cleanup.run, /--prune|--all|latest|npx/);
  assert.equal(step(release, 'Deploy to Cloudflare Workers').id, 'deploy-cloudflare');
  assert.equal(step(release, 'Deploy to Cloudflare Workers').uses, 'cloudflare/wrangler-action@v3');
  assert.equal(step(release, 'Deploy to Cloudflare Workers').with.command, 'deploy --config wrangler.jsonc');
  const verify = step(release, 'Verify production deployment URL');
  assert.equal(verify.id, 'verify-deployment');
  assert.equal(verify.env.DEPLOYMENT_URL, '${{ steps.deploy-cloudflare.outputs.deployment-url }}');
  assert.match(verify.run, /"\$\{DEPLOYMENT_URL%\/\}" != "\$\{SMOKE_FRONTEND_URL%\/\}"/);
  const aiSmoke = step(release, 'Verify deployed AI routes');
  assert.equal(aiSmoke.id, 'ai-route-smoke');
  assert.equal(aiSmoke.run, 'node scripts/ai-route-smoke.mjs');
  assert.deepEqual(aiSmoke.env, {
    AI_ROUTE_SMOKE_SUPABASE_URL: '${{ vars.VITE_SUPABASE_URL }}',
    AI_ROUTE_SMOKE_PROJECT_REF: '${{ vars.SUPABASE_PROJECT_REF }}',
    AI_ROUTE_SMOKE_FRONTEND_URL: '${{ vars.PRODUCTION_FRONTEND_URL }}',
  });
  assert.equal(step(release, 'Production runtime smoke').id, 'runtime-smoke');
  assert.equal(step(release, 'Production runtime smoke').run, 'node scripts/runtime-smoke.mjs');
  assert.equal(step(release, 'Production runtime smoke').env.SMOKE_DEPLOYMENT_OUTCOME, '${{ steps.deploy-cloudflare.outcome }}');
  for (const name of ordered.slice(-3)) {
    assert.equal(step(release, name).if, 'always()');
    assert.notEqual(step(release, name)['continue-on-error'], true);
  }
  assert.deepEqual(step(release, 'Record production deployment and runtime outcomes').env, {
    RECIPES_OUTCOME: '${{ steps.deploy-recipes.outcome }}',
    IMAGE_CLEANUP_OUTCOME: '${{ steps.deploy-recipe-image-cleanup.outcome }}',
    EXTRACT_RECIPE_OUTCOME: '${{ steps.deploy-extract-recipe.outcome }}',
    GENERATE_RECIPE_OUTCOME: '${{ steps.deploy-generate-recipe.outcome }}',
    CLOUDFLARE_OUTCOME: '${{ steps.deploy-cloudflare.outcome }}',
    URL_OUTCOME: '${{ steps.verify-deployment.outcome }}',
    AI_ROUTE_SMOKE_OUTCOME: '${{ steps.ai-route-smoke.outcome }}',
    SMOKE_OUTCOME: '${{ steps.runtime-smoke.outcome }}',
  });
  const artifact = step(release, 'Preserve production runtime evidence');
  assert.equal(artifact.uses, 'actions/upload-artifact@v4');
  assert.equal(artifact.with.path, 'runtime-smoke.json');
  assert.equal(artifact.with.name, 'production-runtime-smoke-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.equal(artifact.with['if-no-files-found'], 'warn');
  const aiArtifact = step(release, 'Preserve production AI route evidence');
  assert.equal(aiArtifact.uses, 'actions/upload-artifact@v4');
  assert.equal(aiArtifact.with.path, 'ai-route-smoke.json');
  assert.equal(aiArtifact.with.name, 'production-ai-route-smoke-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.equal(aiArtifact.with['if-no-files-found'], 'warn');
  const summary = step(release, 'Record production deployment and runtime outcomes');
  for (const name of Object.keys(summary.env)) assert.ok(summary.run.includes('${' + name + '}'), name);
  assert.deepEqual(release.concurrency, { group: 'cloudflare-production', 'cancel-in-progress': false, queue: 'max' });
  assert.deepEqual(release.permissions, { contents: 'read' });
  for (const caller of [main.jobs.production]) {
    assert.deepEqual(Object.keys(caller.secrets).sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN']);
    for (const [key, value] of Object.entries(caller.secrets)) assert.equal(value, '${{ secrets.' + key + ' }}');
  }
});

test('upload signing keeps its protected deployment job and frozen dependency setup', () => {
  const job = main.jobs['deploy-upload-signing'];
  assert.deepEqual(job.needs, 'production');
  assert.equal(job.environment, 'recipe-image-upload-production');
  assert.equal(job.if, false);
  const rootInstall = step(job, 'Install root dependencies');
  assert.equal(rootInstall.run, 'pnpm install --frozen-lockfile');
  assert.ok(JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.pg);
  assert.equal(existsSync('pnpm-lock.yaml'), true);
  const frontendInstall = step(job, 'Install frontend dependencies');
  assert.equal(frontendInstall['working-directory'], 'frontend');
  assert.equal(frontendInstall.run, 'pnpm install --frozen-lockfile');
  assert.ok(JSON.parse(readFileSync('frontend/package.json', 'utf8')).devDependencies.supabase);
  assert.equal(existsSync('frontend/pnpm-lock.yaml'), true);
  const readiness = step(job, 'Verify upload-signing production readiness');
  assert.equal(readiness.run, 'node scripts/verify-upload-signing-readiness.mjs');
  assert.equal(readiness.env.SUPABASE_DATABASE_URL, '${{ secrets.SUPABASE_DATABASE_URL }}');
  assert.equal(readiness.env.SUPABASE_DATABASE_CA_CERT, '${{ secrets.SUPABASE_DATABASE_CA_CERT }}');
  assert.equal(readiness.env.UPLOAD_SIGNING_READINESS_ATTESTATION, '${{ secrets.UPLOAD_SIGNING_READINESS_ATTESTATION }}');
  const checkout = step(job, 'Checkout repository');
  assert.equal(checkout.uses, 'actions/checkout@v4');
  assert.deepEqual(checkout.with, { 'persist-credentials': false });
  const deploy = step(job, 'Deploy recipe image upload URL Edge Function');
  assert.equal(deploy.if, "success() && steps.upload-signing-readiness.outcome == 'success'");
  assert.equal(deploy.id, 'deploy-recipe-image-upload-url');
  assert.equal(deploy['working-directory'], 'frontend');
  assert.match(deploy.run, /functions deploy recipe-image-upload-url/);
  assert.match(deploy.run, /--project-ref "\$SUPABASE_PROJECT_REF"/);
  assert.match(deploy.run, /--no-verify-jwt[\s\S]*--use-api[\s\S]*--yes/);
  assert.equal(deploy.env.SUPABASE_ACCESS_TOKEN, '${{ secrets.SUPABASE_ACCESS_TOKEN }}');
  assert.equal(step(job, 'Record upload-signing deployment outcome').if, 'always()');
});

test('recipe image cleanup is explicitly disabled for scheduled and manual invocation', () => {
  assert.deepEqual(scheduledCleanup.on.schedule, [{ cron: '*/15 * * * *' }]);
  assert.equal('workflow_dispatch' in scheduledCleanup.on, true);
  assert.deepEqual(scheduledCleanup.permissions, { contents: 'read' });
  const cleanup = scheduledCleanup.jobs.cleanup;
  assert.equal(cleanup.if, false);
  assert.equal(cleanup.steps.length, 1);
  assert.deepEqual(cleanup.steps[0].env, {
    SUPABASE_URL: '${{ vars.VITE_SUPABASE_URL }}',
    RECIPE_IMAGE_CLEANUP_TOKEN: '${{ secrets.RECIPE_IMAGE_CLEANUP_TOKEN }}',
  });
  const cleanupCommand = cleanup.steps[0].run;
  assert.doesNotMatch(cleanupCommand, /BE13_CLEANUP|BE-13/);
  const httpsGuardIndex = cleanupCommand.indexOf('if [[ "${SUPABASE_URL,,}" != https://* ]]');
  const curlIndex = cleanupCommand.indexOf('curl --fail --silent --show-error');
  assert.notEqual(httpsGuardIndex, -1);
  assert.notEqual(curlIndex, -1);
  assert.ok(httpsGuardIndex < curlIndex);
  assert.match(cleanup.steps[0].run, /functions\/v1\/recipe-image-upload-cleanup/);
  assert.doesNotMatch(cleanup.steps[0].run, /R2_(?:ACCOUNT_ID|BUCKET_NAME|ACCESS_KEY_ID|SECRET_ACCESS_KEY|IMAGE_|BACKUP_)|SUPABASE_SERVICE_ROLE_KEY/);
});

test('main validation covers current authoritative Edge/API targets and mandatory hosted RLS', () => {
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
  assert.equal(edge.on.workflow_call.inputs['require-hosted-rls'].default, false);
  assert.equal(workflow('modular-pr-validation').jobs['test-edge-api'].with?.['require-hosted-rls'] ?? false, false);
  for (const name of ['Type-check Edge Function and tests', 'Run deterministic Edge/API tests']) {
    // Explicit contract replaces parity against the retired workflow. Keep all
    // current recipe, auth, AI and recipe-image targets independently asserted.
    const targets = step(edge.jobs['test-edge-api'], name).run.split(/\s+/).filter(s => s.startsWith('supabase/'));
    const tests = ['demo_recipe', 'auth', 'recipes', 'ai_contracts', 'candidate_token', 'eval_dataset', 'cross_user_rls_lineage',
      'recipe_image_schemas', 'r2_signing', 'recipe_image_upload_url', 'recipe_image_upload_cleanup', 'recipe_image_lifecycle', 'gemini_adapter', 'extract_recipe', 'generate_recipe', 'recipe_context']
      .map(name => `supabase/functions/tests/${name}_test.ts`);
    const expected = name.startsWith('Type-check') ? [
      'supabase/functions/_shared/auth.ts', 'supabase/functions/_shared/ai/recipeContext.ts',
      'supabase/functions/_shared/recipe-images/schemas.ts', 'supabase/functions/_shared/recipe-images/r2.ts',
      'supabase/functions/_shared/recipe-images/lifecycle.ts',
      'supabase/functions/_shared/recipe-images/uploadIntents.ts',
      'supabase/functions/_shared/recipe-images/uploadCleanup.ts',
      ...['demo-recipe', 'auth-session', 'recipes', 'extract-recipe', 'generate-recipe', 'recipe-image-upload-url', 'recipe-image-upload-cleanup', 'recipe-image-attach', 'recipe-image-download-url', 'recipe-image-delete', 'recipe-image-final-cleanup'].map(name => `supabase/functions/${name}/index.ts`),
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
    'node --test scripts/production-workflow.test.mjs scripts/ai-route-smoke.test.mjs');
});

test('Stage A keeps required workflows unfiltered and classifier failure runs core validation', () => {
  const pr = workflow('modular-pr-validation');
  // Required validation entrypoints must never disappear because of a path
  // filter. Optional, non-required observation workflows may be path-scoped.
  for (const name of ['modular-pr-validation.yml', 'modular-main.yml']) {
    const triggers = load(readFileSync(`.github/workflows/${name}`, 'utf8')).on;
    for (const event of ['pull_request', 'push']) {
      assert.equal(triggers[event]?.paths, undefined, name);
      assert.equal(triggers[event]?.['paths-ignore'], undefined, name);
    }
  }
  const audit = workflow('security-audit');
  assert.ok(Array.isArray(audit.on.pull_request.paths));
  assert.ok(audit.on.pull_request.paths.includes('.github/workflows/security-audit.yml'));
  assert.equal(audit.on.push, undefined, 'observation workflow must not gate production push');
  assert.deepEqual(audit.permissions, { contents: 'read' });
  // Caller-wide minimum must not depend on repository default token settings.
  assert.deepEqual(pr.permissions, { contents: 'read' });
  const classifier = pr.jobs.classify;
  assert.deepEqual(classifier.permissions, { contents: 'read' });
  assert.equal(classifier.secrets, undefined);
  const checkout = step(classifier, 'Checkout real PR head with full history');
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(step(classifier, 'Classify complete PR diff').run, 'node scripts/ci-path-classifier.mjs');
  assert.equal(classifier.outputs.docs_only, '${{ steps.classify.outputs.docs_only }}');
  for (const id of ['frontend', 'test-db', 'test-edge-api']) {
    const caller = pr.jobs[id];
    assert.equal(caller.needs, 'classify');
    assert.equal(caller.if, '${{ !cancelled() }}');
    for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
      for (const docs_only of ['true', 'false', '', undefined]) {
        const overrides = { needs: { classify: { result, outputs: { docs_only } } }, cancelled: () => false };
        assert.equal(condition(caller.if, overrides), true);
        assert.equal(condition(caller.with['docs-only'], overrides), result === 'success' && docs_only === 'true');
      }
    }
    assert.equal(condition(caller.if, { cancelled: () => true }), false);
    assert.equal(main.jobs[id].with?.['docs-only'], undefined, 'main never opts into selection');
    assert.equal(main.jobs[id].needs, undefined, 'main does not depend on PR classification');
  }
});

test('docs-only paths execute successful core jobs; main and hosted RLS cannot no-op', () => {
  for (const [file, id] of [['reusable-frontend', 'frontend'], ['reusable-database', 'test-db'], ['reusable-edge-api', 'test-edge-api']]) {
    const reusable = workflow(file);
    const job = reusable.jobs[id];
    assert.deepEqual(reusable.on.workflow_call.inputs['docs-only'], {
      description: 'Verified Stage A prose-only PR; never applies to main', type: 'boolean', default: false,
    });
    assert.equal(job.if, undefined, 'required context itself must not skip');
    assert.equal(step(job, 'Checkout repository').if, undefined);
    const noop = step(job, 'Record documentation-only validation path');
    assert.equal(noop.if, "env.DOCS_ONLY == 'true'");
    for (const event_name of ['push', 'workflow_dispatch', 'pull_request']) {
      for (const docsOnly of [false, true]) {
        const expected = event_name === 'pull_request' && docsOnly;
        assert.equal(condition(job.env.DOCS_ONLY, { inputs: { 'docs-only': docsOnly, 'require-hosted-rls': false },
          github: { event_name } }), expected);
      }
    }
    if (file === 'reusable-edge-api') {
      assert.equal(condition(job.env.DOCS_ONLY, { inputs: { 'docs-only': true, 'require-hosted-rls': true },
        github: { event_name: 'pull_request' } }), false);
    }
    const skippedNames = id === 'frontend' ? ['Run lint', 'Run frontend tests', 'Build frontend'] :
      job.steps.filter(s => s.name !== 'Checkout repository' && s !== noop).map(s => s.name);
    for (const name of skippedNames) {
      const expression = step(job, name).if;
      const context = { steps: { frontend: { outputs: { exists: 'true' } }, 'hosted-migration': { outputs: { run: 'true' } } } };
      // Actual conditions contain hyphenated Actions identifiers.
      const source = expression.replace(/steps\.hosted-migration/g, 'steps["hosted-migration"]');
      assert.equal(condition(source, { ...context, env: { DOCS_ONLY: 'true' } }), false, name);
      assert.equal(condition(source, { ...context, env: { DOCS_ONLY: 'false' } }), true, name);
    }
  }
  const frontend = workflow('reusable-frontend');
  assert.equal(frontend.on.workflow_call.outputs.exists.value, '${{ jobs.frontend.outputs.exists }}');
  assert.equal(frontend.jobs.frontend.outputs.exists, '${{ steps.frontend.outputs.exists }}');
  for (const name of ['Test CI path classifier (offline)', 'Test runtime smoke verifier (offline)',
    'Test production workflow safety (offline)', 'Check for frontend project']) {
    assert.equal(step(frontend.jobs.frontend, name).if, undefined, name);
  }
  assert.equal(step(frontend.jobs.frontend, 'Run PR Secretary regression tests').if, "hashFiles('scripts/pr-secretary.test.mjs') != ''");
  assert.equal(step(frontend.jobs.frontend, 'Install dependencies').if, "steps.frontend.outputs.exists == 'true'");
  assert.equal(workflow('reusable-database').jobs['test-db'].services.postgres.image, 'postgres:16');
  assert.equal(main.jobs['test-edge-api'].with['require-hosted-rls'], true);
  assert.doesNotMatch(edge.jobs['test-hosted-rls'].if, /docs-only|DOCS_ONLY/);
});

test('E2E and staging skip only on successful explicit docs-only decisions', () => {
  const pr = workflow('modular-pr-validation');
  assert.equal(pr.jobs['test-e2e'].needs, 'classify');
  assert.deepEqual(pr.jobs.staging.needs, ['classify', 'frontend', 'test-db', 'test-edge-api']);
  for (const output of ['e2e', 'staging']) {
    assert.equal(pr.jobs.classify.outputs[output], '${{ steps.classify.outputs.' + output + ' }}');
  }
  const marker = step(pr.jobs.classify, 'Record documentation-only E2E/staging skips');
  for (const result of ['success', 'failure', 'skipped', 'cancelled', undefined]) {
    for (const docs_only of ['true', 'false', '', undefined]) {
      for (const decision of ['skip', 'run', '', 'malformed', undefined]) {
        const outputs = { docs_only, e2e: decision, staging: decision };
        const needs = { classify: { result, outputs }, frontend: { result: 'success' },
          'test-db': { result: 'success' }, 'test-edge-api': { result: 'success' } };
        const overrides = { needs, cancelled: () => false, success: () => false,
          github: { repository: '2ton-exe/moris-mix-ai', event: { pull_request: {
            draft: false, head: { repo: { full_name: '2ton-exe/moris-mix-ai' } },
          } } } };
        const skip = result === 'success' && docs_only === 'true' && decision === 'skip';
        for (const id of ['test-e2e', 'staging']) {
          assert.equal(condition(pr.jobs[id].if, overrides), !skip, `${id}: ${result}/${docs_only}/${decision}`);
          assert.equal(condition(pr.jobs[id].if, { ...overrides, cancelled: () => true }), false);
        }
        assert.equal(condition(marker.if, { steps: { classify: { outputs } } }), docs_only === 'true' && decision === 'skip');
        for (const dependency of ['frontend', 'test-db', 'test-edge-api']) {
          for (const coreResult of ['failure', 'skipped', 'cancelled', undefined]) {
            assert.equal(condition(pr.jobs.staging.if, { ...overrides,
              needs: { ...needs, [dependency]: { result: coreResult } } }), false);
          }
        }
        for (const pull_request of [{ draft: true, head: { repo: { full_name: '2ton-exe/moris-mix-ai' } } },
          { draft: false, head: { repo: { full_name: 'fork/repo' } } }]) {
          assert.equal(condition(pr.jobs.staging.if, { ...overrides,
            github: { repository: '2ton-exe/moris-mix-ai', event: { pull_request } } }), false);
        }
      }
    }
  }
  assert.equal(main.jobs['test-e2e'].needs, undefined);
  assert.equal(main.jobs['test-e2e'].if, undefined);
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
    'scripts/ai-route-smoke.mjs',
    'scripts/ai-route-smoke.test.mjs',
    'scripts/pr-secretary.mjs',
    'scripts/pr-secretary.test.mjs',
    'scripts/ci-path-classifier.mjs',
    'scripts/ci-path-classifier.test.mjs',
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

test('cleanup deployment and invocation stay disabled regardless of configuration', () => {
  const deployment = step(release, 'Deploy recipe image upload cleanup Edge Function');
  assert.equal(deployment.if, false);
  for (const event_name of ['push', 'schedule', 'workflow_dispatch']) {
    for (const value of [undefined, '', 'false', 'TRUE', 'True', ' true', 'true ', 'true']) {
      const vars = value === undefined ? {} : { RECIPE_IMAGE_CLEANUP_ENABLED: value };
      const github = { event_name, ref: 'refs/heads/main' };
      assert.equal(condition(deployment.if, { vars, github }), false);
      assert.equal(condition(scheduledCleanup.jobs.cleanup.if, { vars, github }), false);
    }
  }
});

test('cleanup workflow paths contain no variable-based activation bypass', () => {
  const deployment = step(release, 'Deploy recipe image upload cleanup Edge Function');
  const invocation = step(scheduledCleanup.jobs.cleanup, 'Invoke recipe image cleanup');
  assert.equal(deployment.if, false);
  assert.equal(scheduledCleanup.jobs.cleanup.if, false);
  for (const target of [deployment, invocation]) {
    assert.equal(target.env.RECIPE_IMAGE_CLEANUP_ENABLED, undefined);
    assert.doesNotMatch(target.run, /RECIPE_IMAGE_CLEANUP_ENABLED/);
  }
});

test('upload signing remains disabled until ingress and cleanup readiness are addressed', () => {
  const job = main.jobs['deploy-upload-signing'];
  assert.equal(job.if, false);
  assert.equal(job.environment, 'recipe-image-upload-production');
  assert.equal(job.needs, 'production');
  assert.doesNotMatch(JSON.stringify(job.if), /vars\.|inputs\./);
  const readiness = step(job, 'Verify upload-signing production readiness');
  assert.equal(readiness.run, 'node scripts/verify-upload-signing-readiness.mjs');
  for (const name of [
    'SUPABASE_DATABASE_URL', 'SUPABASE_DATABASE_CA_CERT', 'SUPABASE_URL', 'SUPABASE_PROJECT_REF',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
    'ALLOWED_ORIGIN', 'UPLOAD_SIGNING_READINESS_ATTESTATION',
  ]) assert.ok(Object.hasOwn(readiness.env, name), name);
  for (const name of [
    'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_IMAGE_ENDPOINT', 'R2_IMAGE_BUCKET', 'R2_IMAGE_ACCESS_KEY_ID', 'R2_IMAGE_SECRET_ACCESS_KEY',
  ]) assert.equal(Object.hasOwn(readiness.env, name), false, name);
  for (const name of [
    'SUPABASE_DATABASE_URL', 'SUPABASE_DATABASE_CA_CERT', 'SUPABASE_SERVICE_ROLE_KEY',
    'UPLOAD_SIGNING_READINESS_ATTESTATION',
  ]) assert.equal(readiness.env[name], '${{ secrets.' + name + ' }}', name);
  assert.equal(readiness.env.SUPABASE_URL, '${{ vars.VITE_SUPABASE_URL }}');
  assert.equal(readiness.env.SUPABASE_PROJECT_REF, '${{ vars.SUPABASE_PROJECT_REF }}');
  assert.deepEqual(Object.keys(main.jobs.production.secrets).sort(), [
    'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN',
  ]);
  assert.deepEqual(Object.keys(production.on.workflow_call.secrets).sort(), [
    'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN',
  ]);
  const verifier = readFileSync('scripts/verify-upload-signing-readiness.mjs', 'utf8');
  for (const prerequisite of [
    '20261102000009', '20261102000010', 'recipe_image_upload_intents',
    'relforcerowsecurity', 'create_recipe_image_upload_intent',
    'has_table_privilege', 'has_function_privilege',
  ]) assert.ok(verifier.includes(prerequisite), prerequisite);
  assert.match(verifier, /getSupabaseDatabaseConnection/);
  assert.match(verifier, /UPLOAD_SIGNING_READINESS_ATTESTATION !== 'verified'/);
  assert.match(verifier, /\/auth\/v1\/settings/);
  assert.match(verifier, /\/rest\/v1\/recipe_image_upload_intents\?select=id&limit=0/);
  assert.match(verifier, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(verifier, /R2_(?:ACCOUNT_ID|BUCKET_NAME|ACCESS_KEY_ID|SECRET_ACCESS_KEY|IMAGE_)/);
  assert.match(verifier, /await import\('pg'\)/);
  assert.match(verifier, /getSupabaseDatabaseCaCertificates/);
  assert.match(verifier, /ssl:\s*\{\s*ca:\s*databaseCa,\s*rejectUnauthorized:\s*true\s*\}/);
  assert.doesNotMatch(verifier, /connectionString:/);
  assert.doesNotMatch(verifier, /\b(insert|update|delete|alter|create)\s+(into|table|function|policy)/i);
  const baseEnv = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
  const isolatedDirectory = mkdtempSync(join(tmpdir(), 'upload-readiness-'));
  try {
    const isolatedVerifier = join(isolatedDirectory, 'verify-upload-signing-readiness.mjs');
    writeFileSync(isolatedVerifier, verifier);
    writeFileSync(
      join(isolatedDirectory, 'supabase-database-target.mjs'),
      readFileSync('scripts/supabase-database-target.mjs', 'utf8'),
    );
    const missing = spawnSync(process.execPath, [isolatedVerifier], {
      cwd: isolatedDirectory, encoding: 'utf8', env: baseEnv, windowsHide: true,
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Missing required protected configuration: SUPABASE_DATABASE_URL/);
    assert.doesNotMatch(missing.stderr, /ERR_MODULE_NOT_FOUND/);
    const configured = {
      ...baseEnv,
      SUPABASE_DATABASE_URL: 'postgresql://placeholder:placeholder@db.invalid.supabase.co/postgres',
      SUPABASE_DATABASE_CA_CERT: getCACertificates('default')[0],
      SUPABASE_URL: 'https://invalid.supabase.co',
      SUPABASE_PROJECT_REF: 'invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
      SUPABASE_ANON_KEY: 'placeholder',
      ALLOWED_ORIGIN: 'https://example.invalid',
      UPLOAD_SIGNING_READINESS_ATTESTATION: 'unverified',
    };
    const missingCa = { ...configured, UPLOAD_SIGNING_READINESS_ATTESTATION: 'verified' };
    delete missingCa.SUPABASE_DATABASE_CA_CERT;
    const missingCaResult = spawnSync(process.execPath, [isolatedVerifier], {
      cwd: isolatedDirectory, encoding: 'utf8', env: missingCa, windowsHide: true,
    });
    assert.notEqual(missingCaResult.status, 0);
    assert.match(missingCaResult.stderr, /Missing required protected configuration: SUPABASE_DATABASE_CA_CERT/);
    assert.doesNotMatch(missingCaResult.stderr, /ERR_MODULE_NOT_FOUND/);
    const unverified = spawnSync(process.execPath, [isolatedVerifier], {
      cwd: isolatedDirectory, encoding: 'utf8', env: configured, windowsHide: true,
    });
    assert.notEqual(unverified.status, 0);
    assert.match(unverified.stderr, /readiness attestation is missing or invalid/);
    assert.doesNotMatch(unverified.stderr, /ERR_MODULE_NOT_FOUND/);
    const projectRef = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([^"]+)"$/m)?.[1];
    const invalidCa = {
      ...configured,
      SUPABASE_DATABASE_CA_CERT: 'invalid certificate',
      SUPABASE_DATABASE_URL: `postgresql://postgres:placeholder@db.${projectRef}.supabase.co:5432/postgres`,
      SUPABASE_URL: `https://${projectRef}.supabase.co`,
      SUPABASE_PROJECT_REF: projectRef,
      UPLOAD_SIGNING_READINESS_ATTESTATION: 'verified',
    };
    mkdirSync(join(isolatedDirectory, 'supabase'));
    writeFileSync(join(isolatedDirectory, 'supabase', 'config.toml'), `project_id = "${projectRef}"\n`);
    const invalidCaResult = spawnSync(process.execPath, [isolatedVerifier], {
      cwd: isolatedDirectory, encoding: 'utf8', env: invalidCa, windowsHide: true,
    });
    assert.notEqual(invalidCaResult.status, 0);
    assert.match(invalidCaResult.stderr, /CA certificate is missing or invalid/);
    assert.doesNotMatch(invalidCaResult.stderr, /ERR_MODULE_NOT_FOUND|fetch failed/);
  } finally {
    rmSync(isolatedDirectory, { recursive: true, force: true });
  }
  const deployment = step(job, 'Deploy recipe image upload URL Edge Function');
  assert.equal(deployment.if, "success() && steps.upload-signing-readiness.outcome == 'success'");
  assert.equal(deployment.id, 'deploy-recipe-image-upload-url');
  assert.equal(deployment['working-directory'], 'frontend');
  assert.match(deployment.run, /functions deploy recipe-image-upload-url/);
  assert.match(deployment.run, /--project-ref "\$SUPABASE_PROJECT_REF"/);
  assert.match(deployment.run, /--no-verify-jwt[\s\S]*--use-api[\s\S]*--yes/);
  assert.equal(step(job, 'Record upload-signing deployment outcome').if, 'always()');
  const stale = step(job, 'Reject stale upload-signing revision');
  const staleIndex = job.steps.indexOf(stale);
  const deploymentIndex = job.steps.indexOf(deployment);
  assert.equal(staleIndex, deploymentIndex - 1);
  assert.ok(job.steps.indexOf(readiness) < staleIndex);
  assert.equal(stale.if, undefined);
  assert.equal(stale.env.GH_TOKEN, '${{ github.token }}');
  assert.match(stale.run, /set -euo pipefail/);
  assert.match(stale.run, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/commits\/main"/);
  assert.match(stale.run, /"\$current_sha" != "\$GITHUB_SHA"/);
  for (const event_name of ['push', 'workflow_dispatch', 'pull_request']) {
    for (const ref of ['refs/heads/main', 'refs/heads/feature']) {
      for (const deployRequest of [undefined, false, true]) {
        for (const readiness of [undefined, 'verified']) {
          assert.equal(condition(job.if, {
            inputs: { 'deploy-upload-signing': deployRequest },
            vars: { UPLOAD_SIGNING_ENABLED: 'true' },
            secrets: { UPLOAD_SIGNING_READINESS_ATTESTATION: readiness },
            github: { event_name, ref },
          }), false);
        }
      }
    }
  }
});
