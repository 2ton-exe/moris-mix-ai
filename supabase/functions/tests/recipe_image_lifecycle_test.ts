import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler as attachHandler } from "../recipe-image-attach/index.ts";
import { handler as downloadHandler } from "../recipe-image-download-url/index.ts";
import { handler as deleteHandler } from "../recipe-image-delete/index.ts";
import { handler as cleanupHandler } from "../recipe-image-final-cleanup/index.ts";
import {
  copyVerifiedRecipeImage,
  type R2Config,
  readAndVerifyRecipeImage,
  signRecipeImageFinalGet,
} from "../_shared/recipe-images/r2.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RECIPE = "33333333-3333-4333-8333-333333333333";
const UPLOAD = "44444444-4444-4444-8444-444444444444";
const REPLACEMENT_UPLOAD = "88888888-8888-4888-8888-888888888888";
const LATE_DELETE_UPLOAD = "99999999-9999-4999-8999-999999999999";
const OBJECT = "55555555-5555-4555-8555-555555555555";
const ATTEMPT = "66666666-6666-4666-8666-666666666666";
const TOKEN = "synthetic.header.signature";
const FINAL =
  `recipe-images/final/${USER}/${RECIPE}/${UPLOAD}/${OBJECT}/${ATTEMPT}`;
const STAGING = `recipe-images/staging/${USER}/${RECIPE}/${UPLOAD}`;
const CONFIG: R2Config = {
  accountId: "0123456789abcdef0123456789abcdef",
  bucketName: "recipe-images",
  accessKeyId: "synthetickey123",
  secretAccessKey: "synthetic-secret-key-for-tests-only",
};
const NOW = new Date("2026-11-07T10:00:00Z");

Deno.test("lifecycle method errors advertise the allowed methods", async () => {
  for (const handler of [attachHandler, downloadHandler, deleteHandler]) {
    const response = await handler(
      new Request("https://edge.invalid", { method: "DELETE" }),
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("Allow"), "POST, OPTIONS");
  }
});

Deno.test("attachment distinguishes retryable missing or changed objects from invalid images", async () => {
  for (
    const scenario of ["missing", "changed-read", "changed-copy", "invalid"]
  ) {
    const calls: string[] = [];
    const normalFetch = metadataFetch();
    const deps = handlerDeps({
      rpc: (name) => {
        calls.push(name);
        return Promise.resolve({
          error: null,
          data: name === "claim_recipe_image_finalization"
            ? {
              status: "claimed",
              staging_key: STAGING,
              object_key: FINAL,
              content_type: "image/png",
              byte_size: pngBytes().byteLength,
            }
            : name === "start_recipe_image_final_copy"
            ? "started"
            : "pending",
        });
      },
      r2Fetch: (input, init) => {
        if (scenario === "missing") {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        if (
          (scenario === "changed-read" && init?.method === "GET") ||
          (scenario === "changed-copy" && init?.method === "PUT")
        ) return Promise.resolve(new Response(null, { status: 412 }));
        if (scenario === "invalid") {
          return metadataFetch(pngBytes(), "image/jpeg")(input, init);
        }
        return normalFetch(input, init);
      },
    });
    const response = await attachHandler(
      imageRequest("recipe-image-attach", {
        recipe_id: RECIPE,
        upload_id: UPLOAD,
      }),
      deps,
    );
    assertEquals(response.status, scenario === "invalid" ? 422 : 409);
    assertEquals(
      (await response.json()).error.code,
      scenario === "invalid"
        ? "INVALID_IMAGE"
        : scenario === "missing"
        ? "UPLOAD_BYTES_MISSING"
        : "UPLOAD_NOT_READY",
    );
    assertEquals(calls.at(-1), "release_recipe_image_finalization");
  }
});

function pngBytes(): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (type: string, data: number[]) => {
    const typeBytes = Array.from(type, (char) => char.charCodeAt(0));
    const crc = testCrc32([...typeBytes, ...data]);
    return [...u32(data.length), ...typeBytes, ...data, ...u32(crc)];
  };
  return new Uint8Array([
    ...signature,
    ...chunk("IHDR", [...u32(1), ...u32(1), 8, 6, 0, 0, 0]),
    ...chunk("IDAT", [120, 156, 99, 96, 0, 2, 0, 5, 0, 1]),
    ...chunk("IEND", []),
  ]);
}
function jpegBytes(): Uint8Array {
  return Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    0,
    1,
    0,
    1,
    3,
    1,
    0x11,
    0,
    0xff,
    0xd9,
  );
}
function webpBytes(): Uint8Array {
  return Uint8Array.of(
    0x52,
    0x49,
    0x46,
    0x46,
    14,
    0,
    0,
    0,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x20,
    1,
    0,
    0,
    0,
    0,
    0,
  );
}

