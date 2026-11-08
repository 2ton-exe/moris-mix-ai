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
const uploadRecords = new Map<string, Record<string, unknown>>();

function request(
  body: unknown = payload,
  options: {
    token?: string | null;
    method?: string;
    query?: string;
    raw?: boolean;
    uploadBody?: Uint8Array<ArrayBuffer>;
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
        : method === "PUT"
        ? { body: options.uploadBody ?? new Uint8Array() }
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
    quota?: "allowed" | "rate_limited" | "pending_limit";
    putResult?: "stored" | "already_exists" | "failed";
    staleAfterPut?: boolean;
  } = {},
) {
  const reservations = new Map<string, string>();
  const calls: { url: URL; method: string; headers: Headers }[] = [];
  const intents: UploadIntent[] = [];
  const stored: Uint8Array<ArrayBuffer>[] = [];
  const removed: string[] = [];
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
        if (url.pathname === "/rest/v1/rpc/create_recipe_image_upload_intent") {
          assertEquals(method, "POST");
          assertEquals(headers.get("Authorization"), `Bearer ${SERVICE_KEY}`);
          assertEquals(headers.get("apikey"), SERVICE_KEY);
          const args = JSON.parse(String(init?.body));
          intents.push({
            id: args.p_id,
            user_id: args.p_user_id,
            recipe_id: args.p_recipe_id,
            staging_key: args.p_staging_key,
            final_key: args.p_final_key,
            content_type: args.p_content_type,
            byte_size: args.p_byte_size,
            created_at: args.p_created_at,
            expires_at: args.p_expires_at,
            state: "pending",
          });
          uploadRecords.set(args.p_id, {
            id: args.p_id,
            user_id: args.p_user_id,
            recipe_id: args.p_recipe_id,
            staging_key: args.p_staging_key,
            final_key: args.p_final_key,
            content_type: args.p_content_type,
            byte_size: args.p_byte_size,
            created_at: args.p_created_at,
            expires_at: args.p_expires_at,
            state: "pending",
            cleanup_status: "waiting",
          });
          if (options.persistenceFailure) {
            return Response.json({ message: "private storage information" }, {
              status: 500,
            });
          }
          return Response.json(options.quota ?? "allowed");
        }
        if (url.pathname.endsWith("_recipe_image_upload_reservation")) {
          assertEquals(headers.get("Authorization"), `Bearer ${SERVICE_KEY}`);
          const args = JSON.parse(String(init?.body));
          if (url.pathname.includes("/claim_")) {
            if (reservations.has(args.p_id)) return Response.json(false);
            reservations.set(args.p_id, args.p_token);
            return Response.json(true);
          }
          const matches = reservations.get(args.p_id) === args.p_token;
          if (matches) reservations.delete(args.p_id);
          return Response.json(matches);
        }
        if (url.pathname === "/rest/v1/recipe_image_upload_intents") {
          assertEquals(headers.get("Authorization"), `Bearer ${SERVICE_KEY}`);
          assertEquals(headers.get("apikey"), SERVICE_KEY);
          const id = url.searchParams.get("id")?.slice(3) ?? "";
          assertEquals(url.searchParams.get("user_id"), `eq.${USER}`);
          const record = uploadRecords.get(id);
          if (options.staleAfterPut && stored.length > 0 && record) {
            record.state = "expired";
            record.cleanup_status = "complete";
          }
          return Response.json(record ? [record] : []);
        }
        throw new Error("Unexpected network request");
      }),
    checkUpload: () => Promise.resolve("missing"),
    putUpload: (_intent, _configuration, body) => {
      stored.push(body);
      return Promise.resolve(options.putResult ?? "stored");
    },
    deleteUpload: (key) => {
      removed.push(key);
      return Promise.resolve(true);
    },
  };
  return { deps, calls, intents, stored, removed };
}

function putRequest(
  uploadId: string,
  body: Uint8Array<ArrayBuffer>,
  contentType = "image/jpeg",
  declaredSize: number | null = body.byteLength,
  token: string | null = TOKEN,
): Request {
  return new Request(
    `https://edge.invalid/functions/v1/recipe-image-upload-url?upload_id=${uploadId}`,
    {
      method: "PUT",
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        "Content-Type": contentType,
        ...(declaredSize === null
          ? {}
          : { "Content-Length": String(declaredSize) }),
      },
      body,
    },
  );
}

