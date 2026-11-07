import { z } from "npm:zod@3.22.4";
import { type UploadIntent, validateUploadIntent } from "./uploadIntents.ts";

const R2_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const R2_ENDPOINT_HOST_PATTERN = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/;

function r2Endpoint(accountId: string): URL {
  if (!R2_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("Invalid image storage configuration.");
  }
  const endpoint = new URL(
    `https://${accountId}.r2.cloudflarestorage.com`,
  );
  if (
    endpoint.protocol !== "https:" ||
    !R2_ENDPOINT_HOST_PATTERN.test(endpoint.hostname) ||
    endpoint.username !== "" || endpoint.password !== "" ||
    endpoint.port !== "" || endpoint.pathname !== "/" ||
    endpoint.search !== "" || endpoint.hash !== ""
  ) {
    throw new Error("Invalid image storage configuration.");
  }
  return endpoint;
}

const R2ConfigSchema = z.object({
  accountId: z.string().regex(R2_ACCOUNT_ID_PATTERN),
  bucketName: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  accessKeyId: z.string().min(1).max(128).regex(/^[A-Za-z0-9]+$/),
  secretAccessKey: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),
}).strict();

export type R2Config = z.infer<typeof R2ConfigSchema>;

export type StagingPutResult = "stored" | "already_exists" | "failed";

export function resolveR2Config(explicit?: R2Config): R2Config {
  const result = R2ConfigSchema.safeParse(
    explicit ?? {
      accountId: Deno.env.get("R2_ACCOUNT_ID"),
      bucketName: Deno.env.get("R2_BUCKET_NAME"),
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID"),
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY"),
    },
  );
  if (!result.success) {
    throw new Error("Invalid image storage configuration.");
  }
  return result.data;
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  value: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", imported, encoder.encode(value)),
  );
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function putRecipeImageStaging(
  intent: UploadIntent,
  configuration: R2Config,
  body: Uint8Array<ArrayBuffer>,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<StagingPutResult> {
  validateUploadIntent(intent);
  const config = resolveR2Config(configuration);
  const endpoint = r2Endpoint(config.accountId);
  if (body.byteLength !== intent.byte_size) {
    throw new Error("Invalid image upload size.");
  }
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = endpoint.host;
  const path = `/${config.bucketName}/${
    intent.staging_key.split("/").map(encode).join("/")
  }`;
  const payloadHash = hex(await crypto.subtle.digest("SHA-256", body));
  const signedHeaders =
    "content-type;host;if-none-match;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${intent.content_type}`,
    `host:${host}`,
    "if-none-match:*",
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${timestamp}`,
  ].join("\n");
  const canonicalRequest = [
    "PUT",
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const requestHash = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)),
  );
  const stringToSign =
    `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${requestHash}`;
  let signingKey = await hmac(
    encoder.encode(`AWS4${config.secretAccessKey}`),
    date,
  );
  for (const component of ["auto", "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, component);
  }
  const signature = hex((await hmac(signingKey, stringToSign)).buffer);
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    const response = await fetchImpl(`${endpoint.origin}${path}`, {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "Content-Type": intent.content_type,
        "If-None-Match": "*",
        "X-Amz-Content-Sha256": payloadHash,
        "X-Amz-Date": timestamp,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 412 || response.status === 409) {
      return "already_exists";
    }
    return response.ok ? "stored" : "failed";
  } catch {
    return "failed";
  }
}

export async function signRecipeImageStagingDelete(
  stagingKey: string,
  configuration: R2Config,
  now: Date = new Date(),
): Promise<string> {
  const keyPattern =
    /^recipe-images\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!keyPattern.test(stagingKey)) {
    throw new Error("Invalid staging object key.");
  }
  const config = resolveR2Config(configuration);
  const endpoint = r2Endpoint(config.accountId);
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = endpoint.host;
  const path = `/${config.bucketName}/${
    stagingKey.split("/").map(encode).join("/")
  }`;
  const signedHeaders = "host";
  const query = Object.entries({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": "60",
    "X-Amz-SignedHeaders": signedHeaders,
  }).map(([key, value]) => `${encode(key)}=${encode(value)}`).sort().join("&");
  const canonicalRequest = [
    "DELETE",
    path,
    query,
    `host:${host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const requestHash = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)),
  );
  const stringToSign =
    `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${requestHash}`;
  let signingKey = await hmac(
    encoder.encode(`AWS4${config.secretAccessKey}`),
    date,
  );
  for (const component of ["auto", "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, component);
  }
  const signature = hex((await hmac(signingKey, stringToSign)).buffer);
  return `${endpoint.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

export async function deleteRecipeImageStaging(
  stagingKey: string,
  configuration: R2Config,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const url = await signRecipeImageStagingDelete(stagingKey, configuration);
    const response = await fetchImpl(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function signRecipeImageStagingList(
  continuationToken: string | null,
  configuration: R2Config,
  now: Date = new Date(),
): Promise<string> {
  if (
    continuationToken !== null &&
    (!continuationToken.length || continuationToken.length > 4096)
  ) {
    throw new Error("Invalid staging listing cursor.");
  }
  const config = resolveR2Config(configuration);
  const endpoint = r2Endpoint(config.accountId);
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = endpoint.host;
  const path = `/${config.bucketName}`;
  const queryEntries: [string, string][] = [
    ["list-type", "2"],
    ["max-keys", "25"],
    ["prefix", "recipe-images/staging/"],
  ];
  if (continuationToken !== null) {
    queryEntries.push(["continuation-token", continuationToken]);
  }
  const query = queryEntries
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .sort()
    .concat(
      Object.entries({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
        "X-Amz-Date": timestamp,
        "X-Amz-Expires": "60",
        "X-Amz-SignedHeaders": "host",
      }).map(([key, value]) => `${encode(key)}=${encode(value)}`),
    )
    .sort()
    .join("&");
  const canonicalRequest = [
    "GET",
    path,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const requestHash = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)),
  );
  const stringToSign =
    `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${requestHash}`;
  let signingKey = await hmac(
    encoder.encode(`AWS4${config.secretAccessKey}`),
    date,
  );
  for (const component of ["auto", "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, component);
  }
  const signature = hex((await hmac(signingKey, stringToSign)).buffer);
  return `${endpoint.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}