function u32(value: number): number[] {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
}
function testCrc32(bytes: number[]): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function imageRequest(
  path: string,
  body: unknown,
  token: string | null = TOKEN,
): Request {
  return new Request(`https://edge.invalid/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function authFetch(
  recipe: Record<string, unknown> | null,
  authStatus = 200,
): typeof fetch {
  return (input, _init) =>
    Promise.resolve().then(() => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url,
      );
      if (url.pathname === "/auth/v1/user") {
        return Response.json(
          authStatus === 200
            ? { id: USER, role: "authenticated", aud: "authenticated" }
            : { code: "bad_jwt", message: "Invalid JWT" },
          { status: authStatus },
        );
      }
      if (url.pathname === "/rest/v1/recipes") return Response.json(recipe);
      throw new Error(`Unexpected request ${url.pathname}`);
    });
}

function metadataFetch(
  bytes = pngBytes(),
  contentType = "image/png",
): typeof fetch {
  return (_input, init) =>
    Promise.resolve().then(() => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-length": String(bytes.byteLength),
            etag: '"stored-etag"',
          },
        });
      }
      if (method === "GET") {
        assertEquals(headers.get("if-match"), '"stored-etag"');
        return new Response(bytes.slice().buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": contentType, etag: '"stored-etag"' },
        });
      }
      if (method === "PUT") {
        assert(
          headers.get("authorization")?.includes(
            "SignedHeaders=host;x-amz-content-sha256;x-amz-copy-source;x-amz-copy-source-if-match;x-amz-date",
          ),
        );
        assertEquals(
          headers.get("x-amz-copy-source-if-match"),
          '"stored-etag"',
        );
        return new Response("<CopyObjectResult/>", { status: 200 });
      }
      throw new Error(`Unexpected storage method ${method}`);
    });
}

function handlerDeps(
  options: {
    recipe?: Record<string, unknown> | null;
    rpc?: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
    r2Fetch?: typeof fetch;
  } = {},
) {
  return {
    supabaseUrl: "https://mock.supabase.co",
    supabaseAnonKey: "synthetic-anon-key",
    supabaseServiceRoleKey: "synthetic-service-role-key",
    r2Config: CONFIG,
    now: () => NOW,
    fetch: authFetch(
      options.recipe ?? { id: RECIPE, user_id: USER, image_path: null },
    ),
    rpc: options.rpc,
    r2Fetch: options.r2Fetch,
    cleanupToken: "synthetic-final-cleanup-token-0123456789",
  };
}

Deno.test("R2 content verification validates actual size, metadata, format structure, and ETag", async () => {
  const valid = pngBytes();
  const stored = await readAndVerifyRecipeImage(
    STAGING,
    "image/png",
    valid.byteLength,
    CONFIG,
    metadataFetch(valid),
  );
  assert(stored);
  assertEquals(stored.byteSize, valid.byteLength);
  assert(
    await readAndVerifyRecipeImage(
      STAGING,
      "image/jpeg",
      jpegBytes().byteLength,
      CONFIG,
      metadataFetch(jpegBytes(), "image/jpeg"),
    ),
  );
  assert(
    await readAndVerifyRecipeImage(
      STAGING,
      "image/webp",
      webpBytes().byteLength,
      CONFIG,
      metadataFetch(webpBytes(), "image/webp"),
    ),
  );
  await assertRejects(
    () =>
      readAndVerifyRecipeImage(
        STAGING,
        "image/png",
        valid.byteLength - 1,
        CONFIG,
        metadataFetch(valid),
      ),
    Error,
    "metadata",
  );
  await assertRejects(
    () =>
      readAndVerifyRecipeImage(
        STAGING,
        "image/jpeg",
        valid.byteLength,
        CONFIG,
        metadataFetch(valid),
      ),
    Error,
    "metadata",
  );
  const shortBody: typeof fetch = (_input, init) =>
    Promise.resolve(
      init?.method === "HEAD"
        ? new Response(null, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(valid.byteLength),
            etag: '"stored-etag"',
          },
        })
        : new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "image/png", etag: '"stored-etag"' },
        }),
    );
  await assertRejects(
    () =>
      readAndVerifyRecipeImage(
        STAGING,
        "image/png",
        valid.byteLength,
        CONFIG,
        shortBody,
      ),
    Error,
    "size",
  );
});

Deno.test("R2 verification rejects missing, oversized, truncated, and changed objects", async () => {
  const missing = await readAndVerifyRecipeImage(
    STAGING,
    "image/png",
    1,
    CONFIG,
    () => Promise.resolve(new Response(null, { status: 404 })),
  );
  assertEquals(missing, null);
  const oversized: typeof fetch = () =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": "10485761",
          etag: '"stored-etag"',
        },
      }),
    );
  await assertRejects(
    () =>
      readAndVerifyRecipeImage(
        STAGING,
        "image/png",
        10_485_761,
        CONFIG,
        oversized,
      ),
    Error,
  );
  const truncated = pngBytes().slice(0, 20);
  await assertRejects(
    () =>
      readAndVerifyRecipeImage(
        STAGING,
        "image/png",
        truncated.byteLength,
        CONFIG,
        metadataFetch(truncated),
      ),
    Error,
    "structurally",
  );
  const changedFetch: typeof fetch = (_input, init) =>
    Promise.resolve().then(() => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(pngBytes().byteLength),
            etag: '"first"',
          },
        });
      }
      return new Response(null, { status: 412 });
    });
  await assertRejects(
    () =>
      readAndVerifyRecipeImage(
        STAGING,
        "image/png",
        pngBytes().byteLength,
        CONFIG,
        changedFetch,
      ),
    Error,
    "changed",
  );
});

Deno.test("copy uses the captured source ETag and verifies the finalized metadata", async () => {
  const result = await copyVerifiedRecipeImage(
    STAGING,
    FINAL,
    "image/png",
    pngBytes().byteLength,
    '"stored-etag"',
    CONFIG,
    metadataFetch(),
  );
  assertEquals(result, true);
  const wrong: typeof fetch = () =>
    Promise.resolve(new Response(null, { status: 412 }));
  await assertRejects(
    () =>
      copyVerifiedRecipeImage(
        STAGING,
        FINAL,
        "image/png",
        pngBytes().byteLength,
        '"stored-etag"',
        CONFIG,
        wrong,
      ),
    Error,
    "changed",
  );
  let headCount = 0;
  const invalidFinal: typeof fetch = (input, init) => {
    if (init?.method === "HEAD") {
      headCount++;
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            "content-type": headCount === 1 ? "image/jpeg" : "image/png",
            "content-length": String(pngBytes().byteLength),
            etag: '"stored-etag"',
          },
        }),
      );
    }
    if (init?.method === "GET") return metadataFetch()(input, init);
    return Promise.resolve(
      new Response("<CopyObjectResult/>", { status: 200 }),
    );
  };
  assertEquals(
    await copyVerifiedRecipeImage(
      STAGING,
      FINAL,
      "image/png",
      pngBytes().byteLength,
      '"stored-etag"',
      CONFIG,
      invalidFinal,
    ),
    false,
  );
});

Deno.test("GET signer is limited to final keys, GET, and 60 seconds", async () => {
  const signed = new URL(
    await signRecipeImageFinalGet(FINAL, "image/png", CONFIG, NOW),
  );
  assertEquals(signed.searchParams.get("X-Amz-Expires"), "60");
  assertEquals(signed.searchParams.get("X-Amz-SignedHeaders"), "host");
  assertEquals(signed.searchParams.get("response-content-type"), "image/png");
  assertEquals(
    signed.searchParams.get("response-content-disposition"),
    'inline; filename="recipe-image.png"',
  );
  assertEquals(signed.pathname.includes("/recipe-images/final/"), true);
  await assertRejects(
    () => signRecipeImageFinalGet(STAGING, "image/png", CONFIG, NOW),
    Error,
    "Invalid finalized",
  );
});

Deno.test("attachment authenticates and atomically replays an attached result", async () => {
  const calls: string[] = [];
  const deps = handlerDeps({
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({
        data: {
          status: "attached",
          content_type: "image/png",
          byte_size: pngBytes().byteLength,
          uploaded_at: NOW.toISOString(),
        },
        error: null,
      });
    },
  });
  const response = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).image.recipe_id, RECIPE);
  assertEquals(calls, ["claim_recipe_image_finalization"]);
});

Deno.test("attachment verifies and copies before fenced association commit", async () => {
  const calls: string[] = [];
  const uploadedAt = "2026-10-26T10:04:00+00:00";
  const deps = handlerDeps({
    r2Fetch: metadataFetch(),
    rpc: (name, args) => {
      calls.push(name);
      if (name === "claim_recipe_image_finalization") {
        return Promise.resolve({
          data: {
            status: "claimed",
            staging_key: STAGING,
            object_key: FINAL,
            content_type: "image/png",
            byte_size: pngBytes().byteLength,
          },
          error: null,
        });
      }
      if (name === "finish_recipe_image_finalization") {
        assertEquals(args.p_attempt_token !== undefined, true);
        return Promise.resolve({
          data: {
            status: "attached",
            content_type: "image/png",
            byte_size: pngBytes().byteLength,
            uploaded_at: uploadedAt,
          },
          error: null,
        });
      }
      if (name === "start_recipe_image_final_copy") {
        return Promise.resolve({ data: "started", error: null });
      }
      if (name === "finish_recipe_image_final_copy") {
        return Promise.resolve({ data: "verified", error: null });
      }
      return Promise.reject(new Error("unexpected rpc"));
    },
  });
  const response = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).image.uploaded_at, uploadedAt);
  assertEquals(calls, [
    "claim_recipe_image_finalization",
    "start_recipe_image_final_copy",
    "finish_recipe_image_final_copy",
    "finish_recipe_image_finalization",
  ]);
});

Deno.test("attachment rejects unauthenticated, cross-owner, cross-intent, and active lease requests before R2", async () => {
  const unauth = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }, null),
    handlerDeps(),
  );
  assertEquals(unauth.status, 401);
  const foreign = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    handlerDeps({ recipe: { id: RECIPE, user_id: OTHER } }),
  );
  assertEquals(foreign.status, 404);
  let touched = false;
  const conflict = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    handlerDeps({
      rpc: () => Promise.resolve({ data: { status: "conflict" }, error: null }),
      r2Fetch: () =>
        Promise.resolve().then(() => {
          touched = true;
          return new Response(null);
        }),
    }),
  );
  assertEquals(conflict.status, 409);
  assertEquals(touched, false);
  const mismatch = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    handlerDeps({
      rpc: () =>
        Promise.resolve({ data: { status: "not_found" }, error: null }),
    }),
  );
  assertEquals(mismatch.status, 404);
});

Deno.test("failed verification leaves image association untouched and releases only the active token", async () => {
  const calls: string[] = [];
  const deps = handlerDeps({
    recipe: { id: RECIPE, user_id: USER, image_path: "already-attached" },
    r2Fetch: metadataFetch(Uint8Array.of(1, 2, 3)),
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({
        data: {
          status: "claimed",
          staging_key: STAGING,
          object_key: FINAL,
          content_type: "image/png",
          byte_size: 3,
        },
        error: null,
      });
    },
  });
  const response = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    deps,
  );
  assertEquals(response.status, 422);
  assertEquals(calls, [
    "claim_recipe_image_finalization",
    "release_recipe_image_finalization",
  ]);
});

Deno.test("database commit failure leaves the old image intact and keeps the verified object retryable", async () => {
  const calls: string[] = [];
  const deps = handlerDeps({
    recipe: { id: RECIPE, user_id: USER, image_path: "existing-final-image" },
    r2Fetch: metadataFetch(),
    rpc: (name) => {
      calls.push(name);
      if (name === "claim_recipe_image_finalization") {
        return Promise.resolve({
          data: {
            status: "claimed",
            staging_key: STAGING,
            object_key: FINAL,
            content_type: "image/png",
            byte_size: pngBytes().byteLength,
          },
          error: null,
        });
      }
      if (name === "finish_recipe_image_finalization") {
        return Promise.resolve({
          data: null,
          error: { message: "database unavailable" },
        });
      }
      if (name === "start_recipe_image_final_copy") {
        return Promise.resolve({ data: "started", error: null });
      }
      if (name === "finish_recipe_image_final_copy") {
        return Promise.resolve({ data: "verified", error: null });
      }
      return Promise.resolve({ data: "pending", error: null });
    },
  });
  const response = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    deps,
  );
  assertEquals(response.status, 500);
  assertEquals(calls, [
    "claim_recipe_image_finalization",
    "start_recipe_image_final_copy",
    "finish_recipe_image_final_copy",
    "finish_recipe_image_finalization",
    "release_recipe_image_finalization",
  ]);
});

Deno.test("stale commit fence returns conflict without changing the recipe pointer", async () => {
  const calls: string[] = [];
  const deps = handlerDeps({
    recipe: { id: RECIPE, user_id: USER, image_path: "existing-final-image" },
    r2Fetch: metadataFetch(),
    rpc: (name) => {
      calls.push(name);
      if (name === "claim_recipe_image_finalization") {
        return Promise.resolve({
          data: {
            status: "claimed",
            staging_key: STAGING,
            object_key: FINAL,
            content_type: "image/png",
            byte_size: pngBytes().byteLength,
          },
          error: null,
        });
      }
      if (name === "finish_recipe_image_finalization") {
        return Promise.resolve({ data: { status: "stale" }, error: null });
      }
      if (name === "start_recipe_image_final_copy") {
        return Promise.resolve({ data: "started", error: null });
      }
      if (name === "finish_recipe_image_final_copy") {
        return Promise.resolve({ data: "verified", error: null });
      }
      return Promise.resolve({ data: "stale", error: null });
    },
  });
  const response = await attachHandler(
    imageRequest("recipe-image-attach", {
      recipe_id: RECIPE,
      upload_id: UPLOAD,
    }),
    deps,
  );
  assertEquals(response.status, 409);
  assertEquals(calls, [
    "claim_recipe_image_finalization",
    "start_recipe_image_final_copy",
    "finish_recipe_image_final_copy",
    "finish_recipe_image_finalization",
    "release_recipe_image_finalization",
  ]);
});

Deno.test("late copy attempts stay isolated and their abandoned keys remain watched after deletion", async () => {
  const image = pngBytes();
  const intents = new Map<string, { state: string; token: string | null }>();
  const attempts = new Map<
    string,
    { upload: string; key: string; state: string; watch: boolean }
  >();
  const queue = new Map<
    string,
    { state: string; watch: boolean; lease: string | null }
  >();
  const objects = new Map<string, Uint8Array>();
  let imagePath: string | null = null;
  let copyCount = 0;
  const delayed = new Map<number, () => void>();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    await Promise.resolve();
    const uploadId = String(args.p_upload_id ?? "");
    const token = String(args.p_attempt_token ?? "");
    const intent = intents.get(uploadId);
    if (name === "claim_recipe_image_finalization") {
      if (intent?.state === "attached") {
        return {
          data: {
            status: "attached",
            content_type: "image/png",
            byte_size: image.byteLength,
            uploaded_at: NOW.toISOString(),
          },
          error: null,
        };
      }
      if (intent?.state === "finalizing") {
        return { data: { status: "conflict" }, error: null };
      }
      const key =
        `recipe-images/final/${USER}/${RECIPE}/${uploadId}/${OBJECT}/${token}`;
      intents.set(uploadId, { state: "finalizing", token });
      attempts.set(token, {
        upload: uploadId,
        key,
        state: "claimed",
        watch: false,
      });
      queue.set(key, { state: "active", watch: false, lease: null });
      return {
        data: {
          status: "claimed",
          staging_key: `recipe-images/staging/${USER}/${RECIPE}/${uploadId}`,
          object_key: key,
          content_type: "image/png",
          byte_size: image.byteLength,
        },
        error: null,
      };
    }
    if (name === "start_recipe_image_final_copy") {
      const attempt = attempts.get(token)!;
      attempt.state = "copying";
      attempt.watch = true;
      queue.get(attempt.key)!.watch = true;
      return { data: "started", error: null };
    }
    if (name === "finish_recipe_image_final_copy") {
      const attempt = attempts.get(token)!;
      attempt.state = "verified";
      attempt.watch = false;
      queue.get(attempt.key)!.watch = false;
      return { data: "verified", error: null };
    }
    if (name === "finish_recipe_image_finalization") {
      const attempt = attempts.get(token)!;
      if (
        intents.get(uploadId)?.token !== token || attempt.state !== "verified"
      ) {
        return { data: { status: "stale" }, error: null };
      }
      if (imagePath) queue.get(imagePath)!.state = "queued";
      imagePath = attempt.key;
      attempt.state = "attached";
      intents.set(uploadId, { state: "attached", token });
      return {
        data: {
          status: "attached",
          content_type: "image/png",
          byte_size: image.byteLength,
          uploaded_at: NOW.toISOString(),
        },
        error: null,
      };
    }
    if (name === "release_recipe_image_finalization") {
      const attempt = attempts.get(token);
      if (
        attempt && attempt.state !== "attached" && attempt.state !== "abandoned"
      ) {
        attempt.state = "abandoned";
        const task = queue.get(attempt.key)!;
        if (args.p_copy_outcome === "uncertain" && task.watch) {
          task.state = "watching";
        } else if (args.p_copy_outcome === "not_started") {
          task.state = "complete";
        } else {
          task.state = "queued";
        }
      }
      if (intents.get(uploadId)?.token === token) {
        intents.set(uploadId, { state: "pending", token: null });
      }
      return { data: "pending", error: null };
    }
    if (name === "delete_recipe_image_association") {
      if (imagePath) queue.get(imagePath)!.state = "queued";
      imagePath = null;
      return { data: "deleted", error: null };
    }
    if (name === "claim_recipe_image_final_cleanup") {
      const claims: Array<{ object_key: string; lease_token: string }> = [];
      for (const [key, task] of queue) {
        if (task.state !== "queued" && task.state !== "watching") continue;
        if (key === imagePath) continue;
        task.state = "claimed";
        task.lease = crypto.randomUUID();
        claims.push({ object_key: key, lease_token: task.lease });
        if (claims.length >= Number(args.p_limit)) break;
      }
      return { data: claims, error: null };
    }
    if (name === "finish_recipe_image_final_cleanup") {
      const task = queue.get(String(args.p_object_key))!;
      if (args.p_success) {
        task.state = task.watch ? "watching" : "complete";
      } else {
        task.state = "retry";
      }
      task.lease = null;
      return {
        data: task.state === "watching"
          ? "watching"
          : task.state === "complete"
          ? "complete"
          : "retry",
        error: null,
      };
    }
    throw new Error(`Unexpected lifecycle RPC ${name}`);
  };
  const r2Fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    const key = url.pathname.split("/").slice(2).join("/");
    const method = init?.method ?? "GET";
    if (method === "HEAD" && key.startsWith("recipe-images/staging/")) {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(image.byteLength),
          etag: '"etag"',
        },
      });
    }
    if (method === "GET" && key.startsWith("recipe-images/staging/")) {
      return new Response(image.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "image/png", etag: '"etag"' },
      });
    }
    if (method === "PUT") {
      copyCount++;
      if (copyCount === 1 || copyCount === 4) {
        delayed.set(copyCount, () => {
          objects.set(key, image.slice());
        });
        throw new Error("client timed out while R2 copy remained outstanding");
      }
      objects.set(key, image.slice());
      return new Response("<CopyObjectResult/>", { status: 200 });
    }
    if (method === "HEAD") {
      if (!objects.has(key)) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(image.byteLength),
          etag: '"final"',
        },
      });
    }
    if (method === "DELETE") {
      if (!objects.delete(key)) return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected R2 method ${method}`);
  };
  const deps = {
    ...handlerDeps({ rpc, r2Fetch }),
    cleanupToken: "synthetic-final-cleanup-token-0123456789",
  };
  const attach = (uploadId: string) =>
    attachHandler(
      imageRequest("recipe-image-attach", {
        recipe_id: RECIPE,
        upload_id: uploadId,
      }),
      deps,
    );
  assertEquals((await attach(UPLOAD)).status, 503);
  const staleKey = [...attempts.values()][0].key;
  assertEquals(queue.get(staleKey)?.state, "watching");
  assertEquals((await attach(UPLOAD)).status, 200);
  const winningKey = imagePath;
  assert(winningKey && winningKey !== staleKey);
  assertEquals((await attach(UPLOAD)).status, 200);
  assertEquals(imagePath, winningKey);
  assertEquals(copyCount, 2);
  assertEquals((await attach(REPLACEMENT_UPLOAD)).status, 200);
  const replacementKey = imagePath;
  assert(
    replacementKey && replacementKey !== winningKey &&
      replacementKey !== staleKey,
  );

  const cleanupRequest = () =>
    cleanupHandler(
      new Request("https://edge.invalid", {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.cleanupToken}` },
      }),
      deps,
    );
  const firstCleanup = await cleanupRequest();
  assertEquals(firstCleanup.status, 200);
  assertEquals(objects.has(replacementKey), true);
  assertEquals(queue.get(staleKey)?.state, "watching");
  assertEquals(queue.get(winningKey)?.state, "complete");
  delayed.get(1)?.();
  assertEquals(imagePath, replacementKey);
  assertEquals(objects.has(staleKey), true);

  assertEquals(
    (await deleteHandler(
      imageRequest("recipe-image-delete", { recipe_id: RECIPE }),
      deps,
    )).status,
    204,
  );
  assertEquals(imagePath, null);
  assertEquals((await attach(LATE_DELETE_UPLOAD)).status, 503);
  delayed.get(4)?.();
  assertEquals(imagePath, null);
  delayed.get(1)?.();
  assertEquals(objects.has(staleKey), true);
  const deletedAttemptKey = [...attempts.values()].find((item) =>
    item.upload === LATE_DELETE_UPLOAD
  )?.key;
  assert(deletedAttemptKey);
  assertEquals(objects.has(deletedAttemptKey), true);
  const secondCleanup = await cleanupRequest();
  assertEquals(secondCleanup.status, 200);
  assertEquals(objects.has(staleKey), false);
  assertEquals(objects.has(deletedAttemptKey), false);
  assertEquals(objects.has(replacementKey), false);
  assertEquals(queue.get(staleKey)?.state, "watching");
  assertEquals(queue.get(replacementKey)?.state, "complete");
});

Deno.test("private read signs only the owned recipe's final image and does not cache", async () => {
  let signedKey = "";
  const deps = {
    ...handlerDeps({
      recipe: { id: RECIPE, user_id: USER, image_path: FINAL },
      rpc: () =>
        Promise.resolve({
          data: {
            status: "found",
            object_key: FINAL,
            content_type: "image/png",
          },
          error: null,
        }),
    }),
    signGet: (key: string) => {
      signedKey = key;
      return Promise.resolve(`https://r2.invalid/${key}?X-Amz-Expires=60`);
    },
  };
  const response = await downloadHandler(
    imageRequest("recipe-image-download-url", { recipe_id: RECIPE }),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(signedKey, FINAL);
  assertEquals((await response.json()).expires_at, "2026-11-07T10:01:00.000Z");
  const foreign = await downloadHandler(
    imageRequest("recipe-image-download-url", { recipe_id: RECIPE }),
    {
      ...deps,
      fetch: authFetch({ id: RECIPE, user_id: OTHER }),
      rpc: () => Promise.reject(new Error("must not resolve a foreign recipe")),
    },
  );
  assertEquals(foreign.status, 404);
  const staging = await downloadHandler(
    imageRequest("recipe-image-download-url", { recipe_id: RECIPE }),
    {
      ...deps,
      rpc: () =>
        Promise.resolve({
          data: {
            status: "found",
            object_key: STAGING,
            content_type: "image/png",
          },
          error: null,
        }),
    },
  );
  assertEquals(staging.status, 404);
  const missing = await downloadHandler(
    imageRequest("recipe-image-download-url", { recipe_id: RECIPE }),
    {
      ...deps,
      rpc: () =>
        Promise.resolve({ data: { status: "not_found" }, error: null }),
    },
  );
  assertEquals(missing.status, 404);
});

