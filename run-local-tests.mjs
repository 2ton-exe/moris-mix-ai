import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  RUN_BE04_RLS_INTEGRATION: "true",
  BE04_RLS_TEST_SUPABASE_URL: "http://127.0.0.1:54321",
  BE04_RLS_TEST_SUPABASE_ANON_KEY: "local-anon-key",
  BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  RUN_MIGRATION_DB_TESTS: "true",
};

const args = [
  "test",
  "--frozen-lockfile",
  "--node-modules-dir=auto",
  "--allow-env",
  "--allow-net",
  "--allow-read=fixtures/demo-recipe.json",
  "supabase/functions/tests/demo_recipe_test.ts",
  "supabase/functions/tests/auth_test.ts",
  "supabase/functions/tests/auth_rls_integration_test.ts",
  "supabase/functions/tests/recipes_test.ts",
];

const result = spawnSync("deno", args, {
  stdio: "inherit",
  shell: true,
  env,
});

process.exit(result.status ?? 1);
