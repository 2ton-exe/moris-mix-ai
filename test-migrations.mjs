import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  discoverMigrations,
  initializeMigrationHistory,
  verifyInitialSchemaCompleteness,
  reconcileMigrationState,
  runMigrations
} from './run-migrations.mjs';

dotenv.config();

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {}
};

function runDiscoveryAndIntegrityUnitTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moris-mig-unit-'));
  try {
    fs.writeFileSync(path.join(tempDir, '20261020000000_second.sql'), 'SELECT 2;');
    fs.writeFileSync(path.join(tempDir, '20261010000000_first.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(tempDir, 'not_sql.txt'), 'IGNORE ME');

    const discovered = discoverMigrations(tempDir);
    assert.equal(discovered.length, 2);
    assert.equal(discovered[0].version, '20261010000000');
    assert.equal(discovered[0].file, '20261010000000_first.sql');
    assert.equal(discovered[1].version, '20261020000000');
    assert.equal(discovered[1].file, '20261020000000_second.sql');

    fs.writeFileSync(path.join(tempDir, 'invalid_name.sql'), 'SELECT 0;');
    assert.throws(
      () => discoverMigrations(tempDir),
      /Invalid migration filename: invalid_name\.sql/
    );
    fs.unlinkSync(path.join(tempDir, 'invalid_name.sql'));

    fs.writeFileSync(path.join(tempDir, '20261010000000_duplicate.sql'), 'SELECT 3;');
    assert.throws(
      () => discoverMigrations(tempDir),
      /Duplicate migration version detected: 20261010000000/
    );
    fs.unlinkSync(path.join(tempDir, '20261010000000_duplicate.sql'));

    console.log('PASS: Discovery, deterministic sorting, and filename integrity validation verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runSchemaVerificationUnitTests() {
  const mockClientMissingTable = {
    query: async (sql) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ table_name: 'profiles' }, { table_name: 'recipes' }] };
      }
      return { rows: [] };
    }
  };
  const resMissingTable = await verifyInitialSchemaCompleteness(mockClientMissingTable);
  assert.equal(resMissingTable.status, 'incomplete');
  assert.ok(resMissingTable.errors.some((e) => e.includes('Missing table: public.recipe_lineage')));
  assert.ok(resMissingTable.errors.some((e) => e.includes('Missing table: public.ai_usage_daily')));

  const mockClientMissingColumn = {
    query: async (sql) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ table_name: 'profiles' }, { table_name: 'recipes' }, { table_name: 'recipe_lineage' }, { table_name: 'ai_usage_daily' }] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { table_name: 'profiles', column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'profiles', column_name: 'display_name', udt_name: 'text', is_nullable: 'YES' }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const resMissingColumn = await verifyInitialSchemaCompleteness(mockClientMissingColumn);
  assert.equal(resMissingColumn.status, 'incomplete');
  assert.ok(resMissingColumn.errors.some((e) => e.includes('Missing column: public.profiles.avatar_url')));

  const mockClientTypeMismatch = {
    query: async (sql) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ table_name: 'profiles' }, { table_name: 'recipes' }, { table_name: 'recipe_lineage' }, { table_name: 'ai_usage_daily' }] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { table_name: 'profiles', column_name: 'id', udt_name: 'text', is_nullable: 'NO' },
            { table_name: 'profiles', column_name: 'display_name', udt_name: 'text', is_nullable: 'YES' },
            { table_name: 'profiles', column_name: 'avatar_url', udt_name: 'text', is_nullable: 'YES' },
            { table_name: 'profiles', column_name: 'created_at', udt_name: 'timestamptz', is_nullable: 'NO' },
            { table_name: 'profiles', column_name: 'updated_at', udt_name: 'timestamptz', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'user_id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'title', udt_name: 'text', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'raw_input', udt_name: 'text', is_nullable: 'YES' },
            { table_name: 'recipes', column_name: 'ingredients', udt_name: 'jsonb', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'instructions', udt_name: 'jsonb', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'flavor_scores', udt_name: 'jsonb', is_nullable: 'YES' },
            { table_name: 'recipes', column_name: 'star_rating', udt_name: 'int2', is_nullable: 'YES' },
            { table_name: 'recipes', column_name: 'cooked_at', udt_name: 'date', is_nullable: 'YES' },
            { table_name: 'recipes', column_name: 'image_url', udt_name: 'text', is_nullable: 'YES' },
            { table_name: 'recipes', column_name: 'image_path', udt_name: 'text', is_nullable: 'YES' },
            { table_name: 'recipes', column_name: 'created_at', udt_name: 'timestamptz', is_nullable: 'NO' },
            { table_name: 'recipes', column_name: 'updated_at', udt_name: 'timestamptz', is_nullable: 'NO' },
            { table_name: 'recipe_lineage', column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'recipe_lineage', column_name: 'parent_recipe_id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'recipe_lineage', column_name: 'child_recipe_id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'recipe_lineage', column_name: 'created_at', udt_name: 'timestamptz', is_nullable: 'NO' },
            { table_name: 'ai_usage_daily', column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'ai_usage_daily', column_name: 'user_id', udt_name: 'uuid', is_nullable: 'NO' },
            { table_name: 'ai_usage_daily', column_name: 'usage_date', udt_name: 'date', is_nullable: 'NO' },
            { table_name: 'ai_usage_daily', column_name: 'operation_count', udt_name: 'int4', is_nullable: 'NO' },
            { table_name: 'ai_usage_daily', column_name: 'created_at', udt_name: 'timestamptz', is_nullable: 'NO' },
            { table_name: 'ai_usage_daily', column_name: 'updated_at', udt_name: 'timestamptz', is_nullable: 'NO' }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const resTypeMismatch = await verifyInitialSchemaCompleteness(mockClientTypeMismatch);
  assert.equal(resTypeMismatch.status, 'incomplete');
  assert.ok(resTypeMismatch.errors.some((e) => e.includes('Column type mismatch on public.profiles.id: expected uuid, found text')));

  const mockClientFresh = {
    query: async (sql) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const resFresh = await verifyInitialSchemaCompleteness(mockClientFresh);
  assert.equal(resFresh.status, 'fresh');
  assert.equal(resFresh.errors.length, 0);

  const mockMigrations = [
    { version: '20261013000000', file: '20261013000000_initial_schema.sql' },
    { version: '20261017000001', file: '20261017000001_add_is_public_to_recipes.sql' }
  ];
  await assert.rejects(
    async () => {
      await reconcileMigrationState({
        client: mockClientFresh,
        appliedVersions: new Set(),
        migrations: mockMigrations,
        explicitReconcile: ['99999999999999'],
        logger: silentLogger
      });
    },
    /Cannot reconcile unknown migration version: 99999999999999/
  );

  console.log('PASS: Schema completeness verification and unit assertions verified.');
}

async function runDatabaseLifecycleIntegrationTests() {
  const hasOptIn = process.argv.includes('--run-db-tests') || process.env.RUN_MIGRATION_DB_TESTS === 'true';
  if (!hasOptIn) {
    console.log('INFO: Database lifecycle integration tests skipped. Use --run-db-tests or RUN_MIGRATION_DB_TESTS=true to enable.');
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.log('SKIP: DATABASE_URL not configured. Skipping database lifecycle integration tests.');
    return;
  }

  const baseDbUrl = process.env.DATABASE_URL;
  let parsed;
  try {
    parsed = new URL(baseDbUrl);
  } catch (err) {
    console.error(`Invalid DATABASE_URL: ${err.message}`);
    process.exit(1);
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const allowRemote = process.argv.includes('--allow-remote') || process.env.ALLOW_REMOTE_TEST_DB === 'true';

  if (!isLocalhost && !allowRemote) {
    console.warn('SKIP: Remote database lifecycle tests rejected. Target hostname is remote and neither --allow-remote nor ALLOW_REMOTE_TEST_DB=true is specified.');
    return;
  }

  const sourceDbName = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
  const testDbSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  const dbName = `test_mig_suite_${testDbSuffix}`;

  if (!/^test_mig_suite_\d+_\d+$/.test(dbName)) {
    throw new Error(`Safety violation: Invalid test database name generated: ${dbName}`);
  }

  if (dbName === sourceDbName) {
    throw new Error(`Safety violation: Test database name matches source database (${sourceDbName})`);
  }

  parsed.pathname = `/${dbName}`;
  const testDbUrl = parsed.toString();

  const caPath = path.resolve(__dirname, 'supabase/prod-ca-2021.crt');
  const caCert = fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf8') : undefined;
  const sslConfig = isLocalhost ? false : { rejectUnauthorized: true, ca: caCert };

  let adminClient = null;
  let testClient = null;
  let createdDatabase = false;
  let primaryError = null;

  try {
    adminClient = new Client({
      connectionString: baseDbUrl,
      ssl: sslConfig
    });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE ${dbName};`);
    createdDatabase = true;

    testClient = new Client({
      connectionString: testDbUrl,
      ssl: sslConfig
    });
    await testClient.connect();

    const migrationsDir = path.resolve(__dirname, 'supabase/migrations');
    const seedDir = path.resolve(__dirname, 'supabase');

    const mockAuthPath = path.resolve(seedDir, 'mock-auth.sql');
    if (fs.existsSync(mockAuthPath)) {
      const mockAuthSql = fs.readFileSync(mockAuthPath, 'utf8');
      await testClient.query(mockAuthSql);
    }

    const freshResult = await runMigrations({
      client: testClient,
      migrationsDir,
      seedDir,
      isLocalhost: true,
      shouldSeed: true,
      logger: silentLogger
    });

    assert.equal(freshResult.appliedMigrations.length, 2);
    assert.deepEqual(freshResult.appliedVersions.sort(), ['20261013000000', '20261017000001']);

    const historyRows = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
    assert.deepEqual(historyRows.rows.map((r) => r.version), ['20261013000000', '20261017000001']);

    const demoRow1 = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRow1.rows[0].is_public, true);
    console.log('PASS: Fresh database initialization applied all migrations once and recorded history.');

    await testClient.query('UPDATE public.recipes SET is_public = false WHERE id = \'11111111-1111-1111-1111-111111111111\';');

    const repeatResult = await runMigrations({
      client: testClient,
      migrationsDir,
      seedDir,
      isLocalhost: true,
      shouldSeed: false,
      logger: silentLogger
    });

    assert.equal(repeatResult.appliedMigrations.length, 0);

    const demoRow2 = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRow2.rows[0].is_public, false);
    console.log('PASS: Repeated migration execution skipped applied migrations and preserved demo recipe state.');

    await testClient.query('DELETE FROM supabase_migrations.schema_migrations WHERE version = \'20261017000001\';');

    await assert.rejects(
      async () => {
        await runMigrations({
          client: testClient,
          migrationsDir,
          seedDir,
          isLocalhost: true,
          shouldSeed: false,
          logger: silentLogger
        });
      },
      /Ambiguous database state for migration 20261017000001/
    );

    const historyAfterAmbiguous = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261017000001\';');
    assert.equal(historyAfterAmbiguous.rows.length, 0);

    const demoRowAmbiguous = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRowAmbiguous.rows[0].is_public, false);
    console.log('PASS: Ambiguous legacy state halted automatic reconciliation and left data untouched.');

    const reconcileResult = await runMigrations({
      client: testClient,
      migrationsDir,
      seedDir,
      isLocalhost: true,
      shouldSeed: false,
      explicitReconcile: ['20261017000001'],
      logger: silentLogger
    });

    assert.equal(reconcileResult.appliedMigrations.length, 0);

    const historyAfterExplicit = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
    assert.deepEqual(historyAfterExplicit.rows.map((r) => r.version), ['20261013000000', '20261017000001']);

    const demoRowReconciled = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRowReconciled.rows[0].is_public, false);
    console.log('PASS: Explicit reconciliation recorded history without executing SQL and preserved demo recipe state.');

    const repeatExplicitResult = await runMigrations({
      client: testClient,
      migrationsDir,
      seedDir,
      isLocalhost: true,
      shouldSeed: false,
      explicitReconcile: ['20261017000001'],
      logger: silentLogger
    });
    assert.equal(repeatExplicitResult.appliedMigrations.length, 0);

    await assert.rejects(
      async () => {
        await runMigrations({
          client: testClient,
          migrationsDir,
          seedDir,
          isLocalhost: true,
          shouldSeed: false,
          explicitReconcile: ['99999999999999'],
          logger: silentLogger
        });
      },
      /Cannot reconcile unknown migration version: 99999999999999/
    );

    const failureTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moris-mig-failure-'));
    try {
      fs.copyFileSync(
        path.join(migrationsDir, '20261013000000_initial_schema.sql'),
        path.join(failureTempDir, '20261013000000_initial_schema.sql')
      );
      fs.copyFileSync(
        path.join(migrationsDir, '20261017000001_add_is_public_to_recipes.sql'),
        path.join(failureTempDir, '20261017000001_add_is_public_to_recipes.sql')
      );
      fs.writeFileSync(
        path.join(failureTempDir, '20261099999999_failing_migration.sql'),
        'CREATE TABLE public.should_not_exist (id int); INVALID SYNTAX ERROR;'
      );

      await assert.rejects(
        async () => {
          await runMigrations({
            client: testClient,
            migrationsDir: failureTempDir,
            seedDir,
            isLocalhost: true,
            shouldSeed: false,
            logger: silentLogger
          });
        },
        /Migration 20261099999999_failing_migration\.sql failed/
      );

      const failHistory = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261099999999\';');
      assert.equal(failHistory.rows.length, 0);

      const tableCheck = await testClient.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = \'should_not_exist\';');
      assert.equal(tableCheck.rows.length, 0);
      console.log('PASS: Transactional failure rolled back cleanly without recording migration version.');
    } finally {
      fs.rmSync(failureTempDir, { recursive: true, force: true });
    }

    const concurrentClientA = new Client({ connectionString: testDbUrl, ssl: sslConfig });
    const concurrentClientB = new Client({ connectionString: testDbUrl, ssl: sslConfig });
    await concurrentClientA.connect();
    await concurrentClientB.connect();
    try {
      const [resA, resB] = await Promise.all([
        runMigrations({ client: concurrentClientA, migrationsDir, seedDir, isLocalhost: true, shouldSeed: false, logger: silentLogger }),
        runMigrations({ client: concurrentClientB, migrationsDir, seedDir, isLocalhost: true, shouldSeed: false, logger: silentLogger })
      ]);
      assert.equal(resA.appliedMigrations.length + resB.appliedMigrations.length, 0);
      console.log('PASS: Advisory lock serialized concurrent migration executions safely.');
    } finally {
      await concurrentClientA.end();
      await concurrentClientB.end();
    }

    const inconsistentClient = new Client({
      connectionString: testDbUrl,
      ssl: sslConfig
    });
    await inconsistentClient.connect();
    try {
      await inconsistentClient.query('DELETE FROM supabase_migrations.schema_migrations;');
      await inconsistentClient.query('DROP TABLE public.recipe_lineage CASCADE;');

      await assert.rejects(
        async () => {
          await runMigrations({
            client: inconsistentClient,
            migrationsDir,
            seedDir,
            isLocalhost: true,
            shouldSeed: false,
            logger: silentLogger
          });
        },
        /Inconsistent database state: initial schema verification failed/
      );
      console.log('PASS: Partially initialized database aborted safely without destructive recovery.');
    } finally {
      await inconsistentClient.end();
    }
  } catch (err) {
    primaryError = err;
  } finally {
    if (testClient) {
      try {
        await testClient.end();
      } catch (_e) {}
    }
    if (createdDatabase && adminClient) {
      try {
        await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
        console.log(`CLEANUP: Ephemeral database ${dbName} dropped.`);
      } catch (_e) {}
    }
    if (adminClient) {
      try {
        await adminClient.end();
      } catch (_e) {}
    }
    if (primaryError) {
      throw primaryError;
    }
  }
}

async function main() {
  console.log('Starting migration runner test suite...');
  runDiscoveryAndIntegrityUnitTests();
  await runSchemaVerificationUnitTests();
  await runDatabaseLifecycleIntegrationTests();
  console.log('ALL MIGRATION RUNNER TESTS COMPLETED SUCCESSFULLY.');
}

main().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
