import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_LOCK_ID = 847291847;
const INITIAL_SCHEMA_VERSION = '20261013000000';
const IS_PUBLIC_MIGRATION_VERSION = '20261017000001';
const NOTES_MIGRATION_VERSION = '20261023000002';

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

export function tokenizeSql(sql) {
  if (!sql || typeof sql !== 'string') return [];
  const tokens = [];
  let i = 0;
  const s = sql.trim();
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ type: ch, value: ch });
      i++;
      continue;
    }
    if (ch === '=' || ch === '<' || ch === '>' || ch === '!') {
      let op = ch;
      if (s[i + 1] === '=' || s[i + 1] === '>') {
        op += s[i + 1];
        i += 2;
      } else {
        i++;
      }
      tokens.push({ type: 'OP', value: op });
      continue;
    }
    if (ch === "'") {
      let str = "'";
      i++;
      while (i < s.length && s[i] !== "'") {
        str += s[i];
        i++;
      }
      if (i < s.length && s[i] === "'") {
        str += "'";
        i++;
      }
      tokens.push({ type: 'STRING', value: str });
      continue;
    }
    if (/\d/.test(ch)) {
      let num = '';
      while (i < s.length && /\d/.test(s[i])) {
        num += s[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < s.length && /[a-zA-Z0-9_.]/.test(s[i])) {
        ident += s[i];
        i++;
      }
      tokens.push({ type: 'IDENT', value: ident.toLowerCase() });
      continue;
    }
    tokens.push({ type: 'UNKNOWN', value: ch });
    i++;
  }
  return tokens;
}

export class SqlExpressionParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek() {
    return this.tokens[this.pos] || null;
  }
  consume(type, value) {
    const tok = this.peek();
    if (!tok) return null;
    if (type && tok.type !== type) return null;
    if (value && tok.value !== value.toLowerCase()) return null;
    this.pos++;
    return tok;
  }
  parse() {
    const expr = this.parseOr();
    if (this.pos < this.tokens.length) {
      return null;
    }
    return expr;
  }
  parseOr() {
    let left = this.parseAnd();
    if (!left) return null;
    while (this.peek() && this.peek().type === 'IDENT' && this.peek().value === 'or') {
      this.consume('IDENT', 'or');
      const right = this.parseAnd();
      if (!right) return null;
      left = { type: 'binary', op: 'OR', left, right };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseUnary();
    if (!left) return null;
    while (this.peek() && this.peek().type === 'IDENT' && this.peek().value === 'and') {
      this.consume('IDENT', 'and');
      const right = this.parseUnary();
      if (!right) return null;
      left = { type: 'binary', op: 'AND', left, right };
    }
    return left;
  }
  parseUnary() {
    if (this.peek() && this.peek().type === 'IDENT' && this.peek().value === 'not') {
      this.consume('IDENT', 'not');
      const expr = this.parseUnary();
      if (!expr) return null;
      return { type: 'unary', op: 'NOT', expr };
    }
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parsePrimary();
    if (!left) return null;
    const tok = this.peek();
    if (tok && tok.type === 'OP') {
      this.consume('OP');
      const right = this.parsePrimary();
      if (!right) return null;
      return { type: 'binary', op: tok.value, left, right };
    }
    if (tok && tok.type === 'IDENT' && tok.value === 'is') {
      this.consume('IDENT', 'is');
      let not = false;
      if (this.peek() && this.peek().type === 'IDENT' && this.peek().value === 'not') {
        this.consume('IDENT', 'not');
        not = true;
      }
      if (this.peek() && this.peek().type === 'IDENT' && this.peek().value === 'null') {
        this.consume('IDENT', 'null');
        return { type: 'is_null', not, expr: left };
      }
      return null;
    }
    return left;
  }
  parsePrimary() {
    const tok = this.peek();
    if (!tok) return null;
    if (tok.type === '(') {
      this.consume('(');
      const expr = this.parseOr();
      if (!expr || !this.consume(')')) return null;
      return expr;
    }
    if (tok.type === 'IDENT' && tok.value === 'exists') {
      this.consume('IDENT', 'exists');
      if (!this.consume('(')) return null;
      if (!this.consume('IDENT', 'select')) return null;
      if (!this.consume('NUMBER', '1')) return null;
      if (!this.consume('IDENT', 'from')) return null;
      const fromTok = this.consume('IDENT');
      if (!fromTok) return null;
      if (!this.consume('IDENT', 'where')) return null;
      const whereExpr = this.parseOr();
      if (!whereExpr) return null;
      if (!this.consume(')')) return null;
      const fromTable = fromTok.value.replace(/^public\./, '');
      return { type: 'exists', from: fromTable, where: whereExpr };
    }
    if (tok.type === 'IDENT') {
      this.consume('IDENT');
      const name = tok.value.replace(/^public\./, '');
      if (this.peek() && this.peek().type === '(') {
        this.consume('(');
        while (this.peek() && this.peek().type !== ')') {
          const argumentStart = this.pos;
          if (!this.parseOr() || this.pos === argumentStart) return null;
          if (this.peek() && this.peek().type === ',') this.consume(',');
        }
        if (!this.consume(')')) return null;
        return { type: 'call', name };
      }
      return { type: 'ident', name };
    }
    if (tok.type === 'NUMBER') {
      this.consume('NUMBER');
      return { type: 'number', value: tok.value };
    }
    if (tok.type === 'STRING') {
      this.consume('STRING');
      return { type: 'string', value: tok.value };
    }
    return null;
  }
}

