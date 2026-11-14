import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import { AIError } from "../_shared/ai/GeminiAdapter.ts";
import { MOCK_EXTRACTED_RECIPE, MOCK_MALFORMED_RECIPE } from "../_shared/ai/mocks.ts";
import { handler } from "./handler.ts";

const provider: AIProvider = {
  extractRecipe: async ({ rawText }) => {
    if (rawText.includes("QA03_MALFORMED")) {
      return MOCK_MALFORMED_RECIPE as unknown as typeof MOCK_EXTRACTED_RECIPE;
    }
    if (rawText.includes("QA03_PROVIDER_FAILURE")) {
      throw new AIError("provider_unavailable", "extract", "QA-03 local provider failure.");
    }
    return {
      ...MOCK_EXTRACTED_RECIPE,
      title: rawText.split(/\r?\n/, 1)[0] || MOCK_EXTRACTED_RECIPE.title,
    };
  },
  generateRecipe: async () => {
    throw new Error("The FS-04 test provider only supports extraction.");
  },
  testConnection: async () => "Local FS-04 test provider is available.",
};

Deno.serve((request) => handler(request, { provider }));
