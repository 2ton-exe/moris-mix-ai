import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { handler } from "../recipes/index.ts";
import { AIUsageSchema, readAIUsage } from "../_shared/ai/usage.ts";
import { resolveAccountBurstLimit } from "../_shared/ai/quota.ts";

const userId = "99999999-9999-4999-8999-999999999999";
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
const summary = {
  observedAt: "2026-11-27T09:00:00+00:00",
  daily: { limit: 10, used: 3, remaining: 7, resetAt: "2026-11-28T00:00:00+00:00" },
  shortTerm: { mode: "fixed", limit: 5, used: 2, remaining: 3, nextChangeAt: "2026-11-27T09:00:30+00:00", retryAt: null },
};

async function withUsageEnvironment(values: Record<string, string | undefined>, task: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, Deno.env.get(key)]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    await task();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function usageFetch(result: unknown = summary, status = 200) {
  const requests: Array<{ path: string; body: unknown; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null, authorization: new Headers(init?.headers).get("authorization") });
    if (url.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify({ id: userId, aud: "authenticated", role: "authenticated" }), { headers: { "Content-Type": "application/json" } });
    }
    assertEquals(url.pathname, "/rest/v1/rpc/get_ai_usage_summary");
    return new Response(JSON.stringify(result), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, requests };
}

const deps = { supabaseUrl: "https://mock.supabase.co", supabaseAnonKey: "public-test-key", supabaseServiceRoleKey: "service-test-key" };

Deno.test("account burst resolver preserves fixed default and configured rolling validation", () => {
  assertEquals(resolveAccountBurstLimit(""), null);
  assertEquals(resolveAccountBurstLimit("  "), null);
  assertEquals(resolveAccountBurstLimit(" 3 "), 3);
  for (const invalid of ["0", "-1", "1.5", "abc", "2147483648"]) assertThrows(() => resolveAccountBurstLimit(invalid));
});

Deno.test("usage GET returns only the verified account and never consumes AI quota", async () => {
  await withUsageEnvironment({ AI_DAILY_LIMIT: "10", AI_ACCOUNT_BURST_LIMIT: undefined }, async () => {
    const mock = usageFetch();
    const response = await handler(new Request("https://local.test/functions/v1/recipes/ai-usage?user_id=other-account", {
      headers: { Authorization: `Bearer ${jwt}` },
    }), { ...deps, fetch: mock.fetchImpl });
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Cache-Control"), "private, no-store");
    assertEquals(await response.json(), summary);
    assertEquals(mock.requests.map(request => request.path), ["/auth/v1/user", "/rest/v1/rpc/get_ai_usage_summary"]);
    assertEquals(mock.requests[1].body, { p_user_id: userId, p_daily_limit: 10, p_burst_limit: null });
    assertEquals(mock.requests[1].authorization, "Bearer service-test-key");
  });
});

Deno.test("usage reader reuses fallback daily20 and configured rolling3", async () => {
  await withUsageEnvironment({ AI_DAILY_LIMIT: undefined, AI_ACCOUNT_BURST_LIMIT: "3" }, async () => {
    const mock = usageFetch({ ...summary, daily: { ...summary.daily, limit: 20, remaining: 17 }, shortTerm: { ...summary.shortTerm, mode: "rolling", limit: 3, remaining: 1 } });
    const result = await readAIUsage(userId, { ...deps, fetch: mock.fetchImpl });
    assertEquals(result?.daily.limit, 20);
    assertEquals(result?.shortTerm.mode, "rolling");
    assertEquals(mock.requests[0].body, { p_user_id: userId, p_daily_limit: 20, p_burst_limit: 3 });
  });
});

Deno.test("usage route requires authentication and only accepts read-only methods", async () => {
  const mock = usageFetch();
  for (const prefix of ["/functions/v1/recipes", "/recipes"]) {
    assertEquals((await handler(new Request(`https://local.test${prefix}/ai-usage`), { ...deps, fetch: mock.fetchImpl })).status, 401);
    assertEquals((await handler(new Request(`https://local.test${prefix}/ai-usage`, { method: "POST" }), { ...deps, fetch: mock.fetchImpl })).status, 405);
    assertEquals((await handler(new Request(`https://local.test${prefix}/ai-usage`, { method: "OPTIONS" }), { ...deps, fetch: mock.fetchImpl })).status, 204);
  }
  assertEquals(mock.requests.length, 0);
});

Deno.test("usage failures return safe unavailable responses without invented counts", async () => {
  await withUsageEnvironment({ AI_ACCOUNT_BURST_LIMIT: undefined }, async () => {
    for (const [body, status] of [[{ code: "PGRST202", message: "private database detail" }, 404], [{ invalid: true }, 200]] satisfies Array<[unknown, number]>) {
      const mock = usageFetch(body, status);
      const response = await handler(new Request("https://local.test/recipes/ai-usage", { headers: { Authorization: `Bearer ${jwt}` } }), { ...deps, fetch: mock.fetchImpl });
      assertEquals(response.status, 503);
      assertEquals(response.headers.get("Cache-Control"), "private, no-store");
      assertEquals(await response.json(), { error: { code: "QUOTA_UNAVAILABLE", message: "AI usage is temporarily unavailable." } });
    }
  });
  await withUsageEnvironment({ AI_ACCOUNT_BURST_LIMIT: "invalid" }, async () => {
    const mock = usageFetch();
    assertEquals(await readAIUsage(userId, { ...deps, fetch: mock.fetchImpl }), null);
    assertEquals(mock.requests.length, 0);
  });
});

Deno.test("usage contract rejects malformed times and negative or fractional counters", () => {
  assertEquals(AIUsageSchema.safeParse(summary).success, true);
  assertEquals(AIUsageSchema.safeParse({ ...summary, observedAt: "tomorrow" }).success, false);
  assertEquals(AIUsageSchema.safeParse({ ...summary, daily: { ...summary.daily, remaining: -1 } }).success, false);
  assertEquals(AIUsageSchema.safeParse({ ...summary, daily: { ...summary.daily, used: 1.5 } }).success, false);
});
