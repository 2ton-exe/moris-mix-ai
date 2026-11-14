import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const routes = ['extract-recipe', 'generate-recipe'];
const shaPattern = /^[a-f0-9]{40}$/;
const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' } };
class SmokeFailure extends Error {}
const requireValue = (condition, message) => { if (!condition) throw new SmokeFailure(message); };
const failure = error => error instanceof SmokeFailure ? error.message : 'Network, timeout, or response parsing failure';

function validateAllowedOrigin(headers, frontend) {
  const allowedOrigin = (headers.get('access-control-allow-origin') ?? '').trim();
  requireValue(allowedOrigin === '*' || allowedOrigin === frontend, 'CORS allowed origin does not permit the production frontend');
}

function validateCors(headers, frontend) {
  validateAllowedOrigin(headers, frontend);
  const tokens = name => new Set((headers.get(name) ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const methods = tokens('access-control-allow-methods');
  requireValue(methods.size === 2 && methods.has('post') && methods.has('options'), 'Unexpected AI CORS allowed methods');
  const allowedHeaders = tokens('access-control-allow-headers');
  requireValue(['authorization', 'x-client-info', 'apikey', 'content-type'].every(name => allowedHeaders.has(name)),
    'Missing required AI CORS allowed headers');
  requireValue((headers.get('x-content-type-options') ?? '').trim().toLowerCase() === 'nosniff', 'Missing CORS nosniff protection');
}

/** Validate the production frontend and pin route probes to the configured production project. */
export function configuration(env) {
  requireValue(shaPattern.test(env.GITHUB_SHA ?? ''), 'Missing tested Git SHA');
  const project = env.AI_ROUTE_SMOKE_PROJECT_REF;
  requireValue(/^[a-z]{20}$/.test(project ?? ''), 'Invalid Supabase project reference');
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  requireValue(project === config.match(/^project_id = "([a-z]+)"/m)?.[1], 'Unexpected production project');
  let url;
  try { url = new URL(env.AI_ROUTE_SMOKE_SUPABASE_URL); } catch { throw new SmokeFailure('Invalid Supabase origin'); }
  requireValue(url.origin === `https://${project}.supabase.co` && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash, 'Supabase origin/project mismatch');
  let frontend;
  try { frontend = new URL(env.AI_ROUTE_SMOKE_FRONTEND_URL); } catch { throw new SmokeFailure('Invalid production frontend origin'); }
  requireValue(frontend.protocol === 'https:' && !frontend.username && !frontend.password &&
    frontend.pathname === '/' && !frontend.search && !frontend.hash, 'Expected a bare HTTPS production frontend origin');
  return { frontend: frontend.origin, api: url.origin };
}

async function probe(url, method, frontend, fetchImpl) {
  let httpStatus = null;
  try {
    const response = await fetchImpl(url, {
      method, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(10000),
      headers: { Origin: frontend, 'Cache-Control': 'no-cache', ...(method === 'OPTIONS' ? {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
      } : {}) },
    });
    httpStatus = response.status;
    requireValue(!response.redirected && (!response.url || response.url === url), 'Unexpected effective URL');
    requireValue(httpStatus === (method === 'OPTIONS' ? 204 : 401),
      method === 'OPTIONS' ? 'Expected HTTP 204 OPTIONS' : 'Expected HTTP 401 unauthenticated POST');
    if (method === 'OPTIONS') validateCors(response.headers, frontend);
    if (method === 'POST') {
      validateAllowedOrigin(response.headers, frontend);
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      requireValue(type === 'application/json', 'Expected application JSON unauthorized response');
      requireValue(isDeepStrictEqual(await response.json(), unauthorized), 'Unexpected application UNAUTHORIZED contract');
    }
    return { outcome: 'passed', http_status: httpStatus };
  } catch (error) {
    return { outcome: 'failed', http_status: httpStatus, error: failure(error) };
  }
}

/** Check only CORS preflight and missing-auth rejection, never authenticated AI execution. */
export async function runSmoke(env, { fetchImpl = fetch } = {}) {
  const evidence = {
    environment: 'production', tested_sha: shaPattern.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    scope: 'Production browser CORS and unauthenticated route availability only; no AI execution or quota acceptance claim',
    started_at: new Date().toISOString(), configuration: { outcome: 'not run' },
    routes: Object.fromEntries(routes.map(route => [route, {
      options: { outcome: 'not run' }, unauthenticated_post: { outcome: 'not run' },
    }])),
  };
  let origins;
  try {
    origins = configuration(env);
    evidence.api_origin = origins.api;
    evidence.configuration = { outcome: 'passed' };
  } catch (error) { evidence.configuration = { outcome: 'failed', error: failure(error) }; }
  if (origins) {
    for (const route of routes) {
      const url = `${origins.api}/functions/v1/${route}`;
      evidence.routes[route].options = await probe(url, 'OPTIONS', origins.frontend, fetchImpl);
      evidence.routes[route].unauthenticated_post = await probe(url, 'POST', origins.frontend, fetchImpl);
    }
  }
  evidence.outcome = evidence.configuration.outcome === 'passed' && Object.values(evidence.routes)
    .every(checks => Object.values(checks).every(check => check.outcome === 'passed')) ? 'passed' : 'failed';
  evidence.finished_at = new Date().toISOString();
  return evidence;
}

/** Persist separate, response-body-free route evidence and a concise Actions summary. */
export function writeEvidence(evidence, { outputPath = 'ai-route-smoke.json', summaryPath, log = console.log } = {}) {
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  const summary = ['### Production AI route smoke', `- Tested revision: ${evidence.tested_sha}`,
    `- Configuration: ${evidence.configuration.outcome}`, `- Outcome: ${evidence.outcome}`,
    ...Object.entries(evidence.routes).flatMap(([route, checks]) => Object.entries(checks)
      .map(([name, result]) => `- ${route} ${name}: ${result.outcome}`)),
    '- Only unauthenticated OPTIONS/POST probes; AI execution and quota acceptance are not tested.'].join('\n');
  if (summaryPath) appendFileSync(summaryPath, `${summary}\n`);
  log(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runSmoke(process.env);
  writeEvidence(evidence, { summaryPath: process.env.GITHUB_STEP_SUMMARY });
  if (evidence.outcome !== 'passed') process.exitCode = 1;
}
