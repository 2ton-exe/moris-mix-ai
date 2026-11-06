import { readFileSync } from 'node:fs';

import { getSupabaseDatabaseConnection } from './supabase-database-target.mjs';

const required = [
  'SUPABASE_DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PROJECT_REF',
  'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME',
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'ALLOWED_ORIGIN',
];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required protected configuration: ${name}`);
}
if (!(process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim())) {
  throw new Error('A public Supabase key is required.');
}
if (process.env.UPLOAD_SIGNING_READINESS_ATTESTATION !== 'verified') {
  throw new Error('The protected environment readiness attestation is missing or invalid.');
}

const projectRef = process.env.SUPABASE_PROJECT_REF;
const configRef = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "([^"]+)"$/m)?.[1];
if (!configRef || projectRef !== configRef) throw new Error('Project reference does not match supabase/config.toml.');
const supabaseUrl = new URL(process.env.SUPABASE_URL);
const databaseConnection = getSupabaseDatabaseConnection(process.env.SUPABASE_DATABASE_URL, projectRef);
if (supabaseUrl.origin !== `https://${projectRef}.supabase.co`) throw new Error('SUPABASE_URL targets a different project.');
if (new URL(process.env.ALLOWED_ORIGIN).protocol !== 'https:') throw new Error('ALLOWED_ORIGIN must use HTTPS.');

const publicKey = process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY.trim();
const publicKeyCheck = await fetch(new URL('/auth/v1/settings', supabaseUrl), {
  headers: { apikey: publicKey },
  redirect: 'error',
  signal: AbortSignal.timeout(10000),
});
if (!publicKeyCheck.ok) throw new Error('The public Supabase key was rejected by the configured project.');
await publicKeyCheck.body?.cancel();

const serviceRoleCheck = await fetch(new URL('/rest/v1/recipe_image_upload_intents?select=id&limit=0', supabaseUrl), {
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  redirect: 'error',
  signal: AbortSignal.timeout(10000),
});
if (!serviceRoleCheck.ok) throw new Error('The service-role credential was rejected for the configured project or table.');
await serviceRoleCheck.body?.cancel();

const { default: pg } = await import('pg');
const { Client } = pg;
const client = new Client({
  ...databaseConnection,
  ssl: { rejectUnauthorized: true },
  application_name: 'recipe-image-upload-readiness',
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  const migrations = await client.query(
    `select version from supabase_migrations.schema_migrations where version = any($1::text[])`,
    [['20261102000009', '20261102000010']],
  );
  const applied = new Set(migrations.rows.map(row => row.version));
  for (const version of ['20261102000009', '20261102000010']) {
    if (!applied.has(version)) throw new Error(`Required migration is not applied: ${version}`);
  }
  const table = await client.query(
    `select c.oid, c.relrowsecurity, c.relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'recipe_image_upload_intents'`,
  );
  if (table.rowCount !== 1 || !table.rows[0].relrowsecurity || !table.rows[0].relforcerowsecurity) {
    throw new Error('Upload-intent table is missing or does not have enabled and forced RLS.');
  }
  const relation = table.rows[0].oid;
  const columns = await client.query(
    `select attname from pg_attribute where attrelid = $1 and attnum > 0 and not attisdropped`, [relation],
  );
  const columnNames = new Set(columns.rows.map(row => row.attname));
  for (const name of ['id', 'user_id', 'recipe_id', 'staging_key', 'final_key', 'content_type', 'byte_size', 'created_at', 'expires_at', 'state', 'cleanup_status']) {
    if (!columnNames.has(name)) throw new Error(`Required upload-intent column is missing: ${name}`);
  }
  const checks = await client.query(
    'select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = $1 and contype = $2',
    [relation, 'c'],
  );
  const definitions = checks.rows.map(row => row.definition.toLowerCase().replaceAll(' ', ''));
  const allDefinitions = definitions.join(' ');
  for (const expected of [
    "'image/jpeg'", "'image/png'", "'image/webp'", 'byte_size>=1',
    'byte_size<=10485760', '00:10:00', 'cleanup_status',
  ]) {
    if (!allDefinitions.includes(expected)) {
      throw new Error('A required upload-intent size, type, expiry, or lifecycle constraint is missing.');
    }
  }
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const access = await client.query('select has_table_privilege($1, $2::oid, $3) as allowed', [role, relation, privilege]);
      if (access.rows[0].allowed) throw new Error(`Unexpected ${privilege} table access for ${role}.`);
    }
  }
  const rpc = await client.query(
    `select p.oid, p.prosecdef, pg_get_functiondef(p.oid) as definition
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_recipe_image_upload_intent'
       and pg_get_function_identity_arguments(p.oid) =
       'p_id uuid, p_user_id uuid, p_recipe_id uuid, p_staging_key text, p_final_key text, p_content_type text, p_byte_size integer, p_created_at timestamp with time zone, p_expires_at timestamp with time zone'`,
  );
  if (rpc.rowCount !== 1 || !rpc.rows[0].prosecdef || !rpc.rows[0].definition.includes("auth.role() is distinct from 'service_role'")) {
    throw new Error('Upload-intent RPC is missing or has unexpected authorization behavior.');
  }
  const rpcOid = rpc.rows[0].oid;
  const serviceExec = await client.query('select has_function_privilege($1, $2::oid, $3) as allowed', ['service_role', rpcOid, 'EXECUTE']);
  if (!serviceExec.rows[0].allowed) throw new Error('service_role cannot execute create_recipe_image_upload_intent.');
  for (const role of ['anon', 'authenticated']) {
    const access = await client.query('select has_function_privilege($1, $2::oid, $3) as allowed', [role, rpcOid, 'EXECUTE']);
    if (access.rows[0].allowed) throw new Error(`Unexpected upload-intent RPC privilege for ${role}.`);
  }
  const grants = await client.query(
    `select has_table_privilege('service_role', $1::oid, 'SELECT') as can_select,
            has_table_privilege('service_role', $1::oid, 'INSERT') as can_insert,
            has_table_privilege('service_role', $1::oid, 'UPDATE') as can_update,
            has_table_privilege('service_role', $1::oid, 'DELETE') as can_delete`, [relation],
  );
  const privileges = grants.rows[0];
  if (!privileges.can_select || privileges.can_insert || privileges.can_update || privileges.can_delete) {
    throw new Error('service_role table privileges do not match the protected upload-intent model.');
  }
  console.log('Upload-signing database readiness verified for the configured project.');
} finally {
  await client.end();
}
