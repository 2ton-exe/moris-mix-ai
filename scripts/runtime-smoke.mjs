import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/demo-recipe.json', import.meta.url)));
const shaPattern = /^[a-f0-9]{40}$/;
class SmokeFailure extends Error {}

function requireValue(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

const failure = error => error instanceof SmokeFailure ? error.message : 'Network, timeout, or response parsing failure';

function origin(value) {
  let url;
  try { url = new URL(value); } catch { throw new SmokeFailure('Invalid configured origin'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash, 'Expected a bare HTTPS origin');
  return url.origin;
}

export function configuration(env) {
  requireValue(['staging', 'production'].includes(env.SMOKE_ENVIRONMENT), 'Invalid smoke environment');
  requireValue(shaPattern.test(env.GITHUB_SHA ?? ''), 'Missing tested Git SHA');
  requireValue(shaPattern.test(env.SMOKE_BACKEND_REVISION ?? ''), 'Missing operator-attested demo-recipe source SHA');
  requireValue(/^[a-z]{20}$/.test(env.SMOKE_PROJECT_REF ?? ''), 'Invalid Supabase project reference');
  const frontend = origin(env.SMOKE_FRONTEND_URL);
  const api = origin(env.SMOKE_SUPABASE_URL);
  requireValue(api === `https://${env.SMOKE_PROJECT_REF}.supabase.co`, 'Supabase origin/project mismatch');
  if (env.SMOKE_ENVIRONMENT === 'staging') {
    requireValue(env.SMOKE_PROJECT_REF === 'pjeykhjzqhryjwuoizgh', 'Unexpected staging project');
    requireValue(/^https:\/\/moris-mix-ai-staging\.[a-z0-9-]+\.workers\.dev$/.test(frontend), 'Unexpected staging frontend');
  } else {
    const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
    const project = config.match(/^project_id = "([a-z]+)"/m)?.[1];
    requireValue(env.SMOKE_PROJECT_REF === project && env.SMOKE_PROJECT_REF !== 'pjeykhjzqhryjwuoizgh', 'Unexpected production project');
  }
  return { frontend, api };
}

export function validateDemo(data) {
  const recipe = data?.recipe;
  requireValue(recipe && Object.keys(data).length === 1, 'Invalid demo response envelope');
  const { cooked_at, ...actual } = recipe;
  const { cooked_at: ignored, ...expected } = fixture.recipe;
  // The hosted seed uses a relative date; every other approved demo field is fixed.
  requireValue(isDeepStrictEqual(actual, expected), 'Demo identity/content differs from approved public fixture');
  requireValue(cooked_at === null || (typeof cooked_at === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(cooked_at) &&
    Number.isFinite(Date.parse(cooked_at)) && new Date(cooked_at).toISOString().slice(0, 10) === cooked_at),
  'Invalid demo cooked_at');
}

export function assetURL(html, home) {
  requireValue(/<html\b/i.test(html) && /<div\b[^>]*\bid=["']root["']/i.test(html), 'Missing frontend HTML/root');
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  const source = sources.find(value => /(?:^|\/)assets\/[^?#]+\.js(?:[?#]|$)/.test(value));
  requireValue(source, 'Missing built JavaScript asset');
  const url = new URL(source, home);
  requireValue(url.origin === new URL(home).origin && !url.username && !url.password, 'JavaScript asset outside frontend origin');
  return url;
}

export async function request(url, contentTypes, validate, {
  fetchImpl = fetch, attempts = 3, timeout = 10000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), headers = {},
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'manual', signal: AbortSignal.timeout(timeout),
        headers: { 'Cache-Control': 'no-cache', ...headers },
      });
      requireValue(response.status === 200, `Expected HTTP 200; received ${response.status}`);
      requireValue(!response.redirected && (!response.url || response.url === String(url)), 'Unexpected effective URL');
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      requireValue(contentTypes.includes(type), 'Unexpected response content type');
      const body = await response.text();
      requireValue(body.trim().length > 0, 'Empty response body');
      requireValue(type === 'text/html' || !/^\s*(?:<!doctype\s+html|<html\b)/i.test(body), 'HTML asset fallback');
      const value = validate(body);
      return { value, attempts: attempt };
    } catch (error) {
      // Never echo arbitrary network exceptions, URLs, credentials, or response bodies.
      if (attempt === attempts) throw new SmokeFailure(`${failure(error)} after ${attempts} attempts`);
      await sleep(4000);
    }
  }
}

export async function runSmoke(env, options = {}) {
  const evidence = {
    environment: ['staging', 'production'].includes(env.SMOKE_ENVIRONMENT) ? env.SMOKE_ENVIRONMENT : 'invalid',
    tested_sha: shaPattern.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    pr_head_sha: shaPattern.test(env.SMOKE_PR_HEAD_SHA ?? '') ? env.SMOKE_PR_HEAD_SHA : null,
    backend_source_sha: shaPattern.test(env.SMOKE_BACKEND_REVISION ?? '') ? env.SMOKE_BACKEND_REVISION : null,
    backend_revision_evidence: 'operator-attested; not observed from runtime',
    deployment_outcome: ['success', 'failure', 'cancelled', 'skipped'].includes(env.SMOKE_DEPLOYMENT_OUTCOME)
      ? env.SMOKE_DEPLOYMENT_OUTCOME : 'not supplied; see workflow deployment evidence',
    started_at: new Date().toISOString(),
    checks: { configuration: 'not run', frontend_html: 'not run', javascript_asset: 'not run', demo_database: 'not run' },
  };
  let urls;
  try {
    urls = configuration(env);
    evidence.frontend_origin = urls.frontend;
    evidence.api_origin = urls.api;
    evidence.checks.configuration = 'passed';
  } catch (error) {
    evidence.checks.configuration = `failed (${failure(error)})`;
  }
  if (urls) {
    const home = new URL(`/home?revision=${env.GITHUB_SHA}`, urls.frontend);
    let asset;
    try {
      const result = await request(home, ['text/html'], body => assetURL(body, home), options);
      asset = result.value;
      evidence.checks.frontend_html = `passed (${result.attempts} attempt(s))`;
    } catch (error) { evidence.checks.frontend_html = `failed (${failure(error)})`; }
    if (asset) {
      try {
        const result = await request(asset, ['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript'], body => {
          requireValue(!/^\s*</.test(body), 'HTML asset fallback');
        }, options);
        evidence.checks.javascript_asset = `passed (${result.attempts} attempt(s))`;
        evidence.asset_path = asset.pathname;
      } catch (error) { evidence.checks.javascript_asset = `failed (${failure(error)})`; }
    }
    try {
      const result = await request(new URL(`/functions/v1/demo-recipe?smoke_revision=${env.GITHUB_SHA}&smoke_time=${Date.now()}`, urls.api),
        ['application/json'], body => validateDemo(JSON.parse(body)), {
          ...options, headers: env.SMOKE_PUBLIC_KEY ? { apikey: env.SMOKE_PUBLIC_KEY } : {},
        });
      evidence.checks.demo_database = `passed (${result.attempts} attempt(s))`;
    } catch (error) { evidence.checks.demo_database = `failed (${failure(error)})`; }
  }
  evidence.outcome = Object.values(evidence.checks).every(value => value.startsWith('passed')) ? 'passed' : 'failed';
  evidence.finished_at = new Date().toISOString();
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runSmoke(process.env);
  writeFileSync('runtime-smoke.json', `${JSON.stringify(evidence, null, 2)}\n`);
  const summary = ['### Runtime smoke', ...Object.entries(evidence).filter(([key]) => key !== 'checks')
    .map(([key, value]) => `- ${key}: ${String(value).replace(/[\r\n`]/g, '')}`),
  ...Object.entries(evidence.checks).map(([key, value]) => `- ${key}: ${value}`)].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(summary);
  if (evidence.outcome !== 'passed') process.exitCode = 1;
}
