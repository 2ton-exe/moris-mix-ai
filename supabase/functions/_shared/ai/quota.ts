import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";

export const DEFAULT_AI_DAILY_LIMIT = 20;
export const AI_DAILY_LIMIT_ENV = "AI_DAILY_LIMIT";

export type QuotaDecision =
  | {
      status: "allowed";
      limit: number;
      used: number;
      confirm?: () => Promise<void>;
      rollback?: () => Promise<void>;
    }
  | { status: "exceeded"; limit: number; used: number; retryAfterSeconds: number }
  | { status: "unavailable"; limit: number };

export type QuotaCheckDeps = {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  fetch?: typeof fetch;
  reservationId?: string;
  usageDate?: string;
};

export type QuotaCheck = (
  userId: string,
  supabase: SupabaseClient,
  deps?: QuotaCheckDeps,
) => Promise<QuotaDecision>;

export function resolveDailyLimit(raw: string | undefined = Deno.env.get(AI_DAILY_LIMIT_ENV)): number {
  if (typeof raw !== "string") return DEFAULT_AI_DAILY_LIMIT;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_AI_DAILY_LIMIT;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_AI_DAILY_LIMIT;
  return parsed;
}

export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilNextUtcDay(now: Date = new Date()): number {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

function readOperationCount(row: unknown): number | null {
  if (typeof row !== "object" || row === null) return null;
  const value = (row as { operation_count?: unknown }).operation_count;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

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

  const rows = Array.isArray(data) ? data : data === null || data === undefined ? [] : [data];
  if (rows.length === 0) {
    return { status: "allowed", limit, used: 0 };
  }

  const used = readOperationCount(rows[0]);
  if (used === null) {
    return { status: "unavailable", limit };
  }

  if (used >= limit) {
    return { status: "exceeded", limit, used, retryAfterSeconds: secondsUntilNextUtcDay() };
  }

  return { status: "allowed", limit, used };
};

export const consumeDailyQuota: QuotaCheck = async (userId, _supabase, deps) => {
  const limit = resolveDailyLimit();
  const usageDate = deps?.usageDate ?? utcDateString();
  const reservationId = deps?.reservationId ?? crypto.randomUUID();

  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = deps?.supabaseServiceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error("Missing service role configuration for quota consumption");
    return { status: "unavailable", limit };
  }

  let serviceClient: SupabaseClient;
  try {
    serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      ...(deps?.fetch ? { global: { fetch: deps.fetch } } : {}),
    });
  } catch (err) {
    console.error("Failed to initialize service role client for quota consumption", err);
    return { status: "unavailable", limit };
  }

  let rpcResult: { data: unknown; error: unknown };
  try {
    rpcResult = await serviceClient.rpc("consume_ai_quota", {
      p_user_id: userId,
      p_reservation_id: reservationId,
      p_daily_limit: limit,
      p_usage_date: usageDate,
    });
  } catch (err) {
    console.error("RPC consume_ai_quota network or execution failure", err);
    return { status: "unavailable", limit };
  }

  if (rpcResult.error) {
    console.error("RPC consume_ai_quota returned error", rpcResult.error);
    return { status: "unavailable", limit };
  }

  const res = rpcResult.data as {
    status?: string;
    is_new?: boolean;
    limit?: number;
    used?: number;
  } | null;

  if (!res || typeof res !== "object") {
    return { status: "unavailable", limit };
  }

  if (res.status === "exceeded") {
    return {
      status: "exceeded",
      limit: typeof res.limit === "number" ? res.limit : limit,
      used: typeof res.used === "number" ? res.used : limit,
      retryAfterSeconds: secondsUntilNextUtcDay(),
    };
  }

  if (res.status === "conflict") {
    return {
      status: "unavailable",
      limit,
    };
  }

  if (res.status === "allowed" && res.is_new === true) {
    const used = typeof res.used === "number" ? res.used : 1;
    const resolvedLimit = typeof res.limit === "number" ? res.limit : limit;

    return {
      status: "allowed",
      limit: resolvedLimit,
      used,
      confirm: async () => {
        const { error: confirmError } = await serviceClient.rpc("confirm_ai_quota", {
          p_reservation_id: reservationId,
        });
        if (confirmError) {
          throw confirmError;
        }
      },
      rollback: async () => {
        const { error: rollbackError } = await serviceClient.rpc("reconcile_ai_quota", {
          p_reservation_id: reservationId,
        });
        if (rollbackError) {
          throw rollbackError;
        }
      },
    };
  }

  return { status: "unavailable", limit };
};

export async function reconcileUnconfirmedReservation(
  reservationId: string,
  reason: string,
  deps?: QuotaCheckDeps,
): Promise<{ reconciled: boolean; status: string; used?: number }> {
  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = deps?.supabaseServiceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing service role credentials for administrative reconciliation");
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(deps?.fetch ? { global: { fetch: deps.fetch } } : {}),
  });

  const { data, error } = await serviceClient.rpc("reconcile_unconfirmed_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });

  if (error) {
    throw error;
  }

  return data as { reconciled: boolean; status: string; used?: number };
}