export function parseAst(sql) {
  if (!sql || typeof sql !== 'string') return null;
  const tokens = tokenizeSql(sql);
  const parser = new SqlExpressionParser(tokens);
  return parser.parse();
}

function isAuthUidCall(node) {
  return Boolean(node && node.type === 'call' && node.name === 'auth.uid');
}

function isColumnRef(node, colName, tableName) {
  if (!node || node.type !== 'ident') return false;
  if (node.name === colName) return true;
  if (tableName && (node.name === `${tableName}.${colName}` || node.name === `public.${tableName}.${colName}`)) return true;
  return false;
}

export function verifyOwnerEqualityPredicate(expr, ownerCol, tableName = null) {
  const ast = parseAst(expr);
  if (!ast) return false;
  if (ast.type !== 'binary' || ast.op !== '=') return false;
  return (
    (isAuthUidCall(ast.left) && isColumnRef(ast.right, ownerCol, tableName)) ||
    (isColumnRef(ast.left, ownerCol, tableName) && isAuthUidCall(ast.right))
  );
}

function matchLineageExists(subqueryNode, expectedRecipeCol) {
  if (!subqueryNode || subqueryNode.type !== 'exists') return false;
  if (subqueryNode.from !== 'recipes') return false;
  const where = subqueryNode.where;
  if (!where || where.type !== 'binary' || where.op !== 'AND') return false;

  const matchIdEquality = (node) => {
    if (!node || node.type !== 'binary' || node.op !== '=') return false;
    const isId = (n) => isColumnRef(n, 'id', 'recipes');
    const isLineageRef = (n) =>
      n &&
      n.type === 'ident' &&
      (n.name === expectedRecipeCol ||
        n.name === `recipe_lineage.${expectedRecipeCol}` ||
        n.name === `public.recipe_lineage.${expectedRecipeCol}`);
    return (isId(node.left) && isLineageRef(node.right)) || (isLineageRef(node.left) && isId(node.right));
  };

  const matchUserEquality = (node) => {
    if (!node || node.type !== 'binary' || node.op !== '=') return false;
    const isUser = (n) => isColumnRef(n, 'user_id', 'recipes');
    return (isUser(node.left) && isAuthUidCall(node.right)) || (isAuthUidCall(node.left) && isUser(node.right));
  };

  return (
    (matchIdEquality(where.left) && matchUserEquality(where.right)) ||
    (matchUserEquality(where.left) && matchIdEquality(where.right))
  );
}

export function verifyLineageParentPredicate(expr) {
  const ast = parseAst(expr);
  if (!ast) return false;
  return matchLineageExists(ast, 'parent_recipe_id');
}

export function verifyLineageInsertPredicate(expr) {
  const ast = parseAst(expr);
  if (!ast) return false;
  if (ast.type !== 'binary' || ast.op !== 'AND') return false;
  return (
    (matchLineageExists(ast.left, 'parent_recipe_id') && matchLineageExists(ast.right, 'child_recipe_id')) ||
    (matchLineageExists(ast.left, 'child_recipe_id') && matchLineageExists(ast.right, 'parent_recipe_id'))
  );
}

