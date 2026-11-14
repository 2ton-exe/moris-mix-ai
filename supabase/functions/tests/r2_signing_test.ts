import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHash, createHmac } from "node:crypto";
import {
  checkRecipeImageStaging,
  getR2ConfigInvalidFields,
  putRecipeImageStaging,
  type R2Config,
  resolveR2Config,
  signRecipeImageStagingDelete,
  signRecipeImageStagingList,
} from "../_shared/recipe-images/r2.ts";
import {
  createUploadIntent,
  type UploadIntent,
} from "../_shared/recipe-images/uploadIntents.ts";
import type { RecipeImageContentType } from "../_shared/recipe-images/schemas.ts";

const config: R2Config = {
  accountId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  bucketName: "mock-recipe-images",
  accessKeyId: "TESTACCESSKEY",
  secretAccessKey: "synthetic-r2-secret-key",
};
const now = new Date("2026-11-02T00:00:00Z");

Deno.test("R2 configuration resolves only backend environment settings and rejects a missing secret", () => {
  const values = {
    R2_ACCOUNT_ID: config.accountId,
    R2_BUCKET_NAME: config.bucketName,
    R2_ACCESS_KEY_ID: config.accessKeyId,
    R2_SECRET_ACCESS_KEY: config.secretAccessKey,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, Deno.env.get(name)]),
  );
  try {
    for (const [name, value] of Object.entries(values)) {
      Deno.env.set(name, value);
    }
    assertEquals(resolveR2Config(), config);
    Deno.env.delete("R2_SECRET_ACCESS_KEY");
    assertThrows(
      () => resolveR2Config(),
      Error,
      "Invalid image storage configuration.",
    );
    assertEquals(getR2ConfigInvalidFields(), ["secretAccessKey"]);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("R2 configuration does not fall back to image-prefixed or backup credential names", () => {
  const names = [
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_IMAGE_ENDPOINT",
    "R2_IMAGE_BUCKET",
    "R2_IMAGE_ACCESS_KEY_ID",
    "R2_IMAGE_SECRET_ACCESS_KEY",
    "R2_BACKUP_ENDPOINT",
    "R2_BACKUP_BUCKET",
    "R2_BACKUP_ACCESS_KEY_ID",
    "R2_BACKUP_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  try {
    for (const name of names) Deno.env.delete(name);
    Deno.env.set(
      "R2_IMAGE_ENDPOINT",
      "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com",
    );
    Deno.env.set("R2_IMAGE_BUCKET", "image-bucket");
    Deno.env.set("R2_IMAGE_ACCESS_KEY_ID", "IMAGEACCESSKEY");
    Deno.env.set("R2_IMAGE_SECRET_ACCESS_KEY", "synthetic-image-secret");
    Deno.env.set(
      "R2_BACKUP_ENDPOINT",
      "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com",
    );
    Deno.env.set("R2_BACKUP_BUCKET", "backup-bucket");
    Deno.env.set("R2_BACKUP_ACCESS_KEY_ID", "BACKUPACCESSKEY");
    Deno.env.set("R2_BACKUP_SECRET_ACCESS_KEY", "synthetic-backup-secret");
    assertThrows(
      () => resolveR2Config(),
      Error,
      "Invalid image storage configuration.",
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

function intent(
  content_type: RecipeImageContentType = "image/jpeg",
): UploadIntent {
  return createUploadIntent(
    {
      recipe_id: "33333333-3333-4333-8333-333333333333",
      content_type,
      byte_size: 1024,
    },
    "99999999-9999-4999-8999-999999999999",
    now,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
}

function referenceSignature(
  url: URL,
  method: string,
  headers: Headers,
): string {
  const params = new URLSearchParams(url.search);
  params.delete("X-Amz-Signature");
  const canonicalQuery = Array.from(params).sort(([a], [b]) =>
    a.localeCompare(b)
  )
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    ).join("&");
  const names = params.get("X-Amz-SignedHeaders")!.split(";");
  const canonicalHeaders = names.map((name) =>
    `${name}:${
      name === "host"
        ? url.host
        : (headers.get(name) ?? "").trim().replace(/\s+/g, " ")
    }\n`
  ).join("");
  const request =
    `${method}\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${
      names.join(";")
    }\nUNSIGNED-PAYLOAD`;
  const scope = params.get("X-Amz-Credential")!.split("/").slice(1);
  let key: Uint8Array = new TextEncoder().encode(
    `AWS4${config.secretAccessKey}`,
  );
  for (const part of scope) {
    key = createHmac("sha256", key).update(part).digest();
  }
  const hash = createHash("sha256").update(request).digest("hex");
  return createHmac("sha256", key).update(
    `AWS4-HMAC-SHA256\n${params.get("X-Amz-Date")}\n${
      scope.join("/")
    }\n${hash}`,
  ).digest("hex");
}

function referenceListSignature(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete("X-Amz-Signature");
  const canonicalQuery = Array.from(params)
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${
        encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
          `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
      }`
    )
    .sort()
    .join("&");
  const request =
    `GET\n${url.pathname}\n${canonicalQuery}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  let key: Uint8Array = new TextEncoder().encode(
    `AWS4${config.secretAccessKey}`,
  );
  for (const component of ["20261102", "auto", "s3", "aws4_request"]) {
    key = createHmac("sha256", key).update(component).digest();
  }
  const hash = createHash("sha256").update(request).digest("hex");
  return createHmac("sha256", key).update(
    `AWS4-HMAC-SHA256\n20261102T000000Z\n20261102/auto/s3/aws4_request\n${hash}`,
  ).digest("hex");
}

function referencePutSignature(url: URL, init: RequestInit): string {
  const headers = new Headers(init.headers);
  const body = init.body as Uint8Array;
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const date = headers.get("x-amz-date")!;
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const signedHeaders =
    "content-type;host;if-none-match;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${headers.get("content-type")}`,
    `host:${url.host}`,
    `if-none-match:${headers.get("if-none-match")}`,
    `x-amz-content-sha256:${headers.get("x-amz-content-sha256")}`,
    `x-amz-date:${date}`,
  ].join("\n") + "\n";
  const canonicalRequest =
    `PUT\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  let key: Uint8Array = new TextEncoder().encode(
    `AWS4${config.secretAccessKey}`,
  );
  for (const part of [date.slice(0, 8), "auto", "s3", "aws4_request"]) {
    key = createHmac("sha256", key).update(part).digest();
  }
  const requestHash = createHash("sha256").update(canonicalRequest).digest(
    "hex",
  );
  return createHmac("sha256", key).update(
    `AWS4-HMAC-SHA256\n${date}\n${scope}\n${requestHash}`,
  ).digest("hex");
}

Deno.test("backend PUT uses a payload-bound SigV4 signature and atomic create-only condition", async () => {
  for (
    const contentType of ["image/jpeg", "image/png", "image/webp"] as const
  ) {
    const imageIntent = intent(contentType);
    const body = new Uint8Array(1024).fill(7);
    let target = "";
    let init: RequestInit | undefined;
    const result = await putRecipeImageStaging(
      imageIntent,
      config,
      body,
      (input, requestInit) => {
        target = String(input);
        init = requestInit;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
      now,
    );
    const url = new URL(target);
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization")!;
    const signature = authorization.match(/Signature=([0-9a-f]{64})$/)?.[1];
    assertEquals(result, "stored");
    assertEquals(url.protocol, "https:");
    assertEquals(url.host, `${config.accountId}.r2.cloudflarestorage.com`);
    assertEquals(
      url.pathname,
      `/${config.bucketName}/${imageIntent.staging_key}`,
    );
    assertEquals(headers.get("if-none-match"), "*");
    assertEquals(headers.get("content-type"), contentType);
    assertEquals(
      headers.get("x-amz-content-sha256"),
      createHash("sha256").update(body).digest("hex"),
    );
    assertEquals(headers.get("x-amz-date"), "20261102T000000Z");
    assertEquals(authorization.includes("UNSIGNED-PAYLOAD"), false);
    assertEquals(signature, referencePutSignature(url, init!));
    if (contentType === "image/jpeg") {
      assertEquals(
        signature,
        "3f811924aa04c2dd4d5e032c5ce6a0b365a733e56b08dc432ad704e7eea97e74",
      );
    }
    assertEquals(init?.method, "PUT");
    assertEquals((init?.body as Uint8Array).byteLength, 1024);
  }
});

Deno.test("conditional R2 conflicts reject replay and payload mismatch fails before fetch", async () => {
  const imageIntent = intent();
  const body = new Uint8Array(1024);
  let condition = "";
  const replay = await putRecipeImageStaging(
    imageIntent,
    config,
    body,
    (_input, init) => {
      condition = new Headers(init?.headers).get("if-none-match") ?? "";
      return Promise.resolve(new Response(null, { status: 412 }));
    },
    now,
  );
  assertEquals(condition, "*");
  assertEquals(replay, "already_exists");
  let called = false;
  await assertRejects(() =>
    putRecipeImageStaging(
      imageIntent,
      config,
      new Uint8Array(1023),
      () => {
        called = true;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
      now,
    )
  );
  assertEquals(called, false);
});

Deno.test("R2 signer rejects invalid configuration and altered upload intents", async () => {
  for (
    const change of [
      { accountId: "https://untrusted.invalid" },
      { accountId: "A".repeat(32) },
      { accountId: "a".repeat(31) },
      { accountId: "a".repeat(33) },
      { accountId: `${"a".repeat(31)}g` },
      { bucketName: "../other" },
      { accessKeyId: "" },
      { secretAccessKey: "" },
      { secretAccessKey: "secret\nvalue" },
    ]
  ) assertThrows(() => resolveR2Config({ ...config, ...change }));
  for (
    const change of [
      { staging_key: intent().final_key },
      { final_key: intent().staging_key },
      { recipe_id: "invalid" },
      { user_id: "invalid" },
      { id: "invalid" },
      { content_type: "image/svg+xml" },
      { byte_size: 0 },
      { byte_size: 10_485_761 },
      { expires_at: "2026-11-02T00:10:01.000Z" },
      { created_at: "invalid" },
      { state: "attached" },
    ]
  ) {
    await assertRejects(() =>
      putRecipeImageStaging(
        { ...intent(), ...change } as UploadIntent,
        config,
        new Uint8Array(1024),
        () => Promise.resolve(new Response(null, { status: 200 })),
        now,
      )
    );
  }
});

Deno.test("staging cleanup DELETE is object-scoped, short-lived, and independently signed", async () => {
  const stagingKey = intent().staging_key;
  const url = new URL(
    await signRecipeImageStagingDelete(stagingKey, config, now),
  );
  const signature = url.searchParams.get("X-Amz-Signature");
  assertEquals(url.pathname, `/${config.bucketName}/${stagingKey}`);
  assertEquals(url.searchParams.get("X-Amz-Expires"), "60");
  assertEquals(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assertEquals(
    referenceSignature(url, "DELETE", new Headers()),
    signature,
  );
  assertNotEquals(referenceSignature(url, "PUT", new Headers()), signature);
  await assertRejects(() =>
    signRecipeImageStagingDelete(intent().final_key, config, now)
  );
  await assertRejects(() =>
    signRecipeImageStagingDelete("recipe-images/staging/not-a-key", config, now)
  );
});

Deno.test("staging reconciliation listing is prefix-scoped, paginated, and signed", async () => {
  const cursor = "opaque+/=cursor%value";
  const url = new URL(await signRecipeImageStagingList(cursor, config, now));
  const signature = url.searchParams.get("X-Amz-Signature");
  assertEquals(referenceListSignature(url), signature);
  assertEquals(url.protocol, "https:");
  assertEquals(url.pathname, `/${config.bucketName}`);
  assertEquals(url.searchParams.get("list-type"), "2");
  assertEquals(url.searchParams.get("max-keys"), "25");
  assertEquals(url.searchParams.get("prefix"), "recipe-images/staging/");
  assertEquals(url.searchParams.get("continuation-token"), cursor);
  assertEquals(url.searchParams.get("X-Amz-Expires"), "60");
  assertEquals(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assertEquals(url.href.includes(config.secretAccessKey), false);
  const changed = new URL(url);
  changed.searchParams.set("prefix", "recipe-images/final/");
  assertNotEquals(referenceListSignature(changed), signature);
  await assertRejects(() =>
    signRecipeImageStagingList("x".repeat(4097), config, now)
  );
});

Deno.test("upload intent normalizes UUIDs, truncates milliseconds, and generates fresh keys", () => {
  const original = intent();
  const normalized = createUploadIntent(
    {
      recipe_id: original.recipe_id.toUpperCase(),
      content_type: original.content_type,
      byte_size: original.byte_size,
    },
    original.user_id.toUpperCase(),
    new Date("2026-11-02T00:00:00.999Z"),
    original.id.toUpperCase(),
    "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
  );
  assertEquals(normalized, original);
  const fresh = createUploadIntent(
    {
      recipe_id: original.recipe_id,
      content_type: original.content_type,
      byte_size: original.byte_size,
    },
    original.user_id,
    now,
  );
  assertNotEquals(fresh.id, original.id);
  assertNotEquals(fresh.staging_key, original.staging_key);
  assertNotEquals(fresh.staging_key, fresh.final_key);
});

Deno.test("staging HEAD is independently signed and fails closed for uncertain results", async () => {
  for (
    const [status, expected] of [[200, "exists"], [404, "missing"], [
      403,
      "failed",
    ], [500, "failed"]] as const
  ) {
    const result = await checkRecipeImageStaging(
      intent().staging_key,
      config,
      (input, init) => {
        const url = new URL(String(input));
        assertEquals(init?.method, "HEAD");
        assertEquals(init?.redirect, "error");
        assertEquals(
          url.pathname,
          `/${config.bucketName}/${intent().staging_key}`,
        );
        assertEquals(
          url.searchParams.get("X-Amz-Signature"),
          referenceSignature(url, "HEAD", new Headers()),
        );
        return Promise.resolve(new Response(null, { status }));
      },
    );
    assertEquals(result, expected);
  }
  assertEquals(
    await checkRecipeImageStaging(
      intent().staging_key,
      config,
      () => Promise.reject(new Error("network failure")),
    ),
    "failed",
  );
});
