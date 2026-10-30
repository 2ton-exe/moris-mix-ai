import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { configuration, validateDemo, assetURL, request, runSmoke } from './runtime-smoke.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/demo-recipe.json', import.meta.url)));
const env = {
  SMOKE_ENVIRONMENT: 'staging', GITHUB_SHA: 'a'.repeat(40),
  SMOKE_BACKEND_REVISION: 'b'.repeat(40), SMOKE_PROJECT_REF: 'pjeykhjzqhryjwuoizgh',
  SMOKE_SUPABASE_URL: 'https://pjeykhjzqhryjwuoizgh.supabase.co',
  SMOKE_FRONTEND_URL: 'https://moris-mix-ai-staging.example.workers.dev',
  SMOKE_PUBLIC_KEY: 'public-test-key',
};
const html = '<!doctype html><html><div id="root"></div><script type="module" src="/assets/index-hash.js"></script></html>';
const response = (body, type, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
const offline = { sleep: async () => {} };

test('staging accepts only isolated origins and an explicit backend attestation', () => {
  assert.equal(configuration(env).api, env.SMOKE_SUPABASE_URL);
  for (const patch of [
    { SMOKE_BACKEND_REVISION: '' }, { GITHUB_SHA: '' }, { SMOKE_ENVIRONMENT: 'preview' },
    { SMOKE_PROJECT_REF: 'gtbwblxskctpsqhbpebg' },
    { SMOKE_SUPABASE_URL: 'https://gtbwblxskctpsqhbpebg.supabase.co' },
    { SMOKE_FRONTEND_URL: 'https://moris-mix-ai.example.workers.dev' },
    { SMOKE_FRONTEND_URL: `${env.SMOKE_FRONTEND_URL}/home` },
    { SMOKE_SUPABASE_URL: 'https://user:password@pjeykhjzqhryjwuoizgh.supabase.co' },
  ]) assert.throws(() => configuration({ ...env, ...patch }));
});

test('production pins the repository production project and requires its own frontend origin', () => {
  const prod = { ...env, SMOKE_ENVIRONMENT: 'production', SMOKE_PROJECT_REF: 'gtbwblxskctpsqhbpebg',
    SMOKE_SUPABASE_URL: 'https://gtbwblxskctpsqhbpebg.supabase.co', SMOKE_FRONTEND_URL: 'https://production.example.com' };
  assert.equal(configuration(prod).frontend, prod.SMOKE_FRONTEND_URL);
  assert.throws(() => configuration({ ...prod, SMOKE_FRONTEND_URL: '' }));
  assert.throws(() => configuration({ ...env, SMOKE_ENVIRONMENT: 'production' }));
});

test('approved public demo content accepts the relative seed date', () => {
  validateDemo(fixture);
  validateDemo({ recipe: { ...fixture.recipe, cooked_at: '2026-10-28' } });
  validateDemo({ recipe: { ...fixture.recipe, cooked_at: null } });
});

test('approved ingredients accept optional quantityText strings without changing the response', () => {
  const data = structuredClone(fixture);
  data.recipe.ingredients[0].quantityText = '200 g';
  data.recipe.ingredients[1].quantityText = '';
  data.recipe.ingredients[3].quantityText = 'a handful';
  const original = structuredClone(data);
  validateDemo(data);
  assert.deepEqual(data, original);
});

for (const quantityText of [null, 200, false, [], {}]) {
  test(`rejects non-string quantityText ${JSON.stringify(quantityText)}`, () => {
    const data = structuredClone(fixture);
    data.recipe.ingredients[0].quantityText = quantityText;
    assert.throws(() => validateDemo(data));
  });
}

for (const [name, mutate] of [
  ['wrong identity', data => { data.recipe.id = '22222222-2222-2222-2222-222222222222'; }],
  ['missing ingredients', data => { delete data.recipe.ingredients; }],
  ['wrong ingredient type', data => { data.recipe.ingredients[0].quantity = '200'; }],
  ['changed ingredient name', data => { data.recipe.ingredients[0].name = 'private'; }],
  ['changed ingredient quantity', data => { data.recipe.ingredients[0].quantity = 201; }],
  ['changed ingredient unit', data => { data.recipe.ingredients[0].unit = 'kg'; }],
  ['changed ingredient inferred', data => { data.recipe.ingredients[0].inferred = true; }],
  ['private ingredient field', data => { data.recipe.ingredients[0].user_id = 'private'; }],
  ['wrong flavor scores', data => { data.recipe.flavor_scores.sweet = 10; }],
  ['private owner field', data => { data.recipe.user_id = 'private'; }],
  ['error envelope', data => { data.error = { code: 'INTERNAL_ERROR' }; }],
  ['invalid date', data => { data.recipe.cooked_at = '2026-02-30'; }],
]) test(`rejects ${name}`, () => {
  const data = structuredClone(fixture);
  data.recipe.ingredients[0].quantityText = '200 g';
  mutate(data);
  assert.throws(() => validateDemo(data));
});

test('asset resolution uses the document URL and rejects external/protocol-relative assets', () => {
  const home = `${env.SMOKE_FRONTEND_URL}/home`;
  assert.equal(assetURL(html, home).pathname, '/assets/index-hash.js');
  assert.equal(assetURL(html.replace('/assets/', 'assets/'), home).pathname, '/assets/index-hash.js');
  for (const source of ['https://evil.example/assets/index.js', '//evil.example/assets/index.js']) {
    assert.throws(() => assetURL(html.replace('/assets/index-hash.js', source), home));
  }
  assert.throws(() => assetURL('<html></html>', home));
});

test('bounded retries recover and use manual redirects, per-request timeout, and no-cache', async () => {
  let calls = 0;
  const result = await request('https://example.com', ['text/javascript'], () => {}, {
    ...offline, fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['Cache-Control'], 'no-cache');
      assert.ok(options.signal instanceof AbortSignal);
      return ++calls < 3 ? response('unavailable', 'text/plain', 503) : response('export {}', 'text/javascript');
    },
  });
  assert.equal(result.attempts, 3);
});

