import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight } from "../_shared/cors.ts";
import {
  ExtractRecipeRequestSchema,
  ExtractedRecipeSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/schemas.ts";
import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import { AIError, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import { createFailureDrillProvider } from "../_shared/ai/drills.ts";
import { checkDailyQuota, type QuotaCheck } from "../_shared/ai/quota.ts";
import {
  AI_ALLOWED_METHODS,
  AI_MAX_REQUEST_BYTES,
  type AIEndpointErrorCode,
  aiErrorResponse,
  aiJsonResponse,
  isEnvEnabled,
  isPlainObject,
  mapAiError,
  normalizeQuotaRetryAfterSeconds,
  readBodyWithinByteLimit,
  withAiCorsMethods,
} from "../_shared/ai/http.ts";

export type ExtractRecipeDeps = AuthDeps & {
  /** Injected provider (tests/dev). Production builds the real Gemini adapter. */
  provider?: AIProvider;
  /** Injected quota boundary (tests); production reads `ai_usage_daily`. */
  quotaCheck?: QuotaCheck;
};

const ALLOWED_METHODS = AI_ALLOWED_METHODS;
/** Reject bodies larger than this before parsing. 128 KiB comfortably fits the 10k-character cap in any encoding. */
export const MAX_REQUEST_BYTES = AI_MAX_REQUEST_BYTES;

/** Operator opt-in while BE-12 atomic quota accounting is pending. Defaults off. */
export const EXTRACT_ENABLED_ENV = "AI_EXTRACT_ENABLED";

/**
 * Operator kill switch. When truthy, extraction is refused before the quota
 * read or the provider call, so an operator can stop spend/abuse immediately
 * without a deploy (see the quota note in `_shared/ai/quota.ts`).
 */
export const EXTRACT_DISABLED_ENV = "AI_EXTRACT_DISABLED";

export type ExtractRecipeErrorCode = AIEndpointErrorCode;

/** JSON response that advertises this route's allowed methods. */
function extractJsonResponse(body: unknown, init?: ResponseInit): Response {
  return aiJsonResponse(body, init, ALLOWED_METHODS);
}

/** Shared error envelope bound to this route's allowed methods. */
function errorResponse(
  code: AIEndpointErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return aiErrorResponse(code, message, status, extraHeaders, ALLOWED_METHODS);
}

/** Injected provider wins (tests/dev); otherwise honor the drill; otherwise the real adapter. */
function resolveProvider(deps: ExtractRecipeDeps): AIProvider {
  return deps.provider ?? createFailureDrillProvider("extract") ?? new GeminiAdapter();
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
      return withAiCorsMethods(auth.response, ALLOWED_METHODS);
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
      return mapAiError(error, ALLOWED_METHODS);
    }

    console.error("Unhandled exception in extract-recipe handler");
    return errorResponse("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
