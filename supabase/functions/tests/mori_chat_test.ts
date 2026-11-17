import { assertEquals } from "jsr:@std/assert@1";
import type { MoriChatInput, MoriChatProvider } from "../_shared/ai/AIProvider.ts";
import { AIError } from "../_shared/ai/GeminiAdapter.ts";
import { handler, MORI_CHAT_ENABLED_ENV, MORI_CHAT_DISABLED_ENV } from "../mori-chat/index.ts";
import type { QuotaCheck } from "../_shared/ai/quota.ts";

const SUPABASE_URL = "https://mock-mori-chat.supabase.co";
const ANON_KEY = "mock-mori-chat-public-key";
const USER_ID = "99999999-9999-9999-9999-999999999999";
const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const USER_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTk5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6ImNvb2tAbW9yaS50ZXN0Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.signature_segment_ok";

const ROW = {
  id: RECIPE_ID,
  user_id: USER_ID,
  title: "Garlic rice",
  raw_input: null,
  notes: "Weeknight favorite",
  ingredients: [{ name: "rice", quantity: 2, unit: "cups", inferred: false }],
  instructions: [{ step: 1, text: "Saute the garlic, then fold in rice." }],
  flavor_scores: null,
  star_rating: 5,
  cooked_at: null,
  image_url: null,
  created_at: "2026-11-14T00:00:00.000Z",
  updated_at: "2026-11-14T00:00:00.000Z",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function request(body?: unknown, token = USER_JWT): Request {
  return new Request("http://localhost/functions/v1/mori-chat", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createFetch({ foreignDetail = false }: { foreignDetail?: boolean } = {}) {
  const calls: { path: string; method: string; auth: string | null; query: URLSearchParams; body?: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, auth: headers.get("authorization"), query: url.searchParams, body });
    if (url.pathname === "/auth/v1/user") {
      return json({ id: USER_ID, aud: "authenticated", role: "authenticated", email: "cook@mori.test" });
    }
    if (url.pathname === "/rest/v1/rpc/search_recipes") return json([ROW]);
    if (url.pathname === "/rest/v1/recipes") {
      if (url.searchParams.has("id")) {
        const detail = foreignDetail ? { ...ROW, user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } : ROW;
        return json(headers.get("accept")?.includes("vnd.pgrst.object") ? detail : [detail]);
      }
      return json(foreignDetail ? [] : [ROW]);
    }
    return json({ message: "unexpected request" }, 404);
  };
  return { fetchImpl, calls };
}

function allowedQuota(calls: { confirmed: number; rolledBack: number }): QuotaCheck {
  return async () => ({
    status: "allowed",
    limit: 20,
    used: 0,
    confirm: async () => { calls.confirmed += 1; },
    rollback: async () => { calls.rolledBack += 1; },
  });
}

async function withEnabled<T>(run: () => Promise<T>): Promise<T> {
  const previousEnabled = Deno.env.get(MORI_CHAT_ENABLED_ENV);
  const previousDisabled = Deno.env.get(MORI_CHAT_DISABLED_ENV);
  Deno.env.set(MORI_CHAT_ENABLED_ENV, "true");
  Deno.env.set(MORI_CHAT_DISABLED_ENV, "false");
  try { return await run(); } finally {
    if (previousEnabled === undefined) Deno.env.delete(MORI_CHAT_ENABLED_ENV);
    else Deno.env.set(MORI_CHAT_ENABLED_ENV, previousEnabled);
    if (previousDisabled === undefined) Deno.env.delete(MORI_CHAT_DISABLED_ENV);
    else Deno.env.set(MORI_CHAT_DISABLED_ENV, previousDisabled);
  }
}

function chatProvider(onReply: (input: MoriChatInput) => string | Promise<string>): MoriChatProvider {
  return { reply: (input) => Promise.resolve(onReply(input)) };
}

const body = {
  messages: [{ role: "user", content: "Find my saved recipes that use rice." }],
  page: "recipes",
};

Deno.test("mori-chat uses caller-scoped saved recipes, confirms quota and never writes recipe data", async () => {
  await withEnabled(async () => {
    const db = createFetch();
    const settlement = { confirmed: 0, rolledBack: 0 };
    let received: MoriChatInput | undefined;
    const response = await handler(request(body), {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
      quotaCheck: allowedQuota(settlement),
      provider: chatProvider((input) => { received = input; return "Your Garlic rice recipe uses rice."; }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { reply: "Your Garlic rice recipe uses rice." });
    assertEquals(received?.recipes.map((recipe) => recipe.title), ["Garlic rice"]);
    assertEquals(received?.savedRecipesStatus, "available");
    assertEquals(db.calls.filter((call) => call.path === "/rest/v1/recipes").every((call) => call.query.get("user_id") === `eq.${USER_ID}`), true);
    assertEquals(db.calls.filter((call) => call.path === "/rest/v1/rpc/search_recipes").every((call) => call.auth === `Bearer ${USER_JWT}`), true);
    assertEquals(db.calls.some((call) => call.method !== "GET" && call.path === "/rest/v1/recipes"), false);
    assertEquals(settlement, { confirmed: 1, rolledBack: 0 });
  });
});

Deno.test("mori-chat rejects foreign current-recipe rows before provider context", async () => {
  await withEnabled(async () => {
    const db = createFetch({ foreignDetail: true });
    let received: MoriChatInput | undefined;
    const response = await handler(request({
      ...body,
      messages: [{ role: "user", content: "Could you help me with this?" }],
      page: "recipe",
      recipeId: RECIPE_ID,
    }), {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
      quotaCheck: allowedQuota({ confirmed: 0, rolledBack: 0 }),
      provider: chatProvider((input) => { received = input; return "I cannot access that recipe."; }),
    });

    assertEquals(response.status, 200);
    assertEquals(received?.currentRecipe, null);
    assertEquals(received?.savedRecipesStatus, "unavailable");
    assertEquals(received?.recipes.some((recipe) => recipe.id === RECIPE_ID), false);
  });
});

Deno.test("mori-chat authenticates and validates before quota or provider work", async () => {
  const db = createFetch();
  let quotaCalls = 0;
  let providerCalls = 0;
  const deps = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: ANON_KEY,
    fetch: db.fetchImpl,
    quotaCheck: async () => { quotaCalls += 1; return { status: "allowed" as const, limit: 20, used: 0 }; },
    provider: chatProvider(() => { providerCalls += 1; return "reply"; }),
  };
  await withEnabled(async () => {
    const unauthorized = await handler(request(undefined, ""), deps);
    assertEquals(unauthorized.status, 401);
    const invalid = await handler(request({ messages: [], page: "recipes" }), deps);
    assertEquals(invalid.status, 400);
    assertEquals(quotaCalls, 0);
    assertEquals(providerCalls, 0);
  });
});

Deno.test("mori-chat quota rejection avoids model work and maps provider failures safely", async () => {
  await withEnabled(async () => {
    const db = createFetch();
    let providerCalls = 0;
    const limited = await handler(request(body), {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
      quotaCheck: async () => ({ status: "exceeded", limit: 20, used: 20, retryAfterSeconds: 60 }),
      provider: chatProvider(() => { providerCalls += 1; return "reply"; }),
    });
    assertEquals(limited.status, 429);
    assertEquals(providerCalls, 0);

    const failed = await handler(request(body), {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: db.fetchImpl,
      quotaCheck: allowedQuota({ confirmed: 0, rolledBack: 0 }),
      provider: { reply: () => Promise.reject(new AIError("provider_unavailable", "chat", "safe failure")) },
    });
    assertEquals(failed.status, 503);
    const payload = await failed.json();
    assertEquals(payload.error.message, "The AI service is temporarily unavailable. Please try again shortly.");
    assertEquals((failed.headers.get("X-Request-Id") ?? "").length > 0, true);
    assertEquals(payload.error.message.includes("safe failure"), false);
  });
});

Deno.test("mori-chat enforces its reply limit in UTF-8 bytes", async () => {
  await withEnabled(async () => {
    const response = await handler(request(body), {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      fetch: createFetch().fetchImpl,
      quotaCheck: allowedQuota({ confirmed: 0, rolledBack: 0 }),
      provider: chatProvider(() => "é".repeat(1201)),
    });

    assertEquals(response.status, 502);
    assertEquals((await response.json()).error.code, "AI_OUTPUT_INVALID");
  });
});
