import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import { getMigrationTestArgs } from './run-local-tests.mjs';
import {
  discoverMigrations,
  initializeMigrationHistory,
  verifyInitialSchemaCompleteness,
  verifyOwnerEqualityPredicate,
  reconcileMigrationState,
  runMigrations,
  extractProjectRefFromDatabaseUrl,
  extractProjectRefFromSupabaseUrl,
  sanitizeDatabaseUrl,
  validateDatabaseTarget,
  validateTestDatabaseTarget,
  verifyColumnMetadata,
  probePostgrestNotesColumn,
  resolveTestDatabaseConfiguration,
  reloadPostgrestSchemaCache,
  runTestDatabaseMigrations,
  evaluateForeignKeyCascade,
  verifyForeignKeyCascadeConstraint,
  verifyParentRecipeCascadeBehavior,
  verifyChildRecipeCascadeBehavior
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
  const migrations = discoverMigrations(path.join(__dirname, 'supabase/migrations'));
  const uploadMigration = migrations.find((migration) => migration.file.endsWith('_recipe_image_upload_intents.sql'));
  assert.equal(uploadMigration?.version, '20261102000009');
  const uploadSql = fs.readFileSync(uploadMigration.filePath, 'utf8');
  assert.match(uploadSql, /alter table public\.recipe_image_upload_intents enable row level security;/);
  assert.match(uploadSql, /alter table public\.recipe_image_upload_intents force row level security;/);
  assert.match(uploadSql, /revoke all on table public\.recipe_image_upload_intents from public;/);
  const uploadPermissions = uploadSql.slice(uploadSql.indexOf('do $$'));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const roleBlock = uploadPermissions.match(
      new RegExp(
        `if exists \\(select 1 from pg_roles where rolname = '${role}'\\) then([\\s\\S]*?)end if;`
      )
    );
    assert.ok(roleBlock, `${role} permissions must be guarded by role existence`);
    assert.ok(roleBlock[1].includes(`execute 'revoke all on table public.recipe_image_upload_intents from ${role}'`));
  }
  const serviceRoleBlock = uploadPermissions.match(/if exists \(select 1 from pg_roles where rolname = 'service_role'\) then([\s\S]*?)end if;/);
  assert.ok(serviceRoleBlock, 'service_role grants must be guarded by role existence');
  assert.ok(serviceRoleBlock[1].includes("execute 'grant select, insert on table public.recipe_image_upload_intents to service_role'"));
  assert.doesNotMatch(uploadSql, /^\s*(?:revoke|grant)\b[^;]*\b(?:anon|authenticated|service_role)\b[^;]*;/im);
  assert.doesNotMatch(uploadSql, /create\s+policy|security\s+definer|grant[^;]+to\s+(?:public|anon|authenticated)\b/i);
  assert.match(uploadSql, /byte_size between 1 and 10485760/);
  assert.match(uploadSql, /expires_at = created_at \+ interval '10 minutes'/);
  assert.match(uploadSql, /check \(state = 'pending'\)/);
  assert.doesNotMatch(uploadSql, /references|on delete|update public\.recipes|delete from/i);
  const lifecycleMigration = migrations.find((migration) => migration.version === '20261102000010');
  assert.equal(lifecycleMigration?.file, '20261102000010_recipe_image_upload_lifecycle.sql');
  const lifecycleSql = fs.readFileSync(lifecycleMigration.filePath, 'utf8');
  const lifecycleCorrection = migrations.find((migration) => migration.version === '20261102000011');
  assert.equal(lifecycleCorrection?.file, '20261102000011_recipe_image_upload_cleanup_claim_qualification.sql');
  const lifecycleCorrectionSql = fs.readFileSync(lifecycleCorrection.filePath, 'utf8');
  const retentionDelete = lifecycleCorrectionSql.match(/delete from public\.recipe_image_upload_intents as retained[\s\S]*?limit 500\s*\n\s*\);/i)?.[0];
  assert.ok(retentionDelete);
  assert.match(retentionDelete, /retained\.id in \([\s\S]*select candidate\.id/i);
  assert.match(retentionDelete, /order by candidate\.cleanup_completed_at, candidate\.id/i);
  assert.doesNotMatch(retentionDelete, /(?:where|select|order by)\s+id\b/i);
  assert.match(lifecycleCorrectionSql, /cleanup_status in \('queued', 'retry'\)[\s\S]*cleanup_next_attempt_at < now\(\) - interval '1 hour'[\s\S]*cleanup_status = 'claimed'[\s\S]*cleanup_lease_until < now\(\)/);
  assert.match(lifecycleSql, /check \(state in \('pending', 'finalizing', 'attached', 'expired'\)\)/);
  assert.match(lifecycleSql, /state = 'attached' and cleanup_status in \('waiting', 'complete'\)/);
  assert.match(lifecycleSql, /pg_advisory_xact_lock\(hashtext\('recipe-image-upload:' \|\| p_user_id::text\)\)/);
  assert.match(lifecycleSql, /v_hourly_count >= 10/);
  assert.match(lifecycleSql, /v_outstanding_count >= 3/);
  assert.match(lifecycleSql, /for update skip locked/i);
  assert.match(lifecycleSql, /i\.state = 'pending'[\s\S]*?i\.expires_at <= now\(\)/);
  assert.match(lifecycleSql, /cleanup_attempts = i\.cleanup_attempts \+ 1/);
  assert.match(lifecycleSql, /when v_attempts >= 8 then 'failed'/);
  assert.match(lifecycleSql, /cleanup_completed_at < now\(\) - interval '30 days'/);
  assert.match(lifecycleSql, /revoke all on table public\.recipe_image_upload_intents from service_role/);
  assert.match(lifecycleSql, /grant execute on function public\.claim_expired_recipe_image_uploads\(integer\) to service_role/);
  assert.match(lifecycleSql, /grant execute on function public\.finish_recipe_image_upload_cleanup\(uuid, boolean, text\) to service_role/);
  assert.match(lifecycleSql, /if exists \(select 1 from pg_roles where rolname = 'anon'\) then/);
  assert.match(lifecycleSql, /if exists \(select 1 from pg_roles where rolname = 'authenticated'\) then/);
  assert.doesNotMatch(lifecycleSql, /^\s*grant\b[^;]*\b(?:public|anon|authenticated)\b[^;]*;/im);
  assert.doesNotMatch(lifecycleSql, /grant\s+(?:select,\s*)?insert\s+on table public\.recipe_image_upload_intents to service_role/i);
  const quotaMigration = migrations.find((migration) => migration.file.endsWith('_ai_quota_enforcement.sql'));
  assert.equal(quotaMigration?.version, '20261031000007');
  const quotaSql = fs.readFileSync(quotaMigration.filePath, 'utf8');
  const quotaFunctions = [...quotaSql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/g)];
  assert.deepEqual(quotaFunctions.map((match) => match[1]), [
    'consume_ai_quota', 'confirm_ai_quota', 'reconcile_ai_quota', 'reconcile_unconfirmed_reservation'
  ]);
  for (const [definition] of quotaFunctions) {
    assert.match(definition, /begin\s+if auth\.role\(\) IS DISTINCT FROM 'service_role' then\s+raise exception 'Unauthorized quota operation' using errcode = '42501';/);
    assert.doesNotMatch(definition, /auth\.role\(\)\s*<>/);
  }
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

    const recipeSearchMigration = fs.readFileSync(
      path.join(__dirname, 'supabase/migrations/20261026000004_add_recipe_ingredient_search.sql'),
      'utf8'
    );
    assert.match(recipeSearchMigration, /jsonb_path_query_array\(ingredients, '\$\[\*\]\.name'\)/);
    assert.doesNotMatch(recipeSearchMigration, /create\s+(?:unique\s+)?index|idx_recipes_user_ingredients_text/i);

    console.log('PASS: Migration discovery, integrity, and ingredient-search migration safety verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runQuotaAuthorizationDatabaseTests(client) {
  const reservationId = crypto.randomUUID();
  const operations = [
    ['SELECT public.consume_ai_quota($1::uuid, $2::uuid, 20, current_date)', [crypto.randomUUID(), reservationId]],
    ['SELECT public.confirm_ai_quota($1::uuid)', [reservationId]],
    ['SELECT public.reconcile_ai_quota($1::uuid)', [reservationId]],
    ['SELECT public.reconcile_unconfirmed_reservation($1::uuid, $2::text)', [reservationId, 'authorization regression']]
  ];
  await client.query('BEGIN');
  try {
    for (const role of ['', 'anon', 'authenticated']) {
      await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [role]);
      assert.equal((await client.query('SELECT auth.role() AS role')).rows[0].role, role || null);
      for (const [sql, params] of operations) {
        await client.query('SAVEPOINT quota_authorization');
        try {
          await assert.rejects(() => client.query(sql, params), (error) => error.code === '42501');
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT quota_authorization');
          await client.query('RELEASE SAVEPOINT quota_authorization');
        }
      }
    }
    await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
    for (const [sql, params] of operations.slice(1)) {
      const result = await client.query(sql, params);
      assert.equal(Object.values(result.rows[0])[0].status, 'not_found');
    }
  } finally {
    await client.query('ROLLBACK');
  }
  console.log('PASS: All four quota RPCs reject null and non-service role claims; service-role settlement contracts remain unchanged.');
}