const EXPECTED_INITIAL_POLICIES = [
  {
    table: 'profiles',
    name: 'profiles_select_own',
    cmd: 'SELECT',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'owner_equality',
    ownerCol: 'id',
    withCheckKind: null
  },
  {
    table: 'profiles',
    name: 'profiles_update_own',
    cmd: 'UPDATE',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'owner_equality',
    ownerCol: 'id',
    withCheckKind: 'owner_equality'
  },
  {
    table: 'recipes',
    name: 'recipes_select_own',
    cmd: 'SELECT',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'owner_equality',
    ownerCol: 'user_id',
    withCheckKind: null
  },
  {
    table: 'recipes',
    name: 'recipes_insert_own',
    cmd: 'INSERT',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: null,
    ownerCol: 'user_id',
    withCheckKind: 'owner_equality'
  },
  {
    table: 'recipes',
    name: 'recipes_update_own',
    cmd: 'UPDATE',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'owner_equality',
    ownerCol: 'user_id',
    withCheckKind: 'owner_equality'
  },
  {
    table: 'recipes',
    name: 'recipes_delete_own',
    cmd: 'DELETE',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'owner_equality',
    ownerCol: 'user_id',
    withCheckKind: null
  },
  {
    table: 'recipe_lineage',
    name: 'lineage_select_own',
    cmd: 'SELECT',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'lineage_parent',
    ownerCol: null,
    withCheckKind: null
  },
  {
    table: 'recipe_lineage',
    name: 'lineage_insert_own',
    cmd: 'INSERT',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: null,
    ownerCol: null,
    withCheckKind: 'lineage_insert'
  },
  {
    table: 'recipe_lineage',
    name: 'lineage_delete_own',
    cmd: 'DELETE',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'lineage_parent',
    ownerCol: null,
    withCheckKind: null
  },
  {
    table: 'ai_usage_daily',
    name: 'ai_usage_select_own',
    cmd: 'SELECT',
    permissive: 'PERMISSIVE',
    roles: ['public'],
    qualKind: 'owner_equality',
    ownerCol: 'user_id',
    withCheckKind: null
  }
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

  const rlsQuery = await client.query(`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[]);
  `, [EXPECTED_INITIAL_TABLES]);

  const rlsStatus = new Map(rlsQuery.rows.map((r) => [r.relname, r.relrowsecurity]));

  for (const table of EXPECTED_INITIAL_TABLES) {
    if (!existingTables.has(table)) {
      continue;
    }
    const isEnabled = rlsStatus.get(table);
    if (!isEnabled) {
      errors.push(`Row level security (RLS) is disabled on table public.${table}`);
    }
  }

  const polQuery = await client.query(`
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY($1::text[]);
  `, [EXPECTED_INITIAL_TABLES]);

  const actualPolicies = new Map();
  for (const pol of polQuery.rows) {
    const key = `${pol.tablename}.${pol.policyname}`;
    actualPolicies.set(key, pol);
  }

  const expectedPolicyKeys = new Set();
  for (const expected of EXPECTED_INITIAL_POLICIES) {
    const key = `${expected.table}.${expected.name}`;
    expectedPolicyKeys.add(key);
    const actual = actualPolicies.get(key);
    if (!actual) {
      errors.push(`Missing required policy ${expected.name} on public.${expected.table}`);
      continue;
    }

    if (actual.cmd !== expected.cmd) {
      errors.push(`Policy ${expected.name} command mismatch: expected ${expected.cmd}, found ${actual.cmd}`);
    }

    if (actual.permissive !== expected.permissive) {
      errors.push(`Policy ${expected.name} permissive mode mismatch: expected ${expected.permissive}, found ${actual.permissive}`);
    }

    if (expected.roles && Array.isArray(expected.roles)) {
      const normalizeRoles = (val) => {
        if (Array.isArray(val)) {
          return val.map((r) => String(r).replace(/[{}]/g, '').trim()).filter(Boolean);
        }
        if (typeof val === 'string') {
          return val.replace(/[{}]/g, '').split(',').map((r) => r.trim()).filter(Boolean);
        }
        return [];
      };
      const actualRoles = normalizeRoles(actual.roles);
      const expectedSorted = [...expected.roles].map((r) => r.trim()).sort();
      const actualSorted = [...actualRoles].sort();
      if (expectedSorted.length !== actualSorted.length || !expectedSorted.every((r, idx) => r === actualSorted[idx])) {
        errors.push(`Policy ${expected.name} roles mismatch: expected [${expectedSorted.join(', ')}], found [${actualSorted.join(', ')}]`);
      }
    }

    if (expected.qualKind === 'owner_equality') {
      if (!actual.qual) {
        errors.push(`Policy ${expected.name} missing required USING clause`);
      } else if (!verifyOwnerEqualityPredicate(actual.qual, expected.ownerCol, expected.table)) {
        errors.push(`Policy ${expected.name} USING predicate does not strictly enforce owner authorization boundary (${expected.ownerCol} = auth.uid())`);
      }
    } else if (expected.qualKind === 'lineage_parent') {
      if (!actual.qual) {
        errors.push(`Policy ${expected.name} missing required USING clause`);
      } else if (!verifyLineageParentPredicate(actual.qual)) {
        errors.push(`Policy ${expected.name} USING predicate does not strictly enforce parent recipe owner authorization boundary`);
      }
    } else if (expected.qualKind === null && actual.qual) {
      errors.push(`Policy ${expected.name} unexpectedly defines a USING clause`);
    }

    if (expected.withCheckKind === 'owner_equality') {
      if (!actual.with_check) {
        errors.push(`Policy ${expected.name} missing required WITH CHECK clause`);
      } else if (!verifyOwnerEqualityPredicate(actual.with_check, expected.ownerCol, expected.table)) {
        errors.push(`Policy ${expected.name} WITH CHECK predicate does not strictly enforce owner authorization boundary (${expected.ownerCol} = auth.uid())`);
      }
    } else if (expected.withCheckKind === 'lineage_insert') {
      if (!actual.with_check) {
        errors.push(`Policy ${expected.name} missing required WITH CHECK clause`);
      } else if (!verifyLineageInsertPredicate(actual.with_check)) {
        errors.push(`Policy ${expected.name} WITH CHECK predicate does not strictly enforce parent and child recipe owner authorization boundary`);
      }
    } else if (expected.withCheckKind === null && actual.with_check) {
      errors.push(`Policy ${expected.name} unexpectedly defines a WITH CHECK clause`);
    }
  }

  for (const actual of polQuery.rows) {
    const key = `${actual.tablename}.${actual.policyname}`;
    if (!expectedPolicyKeys.has(key)) {
      errors.push(`Unexpected policy ${actual.policyname} on public.${actual.tablename} may weaken row level security boundaries`);
    }
  }

  if (errors.length > 0) {
    return { status: 'incomplete', errors };
  }

  return { status: 'complete', errors: [] };
}

