import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { authenticateRequest } from "../_shared/auth.ts";
import { handler } from "../auth-session/index.ts";
import {
  evaluateHostedRlsPrerequisites,
  isLegacyServiceRoleJwt,
  isModernPublishableKey,
  isModernSecretKey,
  KNOWN_PRODUCTION_REF,
  passesRlsTargetSafetyPrecheck,
} from "../../../run-local-tests.mjs";

const LINKED_PRODUCTION_PROJECT_REF = "gtbwblxskctpsqhbpebg";

const optInEnabled = (Deno.env.get("RUN_BE04_RLS_INTEGRATION") ?? "").trim() === "true";
const testSupabaseUrl = (Deno.env.get("BE04_RLS_TEST_SUPABASE_URL") ?? "").trim();
const testAnonKey =
  (Deno.env.get("BE04_RLS_TEST_SUPABASE_ANON_KEY")?.trim() ||
    Deno.env.get("BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    "");
const testServiceRoleKey =
  (Deno.env.get("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("BE04_RLS_TEST_SUPABASE_SECRET_KEY")?.trim() ||
    "");

const missingPrerequisites: string[] = [];
if (!optInEnabled) {
  missingPrerequisites.push("RUN_BE04_RLS_INTEGRATION=true");
}
if (!testSupabaseUrl) {
  missingPrerequisites.push("BE04_RLS_TEST_SUPABASE_URL");
}
if (!testAnonKey) {
  missingPrerequisites.push("BE04_RLS_TEST_SUPABASE_ANON_KEY (or BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY)");
}
if (!testServiceRoleKey) {
  missingPrerequisites.push("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY (or BE04_RLS_TEST_SUPABASE_SECRET_KEY)");
}

const canRunLiveRlsIntegration = missingPrerequisites.length === 0;

if (!canRunLiveRlsIntegration) {
  console.warn(
    `[BE-04 RLS Integration] Skipping live hosted PostgreSQL RLS integration test. Missing prerequisites: ${missingPrerequisites.join(", ")}.`,
  );
}

function redactSecrets(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }
  return sanitized;
}

function isModernApiKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.startsWith("sb_secret_") || trimmed.startsWith("sb_publishable_");
}

function createRlsClientFetch(apiKey: string, baseFetch: typeof fetch = fetch): typeof fetch {
  const trimmedKey = apiKey.trim();
  if (!isModernApiKey(trimmedKey)) {
    return baseFetch;
  }
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    if (auth && auth.trim().toLowerCase() === `bearer ${trimmedKey.toLowerCase()}`) {
      headers.delete("authorization");
    }
    return baseFetch(input, { ...init, headers });
  };
}

function createRlsTestClient(
  url: string,
  key: string,
  options?: Parameters<typeof createClient>[2],
): ReturnType<typeof createClient> {
  const trimmedKey = key.trim();
  const baseFetch = options?.global?.fetch ?? fetch;

  return createClient(url, trimmedKey, {
    ...options,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      ...options?.auth,
    },
    global: {
      ...options?.global,
      fetch: createRlsClientFetch(trimmedKey, baseFetch),
    },
  });
}