async function runRecipeImageLifecycleDatabaseTests(client, connectionString, ssl) {
  const competing = new Client({ connectionString, ssl });
  await competing.connect();
  const setServiceRole = (target) => target.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
  const createIntent = async (target, userId, createdAt = new Date()) => {
    const id = crypto.randomUUID();
    const recipeId = crypto.randomUUID();
    const created = new Date(Math.floor(createdAt.getTime() / 1000) * 1000);
    const suffix = `${userId}/${recipeId}/${id}`;
    const result = await target.query(
      'SELECT public.create_recipe_image_upload_intent($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::integer, $8::timestamptz, $9::timestamptz) AS status',
      [id, userId, recipeId, `recipe-images/staging/${suffix}`, `recipe-images/final/${suffix}/${crypto.randomUUID()}`, 'image/jpeg', 1024, created.toISOString(), new Date(created.getTime() + 600000).toISOString()]
    );
    return { id, status: result.rows[0].status };
  };

  try {
    const retentionEligible = await createIntent(client, crypto.randomUUID());
    const retentionIneligible = await createIntent(client, crypto.randomUUID());
    await client.query("UPDATE public.recipe_image_upload_intents SET state = 'expired', cleanup_status = 'complete', cleanup_completed_at = now() - interval '31 days' WHERE id = $1::uuid", [retentionEligible.id]);
    await client.query("UPDATE public.recipe_image_upload_intents SET state = 'expired', cleanup_status = 'complete', cleanup_completed_at = now() - interval '29 days' WHERE id = $1::uuid", [retentionIneligible.id]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");
    await assert.rejects(
      () => client.query('SELECT * FROM public.claim_expired_recipe_image_uploads(50)'),
      (error) => error.code === '42501'
    );
    await setServiceRole(client);
    await setServiceRole(competing);

    const concurrentUser = crypto.randomUUID();
    assert.equal((await createIntent(client, concurrentUser)).status, 'allowed');
    assert.equal((await createIntent(client, concurrentUser)).status, 'allowed');
    const concurrent = await Promise.all([
      createIntent(client, concurrentUser),
      createIntent(competing, concurrentUser)
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), ['allowed', 'pending_limit']);

    const rateLimitUser = crypto.randomUUID();
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await createIntent(client, rateLimitUser);
      assert.equal(result.status, 'allowed');
      await client.query(
        "UPDATE public.recipe_image_upload_intents SET state = 'expired', cleanup_status = 'complete', cleanup_completed_at = now() WHERE id = $1::uuid",
        [result.id]
      );
    }
    assert.equal((await createIntent(client, rateLimitUser)).status, 'rate_limited');

    const staleUser = crypto.randomUUID();
    const stale = await createIntent(client, staleUser, new Date(Date.now() - 11 * 60 * 1000));
    const active = await createIntent(client, crypto.randomUUID());
    const finalizing = await createIntent(client, crypto.randomUUID());
    const attached = await createIntent(client, crypto.randomUUID());
    await client.query("UPDATE public.recipe_image_upload_intents SET state = 'finalizing' WHERE id = $1::uuid", [finalizing.id]);
    await client.query("UPDATE public.recipe_image_upload_intents SET state = 'attached' WHERE id = $1::uuid", [attached.id]);
    const claimed = await client.query('SELECT * FROM public.claim_expired_recipe_image_uploads(50)');
    assert.deepEqual(claimed.rows.map((row) => row.id), [stale.id]);
    assert.equal(claimed.rows[0].staging_key.includes(stale.id), true);
    assert.equal((await client.query('SELECT id FROM public.recipe_image_upload_intents WHERE id = $1::uuid', [retentionEligible.id])).rowCount, 0);
    assert.equal((await client.query('SELECT id FROM public.recipe_image_upload_intents WHERE id = $1::uuid', [retentionIneligible.id])).rowCount, 1);
    assert.equal((await client.query('SELECT state FROM public.recipe_image_upload_intents WHERE id = $1::uuid', [active.id])).rows[0].state, 'pending');
    assert.equal((await client.query('SELECT state FROM public.recipe_image_upload_intents WHERE id = $1::uuid', [finalizing.id])).rows[0].state, 'finalizing');
    assert.equal((await client.query('SELECT state FROM public.recipe_image_upload_intents WHERE id = $1::uuid', [attached.id])).rows[0].state, 'attached');
    assert.equal((await client.query("SELECT public.finish_recipe_image_upload_cleanup($1::uuid, false, 'network') AS status", [stale.id])).rows[0].status, 'retry');
    assert.deepEqual((await client.query('SELECT cleanup_status, cleanup_attempts FROM public.recipe_image_upload_intents WHERE id = $1::uuid', [stale.id])).rows[0], { cleanup_status: 'retry', cleanup_attempts: 1 });
    assert.deepEqual((await client.query('SELECT public.recipe_image_upload_cleanup_health() AS health')).rows[0].health, { pending: 0, failed: 0 });
    await client.query("UPDATE public.recipe_image_upload_intents SET cleanup_next_attempt_at = now() - interval '61 minutes' WHERE id = $1::uuid", [stale.id]);
    assert.deepEqual((await client.query('SELECT public.recipe_image_upload_cleanup_health() AS health')).rows[0].health, { pending: 1, failed: 0 });
    const reclaimed = await client.query('SELECT * FROM public.claim_expired_recipe_image_uploads(50)');
    assert.deepEqual(reclaimed.rows.map((row) => row.id), [stale.id]);
    assert.equal((await client.query('SELECT public.finish_recipe_image_upload_cleanup($1::uuid, true, null) AS status', [stale.id])).rows[0].status, 'complete');

    const concurrentCleanup = await createIntent(client, crypto.randomUUID(), new Date(Date.now() - 11 * 60 * 1000));
    await client.query('BEGIN');
    const firstClaim = await client.query('SELECT * FROM public.claim_expired_recipe_image_uploads(50)');
    assert.equal(firstClaim.rows.some((row) => row.id === concurrentCleanup.id), true);
    const secondClaim = await competing.query('SELECT * FROM public.claim_expired_recipe_image_uploads(50)');
    assert.equal(secondClaim.rows.some((row) => row.id === concurrentCleanup.id), false);
    await client.query('ROLLBACK');
    console.log('PASS: Recipe-image quotas serialize concurrent signing, cleanup claims are exclusive, and expiry/retry state fences hold in PostgreSQL.');
  } finally {
    try { await client.query('ROLLBACK'); } catch {}
    try { await client.query("SELECT set_config('request.jwt.claim.role', '', false)"); } catch {}
    await competing.end();
  }
}

async function runRecipeSearchMigrationUnitTests() {
  const migrations = discoverMigrations(path.join(__dirname, 'supabase/migrations'));
  const hardening = migrations.find((migration) => migration.version === '20261101000008');
  const sql = fs.readFileSync(hardening.filePath, 'utf8').replaceAll('\r\n', '\n');
  const rankingSql = fs.readFileSync(
    migrations.find((migration) => migration.version === '20261031000005').filePath,
    'utf8'
  ).replaceAll('\r\n', '\n');
  const signatures = [
    'public.damerau_levenshtein(text, text)',
    'public.match_text_rank(text, text)',
    'public.match_ingredients_rank(jsonb, text)',
    'public.search_recipes(text, text, text, text, int, int, int, timestamptz, smallint, uuid)'
  ];
  const permissions = sql.slice(sql.indexOf('revoke execute on function'));
  const anon = permissions.match(/if exists \(select from pg_roles where rolname = 'anon'\) then([\s\S]*?)end if;/);
  const authenticated = permissions.match(/if exists \(select from pg_roles where rolname = 'authenticated'\) then([\s\S]*?)end if;/);
  assert.ok(anon, 'Anonymous revokes must be guarded by role existence');
  assert.ok(authenticated, 'Authenticated grants must be guarded by role existence');
  for (const signature of signatures) {
    assert.ok(permissions.slice(0, permissions.indexOf('do $$')).includes(`revoke execute on function ${signature} from public;`));
    assert.ok(anon[1].includes(`revoke execute on function ${signature} from anon;`));
    assert.ok(authenticated[1].includes(`grant execute on function ${signature} to authenticated;`));
  }
  assert.doesNotMatch(permissions.replace(anon[0], '').replace(authenticated[0], ''), /from anon|to authenticated/);
  const restore = sql.match(/if to_regprocedure\('public\.match_ingredients_rank\(jsonb,text\)'\) is null then\s+execute \$function\$([\s\S]*?)\$function\$;\s+end if;/);
  assert.ok(restore, 'Restore the ingredient helper only when its exact signature is absent');
  const originalHelper = rankingSql.slice(
    rankingSql.indexOf('create or replace function public.match_ingredients_rank'),
    rankingSql.indexOf('create or replace function public.search_recipes')
  ).trim().replace('create or replace function', 'create function');
  assert.equal(restore[1].trim(), originalHelper, 'Restore the existing canonical helper without changing its behavior');
  assert.ok(sql.indexOf(restore[0]) < sql.indexOf('create or replace function public.search_recipes'));
  assert.doesNotMatch(sql, /schema_migrations|security definer/i);

  const queries = [];
  const history = migrations.filter((migration) => migration !== hardening).map((migration) => migration.version);
  const client = {
    query: async (query, params) => {
      queries.push({ query, params });
      if (query.startsWith('SELECT version FROM')) return { rows: history.map((version) => ({ version })) };
      return { rows: [] };
    }
  };
  const result = await runMigrations({ client, logger: silentLogger });
  assert.deepEqual(result.appliedMigrations, [hardening.file]);
  assert.equal(queries.filter(({ query }) => query === fs.readFileSync(hardening.filePath, 'utf8')).length, 1);
  assert.deepEqual(
    queries.filter(({ query }) => /INSERT INTO supabase_migrations\.schema_migrations/.test(query)).map(({ params }) => params),
    [[hardening.version]]
  );
  assert.equal(queries.some(({ query }) => /^\s*(delete|update)\s/i.test(query)), false);
  console.log('PASS: Search migration role guards, canonical dependency restoration, and version-only history handling verified.');
}