export async function reconcileMigrationState({
  client,
  appliedVersions,
  migrations,
  explicitReconcile = [],
  logger = console
}) {
  const discoveredVersionMap = new Map(migrations.map((m) => [m.version, m]));

  if (explicitReconcile.length > 0) {
    for (const version of explicitReconcile) {
      if (!discoveredVersionMap.has(version)) {
        throw new Error(
          `Cannot reconcile unknown migration version: ${version}. Version must match a discovered migration in supabase/migrations/.`
        );
      }

      if (version === INITIAL_SCHEMA_VERSION) {
        const verification = await verifyInitialSchemaCompleteness(client);
        if (verification.status !== 'complete') {
          throw new Error(
            `Cannot explicitly reconcile initial schema ${INITIAL_SCHEMA_VERSION}: database schema or row-level security is not complete.\n` +
            verification.errors.map((e) => `  - ${e}`).join('\n')
          );
        }
      } else if (version === IS_PUBLIC_MIGRATION_VERSION) {
        const colRes = await client.query(`
          SELECT udt_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'is_public';
        `);
        if (colRes.rows.length === 0) {
          throw new Error(
            `Cannot explicitly reconcile migration ${IS_PUBLIC_MIGRATION_VERSION}: column public.recipes.is_public does not exist.`
          );
        }
        if (colRes.rows[0].udt_name !== 'bool') {
          throw new Error(
            `Cannot explicitly reconcile migration ${IS_PUBLIC_MIGRATION_VERSION}: column public.recipes.is_public has invalid type ${colRes.rows[0].udt_name} (expected bool).`
          );
        }
      } else if (version === NOTES_MIGRATION_VERSION) {
        const notes = await verifyColumnMetadata(client, 'recipes', 'notes');
        if (!notes.exists || notes.udtName !== 'text' || notes.isNullable !== true) {
          const actual = notes.exists ? `type ${notes.udtName}, nullable=${notes.isNullable}` : 'does not exist';
          throw new Error(
            `Cannot explicitly reconcile migration ${NOTES_MIGRATION_VERSION}: column public.recipes.notes ${actual}; expected nullable text.`
          );
        }
      }

      if (!appliedVersions.has(version)) {
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING;',
          [version]
        );
        appliedVersions.add(version);
        logger.log(`INFO: Explicitly reconciled migration ${version} without executing migration SQL.`);
      }
    }
  }

  if (!appliedVersions.has(INITIAL_SCHEMA_VERSION)) {
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
      logger.log(`INFO: Reconciled initial schema migration ${INITIAL_SCHEMA_VERSION} from verified database state and authorization policies.`);
    } else {
      throw new Error(
        `Inconsistent database state: initial schema verification failed:\n` +
        verification.errors.map((e) => `  - ${e}`).join('\n') +
        `\nAborting to prevent unsafe migration execution. Recovery: inspect existing database schema and RLS policies or perform manual repair.`
      );
    }
  }

  if (!appliedVersions.has(IS_PUBLIC_MIGRATION_VERSION)) {
    const colRes = await client.query(`
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'recipes'
        AND column_name = 'is_public';
    `);

    if (colRes.rows.length > 0) {
      throw new Error(
        `Ambiguous database state for migration ${IS_PUBLIC_MIGRATION_VERSION} (add_is_public_to_recipes): ` +
        `column public.recipes.is_public already exists, but its migration history is missing. ` +
        `Automatic reconciliation cannot establish whether previous migration operations completed. ` +
        `Aborting to prevent accidental data modification. ` +
        `Recovery: run 'node run-migrations.mjs --reconcile ${IS_PUBLIC_MIGRATION_VERSION}' to explicitly record this migration without re-executing SQL.`
      );
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
  await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID});`);
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

    await reconcileMigrationState({
      client,
      appliedVersions,
      migrations,
      explicitReconcile,
      logger
    });

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
    await reloadPostgrestSchemaCache(client);

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
    try {
      let unlocked = true;
      while (unlocked) {
        const { rows } = await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID});`);
        unlocked = rows && rows[0] && rows[0].pg_advisory_unlock === true;
      }
      await client.query('SELECT pg_advisory_unlock_all();');
    } catch (_e) {}
  }
}

