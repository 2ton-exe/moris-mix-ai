import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';

dotenv.config();

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing in .env');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === '::1' || parsedUrl.hostname === '[::1]';
const effectivePort = parsedUrl.port || '5432';
const targetDbName = parsedUrl.pathname.startsWith('/') ? parsedUrl.pathname.slice(1) : parsedUrl.pathname;
const allowRemote = process.argv.includes('--allow-remote') || process.env.ALLOW_REMOTE_TEST_DB === 'true';

if (!isLocalhost && !allowRemote) {
  console.error('RLS tests only run against localhost by default. Use `pnpm test:db -- --allow-remote` only for an isolated test database.');
  process.exit(1);
}

if (process.env.CI === 'true') {
  if (!isLocalhost || effectivePort !== '5432' || targetDbName !== 'postgres' || allowRemote) {
    console.error(`CI target assertion failed: RLS tests in CI must execute strictly against local PostgreSQL service container on port 5432 with database 'postgres' without remote overrides (expected localhost/127.0.0.1:5432/postgres, got ${parsedUrl.hostname}:${effectivePort}/${targetDbName})`);
    process.exit(1);
  }
}

const client = new Client({
  connectionString: sanitizedConnectionString,
  ssl: isLocalhost ? false : sslConfig,
  connectionTimeoutMillis: 10000
});