for (const [name, makeResponse] of [
  ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })],
  ['404', () => response('not found', 'application/json', 404)],
  ['HTML fallback', () => response(html, 'text/html')],
  ['HTML mislabeled as JavaScript', () => response(html, 'text/javascript')],
  ['empty asset', () => response('', 'text/javascript')],
]) test(`request rejects ${name} after bounded attempts`, async () => {
  let calls = 0;
  await assert.rejects(request('https://example.com', ['text/javascript'], () => {}, {
    ...offline, fetchImpl: async () => { calls++; return makeResponse(); },
  }));
  assert.equal(calls, 3);
});

test('unexpected final URL is rejected', async () => {
  await assert.rejects(request('https://example.com', ['text/javascript'], () => {}, {
    ...offline, fetchImpl: async () => ({ status: 200, url: 'https://evil.example', redirected: false }),
  }));
});

test('network timeout is retried a bounded number of times', async () => {
  let calls = 0;
  await assert.rejects(request('https://example.com', ['text/html'], () => {}, {
    ...offline, timeout: 1, fetchImpl: async (_url, { signal }) => {
      calls++;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('timeout')); });
      });
    },
  }));
  assert.equal(calls, 3);
});

test('full smoke records separate outcomes and never emits key/response data', async () => {
  const data = structuredClone(fixture);
  data.recipe.ingredients[0].quantityText = '200 g';
  const result = await runSmoke(env, { ...offline, fetchImpl: async (url, options) => {
    if (url.pathname.includes('/functions/')) {
      assert.equal(url.origin, env.SMOKE_SUPABASE_URL);
      assert.equal(options.headers.apikey, env.SMOKE_PUBLIC_KEY);
      return response(JSON.stringify(data), 'application/json');
    }
    assert.equal(options.headers.apikey, undefined);
    return url.pathname === '/home' ? response(html, 'text/html') : response('export {}', 'application/javascript');
  } });
  assert.equal(result.outcome, 'passed');
  assert.equal(result.tested_sha, env.GITHUB_SHA);
  assert.equal(result.backend_source_sha, env.SMOKE_BACKEND_REVISION);
  assert.match(result.backend_revision_evidence, /operator-attested/);
  assert.ok(!JSON.stringify(result).includes(env.SMOKE_PUBLIC_KEY));
  assert.ok(!JSON.stringify(result).includes(fixture.recipe.title));
});

test('missing backend/function fails smoke while frontend successes remain evidence', async () => {
  const result = await runSmoke(env, { ...offline, fetchImpl: async url => {
    if (url.pathname.includes('/functions/')) return response('Requested function was not found', 'application/json', 404);
    return url.pathname === '/home' ? response(html, 'text/html') : response('export {}', 'text/javascript');
  } });
  assert.equal(result.outcome, 'failed');
  assert.match(result.checks.frontend_html, /^passed/);
  assert.match(result.checks.demo_database, /received 404 after 3 attempts/);
});

test('invalid configuration fails closed without network access', async () => {
  const result = await runSmoke({ ...env, SMOKE_BACKEND_REVISION: '' }, {
    fetchImpl: () => { assert.fail('must not access network'); },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.checks.demo_database, 'not run');
});

test('arbitrary network errors cannot leak credentials into evidence', async () => {
  const result = await runSmoke(env, { ...offline, fetchImpl: async () => {
    throw new Error(`Connection failed with key ${env.SMOKE_PUBLIC_KEY}`);
  } });
  assert.equal(result.outcome, 'failed');
  assert.ok(!JSON.stringify(result).includes(env.SMOKE_PUBLIC_KEY));
});

test('CLI exits nonzero and writes failure JSON and summary without accessing a provider', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moris-runtime-smoke-test-'));
  try {
    const summaryPath = join(directory, 'summary.md');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./runtime-smoke.mjs', import.meta.url))], {
      cwd: directory, encoding: 'utf8',
      env: { ...process.env, ...env, SMOKE_BACKEND_REVISION: '', GITHUB_STEP_SUMMARY: summaryPath },
      timeout: 5000,
    });
    assert.equal(result.status, 1);
    const evidence = JSON.parse(readFileSync(join(directory, 'runtime-smoke.json'), 'utf8'));
    assert.equal(evidence.outcome, 'failed');
    assert.match(evidence.checks.configuration, /Missing operator-attested/);
    assert.equal(evidence.checks.demo_database, 'not run');
    assert.match(readFileSync(summaryPath, 'utf8'), /outcome: failed/);
    assert.ok(!result.stdout.includes(env.SMOKE_PUBLIC_KEY));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
