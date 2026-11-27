import { pathToFileURL } from 'node:url';

const worker = 'moris-mix-ai';

function httpsOrigin(value) {
  try {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return null;
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password &&
        url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch {
    // Report only a fixed diagnostic, even if the input contains sensitive data.
  }
  return null;
}

async function getResult(url, token, failure, request) {
  try {
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.success === true) return data.result;
    }
  } catch {
    // Suppress request and parse errors that may contain upstream data.
  }
  throw new Error(failure);
}

export async function verifyProductionWorkerUrl(env, request = fetch) {
  const account = env.PRODUCTION_RELEASE_CLOUDFLARE_ACCOUNT_ID;
  const token = env.PRODUCTION_RELEASE_CLOUDFLARE_API_TOKEN;
  const expected = httpsOrigin(env.SMOKE_FRONTEND_URL);
  if (!/^[a-f0-9]{32}$/i.test(account ?? '') || !token?.trim() || !expected) {
    throw new Error('Cloudflare production URL preflight configuration is invalid.');
  }

  const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const authFailure = 'Cloudflare production token authentication failed.';
  const identity = await getResult(`${api}/tokens/verify`, token, authFailure, request);
  if (identity?.status !== 'active') throw new Error(authFailure);

  const workerFailure = 'Cloudflare production Worker metadata is invalid or unavailable.';
  const result = await getResult(`${api}/workers/workers/${worker}`, token, workerFailure, request);
  if (result?.name !== worker || result.subdomain?.enabled !== true) throw new Error(workerFailure);

  const actual = httpsOrigin(result.subdomain.url);
  if (!actual) throw new Error('Cloudflare production Worker has no valid HTTPS origin.');
  if (actual !== expected) throw new Error('Cloudflare Worker URL does not match PRODUCTION_FRONTEND_URL.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyProductionWorkerUrl(process.env);
    console.log('Cloudflare production Worker URL verified.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
