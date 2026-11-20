import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { logQuotaRpcFailure } from "./quota.ts";

type Admission =
  | { status: "allowed" }
  | { status: "exceeded"; retryAfterSeconds: number }
  | { status: "unavailable" };

export type GeminiAdmission = () => Promise<Admission>;

function readLimit(raw: string): number | null {
  if (raw === "") return null;
  const limit = Number(raw);
  if (!/^\d+$/.test(raw) || limit < 1 || limit > 2_147_483_647) {
    throw new Error("Invalid Gemini capacity limit");
  }
  return limit;
}

export function createGeminiAdmission(
  model: string,
): GeminiAdmission | undefined {
  const rpm = Deno.env.get("AI_GEMINI_QUOTA_RPM")?.trim() ?? "";
  const rpd = Deno.env.get("AI_GEMINI_QUOTA_RPD")?.trim() ?? "";
  if (rpm === "" && rpd === "") return undefined;

  try {
    const project = Deno.env.get("AI_GEMINI_QUOTA_PROJECT")?.trim();
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!project || !url || !serviceKey) {
      throw new Error("Missing Gemini capacity configuration");
    }
    const args = {
      p_project: project,
      p_model: model.replace(/^models\//, ""),
      p_rpm_limit: readLimit(rpm),
      p_rpd_limit: readLimit(rpd),
    };
    const client = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    return async () => {
      try {
        const { data, error } = await client.rpc(
          "admit_ai_gemini_attempt",
          args,
        );
        if (error) throw error;
        if (data?.status === "allowed") return { status: "allowed" };
        const retryAfterSeconds = data?.retry_after_seconds;
        if (
          data?.status === "exceeded" &&
          Number.isSafeInteger(retryAfterSeconds) &&
          retryAfterSeconds >= 1
        ) {
          return { status: "exceeded", retryAfterSeconds };
        }
        logQuotaRpcFailure("gemini_admission_invalid_response");
      } catch (error) {
        logQuotaRpcFailure("gemini_admission_request", error);
      }
      return { status: "unavailable" };
    };
  } catch (error) {
    logQuotaRpcFailure("gemini_admission_configuration", error);
    return () => Promise.resolve({ status: "unavailable" });
  }
}
