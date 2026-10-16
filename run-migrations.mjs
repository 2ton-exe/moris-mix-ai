import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing in .env');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fail-closed TLS verification: resolve CA cert relative to script directory
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

// Sanitize SSL-related query parameters from DATABASE_URL using URL API
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

async function main() {
  try {
    await client.connect();

    if (isLocalhost) {
      const mockAuthPath = path.resolve(__dirname, 'supabase/mock-auth.sql');
      const mockAuthSql = fs.readFileSync(mockAuthPath, 'utf8');
      await client.query(mockAuthSql);
    }

    const migrationPath = path.resolve(__dirname, 'supabase/migrations/20261013000000_initial_schema.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await client.query(migrationSql);
    console.log('SUCCESS: Migrations applied successfully.');

    // Opt-in demo seeding: execute only when SEED_DEMO === 'true' or --seed CLI flag is passed
    const shouldSeed = process.env.SEED_DEMO === 'true' || process.argv.includes('--seed');
    if (shouldSeed) {
      if (!isLocalhost && process.env.FORCE_REMOTE_SEED !== 'true') {
        console.warn('WARN: Seeding skipped. Demo seed is restricted to local development.');
      } else {
        const seedPath = path.resolve(__dirname, 'supabase/seed.sql');
        const seedSql = fs.readFileSync(seedPath, 'utf8');
        await client.query(seedSql);
        console.log('SUCCESS: Demo seed applied.');
      }
    } else {
      console.log('INFO: Skipping demo seeding. Set SEED_DEMO=true or pass --seed flag to seed demo data.');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();