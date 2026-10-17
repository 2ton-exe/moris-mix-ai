import { GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";

// 1. We define a strict type to fix the 'any' lint errors!
type GoogleModel = {
  name: string;
  supportedGenerationMethods: string[];
};

async function runTest() {
  const apiKey = Deno.env.get("GEMINI_API_KEY");

  // 2. Ramos's Suggestion: Early guard to prevent undefined API key requests
  if (!apiKey) {
    console.error("⚠️ GEMINI_API_KEY environment variable is not set. Please provide it to run the test.");
    return;
  }

  try {
    console.log("🔍 Fetching available models from Google...");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    // Filter using our strict type instead of 'any'
    const textModels = data.models
      .filter((m: GoogleModel) => m.supportedGenerationMethods.includes("generateContent"))
      .map((m: GoogleModel) => m.name.replace("models/", ""))
      .filter((name: string) => !name.includes("2.5"));

    console.log(`✅ Found ${textModels.length} potential models. Trying them to bypass 503 errors...`);

    // Try them one by one until one works!
    for (const modelName of textModels) {
      console.log(`\n⏳ Testing model: ${modelName}...`);
      try {
        const adapter = new GeminiAdapter({ modelName });
        const response = await adapter.testConnection();

        console.log("✅ Success! Response:", response);
        console.log("🎉 CONNECTIVITY PROVEN! You can stop testing now.");
        return; // Exit completely on the first success!

      } catch (err) {
        console.log(`⚠️ Failed with ${modelName}: ${(err as Error).message}`);
      }
    }

    console.error("\n❌ All models are currently busy. Go to sleep!");
  } catch (error) {
    console.error("❌ Fatal Error:", (error as Error).message);
  }
}

runTest();