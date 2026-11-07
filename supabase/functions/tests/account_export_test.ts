import { assertEquals } from "jsr:@std/assert@1";
import { handler } from "../account-export/index.ts";

const USER = "99999999-9999-4999-8999-999999999999";
const TOKEN = `${btoa(JSON.stringify({ alg: "HS256" })).replaceAll("=", "")}.${
  btoa(JSON.stringify({ sub: USER })).replaceAll("=", "")
}.synthetic_signature`;
function request(method = "GET", query = "", authenticated = true) {
  return new Request(
    `https://example.test/functions/v1/account-export${query}`,
    {
      method,
      headers: authenticated ? { Authorization: `Bearer ${TOKEN}` } : {},
    },
  );
}
function mock(
  options: {
    foreign?: boolean;
    error?: boolean;
    paginate?: boolean;
    oversized?: boolean;
  } = {},
) {
  const calls: URL[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        Response.json({
          id: USER,
          role: "authenticated",
          aud: "authenticated",
        }),
      );
    }
    assertEquals(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${TOKEN}`,
    );
    if (options.error) {
      return Promise.resolve(
        Response.json({ message: "private database detail" }, { status: 500 }),
      );
    }
    if (url.pathname.endsWith("/recipes")) {
      assertEquals(url.searchParams.get("user_id"), `eq.${USER}`);
      assertEquals(
        url.searchParams.get("select")?.includes("image_path"),
        false,
      );
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const count = options.paginate && offset === 0 ? 100 : 1;
      return Promise.resolve(
        Response.json(
          Array.from(
            { length: count },
            (_, i) => ({
              id: `recipe-${offset + i}`,
              user_id: options.foreign ? "foreign" : USER,
              title: options.oversized
                ? "x".repeat(10 * 1024 * 1024)
                : "Recipe",
            }),
          ),
        ),
      );
    }
    return Promise.resolve(Response.json([
      {
        id: "owned-link",
        parent_recipe_id: "recipe-0",
        child_recipe_id: "recipe-1",
      },
      {
        id: "foreign-link",
        parent_recipe_id: "foreign",
        child_recipe_id: "recipe-0",
      },
    ]));
  };
  return {
    calls,
    deps: {
      supabaseUrl: "https://mock.supabase.co",
      supabaseAnonKey: "synthetic-public-key",
      fetch: fetchImpl,
    },
  };
}

Deno.test("export authenticates before reading data and supports preflight", async () => {
  const { calls, deps } = mock();
  assertEquals((await handler(request("GET", "", false), deps)).status, 401);
  assertEquals((await handler(request("OPTIONS"), deps)).status, 204);
  assertEquals((await handler(request("DELETE"), deps)).status, 405);
  assertEquals(calls.length, 0);
});

Deno.test("export paginates owned recipes and includes only owned lineage", async () => {
  const { deps } = mock({ paginate: true });
  const response = await handler(request(), deps);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assertEquals(body.recipes.length, 101);
  assertEquals(body.lineage.length, 1);
  assertEquals(body.lineage[0].id, "owned-link");
});

Deno.test("export rejects caller-selected owners and unexpected ownership", async () => {
  const { calls, deps } = mock({ foreign: true });
  assertEquals(
    (await handler(request("GET", "?user_id=foreign"), deps)).status,
    400,
  );
  assertEquals(calls.length, 1);
  assertEquals((await handler(request(), deps)).status, 503);
});

Deno.test("export hides database failure details", async () => {
  const { deps } = mock({ error: true });
  const response = await handler(request(), deps);
  assertEquals(response.status, 503);
  assertEquals(
    (await response.text()).includes("private database detail"),
    false,
  );
});

Deno.test("export rejects excessive output without returning a partial download", async () => {
  const { deps } = mock({ oversized: true });
  const response = await handler(request(), deps);
  assertEquals(response.status, 413);
  assertEquals((await response.json()).error.code, "EXPORT_TOO_LARGE");
});
