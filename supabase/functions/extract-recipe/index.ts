import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import {
  ExtractRecipeRequestSchema,
  ExtractedRecipeSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/schemas.ts";
import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import { AIError, type AIErrorCode, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import { checkDailyQuota, type QuotaCheck, secondsUntilNextUtcDay } from "../_shared/ai/quota.ts";

export type ExtractRecipeDeps = AuthDeps & {
  /** Injected provider (tests/dev). Production builds the real Gemini adapter. */
  provider?: AIProvider;
  /** Injected quota boundary (tests); production reads `ai_usage_daily`. */
  quotaCheck?: QuotaCheck;
};

const ALLOWED_METHODS = "POST, OPTIONS";
/** Reject bodies larger than this before parsing. 128 KiB comfortably fits the 10k-character cap in any encoding. */
export const MAX_REQUEST_BYTES = 128 * 1024;

/**
 * Non-production failure drills. Never set in production; never client-triggerable.
 *
 * Only explicit development/test environments permit drills. Production, unset
 * and unknown environments ignore all drill switches, including the master.
 */
export const AI_ENVIRONMENT_ENV = "AI_ENVIRONMENT";
export const ALLOW_FAILURE_DRILLS_ENV = "AI_ALLOW_FAILURE_DRILLS";
export const SIMULATE_OUTAGE_ENV = "AI_SIMULATE_OUTAGE";
export const SIMULATE_BAD_OUTPUT_ENV = "AI_SIMULATE_BAD_OUTPUT";

/** Operator opt-in while BE-12 atomic quota accounting is pending. Defaults off. */
export const EXTRACT_ENABLED_ENV = "AI_EXTRACT_ENABLED";

/**
 * Operator kill switch. When truthy, extraction is refused before the quota
 * read or the provider call, so an operator can stop spend/abuse immediately
 * without a deploy (see the quota note in `_shared/ai/quota.ts`).
 */
export const EXTRACT_DISABLED_ENV = "AI_EXTRACT_DISABLED";

/** Used when the provider rate-limits us without naming a cooldown. */
const DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS = 30;

/** A quota wait is at most one UTC day, unlike a provider cooldown. */
const MAX_QUOTA_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export type ExtractRecipeErrorCode =
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

/**
 * The only place adapter failure codes become HTTP. `invalid_output` is a 502
 * because our upstream returned unusable data; `provider_rejected` is a 502
 * because our key/model is misconfigured; nothing here leaks prompt or recipe
 * text, and unknown errors collapse to a generic 500.
 */
const AI_ERROR_RESPONSES: Record<
  AIErrorCode,
  { status: number; code: ExtractRecipeErrorCode; message: string; retryAfter: boolean }
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

function extractJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  return jsonResponse(body, { ...init, headers });
}

/** Keeps the auth helper's response shape but advertises this route's methods. */
function withExtractCorsMethods(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function errorResponse(
  code: ExtractRecipeErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return extractJsonResponse({ error: { code, message } }, { status, headers: extraHeaders });
}

/** Accepts a parsed JSON object while rejecting null, arrays and scalar values. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads an operator-only boolean env switch. Truthy values mirror common conventions. */
function isEnvEnabled(name: string): boolean {
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
async function readBodyWithinByteLimit(
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

function notImplemented(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation} is not implemented in the extraction endpoint.`));
}

/**
 * Builds a provider that fails the way the drill asks, so the demo exercises the
 * real error contract without a public "break me" endpoint or a live outage.
 * Requires a development/test environment, the master switch and a drill switch.
 */
function simulationProvider(): AIProvider | null {
  const environment = Deno.env.get(AI_ENVIRONMENT_ENV)?.trim().toLowerCase();
  if (environment !== "development" && environment !== "test") return null;
  if (!isEnvEnabled(ALLOW_FAILURE_DRILLS_ENV)) return null;

  const outage = isEnvEnabled(SIMULATE_OUTAGE_ENV);
  const badOutput = !outage && isEnvEnabled(SIMULATE_BAD_OUTPUT_ENV);
  if (!outage && !badOutput) return null;

  return {
    extractRecipe: () =>
      outage
        ? Promise.reject(
          new AIError("provider_unavailable", "extract", "Simulated provider outage."),
        )
        : Promise.reject(
          new AIError("invalid_output", "extract", "Simulated malformed model output."),
        ),
    generateRecipe: () => notImplemented("generateRecipe"),
    testConnection: () => notImplemented("testConnection"),
  };
}

/** Injected provider wins (tests/dev); otherwise honor the drill; otherwise the real adapter. */
function resolveProvider(deps: ExtractRecipeDeps): AIProvider {
  return deps.provider ?? simulationProvider() ?? new GeminiAdapter();
}

/** Rounds valid provider cooldowns up to seconds, caps them at one hour and defaults invalid values to 30. */
function normalizeRetryAfterSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS;
  }
  return Math.min(3600, Math.ceil(value));
}

/**
 * Daily quota resets can be almost 24 hours away, so the provider one-hour cap
 * must not apply. Invalid injected values fall back to the real time until the
 * next UTC midnight; otherwise the wait is rounded up and capped at one day.
 */
function normalizeQuotaRetryAfterSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return secondsUntilNextUtcDay();
  }
  return Math.min(MAX_QUOTA_RETRY_AFTER_SECONDS, Math.ceil(value));
}

/** Maps a typed provider failure to a safe HTTP response, adding a cooldown for rate limits. */
function mapAiError(error: AIError): Response {
  const mapped = AI_ERROR_RESPONSES[error.code];
  const headers = mapped.retryAfter
    ? { "Retry-After": String(normalizeRetryAfterSeconds(error.retryAfterSeconds)) }
    : undefined;
  return errorResponse(mapped.code, mapped.message, mapped.status, headers);
}

/**
 * Authenticates extraction requests, checks the operator opt-in, input limits
 * and quota, then returns a validated recipe preview without database writes.
 * Handles routing and preflight before authentication and maps failures to
 * stable HTTP errors without exposing provider details or submitted notes.
 */
export async function handler(
  req: Request,
  deps: ExtractRecipeDeps = {},
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const isTargetRoute = url.pathname === "/functions/v1/extract-recipe" ||
      url.pathname === "/extract-recipe";

    if (!isTargetRoute) {
      return errorResponse("NOT_FOUND", "Route not found.", 404);
    }

    if (req.method === "OPTIONS") {
      return handleCorsPreflight(ALLOWED_METHODS);
    }

    if (req.method !== "POST") {
      return errorResponse(
        "METHOD_NOT_ALLOWED",
        "Only POST and OPTIONS methods are supported.",
        405,
        { Allow: ALLOWED_METHODS },
      );
    }

    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      return withExtractCorsMethods(auth.response);
    }

    const { user, supabase } = auth.context;

    // Keep extraction off until an operator opts in while atomic accounting is pending.
    // The kill switch takes precedence, even when extraction is explicitly enabled.
    if (!isEnvEnabled(EXTRACT_ENABLED_ENV) || isEnvEnabled(EXTRACT_DISABLED_ENV)) {
      return errorResponse(
        "AI_DISABLED",
        "AI extraction is temporarily disabled.",
        503,
      );
    }

    // Cheap pre-check first: reject an obviously oversized body (when the client
    // declares a length) before reading it at all.
    const declaredLength = req.headers.get("content-length");
    if (declaredLength !== null) {
      const declaredBytes = Number(declaredLength);
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) {
        return errorResponse(
          "INPUT_TOO_LARGE",
          `Request body must be at most ${MAX_REQUEST_BYTES} bytes.`,
          413,
        );
      }
    }

    // Authoritative check: a declared length can be absent or lie, so the byte
    // budget is enforced while streaming the body.
    const read = await readBodyWithinByteLimit(req, MAX_REQUEST_BYTES);
    if (!read.ok) {
      if (read.reason === "too_large") {
        return errorResponse(
          "INPUT_TOO_LARGE",
          `Request body must be at most ${MAX_REQUEST_BYTES} bytes.`,
          413,
        );
      }
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    const rawBody = read.text;
    if (!rawBody || rawBody.trim().length === 0) {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    if (!isPlainObject(parsedBody)) {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    const validation = ExtractRecipeRequestSchema.safeParse(parsedBody);
    if (!validation.success) {
      const details = validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      }));
      return extractJsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request payload.",
            details,
          },
        },
        { status: 400 },
      );
    }

    const notes = validation.data.notes;

    // AI-06/AI-07: cap the input before any provider call.
    if (notes.length > MAX_EXTRACTION_INPUT_CHARS) {
      return errorResponse(
        "INPUT_TOO_LARGE",
        `Notes must be at most ${MAX_EXTRACTION_INPUT_CHARS} characters.`,
        413,
      );
    }

    // AI-17: check the per-user daily quota before spending a provider call.
    const quota = await (deps.quotaCheck ?? checkDailyQuota)(user.id, supabase);
    if (quota.status === "unavailable") {
      return errorResponse(
        "QUOTA_UNAVAILABLE",
        "Could not verify AI usage limits. Please try again shortly.",
        503,
      );
    }
    if (quota.status === "exceeded") {
      return errorResponse(
        "QUOTA_EXCEEDED",
        "Daily AI usage limit reached. Please try again after the quota resets.",
        429,
        { "Retry-After": String(normalizeQuotaRetryAfterSeconds(quota.retryAfterSeconds)) },
      );
    }

    const provider = resolveProvider(deps);
    const extracted = await provider.extractRecipe({ rawText: notes });

    // AI-10: never trust the provider, even one that claims to validate. The
    // endpoint re-validates so malformed data can never reach the frontend.
    const revalidated = ExtractedRecipeSchema.safeParse(extracted);
    if (!revalidated.success) {
      throw new AIError("invalid_output", "extract", "Extraction failed schema validation.");
    }

    // AI-05: return the validated preview only. Nothing is persisted here.
    return extractJsonResponse({ recipe: revalidated.data }, { status: 200 });
  } catch (error) {
    if (error instanceof AIError) {
      return mapAiError(error);
    }

    console.error("Unhandled exception in extract-recipe handler");
    return errorResponse("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
