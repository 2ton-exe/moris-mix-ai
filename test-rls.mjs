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

// Fail-closed TLS verification
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

// Sanitize SSL query parameters from DATABASE_URL
let sanitizedConnectionString;
try {
  const parsedUrl = new URL(process.env.DATABASE_URL);
  const sslParams = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'];
  for (const param of sslParams) {
    parsedUrl.searchParams.delete(param);
  }
  sanitizedConnectionString = parsedUrl.toString();
} catch (err) {
  console.error(`Invalid DATABASE_URL format: ${err.message}`);
  process.exit(1);
}

const client = new Client({
  connectionString: sanitizedConnectionString,
  ssl: sslConfig
});

async function runRlsTests() {
  // 1. Dynamic ID & Email Generation per run
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const timestamp = Date.now();
  const userAEmail = `test-user-a-${timestamp}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const userBEmail = `test-user-b-${timestamp}-${crypto.randomUUID().slice(0, 8)}@example.com`;

  // Track exact IDs created during this run for scoped teardown
  const createdUserIds = [];
  const createdRecipeIds = [];

  try {
    await client.connect();
    console.log('Connected to database for RLS regression testing.');

    // 2. Collision Safety: Provision test users without ON CONFLICT (fails immediately on collision)
    await client.query(`
      insert into auth.users (
        id, instance_id, aud, role, email, created_at, updated_at
      ) values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $3, now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, now(), now());
    `, [userA, userB, userAEmail, userBEmail]);
    createdUserIds.push(userA, userB);
    console.log(`✓ Provisioned test users User A (${userA}) and User B (${userB})`);

    // 3. Impersonate User A
    await client.query('set role authenticated');
    await client.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);

    // 4. User A inserts their own recipe
    const insertRes = await client.query(`
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
    assert.equal(insertRes.rowCount, 1, 'User A should be able to insert recipe');
    const userARecipeId = insertRes.rows[0].id;
    createdRecipeIds.push(userARecipeId);
    console.log(`✓ User A successfully inserted own recipe (ID: ${userARecipeId})`);

    // 5. User A reads their own recipe
    const readA = await client.query('select id, title, user_id from public.recipes where id = $1', [userARecipeId]);
    assert.equal(readA.rowCount, 1, 'User A should be able to read own recipe');
    assert.equal(readA.rows[0].id, userARecipeId);
    console.log('✓ User A successfully read own recipe');

    // 6. Impersonate User B
    await client.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);

    // 7. User B queries User A's recipe (should receive 0 rows)
    const readB = await client.query('select id, title from public.recipes where id = $1', [userARecipeId]);
    assert.equal(readB.rowCount, 0, 'User B must receive 0 rows when reading User A recipe');
    console.log('✓ User B received 0 rows when querying User A recipe (RLS isolation verified)');

    // 8. User B queries all recipes (should only see 0 recipes or only their own)
    const readAllB = await client.query('select id from public.recipes where user_id = $1', [userA]);
    assert.equal(readAllB.rowCount, 0, 'User B must not see any recipes belonging to User A');
    console.log('✓ User B query filtering by User A user_id returned 0 rows');

    // 9. User B attempts to insert a recipe with User A's user_id (should be blocked by RLS)
    let insertBlocked = false;
    try {
      await client.query(`
        insert into public.recipes (user_id, title)
        values ($1, 'User B Forged Recipe')
      `, [userA]);
    } catch (err) {
      insertBlocked = true;
      console.log(`✓ User B insertion with User A ID was blocked by RLS: ${err.message}`);
    }
    assert.equal(insertBlocked, true, 'User B must be blocked from inserting a recipe with User A user_id');

    // 10. User B inserts and reads their own recipe
    const insertBRes = await client.query(`
      insert into public.recipes (user_id, title)
      values ($1, 'User B Scrap Pie')
      returning id, title
    `, [userB]);
    assert.equal(insertBRes.rowCount, 1, 'User B should be able to insert their own recipe');
    const userBRecipeId = insertBRes.rows[0].id;
    createdRecipeIds.push(userBRecipeId);

    const readBOwn = await client.query('select id, title from public.recipes where id = $1', [userBRecipeId]);
    assert.equal(readBOwn.rowCount, 1, 'User B should read their own recipe');
    console.log('✓ User B successfully inserted and read their own recipe');

    console.log('\nPASSED: All RLS policy regression tests completed successfully.');
  } catch (err) {
    console.error('\nFAILED: RLS policy regression tests failed:', err);
    process.exitCode = 1;
  } finally {
    // 11. Scoped Cleanup: Delete only records associated with the exact IDs created during this run
    try {
      await client.query('reset role');
      if (createdRecipeIds.length > 0) {
        const recipePlaceholders = createdRecipeIds.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`delete from public.recipes where id in (${recipePlaceholders})`, createdRecipeIds);
      }
      if (createdUserIds.length > 0) {
        const userPlaceholders = createdUserIds.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`delete from public.recipes where user_id in (${userPlaceholders})`, createdUserIds);
        await client.query(`delete from public.profiles where id in (${userPlaceholders})`, createdUserIds);
        await client.query(`delete from auth.users where id in (${userPlaceholders})`, createdUserIds);
      }
      console.log('✓ Test records cleaned up successfully.');
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr.message);
    } finally {
      await client.end();
    }
  }
}

runRlsTests();
