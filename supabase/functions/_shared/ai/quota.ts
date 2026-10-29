import type { SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";

/**
 * Per-user daily AI quota (AI-17: 20 operations per user per UTC day).
 *
 * AI-05 only *checks* quota before calling the provider; it must never write to
 * the database. The counter in `ai_usage_daily` is advanced by BE-12 through an
 * atomic backend operation, which swaps out the injected `QuotaCheck`. Until
 * then this read-only gate still enforces any usage that has been recorded and
 * gives the endpoint a single, testable place to say "allowed / exceeded".
 *
 * Known limitation (until BE-12 lands): because AI-05 cannot write, the default
 * gate can only *observe* usage that a writer has recorded — it does not itself
 * advance the counter, so it cannot yet meter a user by itself. It is the
 * integration seam, not the enforcement point. The operator kill switch
 * (`AI_EXTRACT_DISABLED`, handled in the endpoint) is the stopgap lever if
 * spend or abuse needs to be cut immediately.
 */
export const DEFAULT_AI_DAILY_LIMIT = 20;
export const AI_DAILY_LIMIT_ENV = "AI_DAILY_LIMIT";

export type QuotaDecision =
  | { status: "allowed"; limit: number; used: number }
  | { status: "exceeded"; limit: number; used: number; retryAfterSeconds: number }
  | { status: "unavailable"; limit: number };

/**
 * Injected quota boundary. The endpoint depends on this, never on the table
 * directly, so tests can force each branch and BE-12 can replace the default
 * with atomic accounting without touching the handler.
 */
export type QuotaCheck = (userId: string, supabase: SupabaseClient) => Promise<QuotaDecision>;

/**
 * Reads `AI_DAILY_LIMIT`. An absent, blank, non-numeric or out-of-range value
 * falls back to the default: a typo must never accidentally block every user
 * (limit 0) or remove the cap entirely.
 */
export function resolveDailyLimit(raw: string | undefined = Deno.env.get(AI_DAILY_LIMIT_ENV)): number {
  if (typeof raw !== "string") return DEFAULT_AI_DAILY_LIMIT;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_AI_DAILY_LIMIT;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_AI_DAILY_LIMIT;
  return parsed;
}

/** The UTC calendar date the quota window is measured against. */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Seconds until the quota window resets, used as the client `Retry-After`. */
export function secondsUntilNextUtcDay(now: Date = new Date()): number {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

/** Trusts only a non-negative safe integer from the counter row. */
function readOperationCount(row: unknown): number | null {
  if (typeof row !== "object" || row === null) return null;
  const value = (row as { operation_count?: unknown }).operation_count;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * Default gate: read today's counter for the verified user through the
 * user-scoped client (RLS `ai_usage_select_own` permits the select, and the
 * `authenticated` role has no insert/update grant, so this call cannot write).
 *
 * A read failure fails *closed* as `unavailable`: a transient database error
 * must not silently hand out unmetered provider calls.
 */
export const checkDailyQuota: QuotaCheck = async (userId, supabase) => {
  const limit = resolveDailyLimit();

  const { data, error } = await supabase
    .from("ai_usage_daily")
    .select("operation_count")
    .eq("user_id", userId)
    .eq("usage_date", utcDateString())
    .limit(1);

  if (error) {
    return { status: "unavailable", limit };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = readOperationCount(row) ?? 0;

  if (used >= limit) {
    return { status: "exceeded", limit, used, retryAfterSeconds: secondsUntilNextUtcDay() };
  }

  return { status: "allowed", limit, used };
};
