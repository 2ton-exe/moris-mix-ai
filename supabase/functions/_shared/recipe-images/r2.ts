import { z } from "npm:zod@3.22.4";
import {
  UPLOAD_TTL_SECONDS,
  type UploadIntent,
  validateUploadIntent,
} from "./uploadIntents.ts";

const R2ConfigSchema = z.object({
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  bucketName: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  accessKeyId: z.string().min(1).max(128).regex(/^[A-Za-z0-9]+$/),
  secretAccessKey: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),
}).strict();

export type R2Config = z.infer<typeof R2ConfigSchema>;

export type SignedUpload = {
  id: string;
  url: string;
  method: "PUT";
  headers: { "Content-Type": string };
  expires_at: string;
};

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

export async function signRecipeImageUpload(
  intent: UploadIntent,
  configuration: R2Config,
): Promise<SignedUpload> {
  validateUploadIntent(intent);
  const config = resolveR2Config(configuration);
  const timestamp = intent.created_at.replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const path = `/${config.bucketName}/${
    intent.staging_key.split("/").map(encode).join("/")
  }`;
  const signedHeaders = "content-type;host";
  const query = Object.entries({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(UPLOAD_TTL_SECONDS),
    "X-Amz-SignedHeaders": signedHeaders,
  }).map(([key, value]) => `${encode(key)}=${encode(value)}`).sort().join("&");
  const canonicalRequest = [
    "PUT",
    path,
    query,
    `content-type:${intent.content_type}\nhost:${host}\n`,
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
  return {
    id: intent.id,
    url: `https://${host}${path}?${query}&X-Amz-Signature=${signature}`,
    method: "PUT",
    headers: { "Content-Type": intent.content_type },
    expires_at: intent.expires_at,
  };
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
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
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
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