Deno.test("image deletion is owner-authorized and returns 204 for an already-empty image", async () => {
  const calls: string[] = [];
  const deps = handlerDeps({
    recipe: { id: RECIPE, user_id: USER },
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({ data: "deleted", error: null });
    },
  });
  const response = await deleteHandler(
    imageRequest("recipe-image-delete", { recipe_id: RECIPE }),
    deps,
  );
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(calls, ["delete_recipe_image_association"]);
  const foreign = await deleteHandler(
    imageRequest("recipe-image-delete", { recipe_id: RECIPE }),
    handlerDeps({
      recipe: { id: RECIPE, user_id: OTHER },
      rpc: () => Promise.reject(new Error("must not call RPC")),
    }),
  );
  assertEquals(foreign.status, 404);
  const unauth = await deleteHandler(
    imageRequest("recipe-image-delete", { recipe_id: RECIPE }, null),
    handlerDeps(),
  );
  assertEquals(unauth.status, 401);
});

Deno.test("final cleanup requires its private token, bounds processing, and records retry outcomes", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps = {
    ...handlerDeps(),
    cleanupToken: "synthetic-final-cleanup-token-0123456789",
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_recipe_image_final_cleanup") {
        return Promise.resolve({
          data: [{ object_key: FINAL, lease_token: UPLOAD }],
          error: null,
        });
      }
      if (name === "finish_recipe_image_final_cleanup") {
        return Promise.resolve({ data: "retry", error: null });
      }
      return Promise.reject(new Error("unexpected rpc"));
    },
    r2Fetch: () => Promise.resolve(new Response(null, { status: 500 })),
  };
  assertEquals(
    (await cleanupHandler(
      new Request("https://edge.invalid", {
        method: "POST",
        headers: { Authorization: "Bearer bad" },
      }),
      deps,
    )).status,
    401,
  );
  const response = await cleanupHandler(
    new Request("https://edge.invalid", {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.cleanupToken}` },
    }),
    deps,
  );
  assertEquals(response.status, 503);
  assertEquals(calls[0], {
    name: "claim_recipe_image_final_cleanup",
    args: { p_limit: 25 },
  });
  assertEquals(calls[1].args.p_success, false);
  assertEquals(calls[1].args.p_failure, "r2_rejected");
});

Deno.test("cleanup scheduling advances ordinary work across recurring watcher batches", () => {
  type Task = {
    key: string;
    created: number;
    nextAttempt: number;
    watch: boolean;
    active: boolean;
    status: "watching" | "queued" | "retry" | "claimed" | "complete";
    leaseUntil: number | null;
    attempts: number;
    visits: number;
  };
  const watchers: Task[] = Array.from({ length: 60 }, (_, index) => ({
    key: "watch-" + String(index).padStart(2, "0"),
    created: -30 * 24 * 60 + index,
    nextAttempt: -3 * 24 * 60,
    watch: true,
    active: false,
    status: "watching",
    leaseUntil: null,
    attempts: 0,
    visits: 0,
  }));
  const ordinary: Task[] = Array.from({ length: 25 }, (_, index) => ({
    key: "ordinary-" + String(index).padStart(2, "0"),
    created: -29 * 24 * 60 + index,
    nextAttempt: -2 * 24 * 60,
    watch: false,
    active: false,
    status: "queued",
    leaseUntil: null,
    attempts: 0,
    visits: 0,
  }));
  const retryKey = ordinary[0].key;
  ordinary[0].status = "retry";
  ordinary[0].attempts = 1;
  const expiredLeaseKey = ordinary[1].key;
  ordinary[1].status = "claimed";
  ordinary[1].attempts = 1;
  ordinary[1].leaseUntil = -1;
  const protectedTask: Task = {
    key: "active-reference",
    created: -31 * 24 * 60,
    nextAttempt: -4 * 24 * 60,
    watch: false,
    active: true,
    status: "queued",
    leaseUntil: null,
    attempts: 0,
    visits: 0,
  };
  const tasks = [...watchers, ...ordinary, protectedTask];
  let now = 0;
  const claim = (limit: number) => {
    const selected = tasks.filter((task) =>
      ["watching", "queued", "retry", "claimed"].includes(task.status) &&
      task.nextAttempt <= now &&
      (task.status !== "claimed" || (task.leaseUntil ?? Infinity) <= now) &&
      !task.active
    ).sort((a, b) =>
      a.nextAttempt - b.nextAttempt || a.created - b.created ||
      a.key.localeCompare(b.key)
    ).slice(0, limit);
    for (const task of selected) {
      task.status = "claimed";
      task.leaseUntil = now + 10;
      task.attempts++;
    }
    return selected;
  };
  const finish = (selected: Task[], failKey?: string) => {
    for (const task of selected) {
      task.leaseUntil = null;
      if (task.key === failKey) {
        task.status = "retry";
        task.nextAttempt = now + 2;
      } else if (task.watch) {
        task.status = "watching";
        task.nextAttempt = now + 60;
        task.visits++;
      } else {
        task.status = "complete";
      }
    }
  };

  const firstBatch = claim(25);
  assertEquals(firstBatch.length, 25);
  assertEquals(firstBatch.every((task) => task.watch), true);
  finish(firstBatch);
  now = 60;
  const secondBatch = claim(25);
  assertEquals(secondBatch.length, 25);
  assertEquals(secondBatch.every((task) => task.watch), true);
  assertEquals(secondBatch.some((task) => firstBatch.includes(task)), false);
  finish(secondBatch);
  now = 120;
  const thirdBatch = claim(25);
  const thirdKeys = thirdBatch.map((task) => task.key);
  assertEquals(watchers.filter((task) => task.visits === 0).length, 10);
  assertEquals(
    watchers.filter((task) => task.visits === 0).every((task) =>
      thirdKeys.includes(task.key)
    ),
    true,
  );
  assertEquals(thirdKeys.includes(protectedTask.key), false);
  assertEquals(thirdKeys.includes(expiredLeaseKey), true);
  assertEquals(
    ordinary.find((task) => task.key === expiredLeaseKey)?.attempts,
    2,
  );
  assertEquals(
    ordinary.find((task) => task.key === expiredLeaseKey)?.leaseUntil,
    now + 10,
  );
  finish(thirdBatch, retryKey);
  assertEquals(ordinary.find((task) => task.key === retryKey)?.status, "retry");
  now = 180;
  const fourthBatch = claim(25);
  finish(fourthBatch);
  let retryReclaimed = fourthBatch.some((task) => task.key === retryKey);
  for (let invocation = 0; invocation < 4 && !retryReclaimed; invocation++) {
    const laterBatch = claim(25);
    retryReclaimed = laterBatch.some((task) => task.key === retryKey);
    finish(laterBatch);
  }
  assertEquals(retryReclaimed, true);
  assertEquals(watchers.every((task) => task.visits > 0), true);
  assertEquals(ordinary.every((task) => task.status === "complete"), true);
  assertEquals(protectedTask.status, "queued");
});