export async function reloadPostgrestSchemaCache(client) {
  try {
    await client.query("NOTIFY pgrst, 'reload schema';");
  } catch (_e) {}
}

export function sanitizeDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let str = url.trim();
  while (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'")) ||
    (str.startsWith('`') && str.endsWith('`'))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

export function extractProjectRefFromDatabaseUrl(connectionString) {
  const sanitized = sanitizeDatabaseUrl(connectionString);
  if (!sanitized) return null;
  try {
    const parsed = new URL(sanitized);
    const host = parsed.hostname.toLowerCase();
    const hostMatch = host.match(/^db\.([a-z0-9-]+)\.supabase\.co$/);
    if (hostMatch && hostMatch[1]) {
      return hostMatch[1];
    }
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
      const poolerUsername = parsed.username.match(/^[^.]+\.([a-z0-9-]+)$/);
      return poolerUsername?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractProjectRefFromSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase();
    return host.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isLocalSupabaseApiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
      parsed.port === '54321' &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function validateDatabaseTarget(connectionString, expectedProjectRef, supabaseUrl) {
  const sanitized = sanitizeDatabaseUrl(connectionString);
  if (!sanitized) {
    throw new Error('Database connection string is missing.');
  }
  let parsed;
  try {
    parsed = new URL(sanitized);
  } catch {
    throw new Error('Database connection string is invalid.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Database connection string must use postgresql: protocol.');
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';

  const expectedRef = (expectedProjectRef ?? '').trim();
  const expectedFromUrl = supabaseUrl ? extractProjectRefFromSupabaseUrl(supabaseUrl) : null;
  const isLocalApi = Boolean(supabaseUrl && isLocalSupabaseApiUrl(supabaseUrl));
  if (supabaseUrl && !expectedFromUrl && !isLocalApi) {
    throw new Error('Safety guard rejected Supabase URL: expected an HTTPS project URL on <project-ref>.supabase.co.');
  }
  if (isLocalApi && (!isLocal || expectedRef)) {
    throw new Error('Safety guard rejected Supabase URL: local Supabase API URLs are only allowed with an unpinned local database target.');
  }

  if (expectedRef && expectedFromUrl && expectedRef.toLowerCase() !== expectedFromUrl.toLowerCase()) {
    throw new Error(`Safety guard rejected database target: RLS_EXPECTED_PROJECT_REF '${expectedRef}' does not match SUPABASE_URL project reference '${expectedFromUrl}'.`);
  }

  const targetExpectedRef = expectedRef || expectedFromUrl;

  if (!targetExpectedRef && !isLocal) {
    throw new Error('Safety guard rejected database target: remote database requires RLS_EXPECTED_PROJECT_REF or a Supabase project URL.');
  }

  if (targetExpectedRef) {
    if (isLocal) {
      throw new Error(`Safety guard rejected database target: cannot target localhost when expected project reference '${targetExpectedRef}' is configured.`);
    }
    const extractedRef = extractProjectRefFromDatabaseUrl(sanitized);
    if (!extractedRef) {
      throw new Error('Safety guard rejected database target: unable to extract Supabase project reference from connection string.');
    }
    if (extractedRef.toLowerCase() !== targetExpectedRef.toLowerCase()) {
      throw new Error(`Safety guard rejected database target: expected project reference '${targetExpectedRef}' does not match database URL project reference '${extractedRef}'.`);
    }
  }
}

export function validateTestDatabaseTarget(connectionString, expectedProjectRef) {
  const sanitized = sanitizeDatabaseUrl(connectionString);
  if (!sanitized) {
    throw new Error('Test database connection string is missing.');
  }
  let parsed;
  try {
    parsed = new URL(sanitized);
  } catch {
    throw new Error('Test database connection string is invalid.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Test database connection string must use postgresql: protocol.');
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
  if (isLocal) {
    throw new Error('Safety guard rejected test database target: hosted test database must not target localhost/loopback.');
  }
  if (!expectedProjectRef || typeof expectedProjectRef !== 'string' || !expectedProjectRef.trim()) {
    throw new Error('Safety guard rejected test database target: expected test-project reference must be explicitly configured.');
  }
  const extractedRef = extractProjectRefFromDatabaseUrl(sanitized);
  if (!extractedRef) {
    throw new Error('Safety guard rejected test database target: unable to extract Supabase project reference from connection string.');
  }
  if (extractedRef.toLowerCase() !== expectedProjectRef.trim().toLowerCase()) {
    throw new Error(`Safety guard rejected test database target: expected project reference '${expectedProjectRef.trim()}' does not match database URL project reference '${extractedRef}'.`);
  }
  const configuredMainRef = (process.env.RLS_EXPECTED_PROJECT_REF || '').trim().toLowerCase();
  const knownProductionRef = 'gtbwblxskctpsqhbpebg';
  if (
    extractedRef.toLowerCase() === knownProductionRef ||
    (configuredMainRef && extractedRef.toLowerCase() === configuredMainRef) ||
    parsed.hostname.toLowerCase().includes(knownProductionRef) ||
    parsed.username.toLowerCase().includes(knownProductionRef) ||
    (configuredMainRef && (parsed.hostname.toLowerCase().includes(configuredMainRef) || parsed.username.toLowerCase().includes(configuredMainRef)))
  ) {
    throw new Error('Safety guard rejected test database target: refuses to target the primary linked production project (gtbwblxskctpsqhbpebg).');
  }
}

export async function verifyColumnMetadata(client, tableName, columnName) {
  const { rows } = await client.query(
    `SELECT column_name, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2;`,
    [tableName, columnName]
  );
  if (rows.length === 0) {
    return { exists: false, udtName: null, isNullable: null };
  }
  return {
    exists: true,
    udtName: rows[0].udt_name,
    isNullable: rows[0].is_nullable === 'YES'
  };
}

export async function probePostgrestNotesColumn(url, key) {
  if (!url || !key) return { ok: false, error: 'missing url or key' };
  if (!extractProjectRefFromSupabaseUrl(url) && !isLocalSupabaseApiUrl(url)) {
    return { ok: false, error: 'untrusted Supabase URL' };
  }
  try {
    const probeUrl = new URL('/rest/v1/recipes?select=notes&limit=0', url);
    const headers = { apikey: key };
    if (/^[^.]+\.[^.]+\.[^.]+$/.test(key)) {
      headers.Authorization = `Bearer ${key}`;
    }
    const res = await fetch(probeUrl.toString(), {
      headers
    });
    if (res.status === 200) {
      return { ok: true, status: 200 };
    }
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: res.status,
      code: body?.code,
      message: body?.message
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function resolveTestDatabaseConfiguration(getEnv = (k) => process.env[k]) {
  const be06OptIn = (getEnv('RUN_BE06_RLS_INTEGRATION') ?? '').trim();
  const be06Url = (getEnv('BE06_RLS_TEST_SUPABASE_URL') ?? '').trim();
  const be06DbUrl = sanitizeDatabaseUrl(getEnv('BE06_RLS_TEST_DATABASE_URL'));
  const be06ExpectedRef = (
    getEnv('BE06_RLS_TEST_EXPECTED_PROJECT_REF') ??
    getEnv('BE06_RLS_TEST_PROJECT_REF') ??
    ''
  ).trim();
  const be06ServiceKey =
    getEnv('BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY')?.trim() ||
    getEnv('BE06_RLS_TEST_SUPABASE_SECRET_KEY')?.trim() ||
    '';
  const be06AnonKey = (
    getEnv('BE06_RLS_TEST_SUPABASE_ANON_KEY') ??
    getEnv('BE06_RLS_TEST_SUPABASE_PUBLISHABLE_KEY') ??
    ''
  ).trim();

  const be04OptIn = (getEnv('RUN_BE04_RLS_INTEGRATION') ?? '').trim();
  const be04Url = (getEnv('BE04_RLS_TEST_SUPABASE_URL') ?? '').trim();
  const be04DbUrl = sanitizeDatabaseUrl(getEnv('BE04_RLS_TEST_DATABASE_URL'));
  const be04ExpectedRef = (
    getEnv('BE04_RLS_TEST_EXPECTED_PROJECT_REF') ??
    getEnv('BE04_RLS_TEST_PROJECT_REF') ??
    ''
  ).trim();
  const be04ServiceKey =
    getEnv('BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY')?.trim() ||
    getEnv('BE04_RLS_TEST_SUPABASE_SECRET_KEY')?.trim() ||
    '';
  const be04AnonKey = (
    getEnv('BE04_RLS_TEST_SUPABASE_ANON_KEY') ??
    getEnv('BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY') ??
    ''
  ).trim();

  const isBe04OptedIn = be04OptIn.toLowerCase() === 'true' || be04OptIn === '1';
  const isBe06OptedIn = be06OptIn.toLowerCase() === 'true' || be06OptIn === '1';

  const hasAnyBe06 = Boolean(
    be06OptIn || be06Url || be06DbUrl || be06ExpectedRef || be06ServiceKey || be06AnonKey
  );

  if (hasAnyBe06) {
    if (!isBe06OptedIn) {
      if (isBe04OptedIn) {
        return {
          shouldRun: true,
          source: 'BE-06',
          isOptedIn: true,
          error: 'Inconsistent test database configuration: RUN_BE04_RLS_INTEGRATION is enabled but BE-06 variables are present without RUN_BE06_RLS_INTEGRATION=true. BE-06 credentials cannot be mixed with BE-04.',
          url: be06Url,
          databaseUrl: be06DbUrl,
          expectedProjectRef: be06ExpectedRef,
          serviceKey: be06ServiceKey,
          anonKey: be06AnonKey
        };
      }
      return { shouldRun: false, source: 'BE-06', isOptedIn: false };
    }
    const missing = [];
    if (!be06Url) missing.push('BE06_RLS_TEST_SUPABASE_URL');
    if (!be06ExpectedRef) missing.push('BE06_RLS_TEST_EXPECTED_PROJECT_REF');
    if (missing.length > 0) {
      return {
        shouldRun: true,
        source: 'BE-06',
        isOptedIn: true,
        error: `BE-06 test database migration preflight enabled but configuration is incomplete: missing ${missing.join(', ')}.`,
        url: be06Url,
        databaseUrl: be06DbUrl,
        expectedProjectRef: be06ExpectedRef,
        serviceKey: be06ServiceKey,
        anonKey: be06AnonKey
      };
    }
    return {
      shouldRun: true,
      source: 'BE-06',
      isOptedIn: true,
      url: be06Url,
      databaseUrl: be06DbUrl,
      expectedProjectRef: be06ExpectedRef,
      serviceKey: be06ServiceKey,
      anonKey: be06AnonKey
    };
  }

  if (!isBe04OptedIn) {
    return { shouldRun: false, source: 'BE-04', isOptedIn: false };
  }

  const missingLegacy = [];
  if (!be04Url) missingLegacy.push('BE04_RLS_TEST_SUPABASE_URL');
  if (!be04ExpectedRef) missingLegacy.push('BE04_RLS_TEST_EXPECTED_PROJECT_REF');
  if (missingLegacy.length > 0) {
    return {
      shouldRun: true,
      source: 'BE-04',
      isOptedIn: true,
      error: `Legacy BE-04 test database migration preflight enabled but configuration is incomplete: missing ${missingLegacy.join(', ')}.`,
      url: be04Url,
      databaseUrl: be04DbUrl,
      expectedProjectRef: be04ExpectedRef,
      serviceKey: be04ServiceKey,
      anonKey: be04AnonKey
    };
  }

  return {
    shouldRun: true,
    source: 'BE-04',
    isOptedIn: true,
    url: be04Url,
    databaseUrl: be04DbUrl,
    expectedProjectRef: be04ExpectedRef,
    serviceKey: be04ServiceKey,
    anonKey: be04AnonKey
  };
}

export async function runTestDatabaseMigrations(options = {}) {
  const getEnv = options.getEnv || ((k) => process.env[k]);
  const config = options.config || resolveTestDatabaseConfiguration(getEnv);
  if (!config.shouldRun) {
    console.log('INFO: Skipping test database migration preflight (opt-in flag not set).');
    return { skipped: true };
  }
  if (config.error) {
    throw new Error(config.error);
  }

  const probeApiKey = config.serviceKey || config.anonKey;
  const cleanDbUrl = sanitizeDatabaseUrl(config.databaseUrl);
  const apiProjectRef = extractProjectRefFromSupabaseUrl(config.url);
  if (!apiProjectRef || apiProjectRef.toLowerCase() !== config.expectedProjectRef.toLowerCase()) {
    throw new Error('Safety guard rejected test target: Supabase URL project reference does not match the expected test project.');
  }
  if (!cleanDbUrl) {
    if (config.url && probeApiKey) {
      const probe = await probePostgrestNotesColumn(config.url, probeApiKey);
      if (probe.ok) {
        console.log("INFO: PostgREST schema cache already exposes 'notes' column.");
        return { success: true, appliedMigrations: [] };
      }
      if (probe.code === 'PGRST204') {
        throw new Error(
          `Preflight verification failed: PostgREST returned PGRST204 for column 'notes'. Migration '20261023000002_add_notes_to_recipes.sql' has not been applied or schema cache is stale. Missing required secret ${config.source === 'BE-06' ? 'BE06_RLS_TEST_DATABASE_URL' : 'BE04_RLS_TEST_DATABASE_URL'} to apply migrations and reload schema cache.`
        );
      }
    }
    throw new Error(
      `Preflight verification failed: missing dedicated test database connection string (${config.source === 'BE-06' ? 'BE06_RLS_TEST_DATABASE_URL' : 'BE04_RLS_TEST_DATABASE_URL'}).`
    );
  }

  validateTestDatabaseTarget(cleanDbUrl, config.expectedProjectRef);

  let caCert;
  const caPath = path.resolve(__dirname, 'supabase/prod-ca-2021.crt');
  if (fs.existsSync(caPath)) {
    caCert = fs.readFileSync(caPath, 'utf8');
  }

  let sanitizedConnectionString;
  const parsedUrl = new URL(cleanDbUrl);
  const sslParams = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'];
  for (const param of sslParams) {
    parsedUrl.searchParams.delete(param);
  }
  sanitizedConnectionString = parsedUrl.toString();

  const client = new Client({
    connectionString: sanitizedConnectionString,
    ssl: {
      rejectUnauthorized: true,
      ca: caCert ? [caCert, ...tls.rootCertificates] : tls.rootCertificates
    }
  });

  await client.connect();
  try {
    const preMeta = await verifyColumnMetadata(client, 'recipes', 'notes');
    if (!preMeta.exists) {
      console.log("INFO: Column 'notes' does not exist in 'public.recipes'. Applying pending migrations...");
    } else {
      console.log("INFO: Column 'notes' exists in 'public.recipes'.");
    }

    const migrationResult = await runMigrations({
      client,
      isLocalhost: false,
      shouldSeed: false,
      logger: console
    });

    await reloadPostgrestSchemaCache(client);

    const postMeta = await verifyColumnMetadata(client, 'recipes', 'notes');
    if (!postMeta.exists) {
      throw new Error("Verification failed: column 'notes' does not exist in 'public.recipes' after running migrations.");
    }
    if (postMeta.udtName !== 'text') {
      throw new Error(`Verification failed: column 'notes' in 'public.recipes' has type '${postMeta.udtName}', expected 'text'.`);
    }
    if (!postMeta.isNullable) {
      throw new Error("Verification failed: column 'notes' in 'public.recipes' must be nullable.");
    }

    if (config.url && probeApiKey) {
      let postgrestReady = false;
      for (let attempt = 1; attempt <= 10; attempt++) {
        const probe = await probePostgrestNotesColumn(config.url, probeApiKey);
        if (probe.ok) {
          postgrestReady = true;
          break;
        }
        if (probe.code === 'PGRST204') {
          await reloadPostgrestSchemaCache(client);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!postgrestReady) {
        throw new Error("Verification failed: PostgREST schema cache did not expose 'notes' column after reloading.");
      }
    }

    console.log("SUCCESS: Test database migrations and PostgREST schema cache verification completed.");
    return {
      success: true,
      appliedMigrations: migrationResult.appliedMigrations
    };
  } finally {
    await client.end();
  }
}

export async function main() {
  if (process.argv.includes('--test-target')) {
    try {
      await runTestDatabaseMigrations();
    } catch (err) {
      console.error('ERROR:', err.message);
      process.exitCode = 1;
    }
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing in .env');
    process.exit(1);
  }

  const rawDbUrl = process.env.DATABASE_URL;
  const expectedProjectRef = process.env.RLS_EXPECTED_PROJECT_REF;
  const supabaseUrl = process.env.SUPABASE_URL;

  try {
    validateDatabaseTarget(rawDbUrl, expectedProjectRef, supabaseUrl);
  } catch (err) {
    console.error(`Target validation failed: ${err.message}`);
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
    ca: [caCert, ...tls.rootCertificates]
  };

  let sanitizedConnectionString;
  let parsedUrl;
  try {
    parsedUrl = new URL(sanitizeDatabaseUrl(process.env.DATABASE_URL));
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

  const client = new Client({
    connectionString: sanitizedConnectionString,
    ssl: isLocalhost ? false : sslConfig
  });

  const explicitReconcile = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--reconcile' && process.argv[i + 1]) {
      const candidates = process.argv[i + 1].split(',').map((v) => v.trim()).filter(Boolean);
      for (const cand of candidates) {
        if (!/^\d+$/.test(cand)) {
          console.error(`Invalid reconciliation version: ${cand}. Version must be numeric.`);
          process.exit(1);
        }
        explicitReconcile.push(cand);
      }
    }
  }

  try {
    await client.connect();
    const shouldSeed = process.env.SEED_DEMO === 'true' || process.argv.includes('--seed');
    const result = await runMigrations({
      client,
      isLocalhost,
      shouldSeed,
      explicitReconcile
    });

    await reloadPostgrestSchemaCache(client);

    const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (supabaseUrl && secretKey) {
      let postgrestReady = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const probe = await probePostgrestNotesColumn(supabaseUrl, secretKey);
        if (probe.ok) {
          postgrestReady = true;
          break;
        }
        await reloadPostgrestSchemaCache(client);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!postgrestReady) {
        throw new Error("Verification failed: PostgREST schema cache did not expose 'notes' after five attempts.");
      }
    }

    return result;
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
