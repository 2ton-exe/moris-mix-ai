import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { ExtractedRecipeSchema, GeneratedRecipeSchema } from "../_shared/ai/schemas.ts";
import { MOCK_EXTRACTED_RECIPE, MOCK_MALFORMED_RECIPE, MOCK_GENERATED_RECIPE, MOCK_MALFORMED_GENERATED_RECIPE } from "../_shared/ai/mocks.ts";

Deno.test("ExtractedRecipeSchema validates correct mock", () => {
  const result = ExtractedRecipeSchema.parse(MOCK_EXTRACTED_RECIPE);
  assertEquals(result.title, "Garlic Soy Chicken");
});

Deno.test("ExtractedRecipeSchema rejects malformed mock", () => {
  assertThrows(() => {
    ExtractedRecipeSchema.parse(MOCK_MALFORMED_RECIPE);
  });
});

Deno.test("GeneratedRecipeSchema validates correct mock", () => {
  const result = GeneratedRecipeSchema.parse(MOCK_GENERATED_RECIPE);
  assertEquals(result.parentRecipeIds.length, 1);
});

Deno.test("GeneratedRecipeSchema rejects malformed mock", () => {
  assertThrows(() => {
    GeneratedRecipeSchema.parse(MOCK_MALFORMED_GENERATED_RECIPE);
  });
});