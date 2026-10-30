import { jsonResponse } from "../cors.ts";
import { AIError, type AIErrorCode } from "./GeminiAdapter.ts";
import { secondsUntilNextUtcDay } from "./quota.ts";

/**
 * Shared HTTP plumbing for the AI endpoints (`extract-recipe`, `generate-recipe`).
 *
 * Both endpoints expose the same auth, byte-limit, quota, provider-failure and
 * CORS behavior. Keeping it in one place means a fix to the error contract or
 * the streaming byte cap cannot drift between them.
 */

/** Stable client-facing codes used by both AI endpoints. */
export type AIEndpointErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "INPUT_TOO_LARGE"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "AUTH_SERVICE_RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "QUOTA_UNAVAILABLE"
  | "AI_DISABLED"
  | "AI_OUTPUT_INVALID"
  | "AI_PROVIDER_REJECTED"
  | "AI_TIMEOUT"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "INTERNAL_ERROR";

/** Methods every AI endpoint supports. */
export const AI_ALLOWED_METHODS = "POST, OPTIONS";

/**
 * Request body budget every AI endpoint enforces while streaming. The largest
 * valid extraction (10k chars) or generation request fits well inside it.
 */
export const AI_MAX_REQUEST_BYTES = 128 * 1024;

/** Used when the provider rate-limits us without naming a cooldown. */
const DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS = 30;

/** Provider cooldowns are short; a day-scale wait is handled by the quota path. */
const MAX_PROVIDER_RETRY_AFTER_SECONDS = 60 * 60;

/** A daily quota wait is at most one UTC day. */
const MAX_QUOTA_RETRY_AFTER_SECONDS = 24 * 60 * 60;

/**
 * The only place adapter failure codes become HTTP. `invalid_output` is a 502
 * because our upstream returned unusable data; `provider_rejected` is a 502
 * because our key/model is misconfigured; nothing here leaks prompt or recipe
 * text, and unknown errors collapse to a generic 500.
 */
const AI_ERROR_RESPONSES: Record<
  AIErrorCode,
  { status: number; code: AIEndpointErrorCode; message: string; retryAfter: boolean }
> = {
  invalid_output: {
    status: 502,
    code: "AI_OUTPUT_INVALID",
    message: "The AI returned a result that could not be validated. Please try again.",
    retryAfter: false,
  },
  provider_rejected: {
    status: 502,
    code: "AI_PROVIDER_REJECTED",
    message: "The AI request was rejected. The service may be misconfigured.",
    retryAfter: false,
  },
  provider_timeout: {
    status: 504,
    code: "AI_TIMEOUT",
    message: "The AI provider timed out. Please try again.",
    retryAfter: false,
  },
  provider_unavailable: {
    status: 503,
    code: "AI_UNAVAILABLE",
    message: "The AI service is temporarily unavailable. Please try again shortly.",
    retryAfter: false,
  },
  rate_limited: {
    status: 429,
    code: "AI_RATE_LIMITED",
    message: "AI usage is temporarily limited. Please try again shortly.",
    retryAfter: true,
  },
  internal_error: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error.",
    retryAfter: false,
  },
};

/** JSON response that advertises the route's allowed methods. */
export function aiJsonResponse(
  body: unknown,
  init: ResponseInit | undefined,
  allowedMethods: string,
): Response {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Methods", allowedMethods);
  return jsonResponse(body, { ...init, headers });
}

/** Keeps an auth helper's response shape but advertises this route's methods. */
export function withAiCorsMethods(response: Response, allowedMethods: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Methods", allowedMethods);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Builds the shared `{ error: { code, message } }` envelope. */
export function aiErrorResponse(
  code: AIEndpointErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
  allowedMethods: string = AI_ALLOWED_METHODS,
): Response {
  return aiJsonResponse({ error: { code, message } }, { status, headers: extraHeaders }, allowedMethods);
}

/** Accepts a parsed JSON object while rejecting null, arrays and scalar values. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads an operator-only boolean env switch. Truthy values mirror common conventions. */
export function isEnvEnabled(name: string): boolean {
  const raw = Deno.env.get(name);
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Reads the request body as UTF-8 text while enforcing a *byte* budget.
 *
 * Counting bytes (not string length) closes the hole where a multibyte payload
 * is under the character cap but far over the byte budget. The reader cancels
 * as soon as the budget is exceeded, so an unbounded body is never buffered in
 * full. `stream: true` keeps a multibyte character split across chunks intact.
 */
export async function readBodyWithinByteLimit(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" }> {
  if (!req.body) {
    return { ok: true, text: "" };
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The stream may already be errored; the size verdict still stands.
        }
        return { ok: false, reason: "too_large" };
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Rounds valid provider cooldowns up to seconds, caps them at one hour and defaults invalid values to 30. */
export function normalizeProviderRetryAfterSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS;
  }
  return Math.min(MAX_PROVIDER_RETRY_AFTER_SECONDS, Math.ceil(value));
}

/**
 * Daily quota resets can be almost 24 hours away, so the provider one-hour cap
 * must not apply. Invalid injected values fall back to the real time until the
 * next UTC midnight; otherwise the wait is rounded up and capped at one day.
 */
export function normalizeQuotaRetryAfterSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return secondsUntilNextUtcDay();
  }
  return Math.min(MAX_QUOTA_RETRY_AFTER_SECONDS, Math.ceil(value));
}

/** Maps a typed provider failure to a safe HTTP response, adding a cooldown for rate limits. */
export function mapAiError(error: AIError, allowedMethods: string): Response {
  const mapped = AI_ERROR_RESPONSES[error.code];
  const headers = mapped.retryAfter
    ? { "Retry-After": String(normalizeProviderRetryAfterSeconds(error.retryAfterSeconds)) }
    : undefined;
  return aiErrorResponse(mapped.code, mapped.message, mapped.status, headers, allowedMethods);
}
