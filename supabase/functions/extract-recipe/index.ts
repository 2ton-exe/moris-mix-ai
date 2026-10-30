import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight } from "../_shared/cors.ts";
import {
  ExtractRecipeRequestSchema,
  ExtractedRecipeSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/schemas.ts";
import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import { AIError, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import { checkDailyQuota, type QuotaCheck } from "../_shared/ai/quota.ts";
import {
  AI_ALLOWED_METHODS,
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