async function runRecipeSearchMigrationDatabaseTests(client) {
  const sql = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261101000008_harden_recipe_search_rpc.sql'), 'utf8');
  const history = await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
  const helperQuery = "SELECT oid, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid = to_regprocedure('public.match_ingredients_rank(jsonb,text)')";
  const originalHelper = await client.query(helperQuery);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    assert.deepEqual((await client.query(helperQuery)).rows, originalHelper.rows, 'An existing helper must retain its identity and definition');
    await client.query('DROP FUNCTION public.match_ingredients_rank(jsonb, text)');
    await client.query(sql);
    const restored = await client.query(helperQuery);
    assert.equal(restored.rows.length, 1);
    assert.equal(restored.rows[0].definition, originalHelper.rows[0].definition);
    const rank = await client.query("SELECT public.match_ingredients_rank('[{\"name\":\"Garlic Fried Rice\"}]'::jsonb, 'garlic rice') AS rank");
    assert.equal(rank.rows[0].rank, 3);
    const privileges = await client.query(`
      SELECT p.oid, p.prosecdef,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
        EXISTS (
          SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public
      FROM pg_proc p
      WHERE p.oid IN (
        'public.damerau_levenshtein(text,text)'::regprocedure,
        'public.match_text_rank(text,text)'::regprocedure,
        'public.match_ingredients_rank(jsonb,text)'::regprocedure,
        'public.search_recipes(text,text,text,text,int,int,int,timestamptz,smallint,uuid)'::regprocedure
      )
    `);
    assert.equal(privileges.rows.length, 4);
    for (const row of privileges.rows) {
      assert.equal(row.prosecdef, false);
      assert.equal(row.anon, false);
      assert.equal(row.public, false);
      assert.equal(row.authenticated, true);
    }
    assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows, history.rows);
  } finally {
    await client.query('ROLLBACK');
  }
  console.log('PASS: Search migration preserves existing helpers, restores missing helpers, restricts RPC permissions, and leaves migration history unchanged.');
}

