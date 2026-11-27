import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { z } from "npm:zod@4.6.6";
import { logQuotaRpcFailure, type QuotaCheckDeps, resolveAccountBurstLimit, resolveDailyLimit } from "./quota.ts";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: true });
export const AIUsageSchema = z.object({
  observedAt: timestamp,
  daily: z.object({
    limit: count.positive(),
    used: count,
    remaining: count,
    resetAt: timestamp,
  }),
  shortTerm: z.object({
    mode: z.enum(["fixed", "rolling"]),
    limit: count.positive(),
    used: count,
    remaining: count,
    nextChangeAt: timestamp.nullable(),
    retryAt: timestamp.nullable(),
  }),
});
export type AIUsage = z.infer<typeof AIUsageSchema>;
export type AIUsageDeps = Pick<QuotaCheckDeps, "supabaseUrl" | "supabaseServiceRoleKey" | "fetch">;

export async function readAIUsage(userId: string, deps?: AIUsageDeps): Promise<AIUsage | null> {
  try {
    const url = deps?.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
    const key = deps?.supabaseServiceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Missing quota configuration");
    const burstLimit = resolveAccountBurstLimit();
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...(deps?.fetch ? { global: { fetch: deps.fetch } } : {}),
    });
    const signal = AbortSignal.timeout(2_000);
    const { data, error } = await client.rpc("get_ai_usage_summary", {
      p_user_id: userId,
      p_daily_limit: resolveDailyLimit(),
      p_burst_limit: burstLimit,
    }).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw error;
    const parsed = AIUsageSchema.safeParse(data);
    if (!parsed.success) throw new Error("Invalid usage response");
    return parsed.data;
  } catch (error) {
    logQuotaRpcFailure("usage_summary", error);
    return null;
  }
}
