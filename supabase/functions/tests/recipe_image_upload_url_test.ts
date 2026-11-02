import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handler,
  type UploadHandlerDeps,
} from "../recipe-image-upload-url/index.ts";
import type { UploadIntent } from "../_shared/recipe-images/uploadIntents.ts";

const USER = "99999999-9999-4999-8999-999999999999";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECIPE = "33333333-3333-4333-8333-333333333333";
const TOKEN = "mock.claims.signature";
const SERVICE_KEY = "synthetic-service-role-key";
const payload = {
  recipe_id: RECIPE,
  content_type: "image/jpeg",
  byte_size: 1024,
};
const config = {
  accountId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  bucketName: "mock-recipe-images",
  accessKeyId: "TESTACCESSKEY",
  secretAccessKey: "synthetic-r2-secret-key",
};

function request(
  body: unknown = payload,
  options: {
    token?: string | null;
    method?: string;
    query?: string;
    raw?: boolean;
  } = {},
): Request {
  const method = options.method ?? "POST";
  return new Request(
    `https://edge.invalid/functions/v1/recipe-image-upload-url${
      options.query ?? ""
    }`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token === null
          ? {}
          : { Authorization: options.token ?? `Bearer ${TOKEN}` }),
      },
      ...(method === "POST"
        ? { body: options.raw ? String(body) : JSON.stringify(body) }
        : {}),
    },
  );
}

function mock(
  options: {
    expectedToken?: string;
    authStatus?: number;
    authCode?: string;
    retryAfter?: string;
    recipe?: "missing" | "foreign";
    dbFailure?: boolean;
    persistenceFailure?: boolean;
    networkFailure?: boolean;
  } = {},
) {
  const calls: { url: URL; method: string; headers: Headers }[] = [];
  const intents: UploadIntent[] = [];
  const deps: UploadHandlerDeps = {
    supabaseUrl: "https://mock.supabase.co",
    supabaseAnonKey: "synthetic-anon-key",
    supabaseServiceRoleKey: SERVICE_KEY,
    r2Config: config,
    now: () => new Date("2026-11-02T00:00:00Z"),
    fetch: (input, init) =>
      Promise.resolve().then(() => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.href
            : input.url,
        );
        const headers = new Headers(init?.headers);
        const method = init?.method ?? "GET";
        calls.push({ url, method, headers });
        if (options.networkFailure) throw new Error("private upstream failure");
        if (url.pathname === "/auth/v1/user") {
          if (options.authStatus) {
            return new Response(
              JSON.stringify({
                code: options.authCode ?? "bad_jwt",
                message: "Invalid JWT",
              }),
              {
                status: options.authStatus,
                headers: {
                  "Content-Type": "application/json",
                  ...(options.retryAfter
                    ? { "Retry-After": options.retryAfter }
                    : {}),
                },
              },
            );
          }
          return Response.json({
            id: USER,
            role: "authenticated",
            aud: "authenticated",
          });
        }
        if (url.pathname === "/rest/v1/recipes") {
          assertEquals(
            headers.get("Authorization"),
            `Bearer ${options.expectedToken ?? TOKEN}`,
          );
          assertEquals(headers.get("apikey"), "synthetic-anon-key");
          assertEquals(url.searchParams.get("id"), `eq.${RECIPE}`);
          assertEquals(url.searchParams.get("user_id"), `eq.${USER}`);
          assertEquals(url.searchParams.get("select"), "id,user_id");
          if (options.dbFailure) {
            return Response.json({ message: "private SQL information" }, {
              status: 500,
            });
          }
          return Response.json(
            options.recipe === "missing" ? null : {
              id: RECIPE,
              user_id: options.recipe === "foreign" ? OTHER : USER,
            },
          );
        }
        if (url.pathname === "/rest/v1/recipe_image_upload_intents") {
          assertEquals(method, "POST");
          assertEquals(headers.get("Authorization"), `Bearer ${SERVICE_KEY}`);
          assertEquals(headers.get("apikey"), SERVICE_KEY);
          intents.push(JSON.parse(String(init?.body)));
          if (options.persistenceFailure) {
            return Response.json({ message: "private storage information" }, {
              status: 500,
            });
          }
          return new Response(null, { status: 201 });
        }
        throw new Error("Unexpected network request");
      }),
  };
  return { deps, calls, intents };
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  assertEquals(response.status, status);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
  const body = await response.json();
  assertEquals(body.error.code, code);
  assertEquals(Object.keys(body), ["error"]);
  const serialized = JSON.stringify(body);
  for (
    const forbidden of [
      SERVICE_KEY,
      config.secretAccessKey,
      "private",
      "stack",
      "staging/",
      "final/",
      "X-Amz-",
    ]
  ) {
    assertEquals(serialized.includes(forbidden), false);
  }
}

