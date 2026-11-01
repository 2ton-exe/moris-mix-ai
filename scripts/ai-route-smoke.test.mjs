import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { configuration, runSmoke, writeEvidence } from './ai-route-smoke.mjs';

const project = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id = "([a-z]+)"/m)[1];
const env = { GITHUB_SHA: 'a'.repeat(40), AI_ROUTE_SMOKE_PROJECT_REF: project,
  AI_ROUTE_SMOKE_SUPABASE_URL: `https://${project}.supabase.co`,
  SUPABASE_ACCESS_TOKEN: 'must-not-appear', SMOKE_PUBLIC_KEY: 'must-not-appear', GEMINI_API_KEY: 'must-not-appear' };
const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } };
const cors = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (method, { status = method === 'OPTIONS' ? 204 : 401, body = unauthorized,
  type = 'application/json', redirected = false, url = '', headers = {} } = {}) => {
  const responseHeaders = new Headers({ 'content-type': type, ...(method === 'OPTIONS' ? cors : {}) });
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) responseHeaders.delete(name);
    else responseHeaders.set(name, value);
  }
  return { status, redirected, url, headers: responseHeaders,
    json: async () => typeof body === 'string' ? JSON.parse(body) : body };
};

test('configuration pins production origin/project and tested revision before requests', async () => {
  assert.equal(configuration(env), env.AI_ROUTE_SMOKE_SUPABASE_URL);
  for (const patch of [{ GITHUB_SHA: '' }, { AI_ROUTE_SMOKE_PROJECT_REF: 'x'.repeat(20) },
    { AI_ROUTE_SMOKE_SUPABASE_URL: 'http://localhost:54321' },
    { AI_ROUTE_SMOKE_SUPABASE_URL: `https://user:password@${project}.supabase.co` },
    { AI_ROUTE_SMOKE_SUPABASE_URL: env.AI_ROUTE_SMOKE_SUPABASE_URL + '/other' },
    { AI_ROUTE_SMOKE_SUPABASE_URL: env.AI_ROUTE_SMOKE_SUPABASE_URL + '?token=must-not-appear' }]) {
    const evidence = await runSmoke({ ...env, ...patch }, { fetchImpl: () => { throw Error('must not request'); } });
    assert.equal(evidence.outcome, 'failed');
    assert.equal(evidence.configuration.outcome, 'failed');
    assert.ok(Object.values(evidence.routes).every(checks => checks.options.outcome === 'not run'));
    assert.ok(!JSON.stringify(evidence).includes('must-not-appear'));
  }
});

test('both routes require 204 OPTIONS and application 401 without credentials or payload', async () => {
  const calls = [];
  const evidence = await runSmoke(env, { fetchImpl: async (url, init) => {
    calls.push([url, init.method]);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.credentials, 'omit');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(init.headers, { 'Cache-Control': 'no-cache' });
    assert.equal(init.body, undefined);
    return reply(init.method);
  } });
  assert.equal(evidence.outcome, 'passed');
  assert.equal(evidence.tested_sha, env.GITHUB_SHA);
  assert.deepEqual(calls, ['extract-recipe', 'generate-recipe'].flatMap(route =>
    ['OPTIONS', 'POST'].map(method => [`${env.AI_ROUTE_SMOKE_SUPABASE_URL}/functions/v1/${route}`, method])));
  for (const checks of Object.values(evidence.routes)) {
    assert.deepEqual(checks.options, { outcome: 'passed', http_status: 204 });
    assert.deepEqual(checks.unauthenticated_post, { outcome: 'passed', http_status: 401 });
  }
  assert.ok(!JSON.stringify(evidence).includes('must-not-appear'));
});

test('CORS accepts configured origins and comma-separated values independent of formatting/casing', async () => {
  for (const origin of ['*', 'https://app.example', 'https://app.example:8443', 'null']) {
    const evidence = await runSmoke(env, { fetchImpl: async (url, init) => reply(init.method, { headers: {
      'aCcEsS-cOnTrOl-AlLoW-oRiGiN': origin,
      'access-control-allow-methods': ' OPTIONS ,\tPOST ',
      'ACCESS-CONTROL-ALLOW-HEADERS': ' Content-Type , APIKEY, X-CLIENT-INFO ,AUTHORIZATION, x-extra ',
    } }) });
    assert.equal(evidence.outcome, 'passed');
    assert.ok(!JSON.stringify(evidence).includes('app.example'));
  }
});

