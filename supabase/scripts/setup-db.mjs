import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to Supabase PostgreSQL.");

    const migrationPath = path.resolve('supabase/migrations/20261013000000_initial_schema.sql');
    const seedPath = path.resolve('supabase/seed.sql');

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await client.query(migrationSql);
    console.log("Migration applied successfully.");

    const seedSql = fs.readFileSync(seedPath, 'supabase/seed.sql');
    await client.query(seedSql);
    console.log("Seed data applied successfully.");
  } catch (error) {
    console.error("Database setup failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();