async function createUpload(
  deps: UploadHandlerDeps,
  byteSize = 1024,
): Promise<string> {
  const response = await handler(
    request({ ...payload, byte_size: byteSize }),
    deps,
  );
  assertEquals(response.status, 200);
  return (await response.json()).upload.id;
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
    "POST, PUT, OPTIONS",
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
      "POST, PUT, OPTIONS",
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
    assertEquals(url.origin, "https://mock.supabase.co");
    assertEquals(url.pathname, "/functions/v1/recipe-image-upload-url");
    assertEquals(url.searchParams.get("upload_id"), intent.id);
    assertEquals(url.searchParams.has("X-Amz-Signature"), false);
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

Deno.test("each upload authorization creates a fresh intent without modifying recipes", async () => {
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

Deno.test("upload ingress accepts the exact limit and rejects oversize or mismatched bodies before R2", async () => {
  const { deps, stored } = mock();
  const uploadId = await createUpload(deps, 10_485_760);
  const exact = await handler(
    putRequest(uploadId, new Uint8Array(10_485_760)),
    deps,
  );
  assertEquals(exact.status, 201);
  assertEquals(stored[0].byteLength, 10_485_760);

  const { deps: oversizedDeps, stored: oversizedStored } = mock();
  const oversizedId = await createUpload(oversizedDeps, 10_485_760);
  await expectError(
    await handler(
      putRequest(oversizedId, new Uint8Array(10_485_761), "image/jpeg", null),
      oversizedDeps,
    ),
    400,
    "VALIDATION_ERROR",
  );
  assertEquals(oversizedStored.length, 0);

  const { deps: shortDeps, stored: shortStored } = mock();
  const shortId = await createUpload(shortDeps, 1024);
  await expectError(
    await handler(
      putRequest(shortId, new Uint8Array(1023), "image/jpeg", null),
      shortDeps,
    ),
    400,
    "VALIDATION_ERROR",
  );
  assertEquals(shortStored.length, 0);
});

Deno.test("upload ingress assembles streamed chunks in order and cancels oversized streams", async () => {
  const { deps, stored } = mock();
  const uploadId = await createUpload(deps, 4);
  function streamedRequest(body: ReadableStream<Uint8Array>): Request {
    return new Request(
      `https://edge.invalid/functions/v1/recipe-image-upload-url?upload_id=${uploadId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/jpeg",
        },
        body,
      },
    );
  }
  const valid = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  assertEquals((await handler(streamedRequest(valid), deps)).status, 201);
  assertEquals(stored[0], new Uint8Array([1, 2, 3, 4]));
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expectError(
    await handler(streamedRequest(oversized), deps),
    400,
    "VALIDATION_ERROR",
  );
  assertEquals(cancelled, true);
  assertEquals(stored.length, 1);
});

Deno.test("upload ingress rejects mismatched headers, expired intents, and cleanup-completed replay", async () => {
  const { deps, stored } = mock();
  const uploadId = await createUpload(deps);
  await expectError(
    await handler(
      putRequest(uploadId, new Uint8Array(1024), "image/png"),
      deps,
    ),
    400,
    "VALIDATION_ERROR",
  );
  assertEquals(stored.length, 0);

  await expectError(
    await handler(
      putRequest(uploadId, new Uint8Array(1024), "image/jpeg", 1023),
      deps,
    ),
    400,
    "VALIDATION_ERROR",
  );
  assertEquals(stored.length, 0);

  const { deps: expiredDeps, stored: expiredStored } = mock();
  const expiredId = await createUpload(expiredDeps);
  expiredDeps.now = () => new Date("2026-11-02T00:09:31Z");
  await expectError(
    await handler(putRequest(expiredId, new Uint8Array(1024)), expiredDeps),
    410,
    "UPLOAD_EXPIRED",
  );
  assertEquals(expiredStored.length, 0);

  const { deps: cleanedDeps, stored: cleanedStored } = mock();
  const cleanedId = await createUpload(cleanedDeps);
  const record = uploadRecords.get(cleanedId)!;
  record.state = "expired";
  record.cleanup_status = "complete";
  await expectError(
    await handler(putRequest(cleanedId, new Uint8Array(1024)), cleanedDeps),
    410,
    "UPLOAD_EXPIRED",
  );
  assertEquals(cleanedStored.length, 0);

  const { deps: foreignDeps, stored: foreignStored } = mock();
  const foreignId = await createUpload(foreignDeps);
  uploadRecords.get(foreignId)!.user_id = OTHER;
  await expectError(
    await handler(putRequest(foreignId, new Uint8Array(1024)), foreignDeps),
    404,
    "UPLOAD_NOT_FOUND",
  );
  assertEquals(foreignStored.length, 0);
});

Deno.test("upload ingress rejects unauthenticated and interrupted streamed bodies before R2", async () => {
  const { deps, stored } = mock();
  const uploadId = await createUpload(deps);
  await expectError(
    await handler(
      putRequest(uploadId, new Uint8Array(1024), "image/jpeg", 1024, null),
      deps,
    ),
    401,
    "UNAUTHORIZED",
  );
  const interrupted = new Request(
    `https://edge.invalid/functions/v1/recipe-image-upload-url?upload_id=${uploadId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "image/jpeg",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(128));
          controller.error(new Error("synthetic interrupted body"));
        },
      }),
    },
  );
  await expectError(await handler(interrupted, deps), 400, "VALIDATION_ERROR");
  assertEquals(stored.length, 0);
});

