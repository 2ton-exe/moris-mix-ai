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
  ].join("\n") + "\n";
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

async function signRecipeImageStagingRequest(
  method: "DELETE" | "HEAD",
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
    method,
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

export function signRecipeImageStagingDelete(
  stagingKey: string,
  configuration: R2Config,
  now: Date = new Date(),
): Promise<string> {
  return signRecipeImageStagingRequest(
    "DELETE",
    stagingKey,
    configuration,
    now,
  );
}

export async function checkRecipeImageStaging(
  stagingKey: string,
  configuration: R2Config,
  fetchImpl: typeof fetch = fetch,
): Promise<"exists" | "missing" | "failed"> {
  try {
    const url = await signRecipeImageStagingRequest(
      "HEAD",
      stagingKey,
      configuration,
    );
    const response = await fetchImpl(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (response.status === 200) return "exists";
    if (response.status === 404) return "missing";
    return "failed";
  } catch {
    return "failed";
  }
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

const FINAL_KEY_PATTERN =
  /^recipe-images\/final\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINAL_CLEANUP_KEY_PATTERN =
  /^recipe-images\/final\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;
const STAGING_KEY_PATTERN =
  /^recipe-images\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function objectUrl(key: string, configuration: R2Config): URL {
  const config = resolveR2Config(configuration);
  const path = key.split("/").map(encode).join("/");
  return new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${path}`,
  );
}

async function signR2Request(
  method: string,
  url: URL,
  headers: Record<string, string>,
  configuration: R2Config,
  now: Date,
): Promise<Headers> {
  const config = resolveR2Config(configuration);
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const canonicalHeaders: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": timestamp,
    ...Object.fromEntries(
      Object.entries(headers).map((
        [k, v],
      ) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]),
    ),
  };
  const signedHeaders = Object.keys(canonicalHeaders).sort().join(";");
  const canonicalHeaderText = Object.keys(canonicalHeaders).sort().map((key) =>
    `${key}:${canonicalHeaders[key]}\n`
  ).join("");
  const canonicalRequest = [
    method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaderText,
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
  const result = new Headers(headers);
  result.set("x-amz-date", timestamp);
  result.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
  result.set(
    "Authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
  return result;
}

async function requestR2Object(
  method: string,
  key: string,
  configuration: R2Config,
  options: {
    headers?: Record<string, string>;
    fetch?: typeof fetch;
    now?: Date;
  } = {},
): Promise<Response> {
  const url = objectUrl(key, configuration);
  const headers = await signR2Request(
    method,
    url,
    options.headers ?? {},
    configuration,
    options.now ?? new Date(),
  );
  return await (options.fetch ?? fetch)(url, {
    method,
    headers,
    signal: AbortSignal.timeout(8_000),
  });
}

export type StoredRecipeImage = {
  contentType: string;
  byteSize: number;
  etag: string;
  bytes: Uint8Array;
};

export async function readAndVerifyRecipeImage(
  stagingKey: string,
  expectedContentType: string,
  expectedByteSize: number,
  configuration: R2Config,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredRecipeImage | null> {
  if (!STAGING_KEY_PATTERN.test(stagingKey)) {
    throw new Error("Invalid staging object key.");
  }
  const head = await requestR2Object("HEAD", stagingKey, configuration, {
    fetch: fetchImpl,
  });
  if (head.status === 404) return null;
  if (!head.ok) throw new Error("Staging object metadata is unavailable.");
  const contentType = (head.headers.get("content-type") ?? "").split(";")[0]
    .trim().toLowerCase();
  const headSize = Number(head.headers.get("content-length"));
  const etag = head.headers.get("etag") ?? "";
  if (
    !etag || !Number.isInteger(headSize) || headSize < 1 ||
    headSize > 10 * 1024 * 1024 || contentType !== expectedContentType ||
    headSize !== expectedByteSize
  ) {
    throw new Error(
      "Staging object metadata does not match the upload intent.",
    );
  }
  const get = await requestR2Object("GET", stagingKey, configuration, {
    headers: { "if-match": etag },
    fetch: fetchImpl,
  });
  if (get.status === 404) return null;
  if (get.status === 412) {
    throw new Error("Staging object changed during verification.");
  }
  if (!get.ok || !get.body) {
    throw new Error("Staging object content is unavailable.");
  }
  const actualType = (get.headers.get("content-type") ?? "").split(";")[0]
    .trim().toLowerCase();
  if (actualType !== contentType || get.headers.get("etag") !== etag) {
    throw new Error("Staging object changed during verification.");
  }
  const reader = get.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      byteSize += item.value.byteLength;
      if (byteSize > 10 * 1024 * 1024 || byteSize > expectedByteSize) {
        await reader.cancel();
        throw new Error("Staging object size is invalid.");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteSize < 1 || byteSize !== expectedByteSize) {
    throw new Error("Staging object size does not match the upload intent.");
  }
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!validateImageStructure(bytes, contentType)) {
    throw new Error("Image content is structurally invalid.");
  }
  return { contentType, byteSize, etag, bytes };
}

function validateImageStructure(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (contentType === "image/jpeg") {
    if (
      bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9
    ) return false;
    for (let i = 2; i < bytes.length - 3; i++) {
      if (
        bytes[i] === 0xff &&
        [
          0xc0,
          0xc1,
          0xc2,
          0xc3,
          0xc5,
          0xc6,
          0xc7,
          0xc9,
          0xca,
          0xcb,
          0xcd,
          0xce,
          0xcf,
        ].includes(bytes[i + 1])
      ) return true;
    }
    return false;
  }
  if (contentType === "image/png") {
    if (
      bytes.length < 45 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) =>
        bytes[index] === value
      )
    ) return false;
    let offset = 8;
    let first = true;
    let hasData = false;
    while (offset + 12 <= bytes.length) {
      const length = readUint32(bytes, offset);
      if (length > bytes.length - offset - 12) return false;
      const type = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8),
      );
      const isFirstChunk = first;
      if (first && (type !== "IHDR" || length !== 13)) return false;
      if (type === "IHDR" && !isFirstChunk) return false;
      first = false;
      if (
        crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
          readUint32(bytes, offset + 8 + length)
      ) return false;
      if (
        type === "IHDR" &&
        (readUint32(bytes, offset + 8) < 1 ||
          readUint32(bytes, offset + 12) < 1)
      ) return false;
      if (type === "IDAT" && length > 0) hasData = true;
      offset += length + 12;
      if (type === "IEND") {
        return length === 0 && hasData && offset === bytes.length;
      }
    }
    return false;
  }
  if (contentType === "image/webp") {
    if (
      bytes.length < 20 ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP" ||
      readUint32LittleEndian(bytes, 4) + 8 !== bytes.length
    ) return false;
    let offset = 12;
    let imageChunk = false;
    while (offset + 8 <= bytes.length) {
      const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      const length = readUint32LittleEndian(bytes, offset + 4);
      if (length > bytes.length - offset - 8) return false;
      if (["VP8 ", "VP8L", "VP8X"].includes(type) && length > 0) {
        imageChunk = true;
      }
      offset += 8 + length + (length % 2);
    }
    return imageChunk && offset === bytes.length;
  }
  return false;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

export async function copyVerifiedRecipeImage(
  stagingKey: string,
  finalKey: string,
  expectedContentType: string,
  expectedByteSize: number,
  etag: string,
  configuration: R2Config,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  if (
    !STAGING_KEY_PATTERN.test(stagingKey) ||
    !FINAL_KEY_PATTERN.test(finalKey) || !etag || /[\r\n]/.test(etag)
  ) throw new Error("Invalid image copy request.");
  const config = resolveR2Config(configuration);
  const url = objectUrl(finalKey, config);
  const source = `/${config.bucketName}/${
    stagingKey.split("/").map(encode).join("/")
  }`;
  const headers = await signR2Request(
    "PUT",
    url,
    {
      "x-amz-copy-source": source,
      "x-amz-copy-source-if-match": etag,
    },
    config,
    new Date(),
  );
  const response = await fetchImpl(url, {
    method: "PUT",
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (response.status === 412) {
    throw new Error("Staging object changed before finalization.");
  }
  if (!response.ok) throw new Error("Image finalization copy failed.");
  const copyResponse = await response.text();
  if (
    copyResponse.length > 16_384 ||
    /<(?:[A-Za-z0-9_]+:)?Error(?:\s|>)/.test(copyResponse) ||
    !/<(?:[A-Za-z0-9_]+:)?CopyObjectResult(?:\s|\/>)/.test(copyResponse)
  ) throw new Error("Image finalization copy failed.");
  const verification = await requestR2Object("HEAD", finalKey, config, {
    fetch: fetchImpl,
  });
  if (!verification.ok) {
    throw new Error("Finalized object verification failed.");
  }
  const type = (verification.headers.get("content-type") ?? "").split(";")[0]
    .trim().toLowerCase();
  const size = Number(verification.headers.get("content-length"));
  return type === expectedContentType && size === expectedByteSize;
}

export async function deleteRecipeImageFinalObject(
  finalKey: string,
  configuration: R2Config,
  fetchImpl: typeof fetch = fetch,
): Promise<"deleted" | "missing" | "failed"> {
  if (!FINAL_CLEANUP_KEY_PATTERN.test(finalKey)) return "failed";
  const response = await requestR2Object("DELETE", finalKey, configuration, {
    fetch: fetchImpl,
  });
  if (response.ok) return "deleted";
  if (response.status === 404) return "missing";
  return "failed";
}

export async function signRecipeImageFinalGet(
  finalKey: string,
  contentType: string,
  configuration: R2Config,
  now = new Date(),
): Promise<string> {
  if (
    !FINAL_KEY_PATTERN.test(finalKey) ||
    !["image/jpeg", "image/png", "image/webp"].includes(contentType)
  ) throw new Error("Invalid finalized object key.");
  const config = resolveR2Config(configuration);
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const path = `/${config.bucketName}/${
    finalKey.split("/").map(encode).join("/")
  }`;
  const signedHeaders = "host";
  const extension = contentType === "image/jpeg"
    ? "jpg"
    : contentType === "image/png"
    ? "png"
    : "webp";
  const query = Object.entries({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": "60",
    "X-Amz-SignedHeaders": signedHeaders,
    "response-content-disposition":
      `inline; filename="recipe-image.${extension}"`,
    "response-content-type": contentType,
  }).map(([key, value]) => `${encode(key)}=${encode(value)}`).sort().join("&");
  const canonicalRequest = [
    "GET",
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
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
