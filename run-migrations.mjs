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
const IS_PUBLIC_MIGRATION_VERSION = '20261017000001';

const EXPECTED_INITIAL_TABLES = [
  'profiles',
  'recipes',
  'recipe_lineage',
  'ai_usage_daily'
];

const EXPECTED_INITIAL_COLUMNS = {
  profiles: {
    id: { type: 'uuid', nullable: false },
    display_name: { type: 'text', nullable: true },
    avatar_url: { type: 'text', nullable: true },
    created_at: { type: 'timestamptz', nullable: false },
    updated_at: { type: 'timestamptz', nullable: false }
  },
  recipes: {
    id: { type: 'uuid', nullable: false },
    user_id: { type: 'uuid', nullable: false },
    title: { type: 'text', nullable: false },
    raw_input: { type: 'text', nullable: true },
    ingredients: { type: 'jsonb', nullable: false },
    instructions: { type: 'jsonb', nullable: false },
    flavor_scores: { type: 'jsonb', nullable: true },
    star_rating: { type: 'int2', nullable: true },
    cooked_at: { type: 'date', nullable: true },
    image_url: { type: 'text', nullable: true },
    image_path: { type: 'text', nullable: true },
    created_at: { type: 'timestamptz', nullable: false },
    updated_at: { type: 'timestamptz', nullable: false }
  },
  recipe_lineage: {
    id: { type: 'uuid', nullable: false },
    parent_recipe_id: { type: 'uuid', nullable: false },
    child_recipe_id: { type: 'uuid', nullable: false },
    created_at: { type: 'timestamptz', nullable: false }
  },
  ai_usage_daily: {
    id: { type: 'uuid', nullable: false },
    user_id: { type: 'uuid', nullable: false },
    usage_date: { type: 'date', nullable: false },
    operation_count: { type: 'int4', nullable: false },
    created_at: { type: 'timestamptz', nullable: false },
    updated_at: { type: 'timestamptz', nullable: false }
  }
};

const EXPECTED_INITIAL_CONSTRAINTS = [
  'profiles_pkey',
  'recipes_pkey',
  'recipe_lineage_pkey',
  'ai_usage_daily_pkey',
  'check_parent_child_distinct',
  'unique_parent_child_pair',
  'unique_user_daily_usage'
];

const EXPECTED_INITIAL_INDEXES = [
  'idx_recipes_user_created',
  'idx_recipes_user_rating',
  'idx_lineage_parent',
  'idx_lineage_child'
];

const EXPECTED_INITIAL_TRIGGERS = [
  'tr_profiles_updated_at',
  'tr_recipes_updated_at',
  'tr_ai_usage_daily_updated_at'
];

const EXPECTED_INITIAL_FUNCTIONS = [
  'set_updated_at',
  'handle_new_user'
];

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

export async function verifyInitialSchemaCompleteness(client) {
  const tableQuery = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[]);
  `, [EXPECTED_INITIAL_TABLES]);

  const existingTables = new Set(tableQuery.rows.map((r) => r.table_name));

  if (existingTables.size === 0) {
    return { status: 'fresh', errors: [] };
  }

  const errors = [];

  for (const expectedTable of EXPECTED_INITIAL_TABLES) {
    if (!existingTables.has(expectedTable)) {
      errors.push(`Missing table: public.${expectedTable}`);
    }
  }

  const colQuery = await client.query(`
    SELECT table_name, column_name, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[]);
  `, [EXPECTED_INITIAL_TABLES]);

  const existingCols = new Map();
  for (const row of colQuery.rows) {
    const key = `${row.table_name}.${row.column_name}`;
    existingCols.set(key, {
      udt_name: row.udt_name,
      is_nullable: row.is_nullable === 'YES'
    });
  }

  for (const [table, cols] of Object.entries(EXPECTED_INITIAL_COLUMNS)) {
    if (!existingTables.has(table)) {
      continue;
    }
    for (const [colName, expected] of Object.entries(cols)) {
      const key = `${table}.${colName}`;
      const actual = existingCols.get(key);
      if (!actual) {
        errors.push(`Missing column: public.${table}.${colName}`);
      } else {
        if (actual.udt_name !== expected.type) {
          errors.push(`Column type mismatch on public.${table}.${colName}: expected ${expected.type}, found ${actual.udt_name}`);
        }
        if (actual.is_nullable !== expected.nullable) {
          errors.push(`Column nullability mismatch on public.${table}.${colName}: expected nullable=${expected.nullable}, found nullable=${actual.is_nullable}`);
        }
      }
    }
  }

  const conQuery = await client.query(`
    SELECT conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace;
  `);
  const existingConstraints = new Set(conQuery.rows.map((r) => r.conname));

  for (const conName of EXPECTED_INITIAL_CONSTRAINTS) {
    if (!existingConstraints.has(conName)) {
      errors.push(`Missing constraint: ${conName}`);
    }
  }

  const idxQuery = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public';
  `);
  const existingIndexes = new Set(idxQuery.rows.map((r) => r.indexname));

  for (const idxName of EXPECTED_INITIAL_INDEXES) {
    if (!existingIndexes.has(idxName)) {
      errors.push(`Missing index: ${idxName}`);
    }
  }

  const trigQuery = await client.query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public';
  `);
  const existingTriggers = new Set(trigQuery.rows.map((r) => r.trigger_name));

  for (const trigName of EXPECTED_INITIAL_TRIGGERS) {
    if (!existingTriggers.has(trigName)) {
      errors.push(`Missing trigger: ${trigName}`);
    }
  }

  const funcQuery = await client.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = ANY($1::text[]);
  `, [EXPECTED_INITIAL_FUNCTIONS]);
  const existingFuncs = new Set(funcQuery.rows.map((r) => r.routine_name));

  for (const funcName of EXPECTED_INITIAL_FUNCTIONS) {
    if (!existingFuncs.has(funcName)) {
      errors.push(`Missing function: public.${funcName}`);
    }
  }

  if (errors.length > 0) {
    return { status: 'incomplete', errors };
  }

  return { status: 'complete', errors: [] };
}