Deno.test("conditional object creation blocks replay and stale post-upload cleanup is compensated", async () => {
  const { deps, stored } = mock();
  const uploadId = await createUpload(deps);
  let attempts = 0;
  deps.putUpload = (_intent, _configuration, body) => {
    attempts++;
    if (attempts > 1) return Promise.resolve("already_exists");
    stored.push(body);
    return Promise.resolve("stored");
  };
  assertEquals(
    (await handler(putRequest(uploadId, new Uint8Array(1024)), deps)).status,
    201,
  );
  await expectError(
    await handler(putRequest(uploadId, new Uint8Array(1024)), deps),
    409,
    "UPLOAD_ALREADY_USED",
  );
  assertEquals(attempts, 2);

  const { deps: concurrentDeps, stored: concurrentStored } = mock();
  const concurrentId = await createUpload(concurrentDeps);
  let occupied = false;
  concurrentDeps.putUpload = async (_intent, _configuration, body) => {
    if (occupied) return "already_exists";
    occupied = true;
    await Promise.resolve();
    concurrentStored.push(body);
    return "stored";
  };
  const concurrent = await Promise.all([
    handler(putRequest(concurrentId, new Uint8Array(1024)), concurrentDeps),
    handler(putRequest(concurrentId, new Uint8Array(1024)), concurrentDeps),
  ]);
  assertEquals(concurrent.map((response) => response.status).sort(), [
    201,
    409,
  ]);
  assertEquals(concurrentStored.length, 1);

  const { deps: staleDeps, removed } = mock({ staleAfterPut: true });
  const staleId = await createUpload(staleDeps);
  await expectError(
    await handler(putRequest(staleId, new Uint8Array(1024)), staleDeps),
    410,
    "UPLOAD_EXPIRED",
  );
  assertEquals(removed.length, 1);
});

Deno.test("signing quotas reject without returning a capability", async () => {
  for (
    const [quota, code] of [
      ["rate_limited", "UPLOAD_RATE_LIMITED"],
      ["pending_limit", "UPLOAD_QUOTA_EXCEEDED"],
    ] as const
  ) {
    const { deps, intents } = mock({ quota });
    await expectError(
      await handler(request(), deps),
      429,
      code,
    );
    assertEquals(intents.length, 1);
  }
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
    const response = await handler(request(), deps);
    bodies.push(await response.clone().json());
    await expectError(response, 404, "RECIPE_NOT_FOUND");
    assertEquals(calls.length, 2);
    assertEquals(intents.length, 0);
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
    "POST, PUT, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const result = await handler(
      request(undefined, { method, token: null }),
      deps,
    );
    assertEquals(result.headers.get("Allow"), "POST, PUT, OPTIONS");
    await expectError(result, 405, "METHOD_NOT_ALLOWED");
  }
  assertEquals(calls.length, 0);
  await expectError(
    await handler(request(undefined, { method: "PUT", token: null }), deps),
    401,
    "UNAUTHORIZED",
  );
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
  const authorization = await handler(request(), deps);
  const upload = await authorization.json();
  deps.putUpload = (intent) => {
    throw new Error(
      `${config.secretAccessKey} ${intent.staging_key} private https://signed.invalid?X-Amz-Credential=secret`,
    );
  };
  try {
    await expectError(
      await handler(putRequest(upload.upload.id, new Uint8Array(1024)), deps),
      500,
      "INTERNAL_ERROR",
    );
    assertEquals(logs, [["Recipe image upload signing failed"]]);
    assertEquals(intents.length, 1);
  } finally {
    console.error = original;
  }
});

