import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";
import { jsonResponse } from "./cors.ts";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  role: string | null;
};

export type AuthContext = {
  user: AuthenticatedUser;
  supabase: SupabaseClient;
};

export type AuthSuccess = {
  ok: true;
  context: AuthContext;
};

export type AuthFailure = {
  ok: false;
  response: Response;
};

export type AuthResult = AuthSuccess | AuthFailure;

export type AuthDeps = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  fetch?: typeof fetch;
};

export type BearerTokenResult =
  | { ok: true; token: string }
  | { ok: false; response: Response };

const COMPACT_JWS_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const SERVER_CONFIG_ERROR_CODES = new Set([
  "invalid_api_key",
  "missing_api_key",
  "no_api_key",
]);

const SERVER_CONFIG_ERROR_MESSAGE_PATTERNS = [
  /\bapi\s*key\b/i,
  /\bapikey\b/i,
  /\bsecret\s*key\b/i,
  /\bpublishable\s*key\b/i,
  /\bservice[_\s-]*role\b/i,
  /\broute\b.*\bnot\s+found\b/i,
  /\bnot\s+found\s+on\s+gateway\b/i,
];

const RECOGNIZED_AUTH_ERROR_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "jwt_expired",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "user_banned",
  "not_authenticated",
  "no_authorization",
]);

const RECOGNIZED_AUTH_ERROR_MESSAGE_PATTERNS = [
  /\bjwt\b.*\b(invalid|expired|malformed|exp|missing|claim|claims|signature)\b/i,
  /\b(invalid|expired|malformed|missing)\b.*\b(jwt|bearer|access\s+token|token|signature|claim|claims)\b/i,
  /\b(bearer|access)\s+token\b.*\b(expired|invalid|malformed|revoked|missing)\b/i,
  /\btoken\b.*\b(expired|revoked|malformed)\b/i,
  /\btoken\s+signature\s+is\s+invalid\b/i,
  /\bsignature\b.*\binvalid\b/i,
  /\bsession\b.*\b(does\s+not\s+exist|expired|invalid|revoked)\b/i,
  /\bsession\s+not\s+found\b/i,
  /\buser\s+from\s+sub\s+claim\b/i,
  /\buser\s+(does\s+not\s+exist|not\s+found|is\s+banned)\b/i,
  /\bsub\s+claim\b/i,
  /\binvalid\b.*\bcredentials\b/i,
];

const RETRY_AFTER_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,6})$/;
const RETRY_AFTER_HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function normalizeRetryAfter(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (RETRY_AFTER_SECONDS_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (RETRY_AFTER_HTTP_DATE_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) {
    return trimmed;
  }

  return null;
}

function unauthorizedHeaderResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid Authorization header.",
      },
    },
    { status: 401 },
  );
}

function invalidCredentialsResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired authentication credentials.",
      },
    },
    { status: 401 },
  );
}

function authRateLimitedResponse(retryAfter?: string | null): Response {
  const headers: Record<string, string> = {};
  if (retryAfter) {
    headers["Retry-After"] = retryAfter;
  }

  return jsonResponse(
    {
      error: {
        code: "AUTH_SERVICE_RATE_LIMITED",
        message: "Authentication service is temporarily unavailable. Please try again later.",
      },
    },
    {
      status: 503,
      headers,
    },
  );
}

function internalErrorResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    },
    { status: 500 },
  );
}

function isRecognizedUnauthenticatedError(error: {
  status?: number;
  code?: string;
  message?: string;
  name?: string;
}): boolean {
  const status = error.status;
  if (typeof status !== "number" || status >= 500 || status < 400 || status === 429) {
    return false;
  }

  if (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError") {
    return false;
  }

  const code = typeof error.code === "string" ? error.code.trim().toLowerCase() : "";
  const message = typeof error.message === "string" ? error.message.trim() : "";

  if (code && SERVER_CONFIG_ERROR_CODES.has(code)) {
    return false;
  }

  if (message && SERVER_CONFIG_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }

  if (code && RECOGNIZED_AUTH_ERROR_CODES.has(code)) {
    return true;
  }

  if (
    (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) &&
    message.length > 0 &&
    RECOGNIZED_AUTH_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return true;
  }

  return false;
}

export function extractBearerToken(req: Request): BearerTokenResult {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: unauthorizedHeaderResponse() };
  }

  const trimmed = authHeader.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return { ok: false, response: unauthorizedHeaderResponse() };
  }

  const token = parts[1];
  if (!token || !COMPACT_JWS_PATTERN.test(token)) {
    return { ok: false, response: unauthorizedHeaderResponse() };
  }

  return { ok: true, token };
}