async function runSchemaVerificationUnitTests() {
  assert.equal(
    verifyOwnerEqualityPredicate("coalesce(user_id::text, '') = auth.uid()::text OR true", 'user_id', 'recipes'),
    false
  );

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

  const createMockClientWithCustom = ({ rlsOverrides = {}, policyOverrides = null, extraPolicies = [] } = {}) => {
    const completeTables = [
      { table_name: 'profiles' },
      { table_name: 'recipes' },
      { table_name: 'recipe_lineage' },
      { table_name: 'ai_usage_daily' }
    ];

    const completeColumns = [
      { table_name: 'profiles', column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
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
    ];

    const completeConstraints = [
      { conname: 'profiles_pkey' },
      { conname: 'recipes_pkey' },
      { conname: 'recipe_lineage_pkey' },
      { conname: 'ai_usage_daily_pkey' },
      { conname: 'check_parent_child_distinct' },
      { conname: 'unique_parent_child_pair' },
      { conname: 'unique_user_daily_usage' }
    ];

    const completeIndexes = [
      { indexname: 'idx_recipes_user_created' },
      { indexname: 'idx_recipes_user_rating' },
      { indexname: 'idx_lineage_parent' },
      { indexname: 'idx_lineage_child' }
    ];

    const completeTriggers = [
      { trigger_name: 'tr_profiles_updated_at' },
      { trigger_name: 'tr_recipes_updated_at' },
      { trigger_name: 'tr_ai_usage_daily_updated_at' }
    ];

    const completeFunctions = [
      { routine_name: 'set_updated_at' },
      { routine_name: 'handle_new_user' }
    ];

    const completeRls = [
      { relname: 'profiles', relrowsecurity: rlsOverrides.profiles ?? true },
      { relname: 'recipes', relrowsecurity: rlsOverrides.recipes ?? true },
      { relname: 'recipe_lineage', relrowsecurity: rlsOverrides.recipe_lineage ?? true },
      { relname: 'ai_usage_daily', relrowsecurity: rlsOverrides.ai_usage_daily ?? true }
    ];

    const defaultPolicies = [
      { tablename: 'profiles', policyname: 'profiles_select_own', cmd: 'SELECT', permissive: 'PERMISSIVE', roles: ['public'], qual: '(auth.uid() = id)', with_check: null },
      { tablename: 'profiles', policyname: 'profiles_update_own', cmd: 'UPDATE', permissive: 'PERMISSIVE', roles: ['public'], qual: '(auth.uid() = id)', with_check: '(auth.uid() = id)' },
      { tablename: 'recipes', policyname: 'recipes_select_own', cmd: 'SELECT', permissive: 'PERMISSIVE', roles: ['public'], qual: '(auth.uid() = user_id)', with_check: null },
      { tablename: 'recipes', policyname: 'recipes_insert_own', cmd: 'INSERT', permissive: 'PERMISSIVE', roles: ['public'], qual: null, with_check: '(auth.uid() = user_id)' },
      { tablename: 'recipes', policyname: 'recipes_update_own', cmd: 'UPDATE', permissive: 'PERMISSIVE', roles: ['public'], qual: '(auth.uid() = user_id)', with_check: '(auth.uid() = user_id)' },
      { tablename: 'recipes', policyname: 'recipes_delete_own', cmd: 'DELETE', permissive: 'PERMISSIVE', roles: ['public'], qual: '(auth.uid() = user_id)', with_check: null },
      { tablename: 'recipe_lineage', policyname: 'lineage_select_own', cmd: 'SELECT', permissive: 'PERMISSIVE', roles: ['public'], qual: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.parent_recipe_id AND user_id = auth.uid()))', with_check: null },
      { tablename: 'recipe_lineage', policyname: 'lineage_insert_own', cmd: 'INSERT', permissive: 'PERMISSIVE', roles: ['public'], qual: null, with_check: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.parent_recipe_id AND user_id = auth.uid()) AND EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.child_recipe_id AND user_id = auth.uid()))' },
      { tablename: 'recipe_lineage', policyname: 'lineage_delete_own', cmd: 'DELETE', permissive: 'PERMISSIVE', roles: ['public'], qual: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.parent_recipe_id AND user_id = auth.uid()))', with_check: null },
      { tablename: 'ai_usage_daily', policyname: 'ai_usage_select_own', cmd: 'SELECT', permissive: 'PERMISSIVE', roles: ['public'], qual: '(auth.uid() = user_id)', with_check: null }
    ];

    const actualPolicies = policyOverrides ? policyOverrides(defaultPolicies) : [...defaultPolicies, ...extraPolicies];

    return {
      query: async (sql) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: completeTables };
        }
        if (sql.includes('information_schema.columns')) {
          return { rows: completeColumns };
        }
        if (sql.includes('pg_constraint')) {
          return { rows: completeConstraints };
        }
        if (sql.includes('pg_indexes')) {
          return { rows: completeIndexes };
        }
        if (sql.includes('information_schema.triggers')) {
          return { rows: completeTriggers };
        }
        if (sql.includes('information_schema.routines')) {
          return { rows: completeFunctions };
        }
        if (sql.includes('pg_class')) {
          return { rows: completeRls };
        }
        if (sql.includes('pg_policies')) {
          return { rows: actualPolicies };
        }
        return { rows: [] };
      }
    };
  };

  const clientValid = createMockClientWithCustom();
  const resValid = await verifyInitialSchemaCompleteness(clientValid);
  assert.equal(resValid.status, 'complete');
  assert.equal(resValid.errors.length, 0);

  const clientDisabledRls = createMockClientWithCustom({ rlsOverrides: { recipes: false } });
  const resDisabledRls = await verifyInitialSchemaCompleteness(clientDisabledRls);
  assert.equal(resDisabledRls.status, 'incomplete');
  assert.ok(resDisabledRls.errors.some((e) => e.includes('Row level security (RLS) is disabled on table public.recipes')));

  const clientMissingPol = createMockClientWithCustom({
    policyOverrides: (policies) => policies.filter((p) => p.policyname !== 'recipes_select_own')
  });
  const resMissingPol = await verifyInitialSchemaCompleteness(clientMissingPol);
  assert.equal(resMissingPol.status, 'incomplete');
  assert.ok(resMissingPol.errors.some((e) => e.includes('Missing required policy recipes_select_own on public.recipes')));

  const clientWeakenedUsingTokens = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_select_own' ? { ...p, qual: '((auth.uid() = user_id) OR (user_id IS NOT NULL))' } : p))
  });
  const resWeakenedUsingTokens = await verifyInitialSchemaCompleteness(clientWeakenedUsingTokens);
  assert.equal(resWeakenedUsingTokens.status, 'incomplete');
  assert.ok(resWeakenedUsingTokens.errors.some((e) => e.includes('Policy recipes_select_own USING predicate does not strictly enforce owner authorization boundary')));

  const clientWeakenedUsingTrue = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_select_own' ? { ...p, qual: '((auth.uid() = user_id) OR true)' } : p))
  });
  const resWeakenedUsingTrue = await verifyInitialSchemaCompleteness(clientWeakenedUsingTrue);
  assert.equal(resWeakenedUsingTrue.status, 'incomplete');
  assert.ok(resWeakenedUsingTrue.errors.some((e) => e.includes('Policy recipes_select_own USING predicate does not strictly enforce owner authorization boundary')));

  const clientWeakenedUsingNotNull = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_select_own' ? { ...p, qual: '(auth.uid() IS NOT NULL AND user_id IS NOT NULL)' } : p))
  });
  const resWeakenedUsingNotNull = await verifyInitialSchemaCompleteness(clientWeakenedUsingNotNull);
  assert.equal(resWeakenedUsingNotNull.status, 'incomplete');
  assert.ok(resWeakenedUsingNotNull.errors.some((e) => e.includes('Policy recipes_select_own USING predicate does not strictly enforce owner authorization boundary')));

  const clientWeakenedCheckTokens = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_insert_own' ? { ...p, with_check: '((auth.uid() = user_id) OR true)' } : p))
  });
  const resWeakenedCheckTokens = await verifyInitialSchemaCompleteness(clientWeakenedCheckTokens);
  assert.equal(resWeakenedCheckTokens.status, 'incomplete');
  assert.ok(resWeakenedCheckTokens.errors.some((e) => e.includes('Policy recipes_insert_own WITH CHECK predicate does not strictly enforce owner authorization boundary')));

  const clientWeakenedLineageParentOr = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'lineage_select_own' ? { ...p, qual: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.parent_recipe_id OR user_id = auth.uid()))' } : p))
  });
  const resWeakenedLineageParentOr = await verifyInitialSchemaCompleteness(clientWeakenedLineageParentOr);
  assert.equal(resWeakenedLineageParentOr.status, 'incomplete');
  assert.ok(resWeakenedLineageParentOr.errors.some((e) => e.includes('Policy lineage_select_own USING predicate does not strictly enforce parent recipe owner authorization boundary')));

  const clientWeakenedLineageInsertOr = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'lineage_insert_own' ? { ...p, with_check: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.parent_recipe_id AND user_id = auth.uid()) OR EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.child_recipe_id AND user_id = auth.uid()))' } : p))
  });
  const resWeakenedLineageInsertOr = await verifyInitialSchemaCompleteness(clientWeakenedLineageInsertOr);
  assert.equal(resWeakenedLineageInsertOr.status, 'incomplete');
  assert.ok(resWeakenedLineageInsertOr.errors.some((e) => e.includes('Policy lineage_insert_own WITH CHECK predicate does not strictly enforce parent and child recipe owner authorization boundary')));

  const clientWeakenedRole = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_select_own' ? { ...p, qual: "(auth.role() = 'authenticated')" } : p))
  });
  const resWeakenedRole = await verifyInitialSchemaCompleteness(clientWeakenedRole);
  assert.equal(resWeakenedRole.status, 'incomplete');
  assert.ok(resWeakenedRole.errors.some((e) => e.includes('Policy recipes_select_own USING predicate does not strictly enforce owner authorization boundary')));

  const clientLineageMissingUser = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'lineage_select_own' ? { ...p, qual: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.parent_recipe_id))' } : p))
  });
  const resLineageMissingUser = await verifyInitialSchemaCompleteness(clientLineageMissingUser);
  assert.equal(resLineageMissingUser.status, 'incomplete');
  assert.ok(resLineageMissingUser.errors.some((e) => e.includes('Policy lineage_select_own USING predicate does not strictly enforce parent recipe owner authorization boundary')));

  const clientLineageDuplicateChild = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'lineage_insert_own' ? { ...p, with_check: '(EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.child_recipe_id AND user_id = auth.uid()) AND EXISTS (SELECT 1 FROM public.recipes WHERE id = public.recipe_lineage.child_recipe_id AND user_id = auth.uid()))' } : p))
  });
  const resLineageDuplicateChild = await verifyInitialSchemaCompleteness(clientLineageDuplicateChild);
  assert.equal(resLineageDuplicateChild.status, 'incomplete');
  assert.ok(resLineageDuplicateChild.errors.some((e) => e.includes('Policy lineage_insert_own WITH CHECK predicate does not strictly enforce parent and child recipe owner authorization boundary')));

  const clientMissingWithCheck = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_insert_own' ? { ...p, with_check: null } : p))
  });
  const resMissingWithCheck = await verifyInitialSchemaCompleteness(clientMissingWithCheck);
  assert.equal(resMissingWithCheck.status, 'incomplete');
  assert.ok(resMissingWithCheck.errors.some((e) => e.includes('Policy recipes_insert_own missing required WITH CHECK clause')));

  const clientUnexpectedQual = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_insert_own' ? { ...p, qual: '(auth.uid() = user_id)' } : p))
  });
  const resUnexpectedQual = await verifyInitialSchemaCompleteness(clientUnexpectedQual);
  assert.equal(resUnexpectedQual.status, 'incomplete');
  assert.ok(resUnexpectedQual.errors.some((e) => e.includes('Policy recipes_insert_own unexpectedly defines a USING clause')));

  const clientUnexpectedWithCheck = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_delete_own' ? { ...p, with_check: '(auth.uid() = user_id)' } : p))
  });
  const resUnexpectedWithCheck = await verifyInitialSchemaCompleteness(clientUnexpectedWithCheck);
  assert.equal(resUnexpectedWithCheck.status, 'incomplete');
  assert.ok(resUnexpectedWithCheck.errors.some((e) => e.includes('Policy recipes_delete_own unexpectedly defines a WITH CHECK clause')));

  const clientCmdMismatch = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_insert_own' ? { ...p, cmd: 'SELECT' } : p))
  });
  const resCmdMismatch = await verifyInitialSchemaCompleteness(clientCmdMismatch);
  assert.equal(resCmdMismatch.status, 'incomplete');
  assert.ok(resCmdMismatch.errors.some((e) => e.includes('Policy recipes_insert_own command mismatch: expected INSERT, found SELECT')));

  const clientRolesMismatch = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_select_own' ? { ...p, roles: ['authenticated'] } : p))
  });
  const resRolesMismatch = await verifyInitialSchemaCompleteness(clientRolesMismatch);
  assert.equal(resRolesMismatch.status, 'incomplete');
  assert.ok(resRolesMismatch.errors.some((e) => e.includes('Policy recipes_select_own roles mismatch')));

  const clientPermissiveMismatch = createMockClientWithCustom({
    policyOverrides: (policies) => policies.map((p) => (p.policyname === 'recipes_select_own' ? { ...p, permissive: 'RESTRICTIVE' } : p))
  });
  const resPermissiveMismatch = await verifyInitialSchemaCompleteness(clientPermissiveMismatch);
  assert.equal(resPermissiveMismatch.status, 'incomplete');
  assert.ok(resPermissiveMismatch.errors.some((e) => e.includes('Policy recipes_select_own permissive mode mismatch')));

  const clientUnexpectedPolicy = createMockClientWithCustom({
    extraPolicies: [
      { tablename: 'recipes', policyname: 'recipes_anonymous_bypass', cmd: 'SELECT', permissive: 'PERMISSIVE', roles: ['anon'], qual: 'true', with_check: null }
    ]
  });
  const resUnexpected = await verifyInitialSchemaCompleteness(clientUnexpectedPolicy);
  assert.equal(resUnexpected.status, 'incomplete');
  assert.ok(resUnexpected.errors.some((e) => e.includes('Unexpected policy recipes_anonymous_bypass on public.recipes may weaken row level security boundaries')));

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

  const notesMigration = { version: '20261023000002', file: '20261023000002_add_notes_to_recipes.sql' };
  const notesReconcileClient = (rows) => ({
    query: async () => ({ rows })
  });
  const appliedBaseVersions = new Set(['20261013000000', '20261017000001']);
  for (const [rows, expectedError] of [
    [[], /column public\.recipes\.notes does not exist; expected nullable text/],
    [[{ udt_name: 'int4', is_nullable: 'YES' }], /type int4, nullable=true; expected nullable text/],
    [[{ udt_name: 'text', is_nullable: 'NO' }], /type text, nullable=false; expected nullable text/]
  ]) {
    await assert.rejects(
      () => reconcileMigrationState({
        client: notesReconcileClient(rows),
        appliedVersions: new Set(appliedBaseVersions),
        migrations: [notesMigration],
        explicitReconcile: [notesMigration.version],
        logger: silentLogger
      }),
      expectedError
    );
  }

  const reconciledVersions = new Set(appliedBaseVersions);
  await reconcileMigrationState({
    client: notesReconcileClient([{ udt_name: 'text', is_nullable: 'YES' }]),
    appliedVersions: reconciledVersions,
    migrations: [notesMigration],
    explicitReconcile: [notesMigration.version],
    logger: silentLogger
  });
  assert.equal(reconciledVersions.has(notesMigration.version), true);

  console.log('PASS: Schema completeness verification and unit assertions verified.');
}

