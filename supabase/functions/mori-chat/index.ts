import {
  type AuthDeps,
  authenticateRequest,
} from "../_shared/auth.ts";
import { handleCorsPreflight } from "../_shared/cors.ts";
import {
  createRequestId,
  logRequestFailure,
  withRequestId,
} from "../_shared/requestId.ts";
import type { MoriChatProvider } from "../_shared/ai/AIProvider.ts";
import { AIError, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import {
  AI_ALLOWED_METHODS,
  AI_MAX_REQUEST_BYTES,
  type AIEndpointErrorCode,
  aiErrorResponse,
  aiJsonResponse,
  isEnvEnabled,
  isJsonRequest,
  isPlainObject,
  mapAiError,
  normalizeQuotaRetryAfterSeconds,
  readBodyWithinByteLimit,
  withAiCorsMethods,
} from "../_shared/ai/http.ts";
import {
  consumeDailyQuota,
  logQuotaRpcFailure,
  type QuotaCheck,
} from "../_shared/ai/quota.ts";
import {
  buildMoriChatInput,
  MAX_MORI_CHAT_REQUEST_BYTES,
  MoriChatRequestSchema,
} from "../_shared/ai/moriChat.ts";

export type MoriChatDeps = AuthDeps & {
  supabaseServiceRoleKey?: string;
  provider?: MoriChatProvider;
  quotaCheck?: QuotaCheck;
};

const ALLOWED_METHODS = AI_ALLOWED_METHODS;
export const MORI_CHAT_ENABLED_ENV = "AI_MORI_CHAT_ENABLED";
export const MORI_CHAT_DISABLED_ENV = "AI_MORI_CHAT_DISABLED";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return aiJsonResponse(body, init, ALLOWED_METHODS);
}

function errorResponse(
  code: AIEndpointErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return aiErrorResponse(code, message, status, extraHeaders, ALLOWED_METHODS);
}

function shouldRefundQuota(error: unknown, providerStarted: boolean): boolean {
  if (!providerStarted) return true;
  if (error instanceof AIError) {
    return error.attempts.length > 0 && error.attempts.every((attempt) => attempt.nonConsuming);
  }
  return false;
}

function resolveProvider(deps: MoriChatDeps): MoriChatProvider {
  return deps.provider ?? new GeminiAdapter();
}

async function handleRequest(req: Request, deps: MoriChatDeps = {}): Promise<Response> {
  try {
    const url = new URL(req.url);
    if (url.pathname !== "/functions/v1/mori-chat" && url.pathname !== "/mori-chat") {
      return errorResponse("NOT_FOUND", "Route not found.", 404);
    }
    if (req.method === "OPTIONS") return handleCorsPreflight(ALLOWED_METHODS);
    if (req.method !== "POST") {
      return errorResponse("METHOD_NOT_ALLOWED", "Only POST and OPTIONS methods are supported.", 405, { Allow: ALLOWED_METHODS });
    }

    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) return withAiCorsMethods(auth.response, ALLOWED_METHODS);
    if (!isEnvEnabled(MORI_CHAT_ENABLED_ENV) || isEnvEnabled(MORI_CHAT_DISABLED_ENV)) {
      return errorResponse("AI_DISABLED", "Mori chat is temporarily unavailable.", 503);
    }
    if (!isJsonRequest(req)) {
      return errorResponse("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415);
    }

    const declaredLength = req.headers.get("content-length");
    if (declaredLength !== null) {
      const declaredBytes = Number(declaredLength);
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > MAX_MORI_CHAT_REQUEST_BYTES) {
        return errorResponse("INPUT_TOO_LARGE", `Request body must be at most ${MAX_MORI_CHAT_REQUEST_BYTES} bytes.`, 413);
      }
    }
    const read = await readBodyWithinByteLimit(req, Math.min(MAX_MORI_CHAT_REQUEST_BYTES, AI_MAX_REQUEST_BYTES));
    if (!read.ok) {
      return errorResponse(
        read.reason === "too_large" ? "INPUT_TOO_LARGE" : "INVALID_JSON",
        read.reason === "too_large" ? `Request body must be at most ${MAX_MORI_CHAT_REQUEST_BYTES} bytes.` : "Request body must be valid JSON.",
        read.reason === "too_large" ? 413 : 400,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(read.text);
    } catch {
      return errorResponse("INVALID_JSON", "Request body must be valid JSON.", 400);
    }
    if (!isPlainObject(rawBody)) {
      return errorResponse("INVALID_JSON", "Request body must be a JSON object.", 400);
    }
    const parsed = MoriChatRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid chat request.",
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
        },
      }, { status: 400 });
    }

    const { user, supabase } = auth.context;
    const quota = await (deps.quotaCheck ?? consumeDailyQuota)(user.id, supabase, {
      supabaseUrl: deps.supabaseUrl,
      supabaseServiceRoleKey: deps.supabaseServiceRoleKey,
      fetch: deps.fetch,
    });
    if (quota.status === "unavailable") {
      return errorResponse("QUOTA_UNAVAILABLE", "Could not verify AI usage limits. Please try again shortly.", 503);
    }
    if (quota.status === "exceeded") {
      return errorResponse("QUOTA_EXCEEDED", "Daily AI usage limit reached. Please try again after the quota resets.", 429, {
        "Retry-After": String(normalizeQuotaRetryAfterSeconds(quota.retryAfterSeconds)),
      });
    }
    if (quota.status === "rate_limited") {
      return errorResponse("AI_REQUEST_RATE_LIMITED", "AI requests are temporarily limited. Please try again shortly.", 429, {
        "Retry-After": String(quota.retryAfterSeconds),
      });
    }

    let providerStarted = false;
    try {
      const context = await buildMoriChatInput(auth.context, parsed.data);
      providerStarted = true;
      const reply = await resolveProvider(deps).reply(context);
      const response = { reply };
      if (typeof response.reply !== "string" || !response.reply.trim() || new TextEncoder().encode(response.reply).byteLength > 2400) {
        throw new AIError("invalid_output", "chat", "Mori returned a reply that could not be validated.", undefined, undefined, false);
      }
      try {
        await quota.confirm?.();
      } catch (confirmError) {
        logQuotaRpcFailure("confirmation", confirmError);
      }
      return jsonResponse(response, { status: 200 });
    } catch (operationError) {
      if (shouldRefundQuota(operationError, providerStarted)) {
        try {
          await quota.rollback?.();
        } catch (rollbackError) {
          logQuotaRpcFailure("rollback", rollbackError);
        }
      } else {
        try {
          await quota.confirm?.();
        } catch (confirmError) {
          logQuotaRpcFailure("confirmation", confirmError);
        }
      }
      throw operationError;
    }
  } catch (error) {
    if (error instanceof AIError) return mapAiError(error, ALLOWED_METHODS);
    console.error("Unhandled exception in mori-chat handler");
    return errorResponse("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

export async function handler(req: Request, deps: MoriChatDeps = {}): Promise<Response> {
  const requestId = createRequestId();
  const response = await handleRequest(req, deps);
  if (response.status >= 500) logRequestFailure(requestId, "mori-chat", response.status);
  return withRequestId(response, requestId);
}

if (import.meta.main) Deno.serve((req) => handler(req));
