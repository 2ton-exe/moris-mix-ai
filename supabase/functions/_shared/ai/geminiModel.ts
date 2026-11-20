/**
 * Pinned extraction model as of Sprint 3. AI_MODEL overrides it, so a model
 * retirement never needs a code change (AI-03).
 *
 * Why the lite model rather than gemini-3.6-flash: on the free tier the 3.6
 * model returned 503 "high demand" on roughly one call in three and hit a
 * per-minute 429 under back-to-back evaluation runs. The pinned 3.5 Flash-Lite
 * passed the six-case evaluation set 6/6 and the live extraction suite 3/3
 * with no provider errors. A stable model gives a reproducible benchmark;
 * a faster model that fails a third of the time does not.
 *
 * The version is pinned on purpose. `gemini-flash-lite-latest` resolves to
 * 3.5 Flash-Lite today, but an alias can move and silently change what the
 * evaluation measured.
 */
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function resolveGeminiModel(): string {
  return Deno.env.get("AI_MODEL")?.trim() || DEFAULT_MODEL;
}