export async function authenticateRequest(
  req: Request,
  deps?: AuthDeps,
): Promise<AuthResult> {
  const extracted = extractBearerToken(req);
  if (!extracted.ok) {
    return extracted;
  }

  const accessToken = extracted.token;
  const supabaseUrl = (deps?.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "").trim();
  const supabaseAnonKey = (
    deps?.supabaseAnonKey ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    ""
  ).trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing required Supabase authentication configuration");
    return { ok: false, response: internalErrorResponse() };
  }

  let baseFetch: typeof fetch;
  try {
    new URL(supabaseUrl);
    baseFetch = deps?.fetch ?? fetch;
  } catch {
    console.error("Invalid Supabase URL configuration");
    return { ok: false, response: internalErrorResponse() };
  }

  let upstreamStatus: number | undefined;
  let upstreamRetryAfter: string | null = null;
  let upstreamErrorPayload: Record<string, unknown> | undefined;
  let networkFailure = false;

  const trackedFetch: typeof fetch = async (input, init) => {
    try {
      const response = await baseFetch(input, init);
      const requestUrl = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

      if (requestUrl.includes("/auth/v1/user")) {
        upstreamStatus = response.status;
        upstreamRetryAfter = normalizeRetryAfter(response.headers.get("Retry-After"));
        if (!response.ok) {
          try {
            const cloned = response.clone();
            const parsed = await cloned.json();
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              upstreamErrorPayload = parsed as Record<string, unknown>;
            }
          } catch {
            upstreamErrorPayload = undefined;
          }
        }
      }
      return response;
    } catch (err) {
      networkFailure = true;
      throw err;
    }
  };

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        fetch: trackedFetch,
      },
    });

    const { data, error } = await supabase.auth.getUser(accessToken);

    if (networkFailure) {
      console.error("Authentication upstream request failed");
      return { ok: false, response: internalErrorResponse() };
    }

    if (error) {
      const status = typeof error.status === "number" && error.status > 0
        ? error.status
        : upstreamStatus;

      if (status === 429 || upstreamStatus === 429) {
        console.error("Authentication upstream rate limit exceeded");
        return { ok: false, response: authRateLimitedResponse(upstreamRetryAfter) };
      }

      const rawCode = typeof upstreamErrorPayload?.error_code === "string"
        ? upstreamErrorPayload.error_code
        : typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code?: string }).code ?? "")
        : typeof upstreamErrorPayload?.code === "string"
        ? upstreamErrorPayload.code
        : typeof upstreamErrorPayload?.error === "string"
        ? upstreamErrorPayload.error
        : "";
      const rawMessage = typeof upstreamErrorPayload?.msg === "string" && upstreamErrorPayload.msg.length > 0
        ? upstreamErrorPayload.msg
        : typeof upstreamErrorPayload?.message === "string" && upstreamErrorPayload.message.length > 0
        ? upstreamErrorPayload.message
        : typeof upstreamErrorPayload?.error_description === "string" && upstreamErrorPayload.error_description.length > 0
        ? upstreamErrorPayload.error_description
        : typeof error.message === "string"
        ? error.message
        : "";

      if (
        isRecognizedUnauthenticatedError({
          status,
          code: rawCode,
          message: rawMessage,
          name: error.name,
        })
      ) {
        return { ok: false, response: invalidCredentialsResponse() };
      }

      console.error("Unexpected authentication upstream error", status ? `status: ${status}` : "");
      return { ok: false, response: internalErrorResponse() };
    }

    if (upstreamStatus === 429) {
      console.error("Authentication upstream rate limit exceeded");
      return { ok: false, response: authRateLimitedResponse(upstreamRetryAfter) };
    }

    if (typeof upstreamStatus === "number" && upstreamStatus !== 200) {
      console.error("Unexpected non-200 authentication upstream status", upstreamStatus);
      return { ok: false, response: internalErrorResponse() };
    }

    if (!data?.user || typeof data.user.id !== "string" || data.user.id.trim().length === 0) {
      console.error("Authentication response missing valid user identity");
      return { ok: false, response: internalErrorResponse() };
    }

    return {
      ok: true,
      context: {
        user: {
          id: data.user.id,
          email: typeof data.user.email === "string" ? data.user.email : null,
          role: typeof data.user.role === "string" ? data.user.role : null,
        },
        supabase,
      },
    };
  } catch {
    console.error("Unhandled exception during request authentication");
    return { ok: false, response: internalErrorResponse() };
  }
}
