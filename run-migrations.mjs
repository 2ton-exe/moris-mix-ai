import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_LOCK_ID = 847291847;
const INITIAL_SCHEMA_VERSION = '20261013000000';
const INITIAL_SCHEMA_TABLES = ['profiles', 'recipes', 'recipe_lineage', 'ai_usage_daily'];

export function discoverMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at ${migrationsDir}`);
  }

  const entries = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  const versionPattern = /^(\d+)(?:_(.+))?\.sql$/;
  const seenVersions = new Map();
  const migrations = [];

  for (const file of entries) {
    const match = file.match(versionPattern);
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}. Migrations must start with a numeric version prefix.`);
    }

    const version = match[1];
    const name = match[2] || '';

    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version detected: ${version} in files: ${seenVersions.get(version)} and ${file}`);
    }

    seenVersions.set(version, file);
    migrations.push({
      version,
      name,
      file,
      filePath: path.join(migrationsDir, file)
    });
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return migrations;
}

export async function initializeMigrationHistory(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY
    );
  `);

  const { rows } = await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
  return new Set(rows.map((row) => row.version));
}

export async function reconcileInitialSchema(client, appliedVersions, logger = console) {
  if (appliedVersions.has(INITIAL_SCHEMA_VERSION)) {
    return;
  }

  const tableQuery = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[]);
  `, [INITIAL_SCHEMA_TABLES]);

  const foundTables = new Set(tableQuery.rows.map((r) => r.table_name));

  if (foundTables.size === 0) {
    return;
  }

  if (foundTables.size === INITIAL_SCHEMA_TABLES.length) {
    const funcQuery = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name = ANY($1::text[]);
    `, [['set_updated_at', 'handle_new_user']]);

    const foundFuncs = new Set(funcQuery.rows.map((r) => r.routine_name));
    if (foundFuncs.has('set_updated_at') && foundFuncs.has('handle_new_user')) {
      await client.query(
        'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING;',
        [INITIAL_SCHEMA_VERSION]
      );
      appliedVersions.add(INITIAL_SCHEMA_VERSION);
      logger.log(`INFO: Reconciled initial schema migration ${INITIAL_SCHEMA_VERSION} from existing database state.`);
      return;
    }
  }

  const missing = INITIAL_SCHEMA_TABLES.filter((t) => !foundTables.has(t));
  throw new Error(
    `Inconsistent database state: found partial initial schema tables (${Array.from(foundTables).join(', ')}), ` +
    `but missing (${missing.join(', ')}). Aborting to prevent unsafe migration execution. ` +
    `Recovery: inspect existing database tables or perform manual reconciliation.`
  );
}

export async function runMigrations({
  client,
  migrationsDir = path.resolve(__dirname, 'supabase/migrations'),
  seedDir = path.resolve(__dirname, 'supabase'),
  isLocalhost = false,
  shouldSeed = false,
  logger = console
} = {}) {
  await client.query('SELECT pg_advisory_lock($1);', [MIGRATION_LOCK_ID]);
  const appliedMigrations = [];

  try {
    if (isLocalhost) {
      const mockAuthPath = path.resolve(seedDir, 'mock-auth.sql');
      if (fs.existsSync(mockAuthPath)) {
        const mockAuthSql = fs.readFileSync(mockAuthPath, 'utf8');
        await client.query(mockAuthSql);
      }
    }

    const migrations = discoverMigrations(migrationsDir);
    const appliedVersions = await initializeMigrationHistory(client);

    await reconcileInitialSchema(client, appliedVersions, logger);

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        logger.log(`INFO: Skipping migration ${migration.file} (already applied).`);
        continue;
      }

      logger.log(`Applying migration ${migration.file}...`);
      const migrationSql = fs.readFileSync(migration.filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(migrationSql);
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1);',
          [migration.version]
        );
        await client.query('COMMIT');
        appliedVersions.add(migration.version);
        appliedMigrations.push(migration.file);
        logger.log(`SUCCESS: Applied migration ${migration.file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.file} failed: ${err.message}`);
      }
    }

    logger.log('SUCCESS: Migrations applied successfully.');

    if (shouldSeed) {
      if (!isLocalhost && process.env.FORCE_REMOTE_SEED !== 'true') {
        logger.warn('WARN: Seeding skipped. Demo seed is restricted to local development.');
      } else {
        const seedPath = path.resolve(seedDir, 'seed.sql');
        if (fs.existsSync(seedPath)) {
          const seedSql = fs.readFileSync(seedPath, 'utf8');
          await client.query(seedSql);
          logger.log('SUCCESS: Demo seed applied.');
        }
      }
    } else {
      logger.log('INFO: Skipping demo seeding. Set SEED_DEMO=true or pass --seed flag to seed demo data.');
    }

    return {
      appliedVersions: Array.from(appliedVersions),
      appliedMigrations
    };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1);', [MIGRATION_LOCK_ID]);
  }
}

export async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing in .env');
    process.exit(1);
  }

  const caPath = path.resolve(__dirname, 'supabase/prod-ca-2021.crt');
  let caCert;
  try {
    if (!fs.existsSync(caPath)) {
      throw new Error(`CA certificate file not found at ${caPath}`);
    }
    caCert = fs.readFileSync(caPath, 'utf8');
    if (!caCert || !caCert.trim()) {
      throw new Error(`CA certificate file at ${caPath} is empty`);
    }
  } catch (err) {
    console.error(`TLS verification failed: ${err.message}`);
    process.exit(1);
  }

  const sslConfig = {
    rejectUnauthorized: true,
    ca: caCert
  };

  let sanitizedConnectionString;
  let parsedUrl;
  try {
    parsedUrl = new URL(process.env.DATABASE_URL);
    const sslParams = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'];
    for (const param of sslParams) {
      parsedUrl.searchParams.delete(param);
    }
    sanitizedConnectionString = parsedUrl.toString();
  } catch (err) {
    console.error(`Invalid DATABASE_URL format: ${err.message}`);
    process.exit(1);
  }

  const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';

  const client = new Client({
    connectionString: sanitizedConnectionString,
    ssl: isLocalhost ? false : sslConfig
  });

  try {
    await client.connect();
    const shouldSeed = process.env.SEED_DEMO === 'true' || process.argv.includes('--seed');
    await runMigrations({
      client,
      isLocalhost,
      shouldSeed
    });
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main();
}