export function evaluateMigrationLifecycleOptIn(argv = process.argv, env = process.env) {
  const hasOptIn = argv.includes('--run-db-tests') || env.RUN_MIGRATION_DB_TESTS === 'true';
  const isCI = env.CI === 'true';
  return {
    hasOptIn,
    isCI,
    shouldRun: hasOptIn,
    error: isCI && !hasOptIn
      ? 'CI failure: Database lifecycle integration tests must not be skipped in CI. Ensure --run-db-tests or RUN_MIGRATION_DB_TESTS=true is enabled.'
      : null
  };
}

function runMigrationOptInUnitTests() {
  // 1. Default behavior (no --run-db-tests, no RUN_MIGRATION_DB_TESTS):
  const defaultEval = evaluateMigrationLifecycleOptIn(['node', 'test-migrations.mjs'], {});
  assert.equal(defaultEval.hasOptIn, false);
  assert.equal(defaultEval.shouldRun, false);
  assert.equal(defaultEval.error, null);

  // 2. Explicit opt-in via CLI argument --run-db-tests:
  const cliOptIn = evaluateMigrationLifecycleOptIn(['node', 'test-migrations.mjs', '--run-db-tests'], {});
  assert.equal(cliOptIn.hasOptIn, true);
  assert.equal(cliOptIn.shouldRun, true);
  assert.equal(cliOptIn.error, null);

  // 3. Explicit opt-in via environment variable RUN_MIGRATION_DB_TESTS=true:
  const envOptIn = evaluateMigrationLifecycleOptIn(['node', 'test-migrations.mjs'], { RUN_MIGRATION_DB_TESTS: 'true' });
  assert.equal(envOptIn.hasOptIn, true);
  assert.equal(envOptIn.shouldRun, true);
  assert.equal(envOptIn.error, null);

  // 4. CI failure when opt-in is missing in CI environment:
  const ciMissingOptIn = evaluateMigrationLifecycleOptIn(['node', 'test-migrations.mjs'], { CI: 'true' });
  assert.equal(ciMissingOptIn.hasOptIn, false);
  assert.equal(ciMissingOptIn.shouldRun, false);
  assert.notEqual(ciMissingOptIn.error, null);
  assert.match(ciMissingOptIn.error, /CI failure: Database lifecycle integration tests must not be skipped in CI/);

  // 5. CI success when opted in via --run-db-tests:
  const ciWithOptIn = evaluateMigrationLifecycleOptIn(['node', 'test-migrations.mjs', '--run-db-tests'], { CI: 'true' });
  assert.equal(ciWithOptIn.hasOptIn, true);
  assert.equal(ciWithOptIn.shouldRun, true);
  assert.equal(ciWithOptIn.error, null);

  // 6. Verify run-local-tests.mjs runner default:
  assert.deepEqual(getMigrationTestArgs(), ['test-migrations.mjs', '--run-db-tests']);

  console.log('PASS: Migration lifecycle default and explicit opt-in behavior verified.');
}

