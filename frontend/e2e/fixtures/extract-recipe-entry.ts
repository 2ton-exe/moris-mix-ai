import type { AIProvider } from "../_shared/ai/AIProvider.ts";
import { MOCK_EXTRACTED_RECIPE } from "../_shared/ai/mocks.ts";
import { handler } from "./handler.ts";

const provider: AIProvider = {
  extractRecipe: ({ rawText }) =>
    Promise.resolve({
      ...MOCK_EXTRACTED_RECIPE,
      title: rawText.split(/\r?\n/, 1)[0] || MOCK_EXTRACTED_RECIPE.title,
    }),
  generateRecipe: async () => {
    throw new Error("The FS-04 test provider only supports extraction.");
  },
  testConnection: async () => "Local FS-04 test provider is available.",
};

Deno.serve((request) => handler(request, { provider }));
