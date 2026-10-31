import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  CANDIDATE_TOKEN_AUDIENCE,
  CandidateTokenConfigError,
  type CandidateTokenErrorReason,
  canonicalParentRecipeIds,
  findDisallowedParentIds,
  MAX_CANDIDATE_TOKEN_TTL_SECONDS,
  MIN_CANDIDATE_TOKEN_TTL_SECONDS,
  signCandidateToken,
  verifyCandidateToken,
} from "../_shared/ai/candidateToken.ts";

const TEST_SECRET = "test-candidate-token-secret-0123456789abcdef";
const OTHER_SECRET = "other-candidate-token-secret-0123456789abcdef";
const USER_A = "99999999-9999-9999-9999-999999999999";
const USER_B = "88888888-8888-4888-8888-888888888888";
const PARENT_1 = "22222222-2222-4222-8222-222222222222";
const PARENT_2 = "33333333-3333-4333-8333-333333333333";
const PARENT_3 = "44444444-4444-4444-8444-444444444444";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Signs arbitrary claims with the same algorithm, for negative tests. */
async function signRawClaims(claims: unknown, secret = TEST_SECRET): Promise<string> {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `v1.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

Deno.test("signCandidateToken and verifyCandidateToken round-trip with canonical parent IDs", async () => {
  const token = await signCandidateToken({
    userId: USER_A,
    // Uppercase, duplicated and unsorted on purpose: the claims must be canonical.
    parentRecipeIds: [PARENT_3.toUpperCase(), PARENT_1, PARENT_3, PARENT_2.toUpperCase()],
    secret: TEST_SECRET,
    jti: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    now: new Date("2026-10-31T10:00:00.000Z"),
  });

  const result = await verifyCandidateToken(token, {
    userId: USER_A,
    secret: TEST_SECRET,
    now: new Date("2026-10-31T10:05:00.000Z"),
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.claims.jti, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assertEquals(result.claims.sub, USER_A);
  assertEquals(result.claims.aud, CANDIDATE_TOKEN_AUDIENCE);
  assertEquals(result.claims.iat, 1_793_440_800);
  assertEquals(result.claims.exp, 1_793_440_800 + 900);
  assertEquals(result.claims.parent_recipe_ids, [PARENT_1, PARENT_2, PARENT_3]);
});

Deno.test("verifyCandidateToken rejects a tampered payload, tampered signature and wrong secret", async () => {
  const token = await signCandidateToken({
    userId: USER_A,
    parentRecipeIds: [PARENT_1],
    secret: TEST_SECRET,
    now: new Date("2026-10-31T10:00:00.000Z"),
  });
  const [version, payload, signature] = token.split(".");

  // Re-encode the payload with a changed user but keep the original signature.
  const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  claims.sub = USER_B;
  const tamperedPayload = `${version}.${
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)))
  }.${signature}`;
  const payloadResult = await verifyCandidateToken(tamperedPayload, {
    userId: USER_A,
    secret: TEST_SECRET,
  });
  assertEquals(payloadResult, { ok: false, reason: "invalid_signature" });

  // Flip the first signature character: every one of its six bits is
  // significant, unlike the last character's two padding bits.
  const first = signature[0] === "A" ? "B" : "A";
  const tamperedSignature = `${version}.${payload}.${first}${signature.slice(1)}`;
  const signatureResult = await verifyCandidateToken(tamperedSignature, {
    userId: USER_A,
    secret: TEST_SECRET,
  });
  assertEquals(signatureResult, { ok: false, reason: "invalid_signature" });

  // A non-canonical spelling (padding bits set) decodes to the same bytes but
  // must still be rejected: one token, one canonical encoding.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastChar = signature.at(-1)!;
  const malleableSignature = `${version}.${payload}.${signature.slice(0, -1)}${
    alphabet[alphabet.indexOf(lastChar) + 1]
  }`;
  const malleableResult = await verifyCandidateToken(malleableSignature, {
    userId: USER_A,
    secret: TEST_SECRET,
  });
  assertEquals(malleableResult, { ok: false, reason: "invalid_signature" });

  const wrongSecretResult = await verifyCandidateToken(token, {
    userId: USER_A,
    secret: OTHER_SECRET,
  });
  assertEquals(wrongSecretResult, { ok: false, reason: "invalid_signature" });
});

Deno.test("verifyCandidateToken rejects expired and not-yet-valid tokens", async () => {
  const now = new Date("2026-10-31T10:00:00.000Z");
  const expired = await signCandidateToken({
    userId: USER_A,
    parentRecipeIds: [PARENT_1],
    secret: TEST_SECRET,
    now: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    ttlSeconds: MIN_CANDIDATE_TOKEN_TTL_SECONDS,
  });
  assertEquals(
    await verifyCandidateToken(expired, { userId: USER_A, secret: TEST_SECRET, now }),
    { ok: false, reason: "expired" },
  );

  const future = await signCandidateToken({
    userId: USER_A,
    parentRecipeIds: [PARENT_1],
    secret: TEST_SECRET,
    now: new Date(now.getTime() + 10 * 60 * 1000),
  });
  assertEquals(
    await verifyCandidateToken(future, { userId: USER_A, secret: TEST_SECRET, now }),
    { ok: false, reason: "not_yet_valid" },
  );
});

Deno.test("verifyCandidateToken rejects the wrong user", async () => {
  const token = await signCandidateToken({
    userId: USER_A,
    parentRecipeIds: [PARENT_1],
    secret: TEST_SECRET,
  });
  assertEquals(
    await verifyCandidateToken(token, { userId: USER_B, secret: TEST_SECRET }),
    { ok: false, reason: "wrong_user" },
  );
});

Deno.test("verifyCandidateToken rejects malformed tokens and unsupported versions", async () => {
  const cases: Array<{ token: string; reason: CandidateTokenErrorReason }> = [
    { token: "", reason: "malformed" },
    { token: "not-a-token", reason: "malformed" },
    { token: "v1.only-two-parts", reason: "malformed" },
    { token: "v1..signature", reason: "malformed" },
    { token: "v1.payload.signature.extra", reason: "malformed" },
    { token: "v2.payload.signature", reason: "unsupported_version" },
  ];

  for (const testCase of cases) {
    const result = await verifyCandidateToken(testCase.token, {
      userId: USER_A,
      secret: TEST_SECRET,
    });
    assertEquals(result, { ok: false, reason: testCase.reason }, testCase.token);
  }
});

Deno.test("verifyCandidateToken rejects correctly signed claims that fail the schema", async () => {
  const now = Math.floor(Date.now() / 1000);
  const invalidClaims = {
    jti: "not-a-uuid",
    sub: USER_A,
    aud: CANDIDATE_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 600,
    parent_recipe_ids: [PARENT_1],
  };
  const token = await signRawClaims(invalidClaims);
  assertEquals(
    await verifyCandidateToken(token, { userId: USER_A, secret: TEST_SECRET }),
    { ok: false, reason: "invalid_claims" },
  );
});

Deno.test("candidate token secret and TTL misconfiguration fail closed", async () => {
  await assertRejects(
    () => signCandidateToken({ userId: USER_A, parentRecipeIds: [PARENT_1], secret: "" }),
    CandidateTokenConfigError,
  );
  await assertRejects(
    () => signCandidateToken({ userId: USER_A, parentRecipeIds: [PARENT_1], secret: "short" }),
    CandidateTokenConfigError,
  );
  await assertRejects(
    () =>
      signCandidateToken({
        userId: USER_A,
        parentRecipeIds: [PARENT_1],
        secret: TEST_SECRET,
        ttlSeconds: MIN_CANDIDATE_TOKEN_TTL_SECONDS - 1,
      }),
    CandidateTokenConfigError,
  );
  await assertRejects(
    () =>
      signCandidateToken({
        userId: USER_A,
        parentRecipeIds: [PARENT_1],
        secret: TEST_SECRET,
        ttlSeconds: MAX_CANDIDATE_TOKEN_TTL_SECONDS + 1,
      }),
    CandidateTokenConfigError,
  );

  const token = await signCandidateToken({
    userId: USER_A,
    parentRecipeIds: [PARENT_1],
    secret: TEST_SECRET,
  });
  await assertRejects(
    () => verifyCandidateToken(token, { userId: USER_A, secret: "short" }),
    CandidateTokenConfigError,
  );
});

Deno.test("canonicalParentRecipeIds and findDisallowedParentIds enforce subset membership", () => {
  assertEquals(
    canonicalParentRecipeIds([PARENT_3.toUpperCase(), PARENT_1, PARENT_2]),
    [PARENT_1, PARENT_2, PARENT_3],
  );
  assertEquals(findDisallowedParentIds([PARENT_1, PARENT_2], [PARENT_2.toUpperCase()]), []);
  assertEquals(findDisallowedParentIds([PARENT_1], [PARENT_1, PARENT_3]), [PARENT_3]);
  assertEquals(findDisallowedParentIds([], [PARENT_1]), [PARENT_1]);
});
