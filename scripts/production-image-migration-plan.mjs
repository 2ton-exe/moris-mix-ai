import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const imageMigrations = [
  '20261102000009',
  '20261102000010',
  '20261102000011',
  '20261102000012',
  '20261102000013',
  '20261102000014',
  '20261106000015',
];

export function validateProductionImageMigrationState(payload, phase) {
  if (!['before', 'after'].includes(phase) || !Array.isArray(payload?.migrations)) {
    throw new Error('Production migration state is invalid.');
  }

  const local = new Set();
  const remote = new Set();
  for (const migration of payload.migrations) {
    const localVersion = typeof migration.local === 'string' ? migration.local : '';
    const remoteVersion = typeof migration.remote === 'string' ? migration.remote : '';
    if (localVersion && local.has(localVersion)) throw new Error('Duplicate local migration version.');
    if (remoteVersion && remote.has(remoteVersion)) throw new Error('Duplicate remote migration version.');
    if (localVersion) local.add(localVersion);
    if (remoteVersion) remote.add(remoteVersion);
    if (remoteVersion && !localVersion) throw new Error('Production has an unknown migration version.');
  }

  for (const version of imageMigrations) {
    if (!local.has(version)) throw new Error(`Required local migration is missing: ${version}`);
  }

  for (const version of local) {
    if (remote.has(version)) continue;
    if (!imageMigrations.includes(version)) throw new Error(`Unexpected production migration is pending: ${version}`);
  }

  const pending = imageMigrations.filter(version => !remote.has(version));
  const allImageMigrationsApplied = pending.length === 0;
  const allImageMigrationsPending = pending.length === imageMigrations.length;

  if (phase === 'before') {
    if (allImageMigrationsApplied) return 'already-applied';
    if (!allImageMigrationsPending) throw new Error('Production has a partial BE-13 migration state.');
    if ([...remote].some(version => version > imageMigrations[0])) {
      throw new Error('Production has a later migration applied before required BE-13 migrations.');
    }
    return 'apply';
  }

  for (const version of imageMigrations) {
    if (!remote.has(version)) throw new Error(`Required production migration is not applied: ${version}`);
  }
  for (const version of local) {
    if (!remote.has(version)) throw new Error(`Production migration is still pending: ${version}`);
  }
  return 'ready';
}

function main() {
  const phase = process.argv[2];
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    throw new Error('Supabase migration list output is invalid.');
  }
  const action = validateProductionImageMigrationState(payload, phase);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `action=${action}\n`, 'utf8');
    return;
  }
  process.stdout.write(`${action}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
