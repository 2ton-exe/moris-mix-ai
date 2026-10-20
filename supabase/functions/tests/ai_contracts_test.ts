import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { ExtractedRecipeSchema } from "../_shared/ai/schemas.ts";
import { MOCK_EXTRACTED_RECIPE, MOCK_MALFORMED_RECIPE } from "../_shared/ai/mocks.ts";

Deno.test("ExtractedRecipeSchema validates correct mock", () => {
  const result = ExtractedRecipeSchema.parse(MOCK_EXTRACTED_RECIPE);
  assertEquals(result.title, "Garlic Soy Chicken");
});

Deno.test("ExtractedRecipeSchema rejects malformed mock", () => {
  assertThrows(() => {
    ExtractedRecipeSchema.parse(MOCK_MALFORMED_RECIPE);
  });
});