async function runDatabaseLifecycleIntegrationTests() {
  const optInResult = evaluateMigrationLifecycleOptIn();
  const { hasOptIn, isCI } = optInResult;
  if (optInResult.error) {
    throw new Error(optInResult.error);
  }

  if (!optInResult.shouldRun) {
    console.log('INFO: Database lifecycle integration tests skipped. Use --run-db-tests or RUN_MIGRATION_DB_TESTS=true to enable.');
    return;
  }

  if (optInResult.isCI && !process.env.DATABASE_URL) {
    throw new Error('CI failure: DATABASE_URL must be configured in CI.');
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

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
  const effectivePort = parsed.port || '5432';
  const sourceDbName = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
  const allowRemote = process.argv.includes('--allow-remote') || process.env.ALLOW_REMOTE_TEST_DB === 'true';

  if (isCI) {
    if (!isLocalhost || effectivePort !== '5432' || sourceDbName !== 'postgres' || allowRemote) {
      throw new Error(`CI target assertion failed: Database tests in CI must execute strictly against local PostgreSQL service container on port 5432 with database 'postgres' without remote overrides (expected localhost/127.0.0.1:5432/postgres, got ${parsed.hostname}:${effectivePort}/${sourceDbName})`);
    }
  }

  if (!isLocalhost && !allowRemote) {
    console.warn(`SKIP: Remote database lifecycle tests rejected. Target hostname is remote (${parsed.hostname}) and neither --allow-remote nor ALLOW_REMOTE_TEST_DB=true is specified.`);
    console.log('\n--- Migration Lifecycle Test Report ---');
    console.log(`Target: ${parsed.hostname}:${effectivePort}/${sourceDbName}`);
    console.log(`Opt-in: ${hasOptIn}`);
    console.log('Scenarios Executed: 0');
    console.log('Scenarios Passed: 0');
    console.log('Skipped: true (remote database safety guard prevented execution)');
    console.log('--------------------------------------\n');
    return;
  }

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
  let scenariosExecuted = 0;
  let scenariosPassed = 0;

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
    const discoveredMigrations = discoverMigrations(migrationsDir);
    const expectedMigrationVersions = discoveredMigrations.map((m) => m.version);
    const expectedMigrationFiles = discoveredMigrations.map((m) => m.file);

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

    assert.equal(freshResult.appliedMigrations.length, expectedMigrationVersions.length);
    assert.deepEqual(freshResult.appliedMigrations, expectedMigrationFiles);
    await runQuotaAuthorizationDatabaseTests(testClient);
    await runRecipeImageLifecycleDatabaseTests(testClient, testDbUrl, sslConfig);
    await runRecipeSearchMigrationDatabaseTests(testClient);
    assert.deepEqual(freshResult.appliedVersions.sort(), [...expectedMigrationVersions].sort());

    const historyRows = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
    assert.deepEqual(historyRows.rows.map((r) => r.version), expectedMigrationVersions);

    const notesCol = await testClient.query("SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'notes';");
    assert.equal(notesCol.rows.length, 1);
    assert.equal(notesCol.rows[0].udt_name, 'text');
    assert.equal(notesCol.rows[0].is_nullable, 'YES');

    const demoRow1 = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRow1.rows[0].is_public, true);

    // Verify parent-deletion cascade foreign key constraint from PostgreSQL system catalog:
    const catalogFkResult = await verifyForeignKeyCascadeConstraint(testClient, {
      sourceSchema: 'public',
      sourceTable: 'recipe_lineage',
      sourceColumn: 'parent_recipe_id',
      targetSchema: 'public',
      targetTable: 'recipes',
      targetColumn: 'id'
    });
    assert.equal(catalogFkResult.valid, true);
    assert.equal(catalogFkResult.deleteAction, 'CASCADE');
    assert.equal(catalogFkResult.validated, true);

    // Verify physical ON DELETE CASCADE behavior directly at database level:
    await verifyParentRecipeCascadeBehavior(testClient);

    // Verify child-deletion cascade foreign key constraint from PostgreSQL system catalog:
    const childCatalogFkResult = await verifyForeignKeyCascadeConstraint(testClient, {
      sourceSchema: 'public',
      sourceTable: 'recipe_lineage',
      sourceColumn: 'child_recipe_id',
      targetSchema: 'public',
      targetTable: 'recipes',
      targetColumn: 'id'
    });
    assert.equal(childCatalogFkResult.valid, true, 'Child foreign key cascade constraint is invalid.');
    assert.equal(childCatalogFkResult.deleteAction, 'CASCADE', 'Child foreign key delete action is not CASCADE.');
    assert.equal(childCatalogFkResult.validated, true, 'Child foreign key constraint is not validated.');

    // Verify physical ON DELETE CASCADE behavior on child deletion directly at database level:
    await verifyChildRecipeCascadeBehavior(testClient);

    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Fresh database initialization applied all migrations once, verified catalog cascade foreign keys (parent and child), and proved physical ON DELETE CASCADE for both parent and child deletions.');

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
    scenariosExecuted++;
    scenariosPassed++;
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
    scenariosExecuted++;
    scenariosPassed++;
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
    assert.deepEqual(historyAfterExplicit.rows.map((r) => r.version), expectedMigrationVersions);

    const demoRowReconciled = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRowReconciled.rows[0].is_public, false);
    scenariosExecuted++;
    scenariosPassed++;
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

    await testClient.query('DELETE FROM supabase_migrations.schema_migrations WHERE version = \'20261013000000\';');

    await testClient.query('ALTER TABLE public.recipes DISABLE ROW LEVEL SECURITY;');
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
      /Row level security \(RLS\) is disabled on table public\.recipes/
    );

    const historyAfterDisabledRls = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261013000000\';');
    assert.equal(historyAfterDisabledRls.rows.length, 0);
    const demoRowDisabledRls = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRowDisabledRls.rows[0].is_public, false);
    await testClient.query('ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;');
    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Disabled RLS rejected initial schema reconciliation and preserved unapplied history state.');

    await testClient.query('DROP POLICY "recipes_select_own" ON public.recipes;');
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
      /Missing required policy recipes_select_own on public\.recipes/
    );

    const historyAfterMissingPolicy = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261013000000\';');
    assert.equal(historyAfterMissingPolicy.rows.length, 0);
    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Missing owner-scoped policy rejected initial schema reconciliation.');

    await testClient.query('CREATE POLICY "recipes_select_own" ON public.recipes FOR SELECT USING ((auth.uid() = user_id) OR (user_id IS NOT NULL));');
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
      /Policy recipes_select_own USING predicate does not strictly enforce owner authorization boundary/
    );

    const historyAfterWeakenedUsing = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261013000000\';');
    assert.equal(historyAfterWeakenedUsing.rows.length, 0);
    await testClient.query('DROP POLICY "recipes_select_own" ON public.recipes;');
    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Weakened policy predicate containing tokens rejected initial schema reconciliation.');

    await testClient.query('CREATE POLICY "recipes_select_own" ON public.recipes FOR DELETE USING (auth.uid() = user_id);');
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
      /Policy recipes_select_own command mismatch/
    );

    const historyAfterCommandMismatch = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261013000000\';');
    assert.equal(historyAfterCommandMismatch.rows.length, 0);
    await testClient.query('DROP POLICY "recipes_select_own" ON public.recipes;');
    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Policy command mismatch rejected initial schema reconciliation.');

    await testClient.query('CREATE POLICY "recipes_select_own" ON public.recipes FOR SELECT TO authenticated USING (auth.uid() = user_id);');
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
      /Policy recipes_select_own roles mismatch/
    );

    const historyAfterRolesMismatch = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version = \'20261013000000\';');
    assert.equal(historyAfterRolesMismatch.rows.length, 0);
    await testClient.query('DROP POLICY "recipes_select_own" ON public.recipes;');
    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Policy roles mismatch rejected initial schema reconciliation.');

    await testClient.query('CREATE POLICY "recipes_select_own" ON public.recipes FOR SELECT USING (auth.uid() = user_id);');

    const recoveredReconciliation = await runMigrations({
      client: testClient,
      migrationsDir,
      seedDir,
      isLocalhost: true,
      shouldSeed: false,
      logger: silentLogger
    });
    assert.equal(recoveredReconciliation.appliedMigrations.length, 0);

    const historyRecovered = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
    assert.deepEqual(historyRecovered.rows.map((r) => r.version), expectedMigrationVersions);
    const demoRowRecovered = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRowRecovered.rows[0].is_public, false);
    scenariosExecuted++;
    scenariosPassed++;
    console.log('PASS: Complete and intact RLS policies reconciled initial schema successfully after correction.');

    const failureTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moris-mig-failure-'));
    try {
      for (const m of discoveredMigrations) {
        fs.copyFileSync(m.filePath, path.join(failureTempDir, m.file));
      }
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
      scenariosExecuted++;
      scenariosPassed++;
      console.log('PASS: Transactional failure rolled back cleanly without recording migration version.');
    } finally {
      fs.rmSync(failureTempDir, { recursive: true, force: true });
    }

    await testClient.end();
    testClient = null;

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
      scenariosExecuted++;
      scenariosPassed++;
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
      scenariosExecuted++;
      scenariosPassed++;
      console.log('PASS: Partially initialized database aborted safely without destructive recovery.');
    } finally {
      await inconsistentClient.end();
    }

    console.log('\n--- Migration Lifecycle Test Report ---');
    console.log(`Target: ${parsed.hostname}:${effectivePort}/${sourceDbName}`);
    console.log(`Opt-in: ${hasOptIn}`);
    console.log(`Scenarios Executed: ${scenariosExecuted}`);
    console.log(`Scenarios Passed: ${scenariosPassed}`);
    console.log('Skipped: false');
    console.log('--------------------------------------\n');

    if (isCI && (scenariosExecuted !== 13 || scenariosPassed !== 13)) {
      throw new Error(`CI failure: Expected 13 lifecycle integration scenarios to run and pass, but executed ${scenariosExecuted} (passed: ${scenariosPassed})`);
    }
  } catch (err) {
    primaryError = err;
  } finally {
    if (testClient) {
      try {
        await testClient.end();
      } catch (_e) {}
    }
    if (createdDatabase && adminClient && /^test_mig_suite_\d+_\d+$/.test(dbName) && dbName !== sourceDbName) {
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

async function runTestTargetMigrationUnitTests() {
  const originalFetch = globalThis.fetch;
  const probeHeaders = [];
  try {
    globalThis.fetch = async (_url, options) => {
      probeHeaders.push(options.headers);
      return { status: 200 };
    };

    for (const key of ['sb_secret_test', 'sb_publishable_test']) {
      await probePostgrestNotesColumn('https://test-project.supabase.co', key);
      assert.deepEqual(probeHeaders.at(-1), { apikey: key });
    }

    const legacyJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl';
    await probePostgrestNotesColumn('https://test-project.supabase.co', legacyJwt);
    assert.deepEqual(probeHeaders.at(-1), {
      apikey: legacyJwt,
      Authorization: `Bearer ${legacyJwt}`
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('PASS: PostgREST probe uses compatible auth headers for modern and legacy API keys.');

  assert.equal(
    sanitizeDatabaseUrl('"postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres"'),
    'postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres'
  );
  assert.equal(
    sanitizeDatabaseUrl("'postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres'"),
    'postgresql://postgres.my-test-proj:secret@aws-0.pooler.supabase.com:5432/postgres'
  );
  assert.equal(
    sanitizeDatabaseUrl('   "postgresql://postgres:secret@db.my-test-proj.supabase.co:5432/postgres"  '),
    'postgresql://postgres:secret@db.my-test-proj.supabase.co:5432/postgres'
  );
  assert.equal(sanitizeDatabaseUrl(''), '');
  assert.equal(sanitizeDatabaseUrl(null), '');

  assert.equal(
    extractProjectRefFromDatabaseUrl('postgresql://postgres.my-test-proj:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres'),
    'my-test-proj'
  );
  assert.equal(
    extractProjectRefFromDatabaseUrl('"postgresql://postgres.my-test-proj:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"'),
    'my-test-proj'
  );
  assert.equal(
    extractProjectRefFromDatabaseUrl("'postgresql://postgres.my-test-proj:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres'"),
    'my-test-proj'
  );
  assert.equal(
    extractProjectRefFromDatabaseUrl('postgresql://postgres:secret@db.my-test-proj.supabase.co:5432/postgres'),
    'my-test-proj'
  );
  assert.equal(
    extractProjectRefFromDatabaseUrl('postgresql://postgres.expected-ref:secret@unrelated-db.example.com:5432/postgres'),
    null
  );
  assert.equal(
    extractProjectRefFromDatabaseUrl('postgresql://postgres:secret@my-test-proj.pooler.supabase.com:5432/postgres'),
    null
  );
  assert.equal(
    extractProjectRefFromDatabaseUrl('postgresql://postgres:secret@127.0.0.1:5432/postgres'),
    null
  );
  assert.equal(extractProjectRefFromDatabaseUrl('not a url'), null);
  assert.equal(extractProjectRefFromDatabaseUrl(''), null);
  assert.equal(extractProjectRefFromDatabaseUrl(null), null);

  assert.throws(
    () => validateTestDatabaseTarget('', 'my-test-proj'),
    /Test database connection string is missing/
  );
  assert.throws(
    () => validateTestDatabaseTarget('invalid url', 'my-test-proj'),
    /Test database connection string is invalid/
  );
  assert.throws(
    () => validateTestDatabaseTarget('http://localhost:5432/postgres', 'my-test-proj'),
    /must use postgresql: protocol/
  );
  assert.throws(
    () => validateTestDatabaseTarget('postgresql://postgres:pass@127.0.0.1:5432/postgres', 'my-test-proj'),
    /hosted test database must not target localhost/
  );
  assert.throws(
    () => validateTestDatabaseTarget('postgresql://postgres.my-test-proj:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres', ''),
    /expected test-project reference must be explicitly configured/
  );
  assert.throws(
    () => validateTestDatabaseTarget('postgresql://postgres:pass@some-other-host.com:5432/postgres', 'my-test-proj'),
    /unable to extract Supabase project reference/
  );
  assert.throws(
    () => validateTestDatabaseTarget('postgresql://postgres.other-proj:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres', 'my-test-proj'),
    /expected project reference 'my-test-proj' does not match database URL project reference 'other-proj'/
  );
  assert.throws(
    () => validateTestDatabaseTarget('postgresql://postgres.gtbwblxskctpsqhbpebg:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres', 'gtbwblxskctpsqhbpebg'),
    /refuses to target the primary linked production project/
  );
  assert.throws(
    () => validateTestDatabaseTarget('postgresql://postgres:pass@db.gtbwblxskctpsqhbpebg.supabase.co:5432/postgres', 'gtbwblxskctpsqhbpebg'),
    /refuses to target the primary linked production project/
  );

  assert.doesNotThrow(() => {
    validateTestDatabaseTarget(
      'postgresql://postgres.my-test-proj:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
      'my-test-proj'
    );
  });
  assert.doesNotThrow(() => {
    validateTestDatabaseTarget(
      'postgresql://postgres:pass@db.my-test-proj.supabase.co:5432/postgres',
      'my-test-proj'
    );
  });
  assert.doesNotThrow(() => {
    validateTestDatabaseTarget(
      '"postgresql://postgres.my-test-proj:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres"',
      'my-test-proj'
    );
  });
  assert.doesNotThrow(() => {
    validateTestDatabaseTarget(
      "'postgresql://postgres:pass@db.my-test-proj.supabase.co:5432/postgres'",
      'my-test-proj'
    );
  });

  assert.equal(
    extractProjectRefFromSupabaseUrl('https://gtbwblxskctpsqhbpebg.supabase.co'),
    'gtbwblxskctpsqhbpebg'
  );
  assert.equal(
    extractProjectRefFromSupabaseUrl('https://expected-ref.supabase.attacker.example'),
    null
  );
  assert.equal(extractProjectRefFromSupabaseUrl('not-a-url'), null);
  assert.equal(extractProjectRefFromSupabaseUrl(''), null);
  assert.equal(extractProjectRefFromSupabaseUrl(null), null);

  assert.doesNotThrow(() => {
    validateDatabaseTarget(
      'postgresql://postgres.gtbwblxskctpsqhbpebg:pass@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
      'gtbwblxskctpsqhbpebg',
      'https://gtbwblxskctpsqhbpebg.supabase.co'
    );
  });
  assert.doesNotThrow(() => {
    validateDatabaseTarget(
      '"postgresql://postgres.gtbwblxskctpsqhbpebg:pass@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres"',
      'gtbwblxskctpsqhbpebg',
      'https://gtbwblxskctpsqhbpebg.supabase.co'
    );
  });
  assert.doesNotThrow(() => {
    validateDatabaseTarget(
      "'postgresql://postgres.gtbwblxskctpsqhbpebg:pass@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres'",
      'gtbwblxskctpsqhbpebg',
      null
    );
  });
  assert.doesNotThrow(() => {
    validateDatabaseTarget('postgresql://postgres:pass@localhost:5432/postgres', null, null);
  });
  assert.doesNotThrow(() => {
    validateDatabaseTarget('postgresql://postgres:pass@127.0.0.1:5432/postgres', '', '');
  });
  assert.throws(
    () => validateDatabaseTarget('postgresql://postgres:pass@remote.example.com:5432/postgres', null, null),
    /remote database requires RLS_EXPECTED_PROJECT_REF or a Supabase project URL/
  );

  assert.throws(
    () => validateDatabaseTarget('', 'gtbwblxskctpsqhbpebg', null),
    /Database connection string is missing/
  );
  assert.throws(
    () => validateDatabaseTarget('http://localhost:5432/postgres', null, null),
    /must use postgresql: protocol/
  );
  assert.throws(
    () => validateDatabaseTarget(
      'postgresql://postgres.gtbwblxskctpsqhbpebg:pass@aws-0.pooler.supabase.com:5432/postgres',
      'other-ref',
      'https://gtbwblxskctpsqhbpebg.supabase.co'
    ),
    /RLS_EXPECTED_PROJECT_REF 'other-ref' does not match SUPABASE_URL project reference 'gtbwblxskctpsqhbpebg'/
  );
  assert.throws(
    () => validateDatabaseTarget(
      'postgresql://postgres.other-ref:pass@aws-0.pooler.supabase.com:5432/postgres',
      'gtbwblxskctpsqhbpebg',
      null
    ),
    /expected project reference 'gtbwblxskctpsqhbpebg' does not match database URL project reference 'other-ref'/
  );
  assert.throws(
    () => validateDatabaseTarget(
      'postgresql://postgres:pass@127.0.0.1:5432/postgres',
      'gtbwblxskctpsqhbpebg',
      null
    ),
    /cannot target localhost when expected project reference 'gtbwblxskctpsqhbpebg' is configured/
  );

  const envNotOptedIn = () => undefined;
  const cfgNotOptedIn = resolveTestDatabaseConfiguration(envNotOptedIn);
  assert.equal(cfgNotOptedIn.shouldRun, false);

  const envBe06Incomplete = (k) => {
    const map = {
      RUN_BE06_RLS_INTEGRATION: 'true',
      BE06_RLS_TEST_SUPABASE_URL: 'https://be06-test.supabase.co'
    };
    return map[k];
  };
  const cfgBe06Incomplete = resolveTestDatabaseConfiguration(envBe06Incomplete);
  assert.equal(cfgBe06Incomplete.shouldRun, true);
  assert.equal(cfgBe06Incomplete.source, 'BE-06');
  assert.ok(cfgBe06Incomplete.error.includes('BE06_RLS_TEST_EXPECTED_PROJECT_REF'));

  const envBe06Complete = (k) => {
    const map = {
      RUN_BE06_RLS_INTEGRATION: 'true',
      BE06_RLS_TEST_SUPABASE_URL: 'https://be06-test.supabase.co',
      BE06_RLS_TEST_EXPECTED_PROJECT_REF: 'be06-test',
      BE06_RLS_TEST_DATABASE_URL: 'postgresql://postgres.be06-test:pass@aws-0.pooler.supabase.com:5432/postgres'
    };
    return map[k];
  };
  const cfgBe06Complete = resolveTestDatabaseConfiguration(envBe06Complete);
  assert.equal(cfgBe06Complete.shouldRun, true);
  assert.equal(cfgBe06Complete.source, 'BE-06');
  assert.equal(cfgBe06Complete.error, undefined);
  assert.equal(cfgBe06Complete.expectedProjectRef, 'be06-test');

  const envNonProdIncomplete = (k) => {
    const map = {
      RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: 'true',
      NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: 'https://non-prod-test.supabase.co'
    };
    return map[k];
  };
  const cfgNonProdIncomplete = resolveTestDatabaseConfiguration(envNonProdIncomplete);
  assert.equal(cfgNonProdIncomplete.shouldRun, true);
  assert.equal(cfgNonProdIncomplete.source, 'NON_PRODUCTION_TEST_DATABASE');
  assert.ok(cfgNonProdIncomplete.error.includes('NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF'));

  const envNonProdComplete = (k) => {
    const map = {
      RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION: 'true',
      NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: 'https://non-prod-test.supabase.co',
      NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF: 'non-prod-test',
      NON_PRODUCTION_TEST_DATABASE_URL: 'postgresql://postgres.non-prod-test:pass@aws-0.pooler.supabase.com:5432/postgres'
    };
    return map[k];
  };
  const cfgNonProdComplete = resolveTestDatabaseConfiguration(envNonProdComplete);
  assert.equal(cfgNonProdComplete.shouldRun, true);
  assert.equal(cfgNonProdComplete.source, 'NON_PRODUCTION_TEST_DATABASE');
  assert.equal(cfgNonProdComplete.error, undefined);
  assert.equal(cfgNonProdComplete.expectedProjectRef, 'non-prod-test');

  const mockMetaClient = {
    query: async (_sql, params) => {
      if (params && params[1] === 'notes') {
        return { rows: [{ column_name: 'notes', udt_name: 'text', is_nullable: 'YES' }] };
      }
      return { rows: [] };
    }
  };
  const metaFound = await verifyColumnMetadata(mockMetaClient, 'recipes', 'notes');
  assert.equal(metaFound.exists, true);
  assert.equal(metaFound.udtName, 'text');
  assert.equal(metaFound.isNullable, true);

  const metaMissing = await verifyColumnMetadata(mockMetaClient, 'recipes', 'missing_col');
  assert.equal(metaMissing.exists, false);
  assert.equal(metaMissing.udtName, null);
  assert.equal(metaMissing.isNullable, null);

  let notifiedSql = null;
  const mockNotifyClient = {
    query: async (sql) => {
      notifiedSql = sql;
      return { rows: [] };
    }
  };
  await reloadPostgrestSchemaCache(mockNotifyClient);
  assert.equal(notifiedSql, "NOTIFY pgrst, 'reload schema';");

  const skipResult = await runTestDatabaseMigrations({
    getEnv: () => undefined
  });
  assert.equal(skipResult.skipped, true);

  console.log('PASS: Test database target extraction, validation, and preflight configuration verified.');
}


async function runForeignKeyCascadeUnitTests() {
  const validCascadeRows = [
    {
      conname: 'recipe_lineage_parent_recipe_id_fkey',
      contype: 'f',
      confdeltype: 'c',
      convalidated: true,
      conkey_len: 1,
      confkey_len: 1,
      src_schema: 'public',
      src_table: 'recipe_lineage',
      src_column: 'parent_recipe_id',
      ref_schema: 'public',
      ref_table: 'recipes',
      ref_column: 'id'
    }
  ];

  // 1. Success on valid ON DELETE CASCADE foreign key
  const validResult = evaluateForeignKeyCascade(validCascadeRows);
  assert.equal(validResult.valid, true);
  assert.equal(validResult.deleteAction, 'CASCADE');
  assert.equal(validResult.validated, true);
  assert.equal(validResult.constraintName, 'recipe_lineage_parent_recipe_id_fkey');

  // 2. Success with non-standard constraint name (proves relationship is identified by tables and columns, not hardcoded name)
  const customNameRows = [
    {
      ...validCascadeRows[0],
      conname: 'custom_lineage_parent_fk'
    }
  ];
  const customResult = evaluateForeignKeyCascade(customNameRows);
  assert.equal(customResult.valid, true);
  assert.equal(customResult.constraintName, 'custom_lineage_parent_fk');

  // 3. Fails when constraint is absent
  assert.throws(
    () => evaluateForeignKeyCascade([]),
    /Catalog verification failed: Foreign key constraint on public\.recipe_lineage\(parent_recipe_id\) referencing public\.recipes\(id\) is missing from pg_constraint\./
  );

  // 4. Fails when referencing column is wrong
  const wrongSourceColRows = [
    {
      ...validCascadeRows[0],
      src_column: 'child_recipe_id'
    }
  ];
  assert.throws(
    () => evaluateForeignKeyCascade(wrongSourceColRows),
    /Catalog verification failed: Foreign key constraint on public\.recipe_lineage\(parent_recipe_id\) referencing public\.recipes\(id\) is missing from pg_constraint\./
  );

  // 5. Fails when referenced table or column is wrong
  const wrongTargetRows = [
    {
      ...validCascadeRows[0],
      ref_table: 'profiles',
      ref_column: 'id'
    }
  ];
  assert.throws(
    () => evaluateForeignKeyCascade(wrongTargetRows),
    /Foreign key on public\.recipe_lineage\(parent_recipe_id\) references unexpected target: expected public\.recipes\(id\), found public\.profiles\(id\)\./
  );

  // 6. Fails when delete action is not CASCADE ('a' NO ACTION, 'r' RESTRICT, 'n' SET NULL, 'd' SET DEFAULT)
  for (const [actionCode, actionName] of [['a', 'NO ACTION'], ['r', 'RESTRICT'], ['n', 'SET NULL'], ['d', 'SET DEFAULT']]) {
    const wrongActionRows = [
      {
        ...validCascadeRows[0],
        confdeltype: actionCode
      }
    ];
    assert.throws(
      () => evaluateForeignKeyCascade(wrongActionRows),
      new RegExp(`does not specify ON DELETE CASCADE: delete action is '${actionCode}' \\(${actionName}\\)`)
    );
  }

  // 7. Fails when constraint is not validated (convalidated is false)
  const unvalidatedRows = [
    {
      ...validCascadeRows[0],
      convalidated: false
    }
  ];
  assert.throws(
    () => evaluateForeignKeyCascade(unvalidatedRows),
    /Foreign key constraint 'recipe_lineage_parent_recipe_id_fkey' on public\.recipe_lineage\(parent_recipe_id\) is not validated \(convalidated is false\)\./
  );

  // 8. verifyForeignKeyCascadeConstraint helper delegates to query and evaluates
  const mockClientSuccess = {
    query: async () => ({ rows: validCascadeRows })
  };
  const helperResult = await verifyForeignKeyCascadeConstraint(mockClientSuccess);
  assert.equal(helperResult.valid, true);

  const mockClientMissing = {
    query: async () => ({ rows: [] })
  };
  await assert.rejects(
    async () => {
      await verifyForeignKeyCascadeConstraint(mockClientMissing);
    },
    /Catalog verification failed: Foreign key constraint on public\.recipe_lineage\(parent_recipe_id\) referencing public\.recipes\(id\) is missing from pg_constraint\./
  );

  
  // Child-recipe foreign key unit regression tests:
  const validChildCascadeRows = [
    {
      conname: 'recipe_lineage_child_recipe_id_fkey',
      contype: 'f',
      confdeltype: 'c',
      convalidated: true,
      conkey_len: 1,
      confkey_len: 1,
      src_schema: 'public',
      src_table: 'recipe_lineage',
      src_column: 'child_recipe_id',
      ref_schema: 'public',
      ref_table: 'recipes',
      ref_column: 'id'
    }
  ];

  // 9. Success on valid child foreign key with ON DELETE CASCADE
  const validChildResult = evaluateForeignKeyCascade(validChildCascadeRows, {
    sourceColumn: 'child_recipe_id'
  });
  assert.equal(validChildResult.valid, true);
  assert.equal(validChildResult.deleteAction, 'CASCADE');
  assert.equal(validChildResult.validated, true);
  assert.equal(validChildResult.constraintName, 'recipe_lineage_child_recipe_id_fkey');
  assert.equal(validChildResult.source, 'public.recipe_lineage(child_recipe_id)');
  assert.equal(validChildResult.target, 'public.recipes(id)');

  // 10. Success on child foreign key with non-standard constraint name
  const customChildNameRows = [
    {
      ...validChildCascadeRows[0],
      conname: 'custom_lineage_child_fk'
    }
  ];
  const customChildResult = evaluateForeignKeyCascade(customChildNameRows, {
    sourceColumn: 'child_recipe_id'
  });
  assert.equal(customChildResult.valid, true);
  assert.equal(customChildResult.constraintName, 'custom_lineage_child_fk');

  // 11. Child foreign key evaluation fails when constraint is absent
  assert.throws(
    () => evaluateForeignKeyCascade([], { sourceColumn: 'child_recipe_id' }),
    /Catalog verification failed: Foreign key constraint on public\.recipe_lineage\(child_recipe_id\) referencing public\.recipes\(id\) is missing from pg_constraint\./
  );
  assert.throws(
    () => evaluateForeignKeyCascade(validCascadeRows, { sourceColumn: 'child_recipe_id' }),
    /Catalog verification failed: Foreign key constraint on public\.recipe_lineage\(child_recipe_id\) referencing public\.recipes\(id\) is missing from pg_constraint\./
  );

  // 12. Child foreign key evaluation fails when referenced target table or column is wrong
  const wrongChildTargetRows = [
    {
      ...validChildCascadeRows[0],
      ref_table: 'profiles',
      ref_column: 'id'
    }
  ];
  assert.throws(
    () => evaluateForeignKeyCascade(wrongChildTargetRows, { sourceColumn: 'child_recipe_id' }),
    /Foreign key on public\.recipe_lineage\(child_recipe_id\) references unexpected target: expected public\.recipes\(id\), found public\.profiles\(id\)\./
  );

  // 13. Child foreign key evaluation fails when delete action is not CASCADE
  for (const [actionCode, actionName] of [['a', 'NO ACTION'], ['r', 'RESTRICT'], ['n', 'SET NULL'], ['d', 'SET DEFAULT']]) {
    const wrongChildActionRows = [
      {
        ...validChildCascadeRows[0],
        confdeltype: actionCode
      }
    ];
    assert.throws(
      () => evaluateForeignKeyCascade(wrongChildActionRows, { sourceColumn: 'child_recipe_id' }),
      new RegExp(`does not specify ON DELETE CASCADE: delete action is '${actionCode}' \\(${actionName}\\)`)
    );
  }

  // 14. Child foreign key evaluation fails when constraint is not validated
  const unvalidatedChildRows = [
    {
      ...validChildCascadeRows[0],
      convalidated: false
    }
  ];
  assert.throws(
    () => evaluateForeignKeyCascade(unvalidatedChildRows, { sourceColumn: 'child_recipe_id' }),
    /Foreign key constraint 'recipe_lineage_child_recipe_id_fkey' on public\.recipe_lineage\(child_recipe_id\) is not validated \(convalidated is false\)\./
  );

  // 15. verifyForeignKeyCascadeConstraint propagates sourceColumn: 'child_recipe_id'
  const mockClientBoth = {
    query: async () => ({ rows: [...validCascadeRows, ...validChildCascadeRows] })
  };
  const childHelperResult = await verifyForeignKeyCascadeConstraint(mockClientBoth, {
    sourceColumn: 'child_recipe_id'
  });
  assert.equal(childHelperResult.valid, true);
  assert.equal(childHelperResult.source, 'public.recipe_lineage(child_recipe_id)');
  assert.equal(childHelperResult.deleteAction, 'CASCADE');

  const mockClientMissingChild = {
    query: async () => ({ rows: validCascadeRows })
  };
  await assert.rejects(
    async () => {
      await verifyForeignKeyCascadeConstraint(mockClientMissingChild, {
        sourceColumn: 'child_recipe_id'
      });
    },
    /Catalog verification failed: Foreign key constraint on public\.recipe_lineage\(child_recipe_id\) referencing public\.recipes\(id\) is missing from pg_constraint\./
  );

  console.log('PASS: Database catalog foreign key cascade verification unit tests passed.');
}

async function main() {
  console.log('Starting migration runner test suite...');
  runDiscoveryAndIntegrityUnitTests();
  await runRecipeSearchMigrationUnitTests();
  await runSchemaVerificationUnitTests();
  await runForeignKeyCascadeUnitTests();
  await runTestTargetMigrationUnitTests();
  runMigrationOptInUnitTests();
  await runDatabaseLifecycleIntegrationTests();
  console.log('ALL MIGRATION RUNNER TESTS COMPLETED SUCCESSFULLY.');
}

main().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
