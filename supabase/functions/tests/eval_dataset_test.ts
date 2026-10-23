import { assertEquals } from "jsr:@std/assert@1";
import { EVALUATION_DATASET } from "../_shared/ai/eval_dataset.ts";
import { ExtractedRecipeSchema } from "../_shared/ai/schemas.ts";

Deno.test("Evaluation Dataset contains required test cases with correct properties", () => {
  // Ensure dataset is loaded and has entries
  assertEquals(EVALUATION_DATASET.length > 0, true);

  // Find specific edge cases to validate their configurations
  const safetyRefusalTest = EVALUATION_DATASET.find(t => t.id === "test-04-safety-refusal");
  const injectionTest = EVALUATION_DATASET.find(t => t.id === "test-06-injection-resilience");

  // Validate test-04: Should explicitly fail due to safety block
  assertEquals(safetyRefusalTest?.shouldFail, true);
  assertEquals(safetyRefusalTest?.failureReason, "provider_safety_block");

  // Validate test-06: Should NOT fail, testing injection resilience (empty safe recipe)
  assertEquals(injectionTest?.shouldFail, false);
  assertEquals(injectionTest?.failureReason, null);
  assertEquals(injectionTest?.expectedIngredients.length, 0);

  const fallbackRecipe = {
    title: "No recipe extracted",
    ingredients: (injectionTest?.expectedIngredients ?? []).map((name) => ({
      name,
      quantity: null,
      unit: null,
      inferred: false,
    })),
    instructions: [],
  };

  assertEquals(ExtractedRecipeSchema.safeParse(fallbackRecipe).success, true);
});