async function runRlsTests() {
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const timestamp = Date.now();
  const userAEmail = `test-user-a-${timestamp}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `test-user-b-${timestamp}-${crypto.randomUUID().slice(0, 8)}@example.com`;

  const createdUserIds = [];
  const createdRecipeIds = [];
  let assertionsExecuted = 0;
  let assertionsPassed = 0;

  const check = (actual, expected, message) => {
    assertionsExecuted++;
    assert.equal(actual, expected, message);
    assertionsPassed++;
  };

  try {
    await client.connect();
    console.log('Connected to database for RLS regression testing.');

    await client.query(`
      insert into auth.users (
        id, instance_id, aud, role, email, created_at, updated_at
      ) values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $3, now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, now(), now());
    `, [userA, userB, userAEmail, userBEmail]);
    createdUserIds.push(userA, userB);
    console.log(`✓ Provisioned test users User A (${userA}) and User B (${userB})`);

    await client.query(`
      insert into public.ai_usage_daily (user_id, usage_date, operation_count)
      values ($1, CURRENT_DATE, 3);
    `, [userA]);
    console.log(`✓ Provisioned baseline ai_usage_daily record for User A`);

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userA]);

    const insertResA1 = await client.query(`
      insert into public.recipes (user_id, title, raw_input, ingredients, instructions)
      values ($1, $2, $3, $4::jsonb, $5::jsonb)
      returning id, user_id, title
    `, [
      userA,
      'User A Secret Scrap Stew',
      'Leftover broth and scallions',
      JSON.stringify(['broth', 'scallions']),
      JSON.stringify(['Simmer scallions in broth'])
    ]);
    check(insertResA1.rowCount, 1, 'User A should be able to insert recipe');
    const userARecipe1Id = insertResA1.rows[0].id;
    createdRecipeIds.push(userARecipe1Id);

    const insertResA2 = await client.query(`
      insert into public.recipes (user_id, title, raw_input, ingredients, instructions)
      values ($1, $2, $3, $4::jsonb, $5::jsonb)
      returning id, user_id, title
    `, [
      userA,
      'User A Enhanced Stew Remix',
      'Leftover broth, scallions, and miso',
      JSON.stringify(['broth', 'scallions', 'miso']),
      JSON.stringify(['Simmer scallions in broth', 'Stir in miso paste'])
    ]);
    check(insertResA2.rowCount, 1, 'User A should be able to insert second recipe');
    const userARecipe2Id = insertResA2.rows[0].id;
    createdRecipeIds.push(userARecipe2Id);

    const readA = await client.query('select id, title, user_id from public.recipes where id = $1', [userARecipe1Id]);
    check(readA.rowCount, 1, 'User A should be able to read own recipe');
    check(readA.rows[0].id, userARecipe1Id);
    console.log('✓ User A successfully inserted and read own recipes');

    const profileReadA = await client.query('select id, display_name from public.profiles where id = $1', [userA]);
    check(profileReadA.rowCount, 1, 'User A should be able to read own profile');

    const profileUpdateA = await client.query('update public.profiles set display_name = $1 where id = $2', ['User A Custom Name', userA]);
    check(profileUpdateA.rowCount, 1, 'User A should be able to update own profile');
    console.log('✓ User A profile read and update authorization verified');

    const usageReadA = await client.query('select user_id, operation_count from public.ai_usage_daily where user_id = $1', [userA]);
    check(usageReadA.rowCount, 1, 'User A should be able to read own ai_usage_daily');
    check(usageReadA.rows[0].operation_count, 3);
    console.log('✓ User A ai_usage_daily read authorization verified');

    const lineageInsertA = await client.query(`
      insert into public.recipe_lineage (parent_recipe_id, child_recipe_id)
      values ($1, $2)
      returning parent_recipe_id, child_recipe_id
    `, [userARecipe1Id, userARecipe2Id]);
    check(lineageInsertA.rowCount, 1, 'User A should be able to link own parent and child recipes');

    const lineageReadA = await client.query('select parent_recipe_id, child_recipe_id from public.recipe_lineage where parent_recipe_id = $1', [userARecipe1Id]);
    check(lineageReadA.rowCount, 1, 'User A should be able to read own recipe lineage');
    console.log('✓ User A recipe_lineage creation and read authorization verified');

    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userB]);

    const readB = await client.query('select id, title from public.recipes where id = $1', [userARecipe1Id]);
    check(readB.rowCount, 0, 'User B must receive 0 rows when reading User A recipe');

    const readAllB = await client.query('select id from public.recipes where user_id = $1', [userA]);
    check(readAllB.rowCount, 0, 'User B must not see any recipes belonging to User A');

    const updateB = await client.query('update public.recipes set title = $1 where id = $2', ['Hacked by User B', userARecipe1Id]);
    check(updateB.rowCount, 0, 'User B update on User A recipe must affect 0 rows');

    const deleteB = await client.query('delete from public.recipes where id = $1', [userARecipe1Id]);
    check(deleteB.rowCount, 0, 'User B delete on User A recipe must affect 0 rows');
    console.log('✓ User B read, update, and delete isolation on User A recipe verified (0 rows affected)');

    const profileReadB = await client.query('select id, display_name from public.profiles where id = $1', [userA]);
    check(profileReadB.rowCount, 0, 'User B must not be able to read User A profile');

    const profileUpdateB = await client.query('update public.profiles set display_name = $1 where id = $2', ['Hacked Profile', userA]);
    check(profileUpdateB.rowCount, 0, 'User B must not be able to update User A profile');
    console.log('✓ User B cross-user profile read and update isolation verified (0 rows affected)');

    const usageReadB = await client.query('select user_id, operation_count from public.ai_usage_daily where user_id = $1', [userA]);
    check(usageReadB.rowCount, 0, 'User B must not be able to read User A ai_usage_daily');

    const usageReadAllB = await client.query('select user_id from public.ai_usage_daily');
    check(usageReadAllB.rowCount, 0, 'User B must receive 0 rows from ai_usage_daily table');
    console.log('✓ User B cross-user ai_usage_daily isolation verified (0 rows returned)');

    const lineageReadB = await client.query('select parent_recipe_id from public.recipe_lineage where parent_recipe_id = $1', [userARecipe1Id]);
    check(lineageReadB.rowCount, 0, 'User B must not be able to read User A recipe lineage');

    const lineageDeleteB = await client.query('delete from public.recipe_lineage where parent_recipe_id = $1', [userARecipe1Id]);
    check(lineageDeleteB.rowCount, 0, 'User B must not be able to delete User A recipe lineage');
    console.log('✓ User B cross-user recipe_lineage read and delete isolation verified (0 rows affected)');

    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userB]);

    let insertForgedBlocked = false;
    try {
      await client.query(`
        insert into public.recipes (user_id, title)
        values ($1, 'User B Forged Recipe')
      `, [userA]);
    } catch (err) {
      if (err.code === '42501' || /row-level security policy/i.test(err.message)) {
        insertForgedBlocked = true;
      } else {
        throw err;
      }
    } finally {
      await client.query('ROLLBACK');
    }
    check(insertForgedBlocked, true, 'User B must be blocked from inserting a recipe with User A user_id');
    console.log('✓ User B insertion forged with User A owner ID blocked by WITH CHECK');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userB]);

    const insertBRes = await client.query(`
      insert into public.recipes (user_id, title)
      values ($1, 'User B Scrap Pie')
      returning id, title
    `, [userB]);
    check(insertBRes.rowCount, 1, 'User B should be able to insert their own recipe');
    const userBRecipeId = insertBRes.rows[0].id;
    createdRecipeIds.push(userBRecipeId);

    const readBOwn = await client.query('select id, title from public.recipes where id = $1', [userBRecipeId]);
    check(readBOwn.rowCount, 1, 'User B should read their own recipe');
    console.log('✓ User B successfully inserted and read their own recipe');
    await client.query('COMMIT');

    let lineageForgedBlocked = false;
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userB]);
    try {
      await client.query(`
        insert into public.recipe_lineage (parent_recipe_id, child_recipe_id)
        values ($1, $2)
      `, [userARecipe1Id, userBRecipeId]);
    } catch (err) {
      if (err.code === '42501' || /row-level security policy/i.test(err.message)) {
        lineageForgedBlocked = true;
      } else {
        throw err;
      }
    } finally {
      await client.query('ROLLBACK');
    }
    check(lineageForgedBlocked, true, 'User B must be blocked from creating lineage referencing User A parent recipe');

    let lineageForgedChildBlocked = false;
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userB]);
    try {
      await client.query(`
        insert into public.recipe_lineage (parent_recipe_id, child_recipe_id)
        values ($1, $2)
      `, [userBRecipeId, userARecipe1Id]);
    } catch (err) {
      if (err.code === '42501' || /row-level security policy/i.test(err.message)) {
        lineageForgedChildBlocked = true;
      } else {
        throw err;
      }
    } finally {
      await client.query('ROLLBACK');
    }
    check(lineageForgedChildBlocked, true, 'User B must be blocked from creating lineage referencing User A child recipe');
    console.log('✓ User B cross-owner recipe_lineage insertions blocked by WITH CHECK for both parent and child');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userA]);

    const readAUserBRecipe = await client.query('select id, title from public.recipes where id = $1', [userBRecipeId]);
    check(readAUserBRecipe.rowCount, 0, 'User A must not be able to read User B private recipe');

    const readAUserBProfile = await client.query('select id, display_name from public.profiles where id = $1', [userB]);
    check(readAUserBProfile.rowCount, 0, 'User A must not be able to read User B profile');

    const updateAUserBRecipe = await client.query('update public.recipes set title = $1 where id = $2', ['Hacked by User A', userBRecipeId]);
    check(updateAUserBRecipe.rowCount, 0, 'User A update on User B recipe must affect 0 rows');
    console.log('✓ User A cross-user read and update isolation on User B records verified (0 rows returned/affected)');

    let transferBlocked = false;
    try {
      await client.query('update public.recipes set user_id = $1 where id = $2', [userB, userARecipe1Id]);
    } catch (err) {
      if (err.code === '42501' || /row-level security policy/i.test(err.message)) {
        transferBlocked = true;
      } else {
        throw err;
      }
    } finally {
      await client.query('ROLLBACK');
    }
    check(transferBlocked, true, 'User A must be blocked from transferring recipe ownership to User B');
    console.log('✓ Recipe ownership transfer attempt blocked by WITH CHECK boundary');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userA]);

    const lineageDeleteA = await client.query('delete from public.recipe_lineage where parent_recipe_id = $1', [userARecipe1Id]);
    check(lineageDeleteA.rowCount, 1, 'User A should be able to delete own recipe lineage');
    console.log('✓ User A successfully deleted own recipe lineage');

    await client.query('COMMIT');

    console.log('\nPASSED: All RLS policy regression tests completed successfully.');
    console.log('\n--- RLS Policy Regression Test Report ---');
    console.log(`Target: ${parsedUrl.hostname}:${effectivePort}/${targetDbName}`);
    console.log(`Assertions Executed: ${assertionsExecuted}`);
    console.log(`Assertions Passed: ${assertionsPassed}`);
    console.log('Skipped: false');
    console.log('-----------------------------------------\n');

    if (process.env.CI === 'true' && (assertionsExecuted !== 30 || assertionsPassed !== 30)) {
      throw new Error(`CI failure: Expected 30 RLS regression assertions to execute and pass, but executed ${assertionsExecuted} (passed: ${assertionsPassed})`);
    }
  } catch (err) {
    console.error('\nFAILED: RLS policy regression tests failed:', err);
    process.exitCode = 1;
  } finally {
    let cleanupFailed = false;
    try {
      try {
        await client.query('ROLLBACK');
      } catch {}

      try {
        await client.query('RESET ROLE');
      } catch {}

      if (createdUserIds.length > 0) {
        const userPlaceholders = createdUserIds.map((_, i) => `$${i + 1}`).join(', ');

        try {
          await client.query(`
            delete from public.recipe_lineage
            where parent_recipe_id in (select id from public.recipes where user_id in (${userPlaceholders}))
               or child_recipe_id in (select id from public.recipes where user_id in (${userPlaceholders}));
          `, createdUserIds);
        } catch (err) {
          cleanupFailed = true;
          console.error('Failed to clean up recipe_lineage:', err.message);
        }

        try {
          await client.query(`delete from public.ai_usage_daily where user_id in (${userPlaceholders});`, createdUserIds);
        } catch (err) {
          cleanupFailed = true;
          console.error('Failed to clean up ai_usage_daily:', err.message);
        }

        try {
          await client.query(`delete from public.recipes where user_id in (${userPlaceholders});`, createdUserIds);
        } catch (err) {
          cleanupFailed = true;
          console.error('Failed to clean up recipes by user_id:', err.message);
        }

        try {
          await client.query(`delete from public.profiles where id in (${userPlaceholders});`, createdUserIds);
        } catch (err) {
          cleanupFailed = true;
          console.error('Failed to clean up profiles:', err.message);
        }

        try {
          await client.query(`delete from auth.users where id in (${userPlaceholders});`, createdUserIds);
        } catch (err) {
          cleanupFailed = true;
          console.error('Failed to clean up auth.users:', err.message);
        }
      }

      if (cleanupFailed) {
        process.exitCode = 1;
        console.error('Teardown cleanup failed.');
      } else {
        console.log('✓ Test records cleaned up successfully.');
      }
    } finally {
      await client.end();
    }
  }
}

runRlsTests();