for (const content_type of ["image/jpeg", "image/png", "image/webp"]) {
  Deno.test(`upload signing authorizes an owner and persists the ${content_type} intent before responding`, async () => {
    const { deps, calls, intents } = mock();
    const response = await handler(
      request({ ...payload, content_type, byte_size: 10_485_760 }),
      deps,
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(
      response.headers.get("Access-Control-Allow-Methods"),
      "POST, OPTIONS",
    );
    const body = await response.json();
    assertEquals(Object.keys(body), ["upload"]);
    assertEquals(Object.keys(body.upload).sort(), [
      "expires_at",
      "headers",
      "id",
      "method",
      "url",
    ]);
    assertEquals(calls.length, 3);
    assertEquals(intents.length, 1);
    const intent = intents[0];
    assertEquals(intent.user_id, USER);
    assertEquals(intent.recipe_id, RECIPE);
    assertEquals(intent.content_type, content_type);
    assertEquals(intent.byte_size, 10_485_760);
    assertEquals(intent.state, "pending");
    assertEquals(intent.created_at, "2026-11-02T00:00:00.000Z");
    assertEquals(intent.expires_at, "2026-11-02T00:10:00.000Z");
    assertEquals(body.upload.id, intent.id);
    assertEquals(body.upload.expires_at, intent.expires_at);
    assertEquals(body.upload.method, "PUT");
    assertEquals(body.upload.headers, { "Content-Type": content_type });
    const url = new URL(body.upload.url);
    assertEquals(url.pathname, `/${config.bucketName}/${intent.staging_key}`);
    assertEquals(url.searchParams.get("X-Amz-Expires"), "600");
    assertEquals(
      url.searchParams.get("X-Amz-SignedHeaders"),
      "content-type;host",
    );
    const serialized = JSON.stringify(body);
    for (
      const secret of [
        SERVICE_KEY,
        config.secretAccessKey,
        intent.final_key,
        "user_id",
        "staging_key",
        "final_key",
      ]
    ) {
      assertEquals(serialized.includes(secret), false);
    }
  });
}

Deno.test("each signing request creates a fresh staging capability without modifying recipes", async () => {
  const { deps, intents, calls } = mock();
  assertEquals((await handler(request(), deps)).status, 200);
  assertEquals((await handler(request(), deps)).status, 200);
  assertNotEquals(intents[0].id, intents[1].id);
  assertNotEquals(intents[0].staging_key, intents[1].staging_key);
  assertEquals(
    calls.filter((call) => call.url.pathname === "/rest/v1/recipes").every((
      call,
    ) => call.method === "GET"),
    true,
  );
});

Deno.test("missing and malformed authentication cannot reach ownership or signing", async () => {
  for (
    const token of [
      null,
      "",
      "Basic credentials",
      "Bearer invalid",
      "Bearer a.b.c extra",
    ]
  ) {
    const { deps, calls } = mock();
    await expectError(
      await handler(request(payload, { token }), deps),
      401,
      "UNAUTHORIZED",
    );
    assertEquals(calls.length, 0);
  }
});

for (const authCode of ["bad_jwt", "jwt_expired", "session_expired"]) {
  Deno.test(`verified Auth rejection ${authCode} prevents signing`, async () => {
    const { deps, calls, intents } = mock({ authStatus: 401, authCode });
    await expectError(await handler(request(), deps), 401, "UNAUTHORIZED");
    assertEquals(calls.length, 1);
    assertEquals(intents.length, 0);
  });
}

Deno.test("verified backend identity overrides a forged JWT subject", async () => {
  const forged = `header.${
    btoa(JSON.stringify({ sub: OTHER, role: "service_role" })).replace(/=/g, "")
      .replace(/\+/g, "-").replace(/\//g, "_")
  }.signature`;
  const { deps, intents } = mock({ expectedToken: forged });
  assertEquals(
    (await handler(request(payload, { token: `Bearer ${forged}` }), deps))
      .status,
    200,
  );
  assertEquals(intents[0].user_id, USER);
});

Deno.test("foreign and nonexistent recipes return identical errors without signing", async () => {
  const bodies: unknown[] = [];
  for (const recipe of ["foreign", "missing"] as const) {
    const { deps, calls, intents } = mock({ recipe });
    let signed = false;
    deps.signUpload = () => {
      signed = true;
      throw new Error("Must not sign");
    };
    const response = await handler(request(), deps);
    bodies.push(await response.clone().json());
    await expectError(response, 404, "RECIPE_NOT_FOUND");
    assertEquals(calls.length, 2);
    assertEquals(intents.length, 0);
    assertEquals(signed, false);
  }
  assertEquals(bodies[0], bodies[1]);
});

Deno.test("upload signing rejects unsupported and missing content types", async () => {
  for (
    const content_type of [
      undefined,
      null,
      "image/gif",
      "image/svg+xml",
      "IMAGE/JPEG",
      "image/jpeg; charset=utf-8",
      "application/octet-stream",
      "",
    ]
  ) {
    const { deps, calls } = mock();
    await expectError(
      await handler(request({ ...payload, content_type }), deps),
      400,
      "VALIDATION_ERROR",
    );
    assertEquals(calls.length, 1);
  }
});

Deno.test("upload signing rejects missing, invalid and oversized declared sizes", async () => {
  for (
    const byte_size of [
      undefined,
      null,
      "1024",
      false,
      0,
      -1,
      1.5,
      10_485_761,
      Number.MAX_SAFE_INTEGER,
    ]
  ) {
    const { deps, calls } = mock();
    await expectError(
      await handler(request({ ...payload, byte_size }), deps),
      400,
      "VALIDATION_ERROR",
    );
    assertEquals(calls.length, 1);
  }
});

Deno.test("upload signing rejects invalid recipe IDs and caller-selected signing parameters", async () => {
  for (
    const body of [
      { ...payload, recipe_id: "invalid" },
      { ...payload, recipe_id: undefined },
      ...Object.entries({
        user_id: OTHER,
        object_key: "mock/object",
        image_path: "mock/path",
        image_url: "https://mock.invalid",
        upload_id: OTHER,
        method: "GET",
        headers: {},
        expires_in: 3600,
        expires_at: "2026-12-01T00:00:00Z",
      }).map(([key, value]) => ({ ...payload, [key]: value })),
    ]
  ) {
    const { deps, calls } = mock();
    await expectError(
      await handler(request(body), deps),
      400,
      "VALIDATION_ERROR",
    );
    assertEquals(calls.length, 1);
  }
  const { deps, calls } = mock();
  await expectError(
    await handler(
      request(payload, { query: "?method=GET&expires_in=3600" }),
      deps,
    ),
    400,
    "VALIDATION_ERROR",
  );
  assertEquals(calls.length, 1);
});

Deno.test("upload signing rejects malformed JSON and non-object bodies", async () => {
  for (const raw of ["", "{", "null", "[]", "true", '"text"']) {
    const { deps, calls } = mock();
    await expectError(
      await handler(request(raw, { raw: true }), deps),
      400,
      "INVALID_JSON",
    );
    assertEquals(calls.length, 1);
  }
});

Deno.test("preflight and unsupported methods do not authenticate or access storage", async () => {
  const { deps, calls } = mock();
  const response = await handler(
    request(undefined, { method: "OPTIONS", token: null }),
    deps,
  );
  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const result = await handler(
      request(undefined, { method, token: null }),
      deps,
    );
    assertEquals(result.headers.get("Allow"), "POST, OPTIONS");
    await expectError(result, 405, "METHOD_NOT_ALLOWED");
  }
  assertEquals(calls.length, 0);
});

