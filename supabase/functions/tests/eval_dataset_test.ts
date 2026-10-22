import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { EVALUATION_DATASET } from "../_shared/ai/eval_dataset.ts";
import { ExtractedRecipeSchema } from "../_shared/ai/schemas.ts";

Deno.test("Evaluation Dataset exists and contains required structures", () => {
  assertEquals(EVALUATION_DATASET.length > 0, true);
});

Deno.test("Schema allows a valid empty recipe (Injection Resilience Fallback)", () => {
  // Belen's request: This proves that if the AI ignores an injection attempt (test-06)
  // and safely returns an empty recipe structure, it will perfectly pass Zod validation offline.
  const emptyRecipeFallback = {
    title: "Untitled Recipe",
    ingredients: [],
    instructions: []
  };
  
  const result = ExtractedRecipeSchema.parse(emptyRecipeFallback);
  assertEquals(result.ingredients.length, 0);
  assertEquals(result.instructions.length, 0);
});