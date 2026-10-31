import { z } from "npm:zod@3.22.4";
import { MAX_PARENT_RECIPE_IDS } from "./schemas.ts";

/**
 * AI-07 save-time candidate membership.
 *
 * Generation runs before the child recipe exists, so the save endpoint cannot
 * ask the database what the model was allowed to propose. Instead the
 * generation endpoint issues a short-lived, stateless HMAC token that lists the
 * parents it actually showed the user. `POST /recipes/:id/lineage` verifies the
 * token and rejects any selected parent outside that list, so a direct call can
 * never attach a foreign or hallucinated parent.
 *
 * Format: `v1.<base64url(claims)>.<base64url(HMAC-SHA256)>`. The signature
 * covers the exact `v1.<payload>` bytes that were issued, so verification never
 * needs to re-serialise JSON.
 *
 * The token is stateless by design: within its TTL the same user can replay it
 * with the same allowed parent set. It cannot be replayed for a different user,
 * a different parent set, or after expiry.
 */

export const CANDIDATE_TOKEN_VERSION = "v1" as const;
export const CANDIDATE_TOKEN_AUDIENCE = "recipe-lineage" as const;
export const CANDIDATE_TOKEN_SECRET_ENV = "AI_CANDIDATE_TOKEN_SECRET";

/** Short-lived: the user reviews the preview, then saves. */
export const CANDIDATE_TOKEN_TTL_SECONDS = 900;
export const MIN_CANDIDATE_TOKEN_TTL_SECONDS = 60;
export const MAX_CANDIDATE_TOKEN_TTL_SECONDS = 3600;

/** A weak secret hurts every token; 32 characters is the floor, not a target. */
export const MIN_CANDIDATE_TOKEN_SECRET_LENGTH = 32;

/** Tolerate a small clock difference when checking `iat` in the future. */
const CLOCK_SKEW_SECONDS = 60;

export class CandidateTokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateTokenConfigError";
  }
}

/**
 * Resolves the HMAC secret. An explicit value (tests, dependency injection)
 * wins over the environment. A missing or too-short secret is a server
 * misconfiguration and must fail closed, never issue or accept a token.
 */
export function resolveCandidateTokenSecret(explicit?: string): string {
  const secret = explicit ?? Deno.env.get(CANDIDATE_TOKEN_SECRET_ENV);
  if (typeof secret !== "string" || secret.length < MIN_CANDIDATE_TOKEN_SECRET_LENGTH) {
    throw new CandidateTokenConfigError(
      `${CANDIDATE_TOKEN_SECRET_ENV} must be set to at least ${MIN_CANDIDATE_TOKEN_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

/**
 * Canonical form of an allowed-parent list: lowercase UUIDs, deduplicated and
 * sorted. Signing and verification both canonicalise, so the subset check can
 * never fail because of casing or ordering.
 */
export function canonicalParentRecipeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
}

/**
 * Returns the selected parent IDs that are not part of the token's allowed set.
 * Empty means the save is a valid subset (the user may deselect parents).
 */
export function findDisallowedParentIds(
  allowedParentIds: readonly string[],
  selectedParentIds: readonly string[],
): string[] {
  const allowed = new Set(allowedParentIds.map((id) => id.toLowerCase()));
  return selectedParentIds
    .map((id) => id.toLowerCase())
    .filter((id) => !allowed.has(id));
}

export const CandidateTokenClaimsSchema = z.object({
  /** Generation identifier: random per issued token, safe to log. */
  jti: z.string().uuid(),
  /** Authenticated user the generation belongs to. */
  sub: z.string().uuid(),
  aud: z.literal(CANDIDATE_TOKEN_AUDIENCE),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  parent_recipe_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_PARENT_RECIPE_IDS)
    .refine(
      (ids) => {
        const canonical = canonicalParentRecipeIds(ids);
        return canonical.length === ids.length && canonical.every((id, index) => id === ids[index]);
      },
      { message: "parent_recipe_ids must be canonical, unique and sorted." },
    ),
}).strict();

export type CandidateTokenClaims = z.infer<typeof CandidateTokenClaimsSchema>;

export type CandidateTokenErrorReason =
  | "malformed"
  | "unsupported_version"
  | "invalid_signature"
  | "invalid_claims"
  | "expired"
  | "not_yet_valid"
  | "wrong_user";

export type CandidateTokenVerifyResult =
  | { ok: true; claims: CandidateTokenClaims }
  | { ok: false; reason: CandidateTokenErrorReason };

type SignCandidateTokenInput = {
  userId: string;
  parentRecipeIds: readonly string[];
  /** Override for tests; defaults to a random UUID. */
  jti?: string;
  /** Override for tests; defaults to the current time. */
  now?: Date;
  /** Override for tests/DI; defaults to the environment secret. */
  secret?: string;
  ttlSeconds?: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> | null {
  try {
    let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function epochSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

/**
 * Issues a candidate token. The caller must pass the resolved authenticated
 * user and the exact parents shown in the preview.
 */
export async function signCandidateToken(input: SignCandidateTokenInput): Promise<string> {
  const secret = resolveCandidateTokenSecret(input.secret);
  const ttlSeconds = input.ttlSeconds ?? CANDIDATE_TOKEN_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < MIN_CANDIDATE_TOKEN_TTL_SECONDS ||
    ttlSeconds > MAX_CANDIDATE_TOKEN_TTL_SECONDS
  ) {
    throw new CandidateTokenConfigError(
      `Candidate token TTL must be between ${MIN_CANDIDATE_TOKEN_TTL_SECONDS} and ${MAX_CANDIDATE_TOKEN_TTL_SECONDS} seconds.`,
    );
  }

  const issuedAt = epochSeconds(input.now ?? new Date());
  const claims = CandidateTokenClaimsSchema.parse({
    jti: input.jti ?? crypto.randomUUID(),
    sub: input.userId,
    aud: CANDIDATE_TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    parent_recipe_ids: canonicalParentRecipeIds(input.parentRecipeIds),
  });

  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${CANDIDATE_TOKEN_VERSION}.${payload}`;
  const key = await hmacKey(secret, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verifies a candidate token for one authenticated user at one instant.
 * Never throws for a bad token: every rejection is a typed reason so the
 * endpoint can map it to a stable 403 without leaking crypto detail.
 */
export async function verifyCandidateToken(
  token: string,
  options: { userId: string; now?: Date; secret?: string },
): Promise<CandidateTokenVerifyResult> {
  const secret = resolveCandidateTokenSecret(options.secret);

  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: "malformed" };
  }
  if (parts[0] !== CANDIDATE_TOKEN_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }

  const signature = base64UrlToBytes(parts[2]);
  if (!signature) {
    return { ok: false, reason: "invalid_signature" };
  }
  // Require the canonical encoding: the last base64url character carries
  // padding bits, so several strings decode to the same bytes. Without this
  // check one valid token would have many equivalent spellings.
  if (base64UrlEncode(signature) !== parts[2]) {
    return { ok: false, reason: "invalid_signature" };
  }

  const key = await hmacKey(secret, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) {
    return { ok: false, reason: "invalid_signature" };
  }

  const payloadBytes = base64UrlToBytes(parts[1]);
  if (!payloadBytes || base64UrlEncode(payloadBytes) !== parts[1]) {
    return { ok: false, reason: "malformed" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parsed = CandidateTokenClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_claims" };
  }
  const claims = parsed.data;

  const nowSeconds = epochSeconds(options.now ?? new Date());
  if (claims.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (claims.sub !== options.userId) {
    return { ok: false, reason: "wrong_user" };
  }

  return { ok: true, claims };
}
