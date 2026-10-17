import { GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";

async function runTest() {
  const modelName = Deno.env.get("AI_MODEL") || "gemini-3.8-flash";

  try {
    const response = await new GeminiAdapter({ modelName }).testConnection();
    console.log(`Gemini Interactions API connectivity succeeded (${modelName}): ${response}`);
  } catch (error) {
    console.error(`Gemini Interactions API connectivity failed (${modelName}): ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}

await runTest();
