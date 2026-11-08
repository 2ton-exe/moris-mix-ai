import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const environment = 'production-migration-recovery';

// The caller holds cloudflare-production for this entire transaction. Never
// clear a hold in a failure/cancellation handler: runners may disappear entirely.
export function recoveryHold(mode, env, api) {
  const base = `repos/${env.GITHUB_REPOSITORY}/deployments`;
  if (mode === 'acquire') {
    if (env.RECOVERY_VERIFIED !== 'true') {
      throw new Error('Production held: PRODUCTION_MIGRATION_RECOVERY_VERIFIED must equal true.');
    }
    const pages = api(`${base}?environment=${environment}&per_page=100`, undefined, true);
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Invalid deployment history');
    for (const deployment of pages.flat()) {
      if (!Number.isSafeInteger(deployment.id)) throw new Error('Invalid deployment id');
      const statuses = api(`${base}/${deployment.id}/statuses?per_page=1`);
      if (!Array.isArray(statuses) || statuses[0]?.state !== 'success') {
        throw new Error(`Production held by deployment ${deployment.id}; operator recovery evidence is required.`);
      }
    }
    const hold = api(base, {
      ref: env.GITHUB_SHA, environment, auto_merge: false, required_contexts: [],
      production_environment: true, transient_environment: false,
      description: `Recovery hold for run ${env.GITHUB_RUN_ID} attempt ${env.GITHUB_RUN_ATTEMPT}`,
    });
    if (!Number.isSafeInteger(hold.id)) throw new Error('Recovery hold was not acknowledged');
    return hold.id;
  }
  if (mode === 'release' && /^\d+$/.test(env.HOLD_ID ?? '')) {
    return api(`${base}/${env.HOLD_ID}/statuses`, {
      state: 'success', auto_inactive: false,
      description: 'Migrations, application deployment and smoke checks succeeded.',
    });
  }
  throw new Error('Invalid recovery hold operation');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = recoveryHold(process.argv[2], process.env, (path, body, paginate) => {
      const args = ['api', path];
      if (paginate) args.push('--paginate', '--slurp');
      if (body) args.push('--method', 'POST', '--input', '-');
      return JSON.parse(execFileSync('gh', args, {
        input: body ? JSON.stringify(body) : undefined, encoding: 'utf8',
      }));
    });
    if (process.argv[2] === 'acquire') appendFileSync(process.env.GITHUB_OUTPUT, `hold-id=${result}\n`);
  } catch (error) {
    const message = `Production recovery hold: ${error.message}`;
    console.error(`::error::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    process.exitCode = 1;
  }
}
