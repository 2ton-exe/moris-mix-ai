import fs from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing in .env');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await client.connect();
    const migrationSql = fs.readFileSync('supabase/migrations/20261013000000_initial_schema.sql', 'utf8');
    await client.query(migrationSql);
    const seedSql = fs.readFileSync('supabase/seed.sql', 'utf8');
    await client.query(seedSql);
    console.log('SUCCESS: Migrations and seed applied.');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
