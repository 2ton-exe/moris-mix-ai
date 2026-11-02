import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHash, createHmac } from "node:crypto";
import {
  type R2Config,
  resolveR2Config,
  signRecipeImageUpload,
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

for (
  const [contentType, expected] of [
    [
      "image/jpeg",
      "b3d07a86031871653d2dd509401259968a5f31efb86ca7c6f522ce049db280b8",
    ],
    [
      "image/png",
      "700bc07adbaedcf16a6b0899be9de7b6e452ebbd4131a25cdb25b19b61a87b9e",
    ],
    [
      "image/webp",
      "6264042592feb52bceedb12e52982d37725232fbcb3119bd5a1bcdd93b130292",
    ],
  ] as const
) {
  Deno.test(`R2 Web Crypto PUT matches independent Node crypto vector for ${contentType}`, async () => {
    const upload = await signRecipeImageUpload(intent(contentType), config);
    const url = new URL(upload.url);
    assertEquals(url.searchParams.get("X-Amz-Signature"), expected);
    assertEquals(
      referenceSignature(url, "PUT", new Headers(upload.headers)),
      expected,
    );
    assertEquals(url.protocol, "https:");
    assertEquals(url.host, `${config.accountId}.r2.cloudflarestorage.com`);
    assertEquals(url.pathname, `/${config.bucketName}/${intent().staging_key}`);
    assertEquals(
      url.searchParams.get("X-Amz-Credential"),
      "TESTACCESSKEY/20261102/auto/s3/aws4_request",
    );
    assertEquals(url.searchParams.get("X-Amz-Date"), "20261102T000000Z");
    assertEquals(url.searchParams.get("X-Amz-Expires"), "600");
    assertEquals(
      url.searchParams.get("X-Amz-SignedHeaders"),
      "content-type;host",
    );
    assertEquals(upload.headers, { "Content-Type": contentType });
    assertEquals(upload.method, "PUT");
    assertEquals(Date.parse(upload.expires_at) - now.getTime(), 600_000);
    assertEquals(upload.url.includes(config.secretAccessKey), false);
    assertEquals(upload.url.includes(intent().final_key), false);
    assertEquals(Array.from(url.searchParams.keys()).sort(), [
      "X-Amz-Algorithm",
      "X-Amz-Credential",
      "X-Amz-Date",
      "X-Amz-Expires",
      "X-Amz-Signature",
      "X-Amz-SignedHeaders",
    ]);
  });
}

Deno.test("R2 signature binds HTTP method, object, host, content type, scope, and expiry", async () => {
  const upload = await signRecipeImageUpload(intent(), config);
  const url = new URL(upload.url);
  const signature = url.searchParams.get("X-Amz-Signature");
  for (const method of ["GET", "HEAD", "DELETE", "POST"]) {
    assertNotEquals(
      referenceSignature(url, method, new Headers(upload.headers)),
      signature,
    );
  }
  for (
    const headers of [
      new Headers(),
      new Headers({ "Content-Type": "image/png" }),
    ]
  ) {
    assertNotEquals(referenceSignature(url, "PUT", headers), signature);
  }
  for (
    const mutate of [
      (changed: URL) => {
        changed.pathname = `/${config.bucketName}/${intent().final_key}`;
      },
      (changed: URL) => {
        changed.pathname += "/other";
      },
      (changed: URL) => {
        changed.hostname =
          `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.r2.cloudflarestorage.com`;
      },
      (changed: URL) => {
        changed.searchParams.set("X-Amz-Expires", "601");
      },
      (changed: URL) => {
        changed.searchParams.set("X-Amz-Date", "20261103T000000Z");
      },
      (changed: URL) => {
        changed.searchParams.set("X-Amz-SignedHeaders", "host");
      },
      (changed: URL) => {
        changed.searchParams.set(
          "X-Amz-Credential",
          "TESTACCESSKEY/20261102/auto/s3/other",
        );
      },
    ]
  ) {
    const changed = new URL(upload.url);
    mutate(changed);
    assertNotEquals(
      referenceSignature(changed, "PUT", new Headers(upload.headers)),
      signature,
    );
  }
});

Deno.test("R2 signer rejects invalid configuration and altered upload intents", async () => {
  for (
    const change of [
      { accountId: "https://untrusted.invalid" },
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
      signRecipeImageUpload({ ...intent(), ...change } as UploadIntent, config)
    );
  }
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
