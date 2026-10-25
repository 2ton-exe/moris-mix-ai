import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";
import { handler } from "../recipes/index.ts";
import {
  CreateRecipeRequestSchema,
  RecipeListResponseSchema,
  RecipeResponseSchema,
} from "../_shared/schemas.ts";
import {
  isLegacyServiceRoleJwt,
  isModernSecretKey,
} from "../../../run-local-tests.mjs";

const KNOWN_PRODUCTION_REF = "gtbwblxskctpsqhbpebg";
const TEST_SUPABASE_URL = "https://mock-test.supabase.co";
const TEST_ANON_KEY = "mock-anon-public-key-value";

const USER_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A_EMAIL = "user-a@morisscraps.test";
const USER_A_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYWFhYWFhYS1hYWFhLTRhYWEtOGFhYS1hYWFhYWFhYWFhYWEiLCJlbWFpbCI6InVzZXItYUBtb3Jpc3NjcmFwcy50ZXN0Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_user_a";

const USER_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_B_EMAIL = "user-b@morisscraps.test";
const USER_B_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYmJiYmJmYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJmYmJiYmIiLCJlbWFpbCI6InVzZXItYkBtb3Jpc3NjcmFwcy50ZXN0Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_user_b";

const INVALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ.invalid_signature";

type RecipeRecord = {
  id: string;
  user_id: string;
  title: string;
  raw_input: string | null;
  notes: string | null;
  ingredients: Array<{ name: string; quantity: number | null; unit: string | null; inferred?: boolean }>;
  instructions: Array<{ step: number; text: string }>;
  flavor_scores: { sweet: number; salty: number; sour: number; bitter: number; umami: number; spicy: number } | null;
  star_rating: number | null;
  cooked_at: string | null;
  image_url: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type LineageRecord = {
  id: string;
  parent_recipe_id: string;
  child_recipe_id: string;
  created_at: string;
};

function sampleRecipeData(title: string, overrides: Partial<RecipeRecord> = {}): Omit<RecipeRecord, "id" | "user_id" | "created_at" | "updated_at"> {
  return {
    title,
    raw_input: "Sample ingredients text",
    notes: "Sample notes",
    ingredients: [{ name: "rice", quantity: 1, unit: "cup", inferred: false }],
    instructions: [{ step: 1, text: "Cook rice." }],
    flavor_scores: { sweet: 1, salty: 2, sour: 0, bitter: 0, umami: 3, spicy: 1 },
    star_rating: 4,
    cooked_at: "2026-10-24",
    image_url: null,
    is_public: false,
    ...overrides,
  };
}

function extractSupabaseProjectRef(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.supabase\.(?:co|net)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const norm = hostname.trim().toLowerCase();
  return norm === "localhost" || norm === "127.0.0.1" || norm === "::1" || norm === "[::1]";
}

export function validateDedicatedTestTarget(
  targetUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  expectedProjectRef: string,
): void {
  if (!targetUrl || !targetUrl.trim()) {
    throw new Error("Safety guard rejected test target: missing target URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    throw new Error("Safety guard rejected test target: target URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Safety guard rejected test target: hosted RLS tests must use HTTPS.");
  }
  if (isLoopbackHost(parsed.hostname)) {
    throw new Error("Safety guard rejected test target: hosted RLS tests must not target localhost/loopback.");
  }
  const derivedRef = extractSupabaseProjectRef(targetUrl);
  if (!derivedRef) {
    throw new Error("Safety guard rejected test target: unable to extract project reference from target URL.");
  }
  if (!expectedProjectRef || !expectedProjectRef.trim()) {
    throw new Error("Safety guard rejected test target: expected project reference must be configured.");
  }
  if (derivedRef.toLowerCase() !== expectedProjectRef.trim().toLowerCase()) {
    throw new Error(
      `Safety guard rejected test target: derived reference '${derivedRef}' does not match expected reference '${expectedProjectRef}'.`,
    );
  }
  if (
    derivedRef.toLowerCase() === KNOWN_PRODUCTION_REF.toLowerCase() ||
    targetUrl.toLowerCase().includes(KNOWN_PRODUCTION_REF.toLowerCase())
  ) {
    throw new Error("Safety guard rejected test target: refuses to run against primary production project.");
  }
  if (anonKey.trim() === serviceRoleKey.trim()) {
    throw new Error("Safety guard rejected test keys: anon key must not match service role key.");
  }
}

export type RlsConfigResult =
  | { shouldRun: false; isOptedIn: false; error?: undefined }
  | { shouldRun: true; isOptedIn: true; error?: string; url: string; anonKey: string; serviceRoleKey: string; expectedProjectRef: string; prefix: "BE06" | "BE04" };

export function resolveCredentialStateMachine(
  getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k),
  options: { required?: boolean } = {},
): RlsConfigResult {
  const isRequired =
    options.required === true ||
    (getEnv("REQUIRE_HOSTED_RLS_INTEGRATION") ?? "").trim().toLowerCase() === "true" ||
    (getEnv("HOSTED_RLS_REQUIRED") ?? "").trim().toLowerCase() === "true";
  const be07Flag = (getEnv("RUN_BE07_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const be07Enabled = be07Flag === "true" || be07Flag === "1";
  const be06Flag = (getEnv("RUN_BE06_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const be06Enabled = be06Flag === "true" || be06Flag === "1";
  const be04Flag = (getEnv("RUN_BE04_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const be04Enabled = be04Flag === "true" || be04Flag === "1";
  if (be07Enabled || isRequired || (!be06Enabled && be04Enabled)) {
    const url = (getEnv("BE04_RLS_TEST_SUPABASE_URL")?.trim() || "");
    const anon = (getEnv("BE04_RLS_TEST_SUPABASE_ANON_KEY")?.trim() || getEnv("BE04_RLS_TEST_SUPABASE_PUBLISHABLE_KEY")?.trim() || "");
    const service = (getEnv("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY")?.trim() || getEnv("BE04_RLS_TEST_SUPABASE_SECRET_KEY")?.trim() || "");
    const expected = (getEnv("BE04_RLS_TEST_EXPECTED_PROJECT_REF")?.trim() || getEnv("BE04_RLS_TEST_PROJECT_REF")?.trim() || "");
    const missing: string[] = [];
    if (!url) missing.push("BE04_RLS_TEST_SUPABASE_URL");
    if (!anon) missing.push("BE04_RLS_TEST_SUPABASE_ANON_KEY");
    if (!service) missing.push("BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY");
    if (!expected) missing.push("BE04_RLS_TEST_EXPECTED_PROJECT_REF");
    if (missing.length > 0) {
      return {
        shouldRun: true,
        isOptedIn: true,
        prefix: "BE04",
        error: be07Enabled
          ? `RUN_BE07_RLS_INTEGRATION requires the shared BE04 credential set, but credentials are incomplete: missing ${missing.join(", ")}.`
          : isRequired
          ? `Hosted RLS integration is required (shared BE04 credentials), but dedicated non-production test credentials are incomplete or unavailable: missing ${missing.join(", ")}.`
          : `RUN_BE04_RLS_INTEGRATION locked prefix BE04 but credentials are incomplete: missing ${missing.join(", ")}.`,
        url,
        anonKey: anon,
        serviceRoleKey: service,
        expectedProjectRef: expected,
      };
    }
    return { shouldRun: true, isOptedIn: true, prefix: "BE04", url, anonKey: anon, serviceRoleKey: service, expectedProjectRef: expected };
  }

  if (be06Enabled) {
    const url = (getEnv("BE06_RLS_TEST_SUPABASE_URL")?.trim() || "");
    const anon = (getEnv("BE06_RLS_TEST_SUPABASE_ANON_KEY")?.trim() || getEnv("BE06_RLS_TEST_SUPABASE_PUBLISHABLE_KEY")?.trim() || "");
    const service = (getEnv("BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY")?.trim() || getEnv("BE06_RLS_TEST_SUPABASE_SECRET_KEY")?.trim() || "");
    const expected = (getEnv("BE06_RLS_TEST_EXPECTED_PROJECT_REF")?.trim() || getEnv("BE06_RLS_TEST_PROJECT_REF")?.trim() || "");
    const missing: string[] = [];
    if (!url) missing.push("BE06_RLS_TEST_SUPABASE_URL");
    if (!anon) missing.push("BE06_RLS_TEST_SUPABASE_ANON_KEY");
    if (!service) missing.push("BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY");
    if (!expected) missing.push("BE06_RLS_TEST_EXPECTED_PROJECT_REF");
    if (missing.length > 0) {
      return {
        shouldRun: true,
        isOptedIn: true,
        prefix: "BE06",
        error: `RUN_BE06_RLS_INTEGRATION locked prefix BE06 but credentials are incomplete: missing ${missing.join(", ")}.`,
        url,
        anonKey: anon,
        serviceRoleKey: service,
        expectedProjectRef: expected,
      };
    }
    return { shouldRun: true, isOptedIn: true, prefix: "BE06", url, anonKey: anon, serviceRoleKey: service, expectedProjectRef: expected };
  }

  return { shouldRun: false, isOptedIn: false };
}

function sanitizeSecrets(message: string, secrets: string[]): string {
  let result = message;
  for (const s of secrets) {
    if (s && s.length > 0) {
      result = result.split(s).join("[REDACTED]");
    }
  }
  return result;
}

function createScopedTestClient(url: string, key: string, token?: string, customFetch?: typeof fetch): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      ...(customFetch ? { fetch: customFetch } : {}),
    },
  });
}

function createMockFetch(initialRecipes: RecipeRecord[] = []) {
  const store = new Map<string, RecipeRecord>(initialRecipes.map((r) => [r.id, { ...r }]));

  const mockFetch: typeof fetch = (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl);
    const headers = new Headers(init?.headers);
    const authHeader = headers.get("authorization") ?? "";

    if (url.pathname === "/auth/v1/user") {
      if (authHeader === `Bearer ${USER_A_JWT}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: USER_A_ID, aud: "authenticated", role: "authenticated", email: USER_A_EMAIL }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (authHeader === `Bearer ${USER_B_JWT}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: USER_B_ID, aud: "authenticated", role: "authenticated", email: USER_B_EMAIL }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "Invalid JWT", error_code: "invalid_jwt" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      const method = init?.method ?? "GET";
      const filterUserId = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      const filterId = url.searchParams.get("id")?.replace(/^eq\./, "");

      if (method === "GET") {
        let matching = Array.from(store.values());
        // Simulate PostgreSQL RLS: queries with authenticated bearer tokens are strictly owner-scoped
        if (authHeader === `Bearer ${USER_A_JWT}`) {
          matching = matching.filter((r) => r.user_id === USER_A_ID);
        } else if (authHeader === `Bearer ${USER_B_JWT}`) {
          matching = matching.filter((r) => r.user_id === USER_B_ID);
        }
        if (filterUserId) {
          matching = matching.filter((r) => r.user_id === filterUserId);
        }
        if (filterId) {
          matching = matching.filter((r) => r.id === filterId);
        }

        const accept = headers.get("accept") ?? "";
        if (accept.includes("application/vnd.pgrst.object+json")) {
          if (matching.length === 1) {
            return Promise.resolve(
              new Response(JSON.stringify(matching[0]), {
                status: 200,
                headers: { "Content-Type": "application/vnd.pgrst.object+json" },
              }),
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({ code: "PGRST116", details: "The result contains 0 rows", message: "JSON object requested, multiple (or no) rows returned" }),
              {
                status: 406,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify(matching), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (method === "PATCH") {
        const matching = Array.from(store.values()).filter((r) => {
          if (filterUserId && r.user_id !== filterUserId) return false;
          if (filterId && r.id !== filterId) return false;
          return true;
        });
        if (matching.length === 0) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        const body = JSON.parse(String(init?.body ?? "{}"));
        const target = matching[0];
        const updated: RecipeRecord = {
          ...target,
          ...body,
          updated_at: "2026-10-24T12:00:00.000Z",
        };
        store.set(target.id, updated);
        return Promise.resolve(
          new Response(JSON.stringify([updated]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (method === "DELETE") {
        const matching = Array.from(store.values()).filter((r) => {
          if (filterUserId && r.user_id !== filterUserId) return false;
          if (filterId && r.id !== filterId) return false;
          return true;
        });
        if (matching.length === 0) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        const target = matching[0];
        store.delete(target.id);
        return Promise.resolve(
          new Response(JSON.stringify([{ id: target.id }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  return { mockFetch, store };
}

export function isServiceRoleClient(client: SupabaseClient): boolean {
  const key = (client as unknown as { supabaseKey?: string })?.supabaseKey;
  if (!key) return false;
  return isLegacyServiceRoleJwt(key) || isModernSecretKey(key);
}

export function assertOwnerScopedClient(client: SupabaseClient, label = "assertion client"): void {
  if (isServiceRoleClient(client)) {
    throw new Error(
      `Security violation: ${label} is a service-role client. Service-role clients must be restricted to test setup and teardown, never used for assertion reads.`,
    );
  }
}

export function assertionClient(client: SupabaseClient, label = "assertion client"): SupabaseClient {
  assertOwnerScopedClient(client, label);
  return client;
}

export function assertCascadeLineagePrerequisite(result: {
  data: { id?: string; parent_recipe_id?: string; child_recipe_id?: string } | null;
  error: { message?: string } | null;
}): { id: string } {
  if (result.error) {
    throw new Error(
      `Cascade prerequisite failed: relationship insertion returned error: ${result.error.message ?? "unknown"}`,
    );
  }
  if (!result.data || !result.data.id) {
    throw new Error(
      "Cascade prerequisite failed: relationship insertion returned empty result without persisted row ID.",
    );
  }
  return { id: result.data.id };
}

export function evaluateCascadeVerification(params: {
  targetDeleted: "parent" | "child";
  hasSurvivingParent: boolean;
  ownerLineageRowCount: number;
}): { independentDeletionProven: boolean; limitationReason?: string } {
  if (params.targetDeleted === "parent") {
    return {
      independentDeletionProven: false,
      limitationReason:
        "Lineage SELECT policy requires parent recipe ownership. Once the parent is deleted, RLS hides any lingering lineage rows, making owner-scoped empty results inconclusive for physical deletion. Physical cascade relies on PostgreSQL foreign key constraint ON DELETE CASCADE.",
    };
  }

  if (params.hasSurvivingParent && params.ownerLineageRowCount === 0) {
    return {
      independentDeletionProven: true,
    };
  }

  return {
    independentDeletionProven: false,
    limitationReason: "Lineage row still observed or parent not surviving.",
  };
}

export type CleanupAdminClient = {
  from: (table: string) => {
    delete: () => {
      filter?: (column: string, operator: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
      in: (column: string, values: string[]) => PromiseLike<{ error: { message: string } | null }>;
      eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
  auth: {
    admin: {
      deleteUser: (uid: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export async function cleanupCrossUserRlsResources(
  adminClient: CleanupAdminClient,
  createdRecipeIds: string[],
  createdUserIds: string[],
  knownSecrets: string[] = [],
  primaryError: Error | null = null,
): Promise<void> {
  const cleanupErrors: string[] = [];

  const recordError = (action: string, error: unknown) => {
    const raw = error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
    cleanupErrors.push(`${action}: ${sanitizeSecrets(raw, knownSecrets)}`);
  };

  if (createdRecipeIds.length > 0) {
    try {
      const { error } = await adminClient
        .from("recipe_lineage")
        .delete()
        .in("parent_recipe_id", createdRecipeIds);
      if (error) {
        recordError("Failed cleaning recipe_lineage by parent", error);
      }
    } catch (e) {
      recordError("Failed cleaning recipe_lineage by parent (thrown)", e);
    }

    try {
      const { error } = await adminClient
        .from("recipe_lineage")
        .delete()
        .in("child_recipe_id", createdRecipeIds);
      if (error) {
        recordError("Failed cleaning recipe_lineage by child", error);
      }
    } catch (e) {
      recordError("Failed cleaning recipe_lineage by child (thrown)", e);
    }

    try {
      const { error } = await adminClient.from("recipes").delete().in("id", createdRecipeIds);
      if (error) {
        recordError("Failed cleaning recipes", error);
      }
    } catch (e) {
      recordError("Failed cleaning recipes (thrown)", e);
    }
  }

  for (const uid of createdUserIds) {
    try {
      const { error } = await adminClient.from("profiles").delete().eq("id", uid);
      if (error) {
        recordError(`Failed cleaning profile ${uid}`, error);
      }
    } catch (e) {
      recordError(`Failed cleaning profile ${uid} (thrown)`, e);
    }

    try {
      const { error } = await adminClient.auth.admin.deleteUser(uid);
      if (error) {
        recordError(`Failed deleting user ${uid}`, error);
      }
    } catch (e) {
      recordError(`Failed deleting user ${uid} (thrown)`, e);
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new Error(
      `${primaryError.message} | Cleanup errors: ${cleanupErrors.join("; ")}`,
      { cause: primaryError },
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Cleanup failed: ${cleanupErrors.join("; ")}`);
  }
}

Deno.test("Target safety guard strictly validates HTTPS, non-loopback, non-production ref, and matching project references", () => {
  validateDedicatedTestTarget(
    "https://valid-target-ref.supabase.co",
    "anon-valid-key",
    "service-valid-key",
    "valid-target-ref",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "http://valid-target-ref.supabase.co",
        "anon-valid-key",
        "service-valid-key",
        "valid-target-ref",
      ),
    Error,
    "HTTPS",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://127.0.0.1:54321",
        "anon-valid-key",
        "service-valid-key",
        "valid-target-ref",
      ),
    Error,
    "localhost/loopback",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        `https://${KNOWN_PRODUCTION_REF}.supabase.co`,
        "anon-valid-key",
        "service-valid-key",
        KNOWN_PRODUCTION_REF,
      ),
    Error,
    "primary production project",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://different-ref.supabase.co",
        "anon-valid-key",
        "service-valid-key",
        "expected-ref",
      ),
    Error,
    "does not match expected reference",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://valid-target-ref.supabase.co",
        "shared-key",
        "shared-key",
        "valid-target-ref",
      ),
    Error,
    "must not match",
  );
});

Deno.test("Credential state machine shares BE04 credentials with the BE07 lineage integration and fails closed on incomplete sets", () => {
  const envEmpty: Record<string, string> = {};
  assertEquals(resolveCredentialStateMachine((k) => envEmpty[k]).shouldRun, false);

  const envBe07Incomplete: Record<string, string> = {
    RUN_BE07_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
    BE06_RLS_TEST_SUPABASE_ANON_KEY: "be06-anon",
    BE06_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be06-service",
    BE06_RLS_TEST_EXPECTED_PROJECT_REF: "be06-test",
  };
  const be07IncompleteResult = resolveCredentialStateMachine((k) => envBe07Incomplete[k]);
  assertEquals(be07IncompleteResult.shouldRun, true);
  if (be07IncompleteResult.shouldRun) {
    assertEquals(be07IncompleteResult.prefix, "BE04");
    assertNotEquals(be07IncompleteResult.error, undefined);
    assertEquals(be07IncompleteResult.error?.includes("missing BE04_RLS_TEST_SUPABASE_ANON_KEY"), true);
  }

  const envBe07Complete: Record<string, string> = {
    RUN_BE07_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
    BE04_RLS_TEST_SUPABASE_ANON_KEY: "be04-anon",
    BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be04-service",
    BE04_RLS_TEST_EXPECTED_PROJECT_REF: "be04-test",
    RUN_BE04_RLS_INTEGRATION: "true",
  };
  const be07CompleteResult = resolveCredentialStateMachine((k) => envBe07Complete[k]);
  assertEquals(be07CompleteResult.shouldRun, true);
  if (be07CompleteResult.shouldRun) {
    assertEquals(be07CompleteResult.prefix, "BE04");
    assertEquals(be07CompleteResult.error, undefined);
    assertEquals(be07CompleteResult.url, "https://be04-test.supabase.co");
  }

  const envBe04Fallback: Record<string, string> = {
    RUN_BE04_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
    BE04_RLS_TEST_SUPABASE_ANON_KEY: "be04-anon",
    BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be04-service",
    BE04_RLS_TEST_EXPECTED_PROJECT_REF: "be04-test",
  };
  const be04FallbackResult = resolveCredentialStateMachine((k) => envBe04Fallback[k]);
  assertEquals(be04FallbackResult.shouldRun, true);
  if (be04FallbackResult.shouldRun) {
    assertEquals(be04FallbackResult.prefix, "BE04");
    assertEquals(be04FallbackResult.error, undefined);
  }
});

Deno.test("Layer 1: Deterministic mock - GET /recipes collection is scoped to caller and excludes other user recipes", async () => {
  const recipeA: RecipeRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Soup"),
  };
  const recipeB: RecipeRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:05:00.000Z",
    updated_at: "2026-10-24T10:05:00.000Z",
    ...sampleRecipeData("User B Roast"),
  };

  const { mockFetch } = createMockFetch([recipeA, recipeB]);

  const reqA = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resA = await handler(reqA, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resA.status, 200);
  const bodyA = await resA.json();
  const parsedA = RecipeListResponseSchema.safeParse(bodyA);
  assertEquals(parsedA.success, true);
  assertEquals(bodyA.recipes.length, 1);
  assertEquals(bodyA.recipes[0].id, recipeA.id);
  assertEquals(bodyA.recipes[0].user_id, USER_A_ID);

  const reqB = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_B_JWT}` },
  });
  const resB = await handler(reqB, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resB.status, 200);
  const bodyB = await resB.json();
  const parsedB = RecipeListResponseSchema.safeParse(bodyB);
  assertEquals(parsedB.success, true);
  assertEquals(bodyB.recipes.length, 1);
  assertEquals(bodyB.recipes[0].id, recipeB.id);
  assertEquals(bodyB.recipes[0].user_id, USER_B_ID);
});

Deno.test("Layer 1: Deterministic mock - GET /recipes/:id retrieves own recipe and returns 404 for other user recipe UUID", async () => {
  const recipeA: RecipeRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Bread"),
  };
  const recipeB: RecipeRecord = {
    id: "44444444-4444-4444-8444-444444444444",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Salad"),
  };

  const { mockFetch } = createMockFetch([recipeA, recipeB]);

  const reqOwn = new Request(`http://localhost/functions/v1/recipes/${recipeA.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resOwn = await handler(reqOwn, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resOwn.status, 200);
  const bodyOwn = await resOwn.json();
  const parsedOwn = RecipeResponseSchema.safeParse(bodyOwn);
  assertEquals(parsedOwn.success, true);
  assertEquals(bodyOwn.recipe.id, recipeA.id);

  const reqCross = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resCross = await handler(reqCross, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resCross.status, 404);
  const bodyCross = await resCross.json();
  assertEquals(bodyCross.error.code, "NOT_FOUND");
  assertEquals(bodyCross.error.message, "Recipe not found.");
  assertEquals(bodyCross.recipe, undefined);
});

Deno.test("Layer 1: Deterministic mock - PATCH /recipes/:id updates own recipe and returns 404 leaving other user recipe untouched", async () => {
  const recipeA: RecipeRecord = {
    id: "55555555-5555-4555-8555-555555555555",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Stew"),
  };
  const recipeB: RecipeRecord = {
    id: "66666666-6666-4666-8666-666666666666",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Tart"),
  };

  const { mockFetch, store } = createMockFetch([recipeA, recipeB]);

  const reqOwn = new Request(`http://localhost/functions/v1/recipes/${recipeA.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${USER_A_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "User A Stew Renovated", star_rating: 5 }),
  });
  const resOwn = await handler(reqOwn, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resOwn.status, 200);
  const bodyOwn = await resOwn.json();
  assertEquals(bodyOwn.recipe.title, "User A Stew Renovated");
  assertEquals(bodyOwn.recipe.star_rating, 5);
  assertEquals(store.get(recipeA.id)?.title, "User A Stew Renovated");

  const reqCross = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${USER_A_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Attacker Malicious Override", star_rating: 1 }),
  });
  const resCross = await handler(reqCross, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resCross.status, 404);
  const bodyCross = await resCross.json();
  assertEquals(bodyCross.error.code, "NOT_FOUND");
  assertEquals(store.get(recipeB.id)?.title, "User B Tart");
  assertEquals(store.get(recipeB.id)?.star_rating, 4);
});

Deno.test("Layer 1: Deterministic mock - DELETE /recipes/:id deletes own recipe and returns 404 leaving other user recipe intact", async () => {
  const recipeA: RecipeRecord = {
    id: "77777777-7777-4777-8777-777777777777",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User A Pasta"),
  };
  const recipeB: RecipeRecord = {
    id: "88888888-8888-4888-8888-888888888888",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Pizza"),
  };

  const { mockFetch, store } = createMockFetch([recipeA, recipeB]);

  const reqCross = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resCross = await handler(reqCross, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resCross.status, 404);
  assertEquals(store.has(recipeB.id), true);

  const reqOwn = new Request(`http://localhost/functions/v1/recipes/${recipeA.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resOwn = await handler(reqOwn, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resOwn.status, 204);
  assertEquals(store.has(recipeA.id), false);
  assertEquals(store.has(recipeB.id), true);
});

Deno.test("Layer 1: Deterministic mock - Missing and invalid authentication return 401 UNAUTHORIZED before any database operation", async () => {
  const { mockFetch, store } = createMockFetch();

  const reqMissing = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
  });
  const resMissing = await handler(reqMissing, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resMissing.status, 401);
  const bodyMissing = await resMissing.json();
  assertEquals(bodyMissing.error.code, "UNAUTHORIZED");

  const reqInvalid = new Request("http://localhost/functions/v1/recipes", {
    method: "GET",
    headers: { Authorization: `Bearer ${INVALID_JWT}` },
  });
  const resInvalid = await handler(reqInvalid, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resInvalid.status, 401);
  const bodyInvalid = await resInvalid.json();
  assertEquals(bodyInvalid.error.code, "UNAUTHORIZED");
  assertEquals(store.size, 0);
});

const activeRlsConfig = resolveCredentialStateMachine();

Deno.test({
  name: "Live PostgreSQL cross-user authorization, PostgREST RLS, and recipe lineage enforcement (hosted integration)",
  ignore: !activeRlsConfig.shouldRun,
  fn: async () => {
    if (!activeRlsConfig.shouldRun) return;
    if (activeRlsConfig.error) {
      throw new Error(activeRlsConfig.error);
    }

    validateDedicatedTestTarget(
      activeRlsConfig.url,
      activeRlsConfig.anonKey,
      activeRlsConfig.serviceRoleKey,
      activeRlsConfig.expectedProjectRef,
    );

    const knownSecrets: string[] = [activeRlsConfig.anonKey, activeRlsConfig.serviceRoleKey];
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const userAEmail = `be07-a-${runId}@morisscraps.test`;
    const userBEmail = `be07-b-${runId}@morisscraps.test`;
    const userAPassword = `PassA!${crypto.randomUUID()}9`;
    const userBPassword = `PassB!${crypto.randomUUID()}9`;
    knownSecrets.push(userAPassword, userBPassword);

    const adminClient = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.serviceRoleKey);
    const createdUserIds: string[] = [];
    const createdRecipeIds: string[] = [];
    let primaryError: Error | null = null;

    try {
      const { data: userARes, error: errCreateA } = await adminClient.auth.admin.createUser({
        email: userAEmail,
        password: userAPassword,
        email_confirm: true,
      });
      if (errCreateA || !userARes?.user?.id) {
        throw new Error(`Failed to create test user A: ${errCreateA?.message}`);
      }
      const userAId = userARes.user.id;
      createdUserIds.push(userAId);

      const { data: userBRes, error: errCreateB } = await adminClient.auth.admin.createUser({
        email: userBEmail,
        password: userBPassword,
        email_confirm: true,
      });
      if (errCreateB || !userBRes?.user?.id) {
        throw new Error(`Failed to create test user B: ${errCreateB?.message}`);
      }
      const userBId = userBRes.user.id;
      createdUserIds.push(userBId);

      const anonClient = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.anonKey);
      const { data: signInA, error: errSignA } = await anonClient.auth.signInWithPassword({
        email: userAEmail,
        password: userAPassword,
      });
      if (errSignA || !signInA?.session?.access_token) {
        throw new Error(`Failed to sign in user A: ${errSignA?.message}`);
      }
      const userAJwt = signInA.session.access_token;
      knownSecrets.push(userAJwt);

      const { data: signInB, error: errSignB } = await anonClient.auth.signInWithPassword({
        email: userBEmail,
        password: userBPassword,
      });
      if (errSignB || !signInB?.session?.access_token) {
        throw new Error(`Failed to sign in user B: ${errSignB?.message}`);
      }
      const userBJwt = signInB.session.access_token;
      knownSecrets.push(userBJwt);

      const rlsClientA = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.anonKey, userAJwt);
      const rlsClientB = createScopedTestClient(activeRlsConfig.url, activeRlsConfig.anonKey, userBJwt);

      assertOwnerScopedClient(rlsClientA, "User A client");
      assertOwnerScopedClient(rlsClientB, "User B client");

      const createRecipe = async (client: SupabaseClient, ownerId: string, title: string): Promise<string> => {
        const payload = sampleRecipeData(title);
        const { data, error } = await client
          .from("recipes")
          .insert({ ...payload, user_id: ownerId })
          .select("id")
          .single();
        if (error || !data?.id) {
          throw new Error(`Failed to insert test recipe '${title}': ${error?.message}`);
        }
        createdRecipeIds.push(data.id);
        return data.id;
      };

      const handlerRecipeA = await createRecipe(rlsClientA, userAId, "Live Handler Recipe A");
      const handlerRecipeB = await createRecipe(rlsClientB, userBId, "Live Handler Recipe B");

      const reqListA = new Request("http://localhost/functions/v1/recipes", {
        method: "GET",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resListA = await handler(reqListA, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resListA.status, 200);
      const bodyListA = await resListA.json();
      const idsListA = (bodyListA.recipes as Array<{ id: string }>).map((r) => r.id);
      assertEquals(idsListA.includes(handlerRecipeA), true);
      assertEquals(idsListA.includes(handlerRecipeB), false);

      const reqCrossGet = new Request(`http://localhost/functions/v1/recipes/${handlerRecipeB}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resCrossGet = await handler(reqCrossGet, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resCrossGet.status, 404);
      const bodyCrossGet = await resCrossGet.json();
      assertEquals(bodyCrossGet.error.code, "NOT_FOUND");
      assertEquals(bodyCrossGet.recipe, undefined);

      const reqCrossPatch = new Request(`http://localhost/functions/v1/recipes/${handlerRecipeB}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${userAJwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Attacker Malicious Live Title", star_rating: 1 }),
      });
      const resCrossPatch = await handler(reqCrossPatch, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resCrossPatch.status, 404);

      const { data: verifyRowB } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("title, star_rating").eq("id", handlerRecipeB).single();
      assertEquals(verifyRowB?.title, "Live Handler Recipe B");
      assertEquals(verifyRowB?.star_rating, 4);

      const reqCrossDelete = new Request(`http://localhost/functions/v1/recipes/${handlerRecipeB}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resCrossDelete = await handler(reqCrossDelete, { supabaseUrl: activeRlsConfig.url, supabaseAnonKey: activeRlsConfig.anonKey });
      assertEquals(resCrossDelete.status, 404);

      const { data: verifyStillPresentB } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("id").eq("id", handlerRecipeB).single();
      assertEquals(verifyStillPresentB?.id, handlerRecipeB);

      const directRecipeA = await createRecipe(rlsClientA, userAId, "Direct Recipe A");
      const directRecipeB = await createRecipe(rlsClientB, userBId, "Direct Recipe B");

      const { data: readCrossData, error: readCrossErr } = await rlsClientA
        .from("recipes")
        .select("id")
        .eq("id", directRecipeB)
        .maybeSingle();
      assertEquals(readCrossErr, null);
      assertEquals(readCrossData, null);

      const { data: readAllA, error: readAllAErr } = await rlsClientA.from("recipes").select("id, user_id");
      assertEquals(readAllAErr, null);
      const returnedIds = (readAllA ?? []).map((r: { id: string }) => r.id);
      assertEquals(returnedIds.includes(directRecipeA), true);
      assertEquals(returnedIds.includes(directRecipeB), false);

      const { data: updateCrossData, error: updateCrossErr } = await rlsClientA
        .from("recipes")
        .update({ title: "Attacker Bypass Title" })
        .eq("id", directRecipeB)
        .select("id");
      assertEquals(updateCrossErr, null);
      assertEquals(updateCrossData, []);

      const { data: verifyDirectB } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("title").eq("id", directRecipeB).single();
      assertEquals(verifyDirectB?.title, "Direct Recipe B");

      const { data: deleteCrossData, error: deleteCrossErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", directRecipeB)
        .select("id");
      assertEquals(deleteCrossErr, null);
      assertEquals(deleteCrossData, []);

      const { data: verifyStillExistsDirectB } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("id").eq("id", directRecipeB).single();
      assertEquals(verifyStillExistsDirectB?.id, directRecipeB);

      const forgedRecipeId = crypto.randomUUID();
      const { data: forgedData, error: forgedErr } = await rlsClientA
        .from("recipes")
        .insert({ ...sampleRecipeData("Forged Owner Recipe"), id: forgedRecipeId, user_id: userBId })
        .select("id");
      assertEquals(forgedData, null);
      assertNotEquals(forgedErr, null);
      assertEquals(forgedErr?.code, "42501");

      const { data: verifyForgedB } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("id").eq("id", forgedRecipeId).maybeSingle();
      assertEquals(verifyForgedB, null);
      const { data: verifyForgedA } = await assertionClient(rlsClientA, "User A assertion client").from("recipes").select("id").eq("id", forgedRecipeId).maybeSingle();
      assertEquals(verifyForgedA, null);

      const { data: transferData, error: transferErr } = await rlsClientA
        .from("recipes")
        .update({ user_id: userBId })
        .eq("id", directRecipeA)
        .select("id");
      assertEquals(transferData, null);
      assertNotEquals(transferErr, null);
      assertEquals(transferErr?.code, "42501");

      const { data: verifyTransferA } = await assertionClient(rlsClientA, "User A assertion client").from("recipes").select("user_id").eq("id", directRecipeA).single();
      assertEquals(verifyTransferA?.user_id, userAId);
      const { data: verifyTransferB } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("id").eq("id", directRecipeA).maybeSingle();
      assertEquals(verifyTransferB, null);

      const s1Parent = await createRecipe(rlsClientA, userAId, "Scenario 1 Parent");
      const s1Child = await createRecipe(rlsClientA, userAId, "Scenario 1 Child");
      const { data: s1Lineage, error: s1LineageErr } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s1Parent, child_recipe_id: s1Child })
        .select("id, parent_recipe_id, child_recipe_id")
        .single();
      assertEquals(s1LineageErr, null);
      assertEquals(s1Lineage?.parent_recipe_id, s1Parent);
      assertEquals(s1Lineage?.child_recipe_id, s1Child);

      const { data: s1Query, error: s1QueryErr } = await assertionClient(rlsClientA, "User A assertion client")
        .from("recipe_lineage")
        .select("id, parent_recipe_id, child_recipe_id")
        .eq("parent_recipe_id", s1Parent);
      assertEquals(s1QueryErr, null);
      assertEquals(s1Query?.length, 1);
      assertEquals(s1Query?.[0].child_recipe_id, s1Child);

      const s2ParentA = await createRecipe(rlsClientA, userAId, "Scenario 2 Parent A");
      const s2ChildB = await createRecipe(rlsClientB, userBId, "Scenario 2 Child B");
      const { data: s2Data, error: s2Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s2ParentA, child_recipe_id: s2ChildB })
        .select("id");
      assertEquals(s2Data, null);
      assertNotEquals(s2Err, null);
      assertEquals(s2Err?.code, "42501");

      const { data: verifyS2A } = await assertionClient(rlsClientA, "User A assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s2ParentA)
        .eq("child_recipe_id", s2ChildB);
      assertEquals(verifyS2A?.length, 0);
      const { data: verifyS2B } = await assertionClient(rlsClientB, "User B assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s2ParentA)
        .eq("child_recipe_id", s2ChildB);
      assertEquals(verifyS2B?.length, 0);

      const s3ParentB = await createRecipe(rlsClientB, userBId, "Scenario 3 Parent B");
      const s3ChildA = await createRecipe(rlsClientA, userAId, "Scenario 3 Child A");
      const { data: s3Data, error: s3Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s3ParentB, child_recipe_id: s3ChildA })
        .select("id");
      assertEquals(s3Data, null);
      assertNotEquals(s3Err, null);
      assertEquals(s3Err?.code, "42501");

      const { data: verifyS3B } = await assertionClient(rlsClientB, "User B assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s3ParentB)
        .eq("child_recipe_id", s3ChildA);
      assertEquals(verifyS3B?.length, 0);
      const { data: verifyS3A } = await assertionClient(rlsClientA, "User A assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s3ParentB)
        .eq("child_recipe_id", s3ChildA);
      assertEquals(verifyS3A?.length, 0);

      const s4ParentB = await createRecipe(rlsClientB, userBId, "Scenario 4 Parent B");
      const s4ChildB = await createRecipe(rlsClientB, userBId, "Scenario 4 Child B");
      const { data: s4Data, error: s4Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s4ParentB, child_recipe_id: s4ChildB })
        .select("id");
      assertEquals(s4Data, null);
      assertNotEquals(s4Err, null);
      assertEquals(s4Err?.code, "42501");

      const { data: verifyS4B } = await assertionClient(rlsClientB, "User B assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s4ParentB)
        .eq("child_recipe_id", s4ChildB);
      assertEquals(verifyS4B?.length, 0);

      const s5RecipeA = await createRecipe(rlsClientA, userAId, "Scenario 5 Recipe A");
      const { data: s5Data, error: s5Err } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s5RecipeA, child_recipe_id: s5RecipeA })
        .select("id");
      assertEquals(s5Data, null);
      assertNotEquals(s5Err, null);
      assertEquals(s5Err?.code, "23514");

      const { data: verifyS5A } = await assertionClient(rlsClientA, "User A assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s5RecipeA)
        .eq("child_recipe_id", s5RecipeA);
      assertEquals(verifyS5A?.length, 0);

      const s6ParentA = await createRecipe(rlsClientA, userAId, "Scenario 6 Parent A");
      const s6ChildA = await createRecipe(rlsClientA, userAId, "Scenario 6 Child A");
      const { data: s6FirstData, error: s6FirstErr } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s6ParentA, child_recipe_id: s6ChildA })
        .select("id");
      assertEquals(s6FirstErr, null);
      assertNotEquals(s6FirstData?.[0]?.id, undefined);

      const { data: s6DuplicateData, error: s6DuplicateErr } = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s6ParentA, child_recipe_id: s6ChildA })
        .select("id");
      assertEquals(s6DuplicateData, null);
      assertNotEquals(s6DuplicateErr, null);
      assertEquals(s6DuplicateErr?.code, "23505");

      const { data: verifyS6A } = await assertionClient(rlsClientA, "User A assertion client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s6ParentA)
        .eq("child_recipe_id", s6ChildA);
      assertEquals(verifyS6A?.length, 1);

      const s7ParentA = await createRecipe(rlsClientA, userAId, "Scenario 7 Parent A");
      const s7ChildA = await createRecipe(rlsClientA, userAId, "Scenario 7 Child A");
      const s7LineageInsert = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s7ParentA, child_recipe_id: s7ChildA })
        .select("id, parent_recipe_id, child_recipe_id")
        .single();
      assertCascadeLineagePrerequisite(s7LineageInsert);

      // Verify relationship exists and is queryable through owner client before parent deletion
      const { data: s7LineagePreDelete, error: s7LineagePreDeleteErr } = await assertionClient(rlsClientA, "User A pre-delete lineage verification client")
        .from("recipe_lineage")
        .select("id, parent_recipe_id, child_recipe_id")
        .eq("id", s7LineageInsert.data!.id)
        .single();
      assertEquals(s7LineagePreDeleteErr, null);
      assertEquals(s7LineagePreDelete?.id, s7LineageInsert.data!.id);
      assertEquals(s7LineagePreDelete?.parent_recipe_id, s7ParentA);
      assertEquals(s7LineagePreDelete?.child_recipe_id, s7ChildA);

      const { data: s7DeleteParentData, error: s7DeleteParentErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", s7ParentA)
        .select("id");
      assertEquals(s7DeleteParentErr, null);
      assertEquals(s7DeleteParentData?.length, 1);
      assertEquals(s7DeleteParentData?.[0]?.id, s7ParentA);

      const { data: verifyS7ParentDeleted } = await assertionClient(rlsClientA, "User A deleted parent verification client")
        .from("recipes")
        .select("id")
        .eq("id", s7ParentA)
        .maybeSingle();
      assertEquals(verifyS7ParentDeleted, null);

      const { data: verifyS7Child } = await assertionClient(rlsClientA, "User A child recipe intact verification client")
        .from("recipes")
        .select("id, title")
        .eq("id", s7ChildA)
        .single();
      assertEquals(verifyS7Child?.id, s7ChildA);
      assertEquals(verifyS7Child?.title, "Scenario 7 Child A");

      const { data: verifyS7Lineage } = await assertionClient(rlsClientA, "User A post-delete lineage query client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s7ParentA);
      assertEquals(
        verifyS7Lineage?.length,
        0,
        "PostgREST query returning zero rows confirms no lineage record is visible under RLS, but does not independently prove physical cascade deletion because lineage_select_own requires an existing parent recipe owned by the caller.",
      );

      // Distinguish dynamic verification from schema-level ON DELETE CASCADE:
      // The lineage_select_own policy requires parent recipe ownership. Once the parent is deleted,
      // RLS hides any lingering lineage rows from owner queries. Thus, verifyS7Lineage.length === 0
      // confirms no row leaks to the user, but does not independently prove physical deletion.
      // Physical deletion is guaranteed by PostgreSQL schema constraint:
      // 'parent_recipe_id uuid not null references public.recipes(id) on delete cascade'.
      const s7CascadeEval = evaluateCascadeVerification({
        targetDeleted: "parent",
        hasSurvivingParent: false,
        ownerLineageRowCount: verifyS7Lineage?.length ?? 0,
      });
      assertEquals(
        s7CascadeEval.independentDeletionProven,
        false,
        "Post-parent-deletion query returning zero rows must evaluate as unproven for physical deletion because RLS hides orphaned lineage rows from the caller once the parent recipe no longer exists.",
      );
      assertNotEquals(s7CascadeEval.limitationReason, undefined);

      const s8ParentA = await createRecipe(rlsClientA, userAId, "Scenario 8 Parent A");
      const s8ChildA = await createRecipe(rlsClientA, userAId, "Scenario 8 Child A");
      const s8LineageInsert = await rlsClientA
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s8ParentA, child_recipe_id: s8ChildA })
        .select("id, parent_recipe_id, child_recipe_id")
        .single();
      assertCascadeLineagePrerequisite(s8LineageInsert);

      // Verify relationship exists and is queryable through owner client before child deletion
      const { data: s8LineagePreDelete, error: s8LineagePreDeleteErr } = await assertionClient(rlsClientA, "User A pre-delete lineage verification client")
        .from("recipe_lineage")
        .select("id, parent_recipe_id, child_recipe_id")
        .eq("id", s8LineageInsert.data!.id)
        .single();
      assertEquals(s8LineagePreDeleteErr, null);
      assertEquals(s8LineagePreDelete?.id, s8LineageInsert.data!.id);

      const { data: s8DeleteChildData, error: s8DeleteChildErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", s8ChildA)
        .select("id");
      assertEquals(s8DeleteChildErr, null);
      assertEquals(s8DeleteChildData?.length, 1);
      assertEquals(s8DeleteChildData?.[0]?.id, s8ChildA);

      const { data: verifyS8ChildDeleted } = await assertionClient(rlsClientA, "User A deleted child verification client")
        .from("recipes")
        .select("id")
        .eq("id", s8ChildA)
        .maybeSingle();
      assertEquals(verifyS8ChildDeleted, null);

      const { data: verifyS8Parent } = await assertionClient(rlsClientA, "User A surviving parent verification client")
        .from("recipes")
        .select("id, title")
        .eq("id", s8ParentA)
        .single();
      assertEquals(verifyS8Parent?.id, s8ParentA);
      assertEquals(verifyS8Parent?.title, "Scenario 8 Parent A");

      const { data: verifyS8Lineage } = await assertionClient(rlsClientA, "User A post-delete lineage query client")
        .from("recipe_lineage")
        .select("id")
        .eq("parent_recipe_id", s8ParentA);
      assertEquals(verifyS8Lineage?.length, 0);

      // In child deletion, surviving parent s8ParentA exists and is owned by User A.
      // Under lineage_select_own, User A has select permission for s8ParentA's lineage rows.
      // Because the parent survived, 0 rows returned independently proves that ON DELETE CASCADE
      // physically removed the relationship from the database.
      const s8CascadeEval = evaluateCascadeVerification({
        targetDeleted: "child",
        hasSurvivingParent: true,
        ownerLineageRowCount: verifyS8Lineage?.length ?? 0,
      });
      assertEquals(s8CascadeEval.independentDeletionProven, true);
      assertEquals(s8CascadeEval.limitationReason, undefined);

      const s9ParentB = await createRecipe(rlsClientB, userBId, "Scenario 9 Parent B");
      const s9ChildB = await createRecipe(rlsClientB, userBId, "Scenario 9 Child B");
      const s9LineageInsert = await rlsClientB
        .from("recipe_lineage")
        .insert({ parent_recipe_id: s9ParentB, child_recipe_id: s9ChildB })
        .select("id")
        .single();
      assertCascadeLineagePrerequisite(s9LineageInsert);
      const s9LineageId = s9LineageInsert.data!.id;

      const { data: s9AttackLineageData, error: s9AttackLineageErr } = await rlsClientA
        .from("recipe_lineage")
        .delete()
        .eq("id", s9LineageId)
        .select("id");
      assertEquals(s9AttackLineageErr, null);
      assertEquals(s9AttackLineageData, []);

      const { data: s9AttackRecipeData, error: s9AttackRecipeErr } = await rlsClientA
        .from("recipes")
        .delete()
        .eq("id", s9ParentB)
        .select("id");
      assertEquals(s9AttackRecipeErr, null);
      assertEquals(s9AttackRecipeData, []);

      const { data: verifyS9Parent } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("id").eq("id", s9ParentB).single();
      assertEquals(verifyS9Parent?.id, s9ParentB);

      const { data: verifyS9Child } = await assertionClient(rlsClientB, "User B assertion client").from("recipes").select("id").eq("id", s9ChildB).single();
      assertEquals(verifyS9Child?.id, s9ChildB);

      const { data: verifyS9Lineage } = await assertionClient(rlsClientB, "User B assertion client").from("recipe_lineage").select("id").eq("id", s9LineageId).single();
      assertEquals(verifyS9Lineage?.id, s9LineageId);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      primaryError = new Error(sanitizeSecrets(raw, knownSecrets));
    } finally {
      await cleanupCrossUserRlsResources(
        adminClient as unknown as CleanupAdminClient,
        createdRecipeIds,
        createdUserIds,
        knownSecrets,
        primaryError,
      );
    }
  },
});

// =============================================================================
// Review Findings Regression Tests (BE-07)
// =============================================================================

Deno.test("Finding 1 regression: Service-role restriction prevents using admin/service-role client for assertion reads", () => {
  const legacyAdminClient = createScopedTestClient(
    "https://example.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig",
  );
  const fakeModernSecretKey = ["sb", "secret", "mock_service_key_for_test"].join("_");
  const fakeModernPublishableKey = ["sb", "publishable", "mock_client_key_for_test"].join("_");
  const modernAdminClient = createScopedTestClient(
    "https://example.supabase.co",
    fakeModernSecretKey,
  );
  const userClient = createScopedTestClient(
    "https://example.supabase.co",
    fakeModernPublishableKey,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig",
  );

  assertThrows(
    () => assertOwnerScopedClient(legacyAdminClient, "legacy admin client"),
    Error,
    "Security violation",
  );
  assertThrows(
    () => assertOwnerScopedClient(modernAdminClient, "modern admin client"),
    Error,
    "Security violation",
  );

  // Owner client passes without throwing
  assertOwnerScopedClient(userClient, "User client");
});

Deno.test("Finding 1 regression: assertionClient dynamically enforces owner scoping on actual assertion read paths and rejects service-role clients", () => {
  const legacyAdminClient = createScopedTestClient(
    "https://example.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig",
  );
  const fakeModernPublishableKey = ["sb", "publishable", "mock_client_key_for_test"].join("_");
  const userClient = createScopedTestClient(
    "https://example.supabase.co",
    fakeModernPublishableKey,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig",
  );

  // An assertion read path given an admin client throws immediately
  assertThrows(
    () => assertionClient(legacyAdminClient, "Assertion read path"),
    Error,
    "Security violation: Assertion read path is a service-role client",
  );

  // An assertion read path given an owner client passes and returns the client
  const verified = assertionClient(userClient, "User client assertion path");
  assertEquals(verified, userClient);
});

Deno.test("Finding 2 regression: Cleanup fails visibly on API-returned errors from recipes, lineage, profiles, and auth, while attempting all remaining cleanup operations", async () => {
  const operationsCalled: string[] = [];

  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string, _values: string[]) => {
          operationsCalled.push(`in:${table}:${column}`);
          if (table === "recipe_lineage") {
            return Promise.resolve({ error: { message: `Simulated lineage API error for ${column}` } });
          }
          if (table === "recipes") {
            return Promise.resolve({ error: { message: "Simulated recipe API error" } });
          }
          return Promise.resolve({ error: null });
        },
        eq: (_column: string, val: string) => {
          operationsCalled.push(`eq:${table}:${val}`);
          if (table === "profiles") {
            return Promise.resolve({ error: { message: `Simulated profile API error for ${val}` } });
          }
          return Promise.resolve({ error: null });
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: (uid: string) => {
          operationsCalled.push(`deleteUser:${uid}`);
          return Promise.resolve({ error: { message: `Simulated auth API error for ${uid}` } });
        },
      },
    },
  };

  let caughtError: Error | null = null;
  try {
    await cleanupCrossUserRlsResources(
      mockAdminClient,
      ["recipe-1", "recipe-2"],
      ["user-1", "user-2"],
      ["secret-token"],
    );
  } catch (err) {
    caughtError = err as Error;
  }

  assertNotEquals(caughtError, null);
  const msg = caughtError?.message ?? "";
  assertEquals(msg.includes("Cleanup failed:"), true);
  assertEquals(msg.includes("Simulated lineage API error for parent_recipe_id"), true);
  assertEquals(msg.includes("Simulated lineage API error for child_recipe_id"), true);
  assertEquals(msg.includes("Simulated recipe API error"), true);
  assertEquals(msg.includes("Simulated profile API error for user-1"), true);
  assertEquals(msg.includes("Simulated profile API error for user-2"), true);
  assertEquals(msg.includes("Simulated auth API error for user-1"), true);
  assertEquals(msg.includes("Simulated auth API error for user-2"), true);

  // Verify all operations were attempted despite earlier errors
  assertEquals(operationsCalled.includes("in:recipe_lineage:parent_recipe_id"), true);
  assertEquals(operationsCalled.includes("in:recipe_lineage:child_recipe_id"), true);
  assertEquals(operationsCalled.includes("in:recipes:id"), true);
  assertEquals(operationsCalled.includes("eq:profiles:user-1"), true);
  assertEquals(operationsCalled.includes("eq:profiles:user-2"), true);
  assertEquals(operationsCalled.includes("deleteUser:user-1"), true);
  assertEquals(operationsCalled.includes("deleteUser:user-2"), true);
});

Deno.test("Finding 2 regression: Cleanup handles thrown exceptions without masking primary error and executes remaining cleanup stages", async () => {
  const operationsCalled: string[] = [];

  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string) => {
          operationsCalled.push(`in:${table}:${column}`);
          if (table === "recipe_lineage" && column === "parent_recipe_id") {
            throw new Error("Network connection dropped during lineage cleanup");
          }
          if (table === "recipes") {
            return Promise.resolve({ error: { message: "Recipe delete returned 500" } });
          }
          return Promise.resolve({ error: null });
        },
        eq: () => {
          operationsCalled.push(`eq:${table}`);
          return Promise.resolve({ error: null });
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: (uid: string) => {
          operationsCalled.push(`deleteUser:${uid}`);
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  const primaryError = new Error("Test scenario assertion failed");
  let caughtError: Error | null = null;
  try {
    await cleanupCrossUserRlsResources(
      mockAdminClient,
      ["recipe-1"],
      ["user-1"],
      [],
      primaryError,
    );
  } catch (err) {
    caughtError = err as Error;
  }

  assertNotEquals(caughtError, null);
  assertEquals(caughtError?.message.includes("Test scenario assertion failed"), true);
  assertEquals(caughtError?.message.includes("Network connection dropped during lineage cleanup"), true);
  assertEquals(caughtError?.message.includes("Recipe delete returned 500"), true);
  assertEquals(caughtError?.cause, primaryError);

  // Confirms subsequent stages were still executed despite thrown error in first stage
  assertEquals(operationsCalled.includes("in:recipe_lineage:child_recipe_id"), true);
  assertEquals(operationsCalled.includes("in:recipes:id"), true);
  assertEquals(operationsCalled.includes("deleteUser:user-1"), true);
});

Deno.test("Finding 2 regression: Cleanup failure preserves primary test error and chains cause", async () => {
  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        filter: () => Promise.resolve({ error: null }),
        in: () => {
          if (table === "recipes") {
            return Promise.resolve({ error: { message: "Cleanup DB error" } });
          }
          return Promise.resolve({ error: null });
        },
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: () => Promise.resolve({ error: null }),
      },
    },
  };

  const primaryError = new Error("Primary test scenario assertion failed");
  let caughtError: Error | null = null;
  try {
    await cleanupCrossUserRlsResources(
      mockAdminClient,
      ["recipe-1"],
      ["user-1"],
      [],
      primaryError,
    );
  } catch (err) {
    caughtError = err as Error;
  }

  assertNotEquals(caughtError, null);
  assertEquals(caughtError?.message.includes("Primary test scenario assertion failed"), true);
  assertEquals(caughtError?.message.includes("Cleanup errors: Failed cleaning recipes: Cleanup DB error"), true);
  assertEquals(caughtError?.cause, primaryError);
});

Deno.test("Finding 2 regression: Successful cleanup completes without throwing errors", async () => {
  const operationsCalled: string[] = [];

  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        filter: () => {
          operationsCalled.push(`filter:${table}`);
          return Promise.resolve({ error: null });
        },
        in: () => {
          operationsCalled.push(`in:${table}`);
          return Promise.resolve({ error: null });
        },
        eq: () => {
          operationsCalled.push(`eq:${table}`);
          return Promise.resolve({ error: null });
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: (uid: string) => {
          operationsCalled.push(`deleteUser:${uid}`);
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  await cleanupCrossUserRlsResources(
    mockAdminClient,
    ["recipe-1"],
    ["user-1"],
  );

  assertEquals(operationsCalled.length >= 4, true);
});

Deno.test("Finding 3 regression: Direct PostgREST queries filtered by RLS assert zero-row results rather than HTTP errors", async () => {
  const recipeB: RecipeRecord = {
    id: "99999999-9999-4999-8999-999999999999",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Private Recipe"),
  };
  const { mockFetch } = createMockFetch([recipeB]);

  const clientA = createScopedTestClient(TEST_SUPABASE_URL, TEST_ANON_KEY, USER_A_JWT, mockFetch);
  const clientB = createScopedTestClient(TEST_SUPABASE_URL, TEST_ANON_KEY, USER_B_JWT, mockFetch);

  // User A directly queries PostgREST for User B's recipe ID
  // Under PostgreSQL RLS (recipes_select_own), rows where user_id <> auth.uid() are filtered out
  // PostgREST returns an empty array [], so maybeSingle() evaluates to { data: null, error: null }
  const { data: dataA, error: errorA } = await assertionClient(clientA, "User A PostgREST client")
    .from("recipes")
    .select("id")
    .eq("id", recipeB.id)
    .maybeSingle();

  assertEquals(errorA, null);
  assertEquals(dataA, null); // Direct PostgREST query under RLS returns zero rows, NOT an HTTP error

  // User B directly queries PostgREST for own recipe ID -> returns row
  const { data: dataB, error: errorB } = await assertionClient(clientB, "User B PostgREST client")
    .from("recipes")
    .select("id")
    .eq("id", recipeB.id)
    .maybeSingle();

  assertEquals(errorB, null);
  assertEquals(dataB?.id, recipeB.id); // Owner successfully reads own record
});

Deno.test("Finding 3 regression: Edge Function handler translates inaccessible or other-user recipes into HTTP 404 NOT_FOUND", async () => {
  const recipeB: RecipeRecord = {
    id: "99999999-9999-4999-8999-999999999999",
    user_id: USER_B_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("User B Private Soup"),
  };
  const { mockFetch } = createMockFetch([recipeB]);

  // User A calls Edge Function GET /recipes/:id -> Handler maps zero-row query result to HTTP 404
  const reqA = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const resA = await handler(reqA, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resA.status, 404);
  const bodyA = await resA.json();
  assertEquals(bodyA.error.code, "NOT_FOUND");
  assertEquals(bodyA.recipe, undefined);

  // User B calls Edge Function GET /recipes/:id -> Handler returns HTTP 200 with recipe envelope
  const reqB = new Request(`http://localhost/functions/v1/recipes/${recipeB.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_B_JWT}` },
  });
  const resB = await handler(reqB, { supabaseUrl: TEST_SUPABASE_URL, supabaseAnonKey: TEST_ANON_KEY, fetch: mockFetch });
  assertEquals(resB.status, 200);
  const bodyB = await resB.json();
  assertEquals(bodyB.recipe.id, recipeB.id);
});

Deno.test("Finding 3 regression: Assert cascade prerequisites rejects error or empty insertion result before cascade deletion", () => {
  // Test case 1: Insertion returned API error
  assertThrows(
    () =>
      assertCascadeLineagePrerequisite({
        data: null,
        error: { message: "violates foreign key constraint or RLS policy" },
      }),
    Error,
    "Cascade prerequisite failed: relationship insertion returned error",
  );

  // Test case 2: Insertion returned empty data (data: null, error: null)
  assertThrows(
    () =>
      assertCascadeLineagePrerequisite({
        data: null,
        error: null,
      }),
    Error,
    "Cascade prerequisite failed: relationship insertion returned empty result",
  );

  // Test case 3: Insertion returned empty object without ID
  assertThrows(
    () =>
      assertCascadeLineagePrerequisite({
        data: {} as { id: string },
        error: null,
      }),
    Error,
    "Cascade prerequisite failed: relationship insertion returned empty result without persisted row ID",
  );

  // Test case 4: Valid persisted row passes and returns id
  const valid = assertCascadeLineagePrerequisite({
    data: { id: "lineage-uuid-1234", parent_recipe_id: "parent-1", child_recipe_id: "child-1" },
    error: null,
  });
  assertEquals(valid.id, "lineage-uuid-1234");
});

Deno.test("Finding 3 regression: Simulated lineage scenario fails on insertion failure rather than allowing zero-row cascade assertion to pass", async () => {
  let cascadeDeletionExecuted = false;

  const simulateScenario7 = async (simulateInsertFailure: boolean) => {
    // 1. Create parent & child
    const parentId = "parent-uuid";
    const childId = "child-uuid";

    // 2. Insert lineage
    const lineageInsertResult = simulateInsertFailure
      ? { data: null, error: { message: "Simulated insert failure" } }
      : { data: { id: "lineage-uuid", parent_recipe_id: parentId, child_recipe_id: childId }, error: null };

    // Cascade prerequisite check
    assertCascadeLineagePrerequisite(lineageInsertResult);

    // 3. Parent deletion (should not be reached if prerequisite failed)
    cascadeDeletionExecuted = true;
  };

  // When insertion fails, scenario must throw and not execute deletion
  await assertRejects(
    async () => {
      await simulateScenario7(true);
    },
    Error,
    "Cascade prerequisite failed",
  );
  assertEquals(cascadeDeletionExecuted, false);

  // When insertion succeeds, scenario proceeds to deletion
  await simulateScenario7(false);
  assertEquals(cascadeDeletionExecuted, true);
});

Deno.test("Finding 4 regression: Parent-deletion cascade verifies prerequisite insertion, parent deletion, and child preservation without falsely claiming RLS-hidden row proves physical deletion", async () => {
  const parentRecipe: RecipeRecord = {
    id: "77777777-7777-4777-8777-777777777771",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("Parent Recipe"),
  };
  const childRecipe: RecipeRecord = {
    id: "77777777-7777-4777-8777-777777777772",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:05:00.000Z",
    updated_at: "2026-10-24T10:05:00.000Z",
    ...sampleRecipeData("Child Recipe"),
  };

  const { mockFetch, store } = createMockFetch([parentRecipe, childRecipe]);
  const clientA = createScopedTestClient(TEST_SUPABASE_URL, TEST_ANON_KEY, USER_A_JWT, mockFetch);

  // 1. Verify prerequisite insertion
  const lineageRow = { id: "lineage-7777", parent_recipe_id: parentRecipe.id, child_recipe_id: childRecipe.id };
  const insertResult = { data: lineageRow, error: null };
  const prereq = assertCascadeLineagePrerequisite(insertResult);
  assertEquals(prereq.id, "lineage-7777");

  // 2. Parent deletion succeeds and returns deleted ID
  const { data: deleteData, error: deleteErr } = await clientA
    .from("recipes")
    .delete()
    .eq("id", parentRecipe.id)
    .select("id");
  assertEquals(deleteErr, null);
  assertEquals(deleteData?.length, 1);
  assertEquals(deleteData?.[0]?.id, parentRecipe.id);
  assertEquals(store.has(parentRecipe.id), false);

  // 3. Child recipe remains accessible and intact
  const { data: childData, error: childErr } = await clientA
    .from("recipes")
    .select("id, title")
    .eq("id", childRecipe.id)
    .single();
  assertEquals(childErr, null);
  assertEquals(childData?.id, childRecipe.id);
  assertEquals(childData?.title, "Child Recipe");

  // 4. Cascade verification evaluation:
  // Post-deletion query from owner returns 0 rows due to RLS hiding
  const cascadeEval = evaluateCascadeVerification({
    targetDeleted: "parent",
    hasSurvivingParent: false,
    ownerLineageRowCount: 0,
  });
  // Must NOT treat RLS hiding as independent proof of physical deletion
  assertEquals(
    cascadeEval.independentDeletionProven,
    false,
    "PostgREST query returning zero rows after parent deletion cannot independently prove physical cascade deletion because lineage_select_own hides orphaned lineage rows when the parent recipe is missing.",
  );
  assertEquals(
    cascadeEval.limitationReason?.includes("Lineage SELECT policy requires parent recipe ownership"),
    true,
  );
});

Deno.test("Finding 4 regression: Child-deletion cascade independently proves lineage deletion via surviving parent ownership", async () => {
  const parentRecipe: RecipeRecord = {
    id: "88888888-8888-4888-8888-888888888881",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    ...sampleRecipeData("Surviving Parent"),
  };
  const childRecipe: RecipeRecord = {
    id: "88888888-8888-4888-8888-888888888882",
    user_id: USER_A_ID,
    created_at: "2026-10-24T10:05:00.000Z",
    updated_at: "2026-10-24T10:05:00.000Z",
    ...sampleRecipeData("Deleted Child"),
  };

  const { mockFetch, store } = createMockFetch([parentRecipe, childRecipe]);
  const clientA = createScopedTestClient(TEST_SUPABASE_URL, TEST_ANON_KEY, USER_A_JWT, mockFetch);

  // 1. Prerequisite verification
  const insertResult = { data: { id: "lineage-8888", parent_recipe_id: parentRecipe.id, child_recipe_id: childRecipe.id }, error: null };
  assertCascadeLineagePrerequisite(insertResult);

  // 2. Child deletion succeeds
  const { data: deleteChild, error: deleteChildErr } = await clientA
    .from("recipes")
    .delete()
    .eq("id", childRecipe.id)
    .select("id");
  assertEquals(deleteChildErr, null);
  assertEquals(deleteChild?.length, 1);
  assertEquals(store.has(childRecipe.id), false);

  // 3. Parent recipe remains accessible and intact
  const { data: parentData, error: parentErr } = await clientA
    .from("recipes")
    .select("id, title")
    .eq("id", parentRecipe.id)
    .single();
  assertEquals(parentErr, null);
  assertEquals(parentData?.id, parentRecipe.id);
  assertEquals(parentData?.title, "Surviving Parent");

  // 4. Cascade verification evaluation:
  // Because surviving parent exists, owner would have RLS select permission.
  // 0 rows returned independently proves physical deletion.
  const cascadeEval = evaluateCascadeVerification({
    targetDeleted: "child",
    hasSurvivingParent: true,
    ownerLineageRowCount: 0,
  });
  assertEquals(cascadeEval.independentDeletionProven, true);
  assertEquals(cascadeEval.limitationReason, undefined);
});

Deno.test("Finding 4 regression: Simulated orphan lineage row confirms RLS hides uncascaded rows after parent deletion", () => {
  // Simulates hypothetical situation where parent recipe was deleted from public.recipes,
  // but an orphan row lingered in public.recipe_lineage (e.g. if cascade had failed).
  const existingRecipes = [
    { id: "child-recipe-uuid", user_id: USER_A_ID },
  ]; // parent-recipe-uuid has been deleted!

  const lingeringLineageRow = {
    id: "lingering-lineage-uuid",
    parent_recipe_id: "parent-recipe-uuid",
    child_recipe_id: "child-recipe-uuid",
  };

  // Simulating RLS policy lineage_select_own:
  // exists (select 1 from public.recipes where id = public.recipe_lineage.parent_recipe_id and user_id = auth.uid())
  const userAId = USER_A_ID;
  const satisfiesRls = existingRecipes.some(
    (r) => r.id === lingeringLineageRow.parent_recipe_id && r.user_id === userAId,
  );

  // RLS evaluates to false because parent recipe no longer exists
  assertEquals(satisfiesRls, false);

  // An owner query would return 0 rows even though lingeringLineageRow exists in the database
  const queryResultRows = satisfiesRls ? [lingeringLineageRow] : [];
  assertEquals(queryResultRows.length, 0);

  // Confirms evaluateCascadeVerification correctly flags this as inconclusive rather than proven deletion
  const cascadeEval = evaluateCascadeVerification({
    targetDeleted: "parent",
    hasSurvivingParent: false,
    ownerLineageRowCount: queryResultRows.length,
  });
  assertEquals(
    cascadeEval.independentDeletionProven,
    false,
    "Simulated orphan row confirms empty PostgREST query results cannot prove physical cascade deletion.",
  );
});

// ============================================================================
// Review Findings Regression Tests: BE-07 Verification and Cleanup
// ============================================================================

Deno.test("Finding 1 review regression: Missing credentials in required mode fails with explicit configuration error", () => {
  // Test case 1: Required mode without any credentials or flags
  const envEmpty: Record<string, string> = {};
  const resRequiredEmpty = resolveCredentialStateMachine((k) => envEmpty[k], { required: true });
  assertEquals(resRequiredEmpty.shouldRun, true);
  if (resRequiredEmpty.shouldRun) {
    assertEquals(resRequiredEmpty.isOptedIn, true);
    assertEquals(resRequiredEmpty.prefix, "BE04");
    assertNotEquals(resRequiredEmpty.error, undefined);
    assertEquals(
      resRequiredEmpty.error?.includes("Hosted RLS integration is required (shared BE04 credentials), but dedicated non-production test credentials are incomplete or unavailable"),
      true,
    );
  }

  // Test case 2: Required mode via environment variable REQUIRE_HOSTED_RLS_INTEGRATION=true
  const envVarRequired: Record<string, string> = {
    REQUIRE_HOSTED_RLS_INTEGRATION: "true",
  };
  const resEnvRequired = resolveCredentialStateMachine((k) => envVarRequired[k]);
  assertEquals(resEnvRequired.shouldRun, true);
  if (resEnvRequired.shouldRun) {
    assertNotEquals(resEnvRequired.error, undefined);
    assertEquals(resEnvRequired.error?.includes("missing BE04_RLS_TEST_SUPABASE_URL"), true);
  }

  const envBe04Only: Record<string, string> = {
    REQUIRE_HOSTED_RLS_INTEGRATION: "true",
    RUN_BE07_RLS_INTEGRATION: "false",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
    BE04_RLS_TEST_SUPABASE_ANON_KEY: "be04-anon",
    BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "be04-service",
    BE04_RLS_TEST_EXPECTED_PROJECT_REF: "be04-test",
  };
  const resBe04Only = resolveCredentialStateMachine((k) => envBe04Only[k]);
  assertEquals(resBe04Only.shouldRun, true);
  if (resBe04Only.shouldRun) {
    assertEquals(resBe04Only.prefix, "BE04");
    assertEquals(resBe04Only.url, "https://be04-test.supabase.co");
    assertEquals(resBe04Only.error, undefined);
  }

  // Test case 3: Required mode via HOSTED_RLS_REQUIRED=true
  const envHostedRequired: Record<string, string> = {
    HOSTED_RLS_REQUIRED: "true",
  };
  const resHostedRequired = resolveCredentialStateMachine((k) => envHostedRequired[k]);
  assertEquals(resHostedRequired.shouldRun, true);
  if (resHostedRequired.shouldRun) {
    assertNotEquals(resHostedRequired.error, undefined);
  }

  // Test case 4: Explicit RUN_BE07_RLS_INTEGRATION=true with missing credentials
  const envBe07Missing: Record<string, string> = {
    RUN_BE07_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://be04-test.supabase.co",
    // Missing anon key, service key, expected ref
  };
  const resBe07Missing = resolveCredentialStateMachine((k) => envBe07Missing[k], { required: true });
  assertEquals(resBe07Missing.shouldRun, true);
  if (resBe07Missing.shouldRun) {
    assertEquals(resBe07Missing.prefix, "BE04");
    assertNotEquals(resBe07Missing.error, undefined);
    assertEquals(
      resBe07Missing.error?.includes("RUN_BE07_RLS_INTEGRATION requires the shared BE04 credential set, but credentials are incomplete: missing BE04_RLS_TEST_SUPABASE_ANON_KEY"),
      true,
    );
  }
});

Deno.test("Finding 1 review regression: Valid non-production credentials resolve successfully in required and optional mode", () => {
  const envValid: Record<string, string> = {
    RUN_BE07_RLS_INTEGRATION: "true",
    BE04_RLS_TEST_SUPABASE_URL: "https://dedicated-valid-ref.supabase.co",
    BE04_RLS_TEST_SUPABASE_ANON_KEY: "dedicated-anon-key-12345",
    BE04_RLS_TEST_SUPABASE_SERVICE_ROLE_KEY: "dedicated-service-role-key-67890",
    BE04_RLS_TEST_EXPECTED_PROJECT_REF: "dedicated-valid-ref",
  };

  const resOptional = resolveCredentialStateMachine((k) => envValid[k]);
  assertEquals(resOptional.shouldRun, true);
  if (resOptional.shouldRun) {
    assertEquals(resOptional.isOptedIn, true);
    assertEquals(resOptional.prefix, "BE04");
    assertEquals(resOptional.error, undefined);
    assertEquals(resOptional.url, "https://dedicated-valid-ref.supabase.co");
    assertEquals(resOptional.anonKey, "dedicated-anon-key-12345");
    assertEquals(resOptional.serviceRoleKey, "dedicated-service-role-key-67890");
    assertEquals(resOptional.expectedProjectRef, "dedicated-valid-ref");
  }

  const resRequired = resolveCredentialStateMachine((k) => envValid[k], { required: true });
  assertEquals(resRequired.shouldRun, true);
  if (resRequired.shouldRun) {
    assertEquals(resRequired.error, undefined);
    validateDedicatedTestTarget(
      resRequired.url,
      resRequired.anonKey,
      resRequired.serviceRoleKey,
      resRequired.expectedProjectRef,
    );
  }
});

Deno.test("Finding 1 review regression: Unsafe production targets and non-HTTPS/loopback targets are strictly rejected", () => {
  // 1. Primary production project ref rejection
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        `https://${KNOWN_PRODUCTION_REF}.supabase.co`,
        "anon-key",
        "service-key",
        KNOWN_PRODUCTION_REF,
      ),
    Error,
    "primary production project",
  );

  // 2. Production project ref in expectedProjectRef even if URL differs
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://some-other-ref.supabase.co",
        "anon-key",
        "service-key",
        KNOWN_PRODUCTION_REF,
      ),
    Error,
    "does not match expected reference",
  );

  // 3. HTTP target rejection (HTTPS required)
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "http://test-project.supabase.co",
        "anon-key",
        "service-key",
        "test-project",
      ),
    Error,
    "HTTPS",
  );

  // 4. Loopback / localhost rejection
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://127.0.0.1:54321",
        "anon-key",
        "service-key",
        "test-project",
      ),
    Error,
    "localhost/loopback",
  );

  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://localhost:54321",
        "anon-key",
        "service-key",
        "test-project",
      ),
    Error,
    "localhost/loopback",
  );

  // 5. Symmetric keys rejection
  assertThrows(
    () =>
      validateDedicatedTestTarget(
        "https://test-project.supabase.co",
        "same-key-value",
        "same-key-value",
        "test-project",
      ),
    Error,
    "must not match",
  );
});

Deno.test("Finding 3 review regression: Both lineage filters receive explicit arrays of tracked recipe IDs", async () => {
  const trackedRecipeIds = [
    "aaaaaaaa-1111-4111-8111-111111111111",
    "bbbbbbbb-2222-4222-8222-222222222222",
  ];
  const capturedCalls: Array<{ table: string; column: string; values: string[] }> = [];

  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string, values: string[]) => {
          capturedCalls.push({ table, column, values });
          return Promise.resolve({ error: null });
        },
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: () => Promise.resolve({ error: null }),
      },
    },
  };

  await cleanupCrossUserRlsResources(
    mockAdminClient,
    trackedRecipeIds,
    ["user-uuid-1"],
  );

  // Lineage parent query verified
  const parentCall = capturedCalls.find((c) => c.table === "recipe_lineage" && c.column === "parent_recipe_id");
  assertNotEquals(parentCall, undefined);
  assertEquals(parentCall?.values, trackedRecipeIds);

  // Lineage child query verified
  const childCall = capturedCalls.find((c) => c.table === "recipe_lineage" && c.column === "child_recipe_id");
  assertNotEquals(childCall, undefined);
  assertEquals(childCall?.values, trackedRecipeIds);

  // Recipes query verified
  const recipesCall = capturedCalls.find((c) => c.table === "recipes" && c.column === "id");
  assertNotEquals(recipesCall, undefined);
  assertEquals(recipesCall?.values, trackedRecipeIds);
});

Deno.test("Finding 3 review regression: Empty recipe ID arrays cause lineage and recipe deletion queries to be skipped", async () => {
  const capturedTables: string[] = [];

  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => {
      capturedTables.push(table);
      return {
        delete: () => ({
          in: () => Promise.resolve({ error: null }),
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    },
    auth: {
      admin: {
        deleteUser: () => Promise.resolve({ error: null }),
      },
    },
  };

  await cleanupCrossUserRlsResources(
    mockAdminClient,
    [], // Empty recipe array!
    ["user-uuid-1"],
  );

  // When createdRecipeIds is empty, neither recipe_lineage nor recipes should be touched
  assertEquals(capturedTables.includes("recipe_lineage"), false);
  assertEquals(capturedTables.includes("recipes"), false);
  // User profiles are still cleaned up
  assertEquals(capturedTables.includes("profiles"), true);
});

Deno.test("Finding 3 review regression: PostgREST API-returned errors remain visible", async () => {
  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string) => {
          if (table === "recipe_lineage" && column === "parent_recipe_id") {
            return Promise.resolve({ error: { message: "PGRST_LINEAGE_PARENT_ERR: foreign key violation" } });
          }
          if (table === "recipe_lineage" && column === "child_recipe_id") {
            return Promise.resolve({ error: { message: "PGRST_LINEAGE_CHILD_ERR: connection timeout" } });
          }
          return Promise.resolve({ error: null });
        },
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: () => Promise.resolve({ error: null }),
      },
    },
  };

  let caught: Error | null = null;
  try {
    await cleanupCrossUserRlsResources(
      mockAdminClient,
      ["recipe-123"],
      ["user-456"],
    );
  } catch (err) {
    caught = err as Error;
  }

  assertNotEquals(caught, null);
  assertEquals(caught?.message.includes("Failed cleaning recipe_lineage by parent: PGRST_LINEAGE_PARENT_ERR: foreign key violation"), true);
  assertEquals(caught?.message.includes("Failed cleaning recipe_lineage by child: PGRST_LINEAGE_CHILD_ERR: connection timeout"), true);
});

Deno.test("Finding 3 review regression: Remaining cleanup stages still execute after lineage deletion failure", async () => {
  const operationsCalled: string[] = [];

  const mockAdminClient: CleanupAdminClient = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string) => {
          operationsCalled.push(`in:${table}:${column}`);
          if (table === "recipe_lineage" && column === "parent_recipe_id") {
            return Promise.resolve({ error: { message: "Parent lineage deletion failed" } });
          }
          return Promise.resolve({ error: null });
        },
        eq: (_column: string, val: string) => {
          operationsCalled.push(`eq:${table}:${val}`);
          return Promise.resolve({ error: null });
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: (uid: string) => {
          operationsCalled.push(`deleteUser:${uid}`);
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  const primaryError = new Error("Primary scenario failure");
  let caught: Error | null = null;
  try {
    await cleanupCrossUserRlsResources(
      mockAdminClient,
      ["recipe-1"],
      ["user-1"],
      [],
      primaryError,
    );
  } catch (err) {
    caught = err as Error;
  }

  assertNotEquals(caught, null);
  assertEquals(caught?.message.includes("Primary scenario failure"), true);
  assertEquals(caught?.message.includes("Failed cleaning recipe_lineage by parent"), true);
  assertEquals(caught?.cause, primaryError);

  // All remaining cleanup stages executed despite parent lineage failure:
  assertEquals(operationsCalled.includes("in:recipe_lineage:child_recipe_id"), true);
  assertEquals(operationsCalled.includes("in:recipes:id"), true);
  assertEquals(operationsCalled.includes("eq:profiles:user-1"), true);
  assertEquals(operationsCalled.includes("deleteUser:user-1"), true);
});
