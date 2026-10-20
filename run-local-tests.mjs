import { spawnSync } from "node:child_process";

const DEFAULT_LOCAL_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const DEFAULT_LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const KNOWN_PRODUCTION_REF = "gtbwblxskctpsqhbpebg";

const PLACEHOLDER_VALUES = new Set([
  "local-anon-key",
  "local-service-role-key",
  "your-anon-key",
  "your-service-role-key",
  "your-publishable-key",
  "your-secret-key",
  "sb_publishable_xxx",
  "sb_secret_xxx",
]);

function isLoopbackHost(hostname) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function isAllowedLoopbackDatabaseUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
      isLoopbackHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isAllowedLocalSupabaseUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      port === "54321"
    );
  } catch {
    return false;
  }
}

function isValidUrlString(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) return false;
  try {
    new URL(rawUrl.trim());
    return true;
  } catch {
    return false;
  }
}

function decodeJwtSegment(segment) {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseLegacyJwtClaims(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return null;
  const parts = trimmed.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return null;
  }
  const header = decodeJwtSegment(parts[0]);
  const payload = decodeJwtSegment(parts[1]);
  if (!header || !payload) return null;
  if (
    typeof header.alg !== "string" ||
    header.alg.trim() === "" ||
    header.alg.toLowerCase() === "none"
  ) {
    return null;
  }
  return { header, payload };
}

function isLegacyAnonJwt(value) {
  const claims = parseLegacyJwtClaims(value);
  if (!claims) return false;
  if (claims.payload.ref === KNOWN_PRODUCTION_REF) return false;
  return claims.payload.role === "anon";
}

function isLegacyServiceRoleJwt(value) {
  const claims = parseLegacyJwtClaims(value);
  if (!claims) return false;
  if (claims.payload.ref === KNOWN_PRODUCTION_REF) return false;
  return claims.payload.role === "service_role";
}

function isModernPublishableKey(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return false;
  return (
    trimmed.length >= 25 && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(trimmed)
  );
}

function isModernSecretKey(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return false;
  return trimmed.length >= 20 && /^sb_secret_[A-Za-z0-9_-]{10,}$/.test(trimmed);
}

function isSupportedByDemoRecipeHandler(value) {
  return isLegacyServiceRoleJwt(value);
}

function buildPostgrestProbeHeaders(apiKey) {
  const trimmed = apiKey.trim();
  const headers = {
    apikey: trimmed,
    Accept: "application/json",
  };
  if (parseLegacyJwtClaims(trimmed)) {
    headers.Authorization = `Bearer ${trimmed}`;
  }
  return headers;
}

async function canReachLocalDemoEndpoint(supabaseUrl, serviceRoleKey) {
  if (
    !isAllowedLocalSupabaseUrl(supabaseUrl) ||
    !isSupportedByDemoRecipeHandler(serviceRoleKey)
  ) {
    return false;
  }
  const baseUrl = supabaseUrl.trim().replace(/\/+$/, "");
  const probeUrl = `${baseUrl}/rest/v1/recipes?id=eq.00000000-0000-0000-0000-000000000001&select=id`;
  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      redirect: "error",
      headers: buildPostgrestProbeHeaders(serviceRoleKey),
      signal: AbortSignal.timeout(2000),
    });
    if (response.status !== 200) return false;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return false;
    const body = await response.json();
    return Array.isArray(body);
  } catch {
    return false;
  }
}