function validateDedicatedTestTarget(url: string, anonKey: string, serviceRoleKey: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("BE04_RLS_TEST_SUPABASE_URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("BE04_RLS_TEST_SUPABASE_URL must use http or https protocol.");
  }

  if (parsed.hostname.includes(LINKED_PRODUCTION_PROJECT_REF)) {
    throw new Error(
      "Safety guard rejected BE04_RLS_TEST_SUPABASE_URL: refuses to run against the primary linked project.",
    );
  }

  const regularAppUrl = (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL") ?? "").trim();
  if (regularAppUrl) {
    try {
      const parsedRegular = new URL(regularAppUrl);
      if (parsedRegular.origin === parsed.origin) {
        throw new Error(
          "Safety guard rejected BE04_RLS_TEST_SUPABASE_URL: must target a dedicated test project distinct from SUPABASE_URL/VITE_SUPABASE_URL.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Safety guard")) {
        throw err;
      }
    }
  }

  if (anonKey === serviceRoleKey) {
    throw new Error(
      "Safety guard rejected test keys: BE04_RLS_TEST_SUPABASE_ANON_KEY must not equal BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

Deno.test("Hosted RLS credential validation accepts valid modern sb_secret_* keys alongside legacy service_role JWTs", () => {
  const validModernSecret = "sb_secret_test_valid_key_1234567890";
  const validModernPublishable = "sb_publishable_test_valid_key_1234567890";
  const validLegacyAnonJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJyZWYiOiJkZWRpY2F0ZWQtdGVzdCIsInJvbGUiOiJhbm9uIn0.valid_anon_sig";
  const validLegacyServiceRoleJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIiLCJyZWYiOiJkZWRpY2F0ZWQtdGVzdCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.valid_service_sig";

  assertEquals(isModernSecretKey(validModernSecret), true);
  assertEquals(isModernSecretKey("sb_secret_abc123_-XYZ_9876543210"), true);
  assertEquals(isModernPublishableKey(validModernPublishable), true);
  assertEquals(isLegacyServiceRoleJwt(validLegacyServiceRoleJwt), true);

  const passesWithModernSecretAndModernPublishable = passesRlsTargetSafetyPrecheck({
    rlsUrl: "https://dedicated-test-project.supabase.co",
    rlsAnonKey: validModernPublishable,
    rlsServiceRoleKey: validModernSecret,
    primarySupabaseUrl: "https://app-project.supabase.co",
    viteSupabaseUrl: "https://app-project.supabase.co",
  });
  assertEquals(passesWithModernSecretAndModernPublishable, true);

  const passesWithModernSecretAndLegacyAnon = passesRlsTargetSafetyPrecheck({
    rlsUrl: "https://dedicated-test-project.supabase.co",
    rlsAnonKey: validLegacyAnonJwt,
    rlsServiceRoleKey: validModernSecret,
    primarySupabaseUrl: "https://app-project.supabase.co",
  });
  assertEquals(passesWithModernSecretAndLegacyAnon, true);

  const passesWithModernSecretKeyParam = passesRlsTargetSafetyPrecheck({
    rlsUrl: "https://dedicated-test-project.supabase.co",
    rlsPublishableKey: validModernPublishable,
    rlsSecretKey: validModernSecret,
    primarySupabaseUrl: "https://app-project.supabase.co",
  });
  assertEquals(passesWithModernSecretKeyParam, true);

  const passesWithLegacyServiceRoleJwt = passesRlsTargetSafetyPrecheck({
    rlsUrl: "https://dedicated-test-project.supabase.co",
    rlsAnonKey: validLegacyAnonJwt,
    rlsServiceRoleKey: validLegacyServiceRoleJwt,
    primarySupabaseUrl: "https://app-project.supabase.co",
  });
  assertEquals(passesWithLegacyServiceRoleJwt, true);
});

Deno.test("Hosted RLS credential validation rejects placeholders, malformed keys, and known production credentials", () => {
  const validModernPublishable = "sb_publishable_test_valid_key_1234567890";
  const validModernSecret = "sb_secret_test_valid_key_1234567890";

  const placeholderKeys = [
    "sb_secret_xxx",
    "sb_secret_placeholder",
    "local-service-role-key",
    "your-service-role-key",
    "your-secret-key",
    "your-dedicated-test-service-role-key",
    "your-dedicated-test-secret-key",
  ];
  for (const placeholder of placeholderKeys) {
    assertEquals(isModernSecretKey(placeholder), false);
    assertEquals(
      passesRlsTargetSafetyPrecheck({
        rlsUrl: "https://dedicated-test.supabase.co",
        rlsAnonKey: validModernPublishable,
        rlsServiceRoleKey: placeholder,
      }),
      false,
    );
  }

  const malformedKeys = [
    "",
    "   ",
    "sb_secret_short",
    "sb_secret_with$illegal#chars!",
    "not-a-secret-key",
    "eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.wrong_role",
  ];
  for (const malformed of malformedKeys) {
    assertEquals(isModernSecretKey(malformed), false);
    assertEquals(
      passesRlsTargetSafetyPrecheck({
        rlsUrl: "https://dedicated-test.supabase.co",
        rlsAnonKey: validModernPublishable,
        rlsServiceRoleKey: malformed,
      }),
      false,
    );
  }

  const prodRefSecretKey = `sb_secret_${KNOWN_PRODUCTION_REF}_1234567890`;
  assertEquals(isModernSecretKey(prodRefSecretKey), false);

  const prodRefPayload = btoa(
    JSON.stringify({
      sub: "00000000-0000-0000-0000-000000000000",
      ref: KNOWN_PRODUCTION_REF,
      role: "service_role",
    }),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const prodRefJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${prodRefPayload}.signature`;
  assertEquals(isLegacyServiceRoleJwt(prodRefJwt), false);

  const prodKeyCollision = passesRlsTargetSafetyPrecheck({
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: validModernPublishable,
    rlsServiceRoleKey: validModernSecret,
    primaryServiceRoleKey: validModernSecret,
  });
  assertEquals(prodKeyCollision, false);

  const keyIdentityCollision = passesRlsTargetSafetyPrecheck({
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: validModernSecret,
    rlsServiceRoleKey: validModernSecret,
  });
  assertEquals(keyIdentityCollision, false);
});

Deno.test("Preserved URL safety checks enforce production rejection, loopback collisions, and origin separation", () => {
  const validKey = "sb_secret_test_valid_key_1234567890";
  const validPub = "sb_publishable_test_valid_key_1234567890";

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: `https://${KNOWN_PRODUCTION_REF}.supabase.co`,
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "http://127.0.0.1:54321",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "http://localhost:54321",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "http://127.0.0.1:54323",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
      primarySupabaseUrl: "http://127.0.0.1:54323",
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "http://127.0.0.1:54323",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
      primarySupabaseUrl: "http://localhost:54323",
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "ftp://dedicated-test.supabase.co",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "not-a-valid-url",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
    }),
    false,
  );

  assertEquals(
    passesRlsTargetSafetyPrecheck({
      rlsUrl: "https://dedicated-test.supabase.co",
      rlsAnonKey: validPub,
      rlsServiceRoleKey: validKey,
      primarySupabaseUrl: "https://production-app.supabase.co",
      viteSupabaseUrl: "https://production-app.supabase.co",
    }),
    true,
  );
});

Deno.test("Missing opt-in flags or dedicated credentials produce explicit skip reason without exposing secrets", () => {
  const secretValue = "sb_secret_super_sensitive_secret_value_123456789";
  const publicValue = "sb_publishable_super_sensitive_anon_123456789";

  const missingOptIn = evaluateHostedRlsPrerequisites({
    optIn: "false",
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: publicValue,
    rlsServiceRoleKey: secretValue,
  });
  assertEquals(missingOptIn.canRun, false);
  assertEquals(typeof missingOptIn.skipReason, "string");
  assertEquals(missingOptIn.skipReason!.includes("RUN_BE04_RLS_INTEGRATION=true opt-in flag"), true);
  assertEquals(missingOptIn.skipReason!.includes(secretValue), false);
  assertEquals(missingOptIn.skipReason!.includes(publicValue), false);

  const missingUrl = evaluateHostedRlsPrerequisites({
    optIn: "true",
    rlsUrl: "",
    rlsAnonKey: publicValue,
    rlsServiceRoleKey: secretValue,
  });
  assertEquals(missingUrl.canRun, false);
  assertEquals(missingUrl.skipReason!.includes("BE04_RLS_TEST_SUPABASE_URL"), true);

  const missingPublic = evaluateHostedRlsPrerequisites({
    optIn: "true",
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: "",
    rlsServiceRoleKey: secretValue,
  });
  assertEquals(missingPublic.canRun, false);
  assertEquals(missingPublic.skipReason!.includes("valid dedicated public key"), true);

  const missingSecret = evaluateHostedRlsPrerequisites({
    optIn: "true",
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: publicValue,
    rlsServiceRoleKey: "",
  });
  assertEquals(missingSecret.canRun, false);
  assertEquals(missingSecret.skipReason!.includes("valid dedicated secret/service-role key"), true);

  const neitherSupplied = evaluateHostedRlsPrerequisites({
    optIn: "true",
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: publicValue,
    rlsServiceRoleKey: "",
    rlsSecretKey: "",
  });
  assertEquals(neitherSupplied.canRun, false);
  assertEquals(neitherSupplied.skipReason!.includes("valid dedicated secret/service-role key"), true);

  const validWithSecretKeyOnly = evaluateHostedRlsPrerequisites({
    optIn: "true",
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: publicValue,
    rlsServiceRoleKey: "",
    rlsSecretKey: secretValue,
    primarySupabaseUrl: "https://app.supabase.co",
  });
  assertEquals(validWithSecretKeyOnly.canRun, true);
  assertEquals(validWithSecretKeyOnly.skipReason, null);
  assertEquals(validWithSecretKeyOnly.effectiveSecretKey, secretValue);

  const allValid = evaluateHostedRlsPrerequisites({
    optIn: "true",
    rlsUrl: "https://dedicated-test.supabase.co",
    rlsAnonKey: publicValue,
    rlsServiceRoleKey: secretValue,
    primarySupabaseUrl: "https://app.supabase.co",
  });
  assertEquals(allValid.canRun, true);
  assertEquals(allValid.skipReason, null);
});

Deno.test("RLS test client configuration normalizes modern secret keys and preserves legacy JWT headers", async () => {
  const modernSecret = "sb_secret_test_admin_key_1234567890";
  const legacyServiceJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIiLCJyZWYiOiJkZWRpY2F0ZWQtdGVzdCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.legacy_sig";
  const userJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzMzMzMzMzMy0zMzMzLTMzMzMtMzMzMy0zMzMzMzMzMzMzMzMiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.user_sig";

  const modernCapturedHeaders: Headers[] = [];
  const modernFetch: typeof fetch = (_input, init) => {
    modernCapturedHeaders.push(new Headers(init?.headers));
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  const modernClient = createRlsTestClient("https://dedicated-test.supabase.co", modernSecret, {
    global: { fetch: modernFetch },
  });

  await modernClient.from("profiles").select("id");
  assertEquals(modernCapturedHeaders.length, 1);
  assertEquals(modernCapturedHeaders[0].get("apikey"), modernSecret);
  assertEquals(modernCapturedHeaders[0].get("authorization"), null);

  const legacyCapturedHeaders: Headers[] = [];
  const legacyFetch: typeof fetch = (_input, init) => {
    legacyCapturedHeaders.push(new Headers(init?.headers));
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  const legacyClient = createRlsTestClient("https://dedicated-test.supabase.co", legacyServiceJwt, {
    global: { fetch: legacyFetch },
  });

  await legacyClient.from("profiles").select("id");
  assertEquals(legacyCapturedHeaders.length, 1);
  assertEquals(legacyCapturedHeaders[0].get("apikey"), legacyServiceJwt);
  assertEquals(legacyCapturedHeaders[0].get("authorization"), `Bearer ${legacyServiceJwt}`);

  const sessionCapturedHeaders: Headers[] = [];
  const sessionFetch: typeof fetch = (_input, init) => {
    sessionCapturedHeaders.push(new Headers(init?.headers));
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  const userSessionClient = createRlsTestClient(
    "https://dedicated-test.supabase.co",
    "sb_publishable_test_anon_key_1234567890",
    {
      global: {
        headers: { Authorization: `Bearer ${userJwt}` },
        fetch: sessionFetch,
      },
    },
  );

  await userSessionClient.from("profiles").select("id");
  assertEquals(sessionCapturedHeaders.length, 1);
  assertEquals(sessionCapturedHeaders[0].get("apikey"), "sb_publishable_test_anon_key_1234567890");
  assertEquals(sessionCapturedHeaders[0].get("authorization"), `Bearer ${userJwt}`);
});

Deno.test({
  name: "Live PostgreSQL RLS enforcement on public.profiles allows own-profile reads and blocks cross-user reads (hosted integration)",
  ignore: !canRunLiveRlsIntegration,
  fn: async () => {
    const knownSecrets = [testAnonKey, testServiceRoleKey];
    validateDedicatedTestTarget(testSupabaseUrl, testAnonKey, testServiceRoleKey);

    const adminClient = createRlsTestClient(testSupabaseUrl, testServiceRoleKey);

    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const userAEmail = `be04-rls-a-${runId}@morisscraps.test`;
    const userBEmail = `be04-rls-b-${runId}@morisscraps.test`;
    const userAPassword = ` PassA!${crypto.randomUUID()}9 `;
    const userBPassword = ` PassB!${crypto.randomUUID()}9 `;
    const userADisplayName = `BE04 RLS Chef A ${runId}`;
    const userBDisplayName = `BE04 RLS Chef B ${runId}`;
    const userAAvatarUrl = `https://example.com/avatars/a-${runId}.png`;
    const userBAvatarUrl = `https://example.com/avatars/b-${runId}.png`;

    knownSecrets.push(userAPassword, userBPassword);

    const createdUserIds: string[] = [];
    let primaryError: Error | null = null;

    try {
      const { data: createdA, error: createErrorA } = await adminClient.auth.admin.createUser({
        email: userAEmail,
        password: userAPassword,
        email_confirm: true,
        user_metadata: {
          full_name: userADisplayName,
          avatar_url: userAAvatarUrl,
        },
      });

      if (createErrorA || !createdA?.user?.id) {
        throw new Error(
          `Failed to create test User A: ${redactSecrets(createErrorA?.message ?? "missing user id", knownSecrets)}`,
        );
      }
      const userAId = createdA.user.id;
      createdUserIds.push(userAId);

      const { data: createdB, error: createErrorB } = await adminClient.auth.admin.createUser({
        email: userBEmail,
        password: userBPassword,
        email_confirm: true,
        user_metadata: {
          full_name: userBDisplayName,
          avatar_url: userBAvatarUrl,
        },
      });

      if (createErrorB || !createdB?.user?.id) {
        throw new Error(
          `Failed to create test User B: ${redactSecrets(createErrorB?.message ?? "missing user id", knownSecrets)}`,
        );
      }
      const userBId = createdB.user.id;
      createdUserIds.push(userBId);
      assertNotEquals(userAId, userBId);

      const { error: upsertProfilesError } = await adminClient
        .from("profiles")
        .upsert(
          [
            {
              id: userAId,
              display_name: userADisplayName,
              avatar_url: userAAvatarUrl,
            },
            {
              id: userBId,
              display_name: userBDisplayName,
              avatar_url: userBAvatarUrl,
            },
          ],
          { onConflict: "id" },
        );

      if (upsertProfilesError) {
        throw new Error(
          `Failed to prepare test profile rows: ${redactSecrets(upsertProfilesError.message, knownSecrets)}`,
        );
      }

      const anonClientA = createRlsTestClient(testSupabaseUrl, testAnonKey);
      const { data: signInA, error: signInErrorA } = await anonClientA.auth.signInWithPassword({
        email: userAEmail,
        password: userAPassword,
      });
      if (signInErrorA || !signInA?.session?.access_token) {
        throw new Error(
          `Failed to sign in test User A: ${redactSecrets(signInErrorA?.message ?? "missing access_token", knownSecrets)}`,
        );
      }
      const userAAccessToken = signInA.session.access_token;
      knownSecrets.push(userAAccessToken);

      const anonClientB = createRlsTestClient(testSupabaseUrl, testAnonKey);
      const { data: signInB, error: signInErrorB } = await anonClientB.auth.signInWithPassword({
        email: userBEmail,
        password: userBPassword,
      });
      if (signInErrorB || !signInB?.session?.access_token) {
        throw new Error(
          `Failed to sign in test User B: ${redactSecrets(signInErrorB?.message ?? "missing access_token", knownSecrets)}`,
        );
      }
      const userBAccessToken = signInB.session.access_token;
      knownSecrets.push(userBAccessToken);

      assertNotEquals(userAAccessToken, userBAccessToken);
      assertNotEquals(userAAccessToken, testServiceRoleKey);
      assertNotEquals(userBAccessToken, testServiceRoleKey);
      assertNotEquals(userAAccessToken, testAnonKey);
      assertNotEquals(userBAccessToken, testAnonKey);

      const recordedPostgrestHeadersA: Headers[] = [];
      const trackedFetchA: typeof fetch = (input, init) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        );
        if (url.pathname.startsWith("/rest/v1/")) {
          recordedPostgrestHeadersA.push(new Headers(init?.headers));
        }
        return fetch(input, init);
      };

      const recordedPostgrestHeadersB: Headers[] = [];
      const trackedFetchB: typeof fetch = (input, init) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        );
        if (url.pathname.startsWith("/rest/v1/")) {
          recordedPostgrestHeadersB.push(new Headers(init?.headers));
        }
        return fetch(input, init);
      };

      const reqA = new Request("http://localhost/functions/v1/auth-session", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${userAAccessToken}`,
        },
      });
      const authA = await authenticateRequest(reqA, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
        fetch: trackedFetchA,
      });
      assertEquals(authA.ok, true);
      if (!authA.ok) {
        throw new Error(`authenticateRequest failed for User A with status ${authA.response.status}`);
      }
      assertEquals(authA.context.user.id, userAId);

      const reqB = new Request("http://localhost/functions/v1/auth-session", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${userBAccessToken}`,
        },
      });
      const authB = await authenticateRequest(reqB, {
        supabaseUrl: testSupabaseUrl,
        supabaseAnonKey: testAnonKey,
        fetch: trackedFetchB,
      });
      assertEquals(authB.ok, true);
      if (!authB.ok) {
        throw new Error(`authenticateRequest failed for User B with status ${authB.response.status}`);
      }
      assertEquals(authB.context.user.id, userBId);

      const { data: ownProfileRowsA, error: ownProfileErrorA } = await authA.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userAId);
      assertEquals(ownProfileErrorA, null);
      assertEquals(Array.isArray(ownProfileRowsA), true);
      assertEquals(ownProfileRowsA?.length, 1);
      assertEquals(ownProfileRowsA?.[0]?.id, userAId);
      assertEquals(ownProfileRowsA?.[0]?.display_name, userADisplayName);
      assertEquals(ownProfileRowsA?.[0]?.avatar_url, userAAvatarUrl);

      const { data: ownProfileRowsB, error: ownProfileErrorB } = await authB.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userBId);
      assertEquals(ownProfileErrorB, null);
      assertEquals(Array.isArray(ownProfileRowsB), true);
      assertEquals(ownProfileRowsB?.length, 1);
      assertEquals(ownProfileRowsB?.[0]?.id, userBId);
      assertEquals(ownProfileRowsB?.[0]?.display_name, userBDisplayName);
      assertEquals(ownProfileRowsB?.[0]?.avatar_url, userBAvatarUrl);

      const { data: crossReadAById, error: crossErrorAById } = await authA.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userBId);
      assertEquals(crossErrorAById, null);
      assertEquals(crossReadAById, []);

      const { data: crossMaybeSingleA, error: crossMaybeSingleErrorA } = await authA.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userBId)
        .maybeSingle();
      assertEquals(crossMaybeSingleErrorA, null);
      assertEquals(crossMaybeSingleA, null);

      const { data: crossReadBById, error: crossErrorBById } = await authB.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userAId);
      assertEquals(crossErrorBById, null);
      assertEquals(crossReadBById, []);

      const { data: crossMaybeSingleB, error: crossMaybeSingleErrorB } = await authB.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userAId)
        .maybeSingle();
      assertEquals(crossMaybeSingleErrorB, null);
      assertEquals(crossMaybeSingleB, null);

      const { data: multiReadA, error: multiErrorA } = await authA.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", [userAId, userBId]);
      assertEquals(multiErrorA, null);
      assertEquals(multiReadA?.length, 1);
      assertEquals(multiReadA?.[0]?.id, userAId);

      const { data: multiReadB, error: multiErrorB } = await authB.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", [userAId, userBId]);
      assertEquals(multiErrorB, null);
      assertEquals(multiReadB?.length, 1);
      assertEquals(multiReadB?.[0]?.id, userBId);

      const { data: unfilteredRowsA, error: unfilteredErrorA } = await authA.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url");
      assertEquals(unfilteredErrorA, null);
      assertEquals(unfilteredRowsA?.length, 1);
      assertEquals(unfilteredRowsA?.[0]?.id, userAId);

      const { data: unfilteredRowsB, error: unfilteredErrorB } = await authB.context.supabase
        .from("profiles")
        .select("id, display_name, avatar_url");
      assertEquals(unfilteredErrorB, null);
      assertEquals(unfilteredRowsB?.length, 1);
      assertEquals(unfilteredRowsB?.[0]?.id, userBId);

      const handlerResA = await handler(
        new Request(`http://localhost/functions/v1/auth-session?id=${userBId}&user_id=${userBId}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${userAAccessToken}` },
        }),
        {
          supabaseUrl: testSupabaseUrl,
          supabaseAnonKey: testAnonKey,
          fetch: trackedFetchA,
        },
      );
      assertEquals(handlerResA.status, 200);
      const handlerBodyA = await handlerResA.json();
      assertEquals(handlerBodyA.user?.id, userAId);
      assertEquals(handlerBodyA.user?.display_name, userADisplayName);

      const handlerResB = await handler(
        new Request(`http://localhost/functions/v1/auth-session?id=${userAId}&user_id=${userAId}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${userBAccessToken}` },
        }),
        {
          supabaseUrl: testSupabaseUrl,
          supabaseAnonKey: testAnonKey,
          fetch: trackedFetchB,
        },
      );
      assertEquals(handlerResB.status, 200);
      const handlerBodyB = await handlerResB.json();
      assertEquals(handlerBodyB.user?.id, userBId);
      assertEquals(handlerBodyB.user?.display_name, userBDisplayName);

      assertEquals(recordedPostgrestHeadersA.length > 0, true);
      for (const headers of recordedPostgrestHeadersA) {
        assertEquals(headers.get("authorization"), `Bearer ${userAAccessToken}`);
        assertEquals(headers.get("apikey"), testAnonKey);
        assertNotEquals(headers.get("authorization"), `Bearer ${testServiceRoleKey}`);
        assertNotEquals(headers.get("apikey"), testServiceRoleKey);
      }

      assertEquals(recordedPostgrestHeadersB.length > 0, true);
      for (const headers of recordedPostgrestHeadersB) {
        assertEquals(headers.get("authorization"), `Bearer ${userBAccessToken}`);
        assertEquals(headers.get("apikey"), testAnonKey);
        assertNotEquals(headers.get("authorization"), `Bearer ${testServiceRoleKey}`);
        assertNotEquals(headers.get("apikey"), testServiceRoleKey);
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      primaryError = new Error(redactSecrets(rawMessage, knownSecrets));
    } finally {
      const cleanupFailures: string[] = [];

      if (createdUserIds.length > 0) {
        const { error: deleteProfilesError } = await adminClient
          .from("profiles")
          .delete()
          .in("id", createdUserIds);

        if (deleteProfilesError) {
          cleanupFailures.push(
            `Failed to delete test profiles: ${redactSecrets(deleteProfilesError.message, knownSecrets)}`,
          );
        }

        for (const userId of createdUserIds) {
          const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
          if (deleteUserError) {
            cleanupFailures.push(
              `Failed to delete test auth user ${userId}: ${redactSecrets(deleteUserError.message, knownSecrets)}`,
            );
          }
        }

        const { data: remainingProfiles, error: verifyCleanupError } = await adminClient
          .from("profiles")
          .select("id")
          .in("id", createdUserIds);

        if (verifyCleanupError) {
          cleanupFailures.push(
            `Failed to verify profile cleanup: ${redactSecrets(verifyCleanupError.message, knownSecrets)}`,
          );
        } else if (remainingProfiles && remainingProfiles.length > 0) {
          cleanupFailures.push(
            `Cleanup incomplete: ${remainingProfiles.length} test profile row(s) still present.`,
          );
        }
      }

      if (primaryError) {
        if (cleanupFailures.length > 0) {
          console.error(cleanupFailures.join(" | "));
        }
        throw primaryError;
      }

      if (cleanupFailures.length > 0) {
        throw new Error(cleanupFailures.join(" | "));
      }
    }
  },
});