for (const [name, headers] of [
  ['missing origin', { 'Access-Control-Allow-Origin': null }],
  ['empty origin', { 'Access-Control-Allow-Origin': '   ' }],
  ['invalid origin', { 'Access-Control-Allow-Origin': 'not-an-origin' }],
  ['multiple origins', { 'Access-Control-Allow-Origin': 'https://app.example, https://other.example' }],
  ['missing methods', { 'Access-Control-Allow-Methods': null }],
  ['wrong methods', { 'Access-Control-Allow-Methods': 'GET, OPTIONS' }],
  ['extra method', { 'Access-Control-Allow-Methods': 'POST, OPTIONS, GET' }],
  ['missing allowed headers', { 'Access-Control-Allow-Headers': null }],
  ...['authorization', 'x-client-info', 'apikey', 'content-type'].map(missing => [
    `missing allowed ${missing}`, { 'Access-Control-Allow-Headers':
      ['authorization', 'x-client-info', 'apikey', 'content-type'].filter(name => name !== missing).join(', ') },
  ]),
  ['missing nosniff', { 'X-Content-Type-Options': null }],
  ['incorrect nosniff', { 'X-Content-Type-Options': 'none' }],
]) test(`OPTIONS 204 fails with ${name}`, async () => {
  const evidence = await runSmoke(env, { fetchImpl: async (url, init) =>
    reply(init.method, url.endsWith('/extract-recipe') && init.method === 'OPTIONS' ? { headers } : {}) });
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.routes['extract-recipe'].options.outcome, 'failed');
  assert.equal(evidence.routes['generate-recipe'].options.outcome, 'passed');
  assert.ok(!JSON.stringify(evidence).includes('app.example'));
});

for (const [name, method, overrides] of [
  ['OPTIONS 200', 'OPTIONS', { status: 200 }],
  ['OPTIONS 401', 'OPTIONS', { status: 401 }],
  ['OPTIONS 404', 'OPTIONS', { status: 404 }],
  ['missing POST route', 'POST', { status: 404 }],
  ['unexpected successful POST', 'POST', { status: 200 }],
  ['unexpected created POST', 'POST', { status: 201 }],
  ['POST server failure', 'POST', { status: 500 }],
  ['gateway-shaped 401', 'POST', { body: { code: 401, message: 'Missing authorization header' } }],
  ['wrong application error', 'POST', { body: { error: { code: 'NOT_FOUND', message: 'Route not found.' } } }],
  ['wrong UNAUTHORIZED message', 'POST', { body: { error: { code: 'UNAUTHORIZED', message: 'Other contract' } } }],
  ['malformed JSON', 'POST', { body: '{must-not-appear' }],
  ['HTML fallback', 'POST', { type: 'text/html', body: 'must-not-appear' }],
  ['redirect', 'POST', { status: 302 }],
  ['redirected response', 'POST', { redirected: true }],
  ['changed effective URL', 'POST', { url: 'https://other.example/' }],
]) test(`failed ${name} fails release evidence without hiding the other route`, async () => {
  const evidence = await runSmoke(env, { fetchImpl: async (url, init) =>
    reply(init.method, url.endsWith('/extract-recipe') && init.method === method ? overrides : {}) });
  assert.equal(evidence.outcome, 'failed');
  const check = method === 'OPTIONS' ? 'options' : 'unauthenticated_post';
  assert.equal(evidence.routes['extract-recipe'][check].outcome, 'failed');
  assert.equal(evidence.routes['generate-recipe'].unauthenticated_post.outcome, 'passed');
  assert.ok(!JSON.stringify(evidence).includes('must-not-appear'));
});

for (const name of ['network', 'timeout']) test(`${name} failure produces safe failure evidence`, async () => {
  const evidence = await runSmoke(env, { fetchImpl: async () => {
    throw name === 'timeout' ? new DOMException('must-not-appear', 'TimeoutError') : Error('must-not-appear');
  } });
  assert.equal(evidence.outcome, 'failed');
  assert.ok(Object.values(evidence.routes).every(checks => Object.values(checks).every(check => check.outcome === 'failed')));
  assert.ok(!JSON.stringify(evidence).includes('must-not-appear'));
});

test('separate evidence file and Actions summary retain outcomes, not bodies or credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'moris-ai-route-smoke-'));
  try {
    const evidence = await runSmoke(env, { fetchImpl: async (url, init) => reply(init.method) });
    const outputPath = join(directory, 'ai-route-smoke.json');
    const summaryPath = join(directory, 'summary.md');
    const logs = [];
    writeEvidence(evidence, { outputPath, summaryPath, log: value => logs.push(value) });
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), evidence);
    assert.match(readFileSync(summaryPath, 'utf8'), /Outcome: passed/);
    assert.ok(!logs.join('\n').includes('must-not-appear'));
    assert.ok(!JSON.stringify(evidence).includes('Missing or invalid Authorization header.'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI configuration failure exits nonzero and preserves separate failure evidence without network', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moris-ai-route-cli-'));
  try {
    const summaryPath = join(directory, 'summary.md');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ai-route-smoke.mjs', import.meta.url))], {
      cwd: directory, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, ...env, GITHUB_SHA: '', GITHUB_STEP_SUMMARY: summaryPath },
    });
    assert.equal(result.status, 1, result.stderr);
    const evidence = JSON.parse(readFileSync(join(directory, 'ai-route-smoke.json'), 'utf8'));
    assert.equal(evidence.outcome, 'failed');
    assert.equal(evidence.routes['extract-recipe'].options.outcome, 'not run');
    assert.match(readFileSync(summaryPath, 'utf8'), /Outcome: failed/);
    assert.ok(!(result.stdout + result.stderr).includes('must-not-appear'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