export async function reconcileInitialSchema(client, appliedVersions, logger = console) {
  if (appliedVersions.has(INITIAL_SCHEMA_VERSION)) {
    return;
  }

  const verification = await verifyInitialSchemaCompleteness(client);

  if (verification.status === 'fresh') {
    return;
  }

  if (verification.status === 'complete') {
    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING;',
      [INITIAL_SCHEMA_VERSION]
    );
    appliedVersions.add(INITIAL_SCHEMA_VERSION);
    logger.log(`INFO: Reconciled initial schema migration ${INITIAL_SCHEMA_VERSION} from verified database state.`);
    return;
  }

  throw new Error(
    `Inconsistent database state: initial schema verification failed:\n` +
    verification.errors.map((e) => `  - ${e}`).join('\n') +
    `\nAborting to prevent unsafe migration execution. Recovery: inspect existing database schema or perform manual repair.`
  );
}

export async function reconcileIsPublicMigration(client, appliedVersions, logger = console) {
  if (appliedVersions.has(IS_PUBLIC_MIGRATION_VERSION)) {
    return;
  }

  const res = await client.query(`
    SELECT column_name, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'recipes'
      AND column_name = 'is_public';
  `);

  if (res.rows.length === 0) {
    return;
  }

  const col = res.rows[0];
  if (col.udt_name !== 'bool') {
    throw new Error(
      `Inconsistent database state for migration ${IS_PUBLIC_MIGRATION_VERSION}: column public.recipes.is_public exists but has unexpected type ${col.udt_name} (expected bool). Aborting to prevent data corruption.`
    );
  }

  await client.query(
    'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING;',
    [IS_PUBLIC_MIGRATION_VERSION]
  );
  appliedVersions.add(IS_PUBLIC_MIGRATION_VERSION);
  logger.log(`INFO: Reconciled migration ${IS_PUBLIC_MIGRATION_VERSION} (add_is_public_to_recipes) from existing column state without re-running data update.`);
}

export async function reconcileExplicitVersions(client, appliedVersions, explicitVersions = [], logger = console) {
  for (const version of explicitVersions) {
    if (!appliedVersions.has(version)) {
      await client.query(
        'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING;',
        [version]
      );
      appliedVersions.add(version);
      logger.log(`INFO: Explicitly reconciled migration version ${version}.`);
    }
  }
}

export async function runMigrations({
  client,
  migrationsDir = path.resolve(__dirname, 'supabase/migrations'),
  seedDir = path.resolve(__dirname, 'supabase'),
  isLocalhost = false,
  shouldSeed = false,
  explicitReconcile = [],
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

    if (explicitReconcile && explicitReconcile.length > 0) {
      await reconcileExplicitVersions(client, appliedVersions, explicitReconcile, logger);
    }

    await reconcileInitialSchema(client, appliedVersions, logger);
    await reconcileIsPublicMigration(client, appliedVersions, logger);

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

  const explicitReconcile = [];
  const reconcileIdx = process.argv.indexOf('--reconcile');
  if (reconcileIdx !== -1 && process.argv[reconcileIdx + 1]) {
    explicitReconcile.push(...process.argv[reconcileIdx + 1].split(',').map((v) => v.trim()).filter(Boolean));
  }

  try {
    await client.connect();
    const shouldSeed = process.env.SEED_DEMO === 'true' || process.argv.includes('--seed');
    await runMigrations({
      client,
      isLocalhost,
      shouldSeed,
      explicitReconcile
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