Deno.test("configured frontend origin applies to success, preflight, and authentication errors", async () => {
  const previous = Deno.env.get("ALLOWED_ORIGIN");
  Deno.env.set("ALLOWED_ORIGIN", "https://frontend.invalid");
  try {
    const { deps } = mock();
    for (
      const input of [
        request(),
        request(payload, { token: null }),
        request(undefined, { method: "OPTIONS", token: null }),
      ]
    ) {
      const response = await handler(input, deps);
      assertEquals(
        response.headers.get("Access-Control-Allow-Origin"),
        "https://frontend.invalid",
      );
      assertEquals(response.headers.get("Vary"), "Origin");
    }
  } finally {
    if (previous === undefined) Deno.env.delete("ALLOWED_ORIGIN");
    else Deno.env.set("ALLOWED_ORIGIN", previous);
  }
});

Deno.test("authentication rate limits retain safe Retry-After and endpoint CORS", async () => {
  const { deps, calls } = mock({ authStatus: 429, retryAfter: "15" });
  const response = await handler(request(), deps);
  assertEquals(response.headers.get("Retry-After"), "15");
  await expectError(response, 503, "AUTH_SERVICE_RATE_LIMITED");
  assertEquals(calls.length, 1);
});

Deno.test("authentication, ownership database, and intent persistence failures fail closed", async () => {
  for (
    const failure of [{ networkFailure: true }, { authStatus: 500 }, {
      dbFailure: true,
    }, { persistenceFailure: true }]
  ) {
    const { deps } = mock(failure);
    await expectError(await handler(request(), deps), 500, "INTERNAL_ERROR");
  }
});

Deno.test("missing or invalid backend configuration never returns a capability", async () => {
  for (
    const change of [
      { r2Config: { ...config, accountId: "invalid" } },
      { r2Config: { ...config, secretAccessKey: "" } },
      { supabaseServiceRoleKey: "" },
    ]
  ) {
    const { deps, intents } = mock();
    await expectError(
      await handler(request(), { ...deps, ...change }),
      500,
      "INTERNAL_ERROR",
    );
    assertEquals(intents.length, 0);
  }
});

Deno.test("signing failures expose no credentials, keys, URLs or raw exceptions in responses or logs", async () => {
  const { deps, intents } = mock();
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...values) => {
    logs.push(values);
  };
  deps.signUpload = (intent) => {
    throw new Error(
      `${config.secretAccessKey} ${intent.final_key} private https://signed.invalid?X-Amz-Credential=secret`,
    );
  };
  try {
    await expectError(await handler(request(), deps), 500, "INTERNAL_ERROR");
    assertEquals(logs, [["Recipe image upload signing failed"]]);
    assertEquals(intents.length, 0);
  } finally {
    console.error = original;
  }
});
