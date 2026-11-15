import type { AIProvider, GeneratedRecipe } from "../_shared/ai/AIProvider.ts";
import { AIError } from "../_shared/ai/GeminiAdapter.ts";
import {
  AI_MAX_REQUEST_BYTES,
  isPlainObject,
  readBodyWithinByteLimit,
} from "../_shared/ai/http.ts";
import { MOCK_EXTRACTED_RECIPE, MOCK_MALFORMED_GENERATED_RECIPE } from "../_shared/ai/mocks.ts";
import { consumeDailyQuota } from "../_shared/ai/quota.ts";
import { handler } from "./handler.ts";

const provider: AIProvider = {
  extractRecipe: async () => {
    throw new Error("The QA-03 generation provider only supports generation.");
  },
  generateRecipe: async (input, context) => {
    if (input.preferences === "qa03:malformed") {
      return MOCK_MALFORMED_GENERATED_RECIPE as unknown as GeneratedRecipe;
    }
    if (input.preferences === "qa03:provider-failure") {
      throw new AIError("provider_unavailable", "generate", "QA-03 local provider failure.");
    }
    return {
      recipe: { ...MOCK_EXTRACTED_RECIPE, title: `QA03 ${input.pantryItems[0]} skillet` },
      substitutions: [],
      parentRecipeIds: context.recipes.map((recipe) => recipe.id),
    };
  },
  testConnection: async () => "Local QA-03 test provider is available.",
};

const quotaDrillMarker = "QA05_QUOTA_EXHAUSTED";

Deno.serve(async (request) => {
  let shouldExhaustQuota = false;
  if (request.method === "POST") {
    const boundedBody = await readBodyWithinByteLimit(
      request.clone(),
      AI_MAX_REQUEST_BYTES,
    );
    if (boundedBody.ok) {
      try {
        const body: unknown = JSON.parse(boundedBody.text);
        shouldExhaustQuota = isPlainObject(body) &&
          body.preferences === quotaDrillMarker;
      } catch {
        // Let the handler report malformed JSON.
      }
    }
  }

  return await handler(request, {
    provider,
    quotaCheck: async (userId, supabase, deps) => {
      if (shouldExhaustQuota) {
        return { status: "exceeded", limit: 20, used: 20, retryAfterSeconds: 60 };
      }
      return await consumeDailyQuota(userId, supabase, deps);
    },
  });
});
