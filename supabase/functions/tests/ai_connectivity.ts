import { GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";

async function runTest() {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  
  try {
    console.log("🔍 Fetching available models from Google...");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    
    if (data.error) throw new Error(data.error.message);

    // Get all text generation models, strip the "models/" prefix, and ignore the banned 2.5
    const textModels = data.models
      .filter((m: any) => m.supportedGenerationMethods.includes("generateContent"))
      .map((m: any) => m.name.replace("models/", ""))
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
        // Continues to the next model in the loop automatically
      }
    }
    
    console.error("\n❌ All models are currently busy. Go to sleep!");
  } catch (error) {
    console.error("❌ Fatal Error:", (error as Error).message);
  }
}

runTest();