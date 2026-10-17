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
  reconcileInitialSchema,
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

async function runDatabaseLifecycleIntegrationTests() {
  if (!process.env.DATABASE_URL) {
    console.log('SKIP: DATABASE_URL not configured. Skipping live database integration tests.');
    return;
  }

  const baseDbUrl = process.env.DATABASE_URL;
  const dbName = `test_mig_suite_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const parsed = new URL(baseDbUrl);
  parsed.pathname = `/${dbName}`;
  const testDbUrl = parsed.toString();

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  const caPath = path.resolve(__dirname, 'supabase/prod-ca-2021.crt');
  const caCert = fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf8') : undefined;
  const sslConfig = isLocalhost ? false : { rejectUnauthorized: true, ca: caCert };

  const adminClient = new Client({
    connectionString: baseDbUrl,
    ssl: sslConfig
  });

  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${dbName};`);

  const testClient = new Client({
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

  try {
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

    await testClient.query('DELETE FROM supabase_migrations.schema_migrations;');
    const emptyHistory = await testClient.query('SELECT count(*) FROM supabase_migrations.schema_migrations;');
    assert.equal(Number(emptyHistory.rows[0].count), 0);

    const bootstrapTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moris-mig-bootstrap-'));
    try {
      fs.copyFileSync(
        path.join(migrationsDir, '20261013000000_initial_schema.sql'),
        path.join(bootstrapTempDir, '20261013000000_initial_schema.sql')
      );
      fs.writeFileSync(
        path.join(bootstrapTempDir, '20261017000002_test_new_column.sql'),
        'ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS test_bootstrap_col text;'
      );

      const bootstrapResult = await runMigrations({
        client: testClient,
        migrationsDir: bootstrapTempDir,
        seedDir,
        isLocalhost: true,
        shouldSeed: false,
        logger: silentLogger
      });

      assert.deepEqual(bootstrapResult.appliedMigrations, ['20261017000002_test_new_column.sql']);

      const reconciledHistory = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
      assert.deepEqual(
        reconciledHistory.rows.map((r) => r.version),
        ['20261013000000', '20261017000002']
      );
      console.log('PASS: Existing database bootstrap reconciled initial schema and executed unapplied migrations.');
    } finally {
      fs.rmSync(bootstrapTempDir, { recursive: true, force: true });
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
        /Inconsistent database state: found partial initial schema tables/
      );
      console.log('PASS: Partially initialized database aborted safely without destructive recovery.');
    } finally {
      await inconsistentClient.end();
    }
  } finally {
    await testClient.end();
    await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
    await adminClient.end();
    console.log(`CLEANUP: Ephemeral database ${dbName} dropped.`);
  }
}

async function main() {
  console.log('Starting migration runner test suite...');
  runDiscoveryAndIntegrityUnitTests();
  await runDatabaseLifecycleIntegrationTests();
  console.log('ALL MIGRATION RUNNER TESTS PASSED.');
}

main().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
