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
  runTestDatabaseMigrations
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

  console.log('PASS: Schema completeness verification and unit assertions verified.');
}

async function runDatabaseLifecycleIntegrationTests() {
  const hasOptIn = process.argv.includes('--run-db-tests') || process.env.RUN_MIGRATION_DB_TESTS === 'true';
  const isCI = process.env.CI === 'true';

  if (isCI && !hasOptIn) {
    throw new Error('CI failure: Database lifecycle integration tests must not be skipped in CI. Ensure --run-db-tests or RUN_MIGRATION_DB_TESTS=true is enabled.');
  }

  if (!hasOptIn) {
    console.log('INFO: Database lifecycle integration tests skipped. Use --run-db-tests or RUN_MIGRATION_DB_TESTS=true to enable.');
    return;
  }

  if (isCI && !process.env.DATABASE_URL) {
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
    assert.deepEqual(freshResult.appliedVersions.sort(), [...expectedMigrationVersions].sort());

    const historyRows = await testClient.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
    assert.deepEqual(historyRows.rows.map((r) => r.version), expectedMigrationVersions);

    const notesCol = await testClient.query("SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'notes';");
    assert.equal(notesCol.rows.length, 1);
    assert.equal(notesCol.rows[0].udt_name, 'text');
    assert.equal(notesCol.rows[0].is_nullable, 'YES');

    const demoRow1 = await testClient.query('SELECT is_public FROM public.recipes WHERE id = \'11111111-1111-1111-1111-111111111111\';');
    assert.equal(demoRow1.rows[0].is_public, true);
    scenariosExecuted++;
    scenariosPassed++;
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

  const envBe04Incomplete = (k) => {
    const map = {
      RUN_BE04_RLS_INTEGRATION: 'true',
      BE04_RLS_TEST_SUPABASE_URL: 'https://be04-test.supabase.co'
    };
    return map[k];
  };
  const cfgBe04Incomplete = resolveTestDatabaseConfiguration(envBe04Incomplete);
  assert.equal(cfgBe04Incomplete.shouldRun, true);
  assert.equal(cfgBe04Incomplete.source, 'BE-04');
  assert.ok(cfgBe04Incomplete.error.includes('BE04_RLS_TEST_EXPECTED_PROJECT_REF'));

  const envBe04Complete = (k) => {
    const map = {
      RUN_BE04_RLS_INTEGRATION: 'true',
      BE04_RLS_TEST_SUPABASE_URL: 'https://be04-test.supabase.co',
      BE04_RLS_TEST_EXPECTED_PROJECT_REF: 'be04-test',
      BE04_RLS_TEST_DATABASE_URL: 'postgresql://postgres.be04-test:pass@aws-0.pooler.supabase.com:5432/postgres'
    };
    return map[k];
  };
  const cfgBe04Complete = resolveTestDatabaseConfiguration(envBe04Complete);
  assert.equal(cfgBe04Complete.shouldRun, true);
  assert.equal(cfgBe04Complete.source, 'BE-04');
  assert.equal(cfgBe04Complete.error, undefined);
  assert.equal(cfgBe04Complete.expectedProjectRef, 'be04-test');

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

async function main() {
  console.log('Starting migration runner test suite...');
  runDiscoveryAndIntegrityUnitTests();
  await runSchemaVerificationUnitTests();
  await runTestTargetMigrationUnitTests();
  await runDatabaseLifecycleIntegrationTests();
  console.log('ALL MIGRATION RUNNER TESTS COMPLETED SUCCESSFULLY.');
}

main().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