function passesRlsTargetSafetyPrecheck({
  rlsUrl,
  rlsAnonKey,
  rlsPublishableKey,
  rlsServiceRoleKey,
  primarySupabaseUrl,
  viteSupabaseUrl,
}) {
  if (!rlsUrl || !rlsUrl.trim()) return false;
  const hasValidPublicKey =
    isLegacyAnonJwt(rlsAnonKey) || isModernPublishableKey(rlsPublishableKey);
  if (!hasValidPublicKey || !isLegacyServiceRoleJwt(rlsServiceRoleKey)) {
    return false;
  }
  try {
    const parsedRls = new URL(rlsUrl.trim());
    const rlsHost = parsedRls.hostname.toLowerCase();
    if (rlsHost.includes(KNOWN_PRODUCTION_REF)) return false;

    const rlsPort =
      parsedRls.port || (parsedRls.protocol === "https:" ? "443" : "80");
    if (isLoopbackHost(rlsHost) && rlsPort === "54321") {
      return false;
    }

    for (const candidate of [primarySupabaseUrl, viteSupabaseUrl]) {
      if (!candidate || !candidate.trim()) continue;
      const parsedCandidate = new URL(candidate.trim());
      const candidatePort =
        parsedCandidate.port ||
        (parsedCandidate.protocol === "https:" ? "443" : "80");
      if (
        parsedCandidate.hostname.toLowerCase() === rlsHost &&
        candidatePort === rlsPort
      ) {
        return false;
      }
      if (
        isLoopbackHost(parsedCandidate.hostname) &&
        isLoopbackHost(rlsHost) &&
        candidatePort === rlsPort
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

const rawDatabaseUrl = process.env.DATABASE_URL;
const rawSupabaseUrl = process.env.SUPABASE_URL;
const rawServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawViteSupabaseUrl = process.env.VITE_SUPABASE_URL;
const rawRlsOptIn = process.env.RUN_BE04_RLS_INTEGRATION;
const rawRlsUrl = process.env.BE04_RLS_TEST_SUPABASE_URL;
const rawRlsAnonKey = process.env.BE04_RLS_TEST_SUPABASE_ANON_KEY;
const rawRlsPublishableKey = process.env.BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY;
const rawRlsServiceRoleKey =
  process.env.BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY;

const env = { ...process.env };

for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "RUN_BE04_RLS_INTEGRATION",
  "BE04_RLS_TEST_SUPABASE_URL",
  "BE04_RLS_TEST_SUPABASE_ANON_KEY",
  "BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY",
  "BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY",
  "RUN_MIGRATION_DB_TESTS",
]) {
  delete env[key];
}

env.ALLOW_REMOTE_TEST_DB = "false";
env.FORCE_REMOTE_SEED = "false";
env.DATABASE_URL = isAllowedLoopbackDatabaseUrl(rawDatabaseUrl)
  ? rawDatabaseUrl.trim()
  : DEFAULT_LOCAL_DB_URL;

const candidateDemoSupabaseUrl = isAllowedLocalSupabaseUrl(rawSupabaseUrl)
  ? rawSupabaseUrl.trim()
  : DEFAULT_LOCAL_SUPABASE_URL;

if (
  await canReachLocalDemoEndpoint(candidateDemoSupabaseUrl, rawServiceRoleKey)
) {
  env.SUPABASE_URL = candidateDemoSupabaseUrl;
  env.SUPABASE_SERVICE_ROLE_KEY = rawServiceRoleKey.trim();
}

if (
  rawRlsOptIn === "true" &&
  passesRlsTargetSafetyPrecheck({
    rlsUrl: rawRlsUrl,
    rlsAnonKey: rawRlsAnonKey,
    rlsPublishableKey: rawRlsPublishableKey,
    rlsServiceRoleKey: rawRlsServiceRoleKey,
    primarySupabaseUrl: env.SUPABASE_URL ?? rawSupabaseUrl,
    viteSupabaseUrl: rawViteSupabaseUrl,
  })
) {
  env.RUN_BE04_RLS_INTEGRATION = "true";
  env.BE04_RLS_TEST_SUPABASE_URL = rawRlsUrl.trim();
  env.BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY = rawRlsServiceRoleKey.trim();
  if (isLegacyAnonJwt(rawRlsAnonKey)) {
    env.BE04_RLS_TEST_SUPABASE_ANON_KEY = rawRlsAnonKey.trim();
  }
  if (isModernPublishableKey(rawRlsPublishableKey)) {
    env.BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY = rawRlsPublishableKey.trim();
  }
  if (!env.SUPABASE_URL && isValidUrlString(rawSupabaseUrl)) {
    env.SUPABASE_URL = rawSupabaseUrl.trim();
  }
  if (isValidUrlString(rawViteSupabaseUrl)) {
    env.VITE_SUPABASE_URL = rawViteSupabaseUrl.trim();
  }
}

function runCommand(command, args, useShell = false) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: useShell,
    env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`Process terminated by signal: ${result.signal}`);
    process.exit(1);
  }

  if (typeof result.status !== "number") {
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status);
  }
}

runCommand(process.execPath, ["test-migrations.mjs", "--run-db-tests"], false);

const denoArgs = [
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

runCommand("deno", denoArgs, process.platform === "win32");
