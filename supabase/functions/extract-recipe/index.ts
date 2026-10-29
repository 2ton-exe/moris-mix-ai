import { authenticateRequest, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import {
  ExtractRecipeRequestSchema,
  ExtractedRecipeSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/schemas.ts";
import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import { AIError, type AIErrorCode, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import { checkDailyQuota, type QuotaCheck } from "../_shared/ai/quota.ts";

export type ExtractRecipeDeps = AuthDeps & {
  /** Injected provider (tests/dev). Production builds the real Gemini adapter. */
  provider?: AIProvider;
  /** Injected quota boundary (tests); production reads `ai_usage_daily`. */
  quotaCheck?: QuotaCheck;
};

const ALLOWED_METHODS = "POST, OPTIONS";
/** Reject bodies larger than this before parsing. 128 KiB comfortably fits the 10k-character cap in any encoding. */
export const MAX_REQUEST_BYTES = 128 * 1024;

/** Non-production failure drills. Never set in production; never client-triggerable. */
export const SIMULATE_OUTAGE_ENV = "AI_SIMULATE_OUTAGE";
export const SIMULATE_BAD_OUTPUT_ENV = "AI_SIMULATE_BAD_OUTPUT";

/** Used when the provider rate-limits us without naming a cooldown. */
const DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS = 30;

export type ExtractRecipeErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "INPUT_TOO_LARGE"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "QUOTA_EXCEEDED"
  | "QUOTA_UNAVAILABLE"
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

function notImplemented(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation} is not implemented in the extraction endpoint.`));
}

/**
 * Builds a provider that fails the way the drill asks, so the demo exercises the
 * real error contract without a public "break me" endpoint or a live outage.
 * Returns null unless a simulation switch is set.
 */
function simulationProvider(): AIProvider | null {
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

function normalizeRetryAfterSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS;
  }
  return Math.min(3600, Math.ceil(value));
}

function mapAiError(error: AIError): Response {
  const mapped = AI_ERROR_RESPONSES[error.code];
  const headers = mapped.retryAfter
    ? { "Retry-After": String(normalizeRetryAfterSeconds(error.retryAfterSeconds)) }
    : undefined;
  return errorResponse(mapped.code, mapped.message, mapped.status, headers);
}

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

    // Reject an obviously oversized body before buffering it into memory.
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

    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    if (!rawBody || rawBody.trim().length === 0) {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    if (rawBody.length > MAX_REQUEST_BYTES) {
      return errorResponse(
        "INPUT_TOO_LARGE",
        `Request body must be at most ${MAX_REQUEST_BYTES} bytes.`,
        413,
      );
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
        { "Retry-After": String(normalizeRetryAfterSeconds(quota.retryAfterSeconds)) },
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