Deno.test("replays and unavailable storage are rejected before reading upload bytes", async () => {
  for (const state of ["exists", "failed"] as const) {
    const { deps, stored } = mock();
    const id = await createUpload(deps, 1024);
    deps.checkUpload = () => Promise.resolve(state);
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const req = new Request(putRequest(id, new Uint8Array(1024)), { body });
    const response = await handler(req, deps);
    assertEquals(response.status, state === "exists" ? 409 : 503);
    assertEquals(reads, 0);
    assertEquals(stored.length, 0);
    await req.body?.cancel();
  }
});

Deno.test("an upload with no stored object can retry after a failed PUT", async () => {
  const { deps } = mock({ putResult: "failed" });
  const id = await createUpload(deps, 1024);
  assertEquals(
    (await handler(putRequest(id, new Uint8Array(1024)), deps)).status,
    503,
  );
  deps.putUpload = () => Promise.resolve("stored");
  assertEquals(
    (await handler(putRequest(id, new Uint8Array(1024)), deps)).status,
    201,
  );
});

Deno.test("reservation rejects a concurrent request before reading its stream and releases on failure", async () => {
  const { deps } = mock();
  const id = await createUpload(deps);
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => enter = resolve);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => finish = resolve);
  deps.checkUpload = async () => {
    enter();
    await finished;
    return "missing";
  };
  const first = handler(
    putRequest(id, new Uint8Array(1), "image/jpeg", 1024),
    deps,
  );
  await entered;
  let reads = 0;
  const second = new Request(
    `https://edge.invalid/functions/v1/recipe-image-upload-url?upload_id=${id}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "image/jpeg",
      },
      body: new ReadableStream<Uint8Array>({
        pull() {
          reads++;
        },
      }, { highWaterMark: 0 }),
    },
  );
  await expectError(await handler(second, deps), 409, "UPLOAD_IN_PROGRESS");
  assertEquals(reads, 0);
  finish();
  await expectError(await first, 400, "VALIDATION_ERROR");
  assertEquals(
    (await handler(putRequest(id, new Uint8Array(1024)), deps)).status,
    201,
  );
});

Deno.test("reservation failures prevent body reads and storage access", async () => {
  for (
    const [result, status] of [[Response.json(false), 409], [
      new Response(null, { status: 500 }),
      500,
    ], [Response.json("invalid"), 500]] as const
  ) {
    const { deps } = mock();
    const id = await createUpload(deps);
    const original = deps.fetch!;
    deps.fetch = (input, init) =>
      String(input).includes("/claim_recipe_image_upload_reservation")
        ? Promise.resolve(result)
        : original(input, init);
    let reads = 0;
    const req = new Request(
      `https://edge.invalid/functions/v1/recipe-image-upload-url?upload_id=${id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/jpeg",
        },
        body: new ReadableStream<Uint8Array>({
          pull() {
            reads++;
          },
        }, { highWaterMark: 0 }),
      },
    );
    const response = await handler(req, deps);
    assertEquals(response.status, status);
    assertEquals(reads, 0);
  }
});

Deno.test("a failed release keeps the reservation closed to subsequent reads", async () => {
  const { deps, stored } = mock();
  const id = await createUpload(deps);
  const original = deps.fetch!;
  deps.fetch = (input, init) =>
    String(input).includes("/release_recipe_image_upload_reservation")
      ? Promise.resolve(Response.json(false))
      : original(input, init);
  await expectError(
    await handler(putRequest(id, new Uint8Array(1024)), deps),
    500,
    "INTERNAL_ERROR",
  );
  await expectError(
    await handler(putRequest(id, new Uint8Array(1024)), deps),
    409,
    "UPLOAD_IN_PROGRESS",
  );
  assertEquals(stored.length, 1);
});
