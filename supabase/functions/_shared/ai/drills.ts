import type { AIProvider } from "./AIProvider.ts";
import { AIError } from "./GeminiAdapter.ts";
import { isEnvEnabled } from "./http.ts";

/**
 * Non-production failure drills shared by the AI endpoints. Never set in
 * production and never client-triggerable: the demo exercises the real error
 * contract without a public "break me" endpoint or a live outage.
 *
 * Only explicit development/test environments permit drills. Production, unset
 * and unknown environments ignore all drill switches, including the master.
 */
export const AI_ENVIRONMENT_ENV = "AI_ENVIRONMENT";
export const ALLOW_FAILURE_DRILLS_ENV = "AI_ALLOW_FAILURE_DRILLS";
export const SIMULATE_OUTAGE_ENV = "AI_SIMULATE_OUTAGE";
export const SIMULATE_BAD_OUTPUT_ENV = "AI_SIMULATE_BAD_OUTPUT";

export type DrillOperation = "extract" | "generate";

function notImplemented(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation} is not part of this failure drill.`));
}

/**
 * Builds a provider that fails the way the drill asks. Requires a
 * development/test environment, the master switch and a drill switch.
 * Outage wins when both switches are set, so the demo always shows one
 * deterministic failure.
 */
export function createFailureDrillProvider(operation: DrillOperation): AIProvider | null {
  const environment = Deno.env.get(AI_ENVIRONMENT_ENV)?.trim().toLowerCase();
  if (environment !== "development" && environment !== "test") return null;
  if (!isEnvEnabled(ALLOW_FAILURE_DRILLS_ENV)) return null;

  const outage = isEnvEnabled(SIMULATE_OUTAGE_ENV);
  const badOutput = !outage && isEnvEnabled(SIMULATE_BAD_OUTPUT_ENV);
  if (!outage && !badOutput) return null;

  const fail = (): Promise<never> =>
    outage
      ? Promise.reject(new AIError("provider_unavailable", operation, "Simulated provider outage."))
      : Promise.reject(
        new AIError("invalid_output", operation, "Simulated malformed model output."),
      );

  return {
    extractRecipe: operation === "extract"
      ? fail
      : () => notImplemented("extractRecipe"),
    generateRecipe: operation === "generate"
      ? fail
      : () => notImplemented("generateRecipe"),
    testConnection: () => notImplemented("testConnection"),
  };
}
