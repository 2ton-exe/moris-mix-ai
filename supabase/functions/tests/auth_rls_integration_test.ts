import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { authenticateRequest } from "../_shared/auth.ts";
import { handler } from "../auth-session/index.ts";

const LINKED_PRODUCTION_PROJECT_REF = "gtbwblxskctpsqhbpebg";

const optInEnabled = (Deno.env.get("RUN_BE04_RLS_INTEGRATION") ?? "").trim() === "true";
const testSupabaseUrl = (Deno.env.get("BE04_RLS_TEST_SUPABASE_URL") ?? "").trim();
const testAnonKey = (
  Deno.env.get("BE04_RLS_TEST_SUPABASE_ANON_KEY") ??
  Deno.env.get("BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY") ??
  ""
).trim();
const testServiceRoleKey = (Deno.env.get("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

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
  missingPrerequisites.push("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY");
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

Deno.test({
  name: "Live PostgreSQL RLS enforcement on public.profiles allows own-profile reads and blocks cross-user reads (hosted integration)",
  ignore: !canRunLiveRlsIntegration,
  fn: async () => {
    const knownSecrets = [testAnonKey, testServiceRoleKey];
    validateDedicatedTestTarget(testSupabaseUrl, testAnonKey, testServiceRoleKey);

    const adminClient = createClient(testSupabaseUrl, testServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

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

      const anonClientA = createClient(testSupabaseUrl, testAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
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

      const anonClientB = createClient(testSupabaseUrl, testAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
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
