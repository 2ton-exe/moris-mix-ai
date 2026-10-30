import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  ExtractedRecipeSchema,
  GeneratedRecipeSchema,
  GenerateRecipeRequestSchema,
  GenerateRecipeResponseSchema,
} from "../_shared/ai/schemas.ts";
import {
  MOCK_EXTRACTED_RECIPE,
  MOCK_MALFORMED_RECIPE,
  MOCK_GENERATED_RECIPE,
  MOCK_MALFORMED_GENERATED_RECIPE,
} from "../_shared/ai/mocks.ts";

Deno.test("ExtractedRecipeSchema validates correct mock", () => {
  const result = ExtractedRecipeSchema.parse(MOCK_EXTRACTED_RECIPE);
  assertEquals(result.title, "Garlic Soy Chicken");
});

Deno.test("ExtractedRecipeSchema rejects malformed mock", () => {
  assertThrows(() => {
    ExtractedRecipeSchema.parse(MOCK_MALFORMED_RECIPE);
  });
});

Deno.test("GeneratedRecipeSchema validates the mock and keeps structured substitutions", () => {
  const result = GeneratedRecipeSchema.parse(MOCK_GENERATED_RECIPE);
  assertEquals(result.parentRecipeIds.length, 1);
  assertEquals(result.substitutions, [
    { original: "soy sauce", replacement: "tamari", reason: "gluten-free" },
  ]);
});

Deno.test("GeneratedRecipeSchema rejects malformed mock", () => {
  assertThrows(() => {
    GeneratedRecipeSchema.parse(MOCK_MALFORMED_GENERATED_RECIPE);
  });
});

Deno.test("GeneratedRecipeSchema requires an explicit substitutions array", () => {
  assertThrows(() => {
    GeneratedRecipeSchema.parse({
      recipe: MOCK_EXTRACTED_RECIPE,
      parentRecipeIds: [],
    });
  });

  assertThrows(() => {
    GeneratedRecipeSchema.parse({
      recipe: MOCK_EXTRACTED_RECIPE,
      substitutions: [{ original: "soy sauce" }],
      parentRecipeIds: [],
    });
  });
});

Deno.test("GenerateRecipeRequestSchema trims pantry items and enforces the input caps", () => {
  const parsed = GenerateRecipeRequestSchema.parse({
    pantryItems: ["  chicken  ", "rice"],
    preferences: "  spicy, 30 minutes  ",
  });
  assertEquals(parsed.pantryItems, ["chicken", "rice"]);
  assertEquals(parsed.preferences, "spicy, 30 minutes");

  assertThrows(() => GenerateRecipeRequestSchema.parse({ pantryItems: [] }));
  assertThrows(() => GenerateRecipeRequestSchema.parse({ pantryItems: ["   "] }));
  assertThrows(() =>
    GenerateRecipeRequestSchema.parse({ pantryItems: ["x".repeat(101)] })
  );
  assertThrows(() =>
    GenerateRecipeRequestSchema.parse({ pantryItems: Array.from({ length: 101 }, () => "rice") })
  );
  assertThrows(() =>
    GenerateRecipeRequestSchema.parse({
      pantryItems: ["rice"],
      preferences: "x".repeat(1001),
    })
  );
});

Deno.test("GenerateRecipeResponseSchema validates resolved parent summaries", () => {
  const response = GenerateRecipeResponseSchema.parse({
    recipe: MOCK_EXTRACTED_RECIPE,
    substitutions: MOCK_GENERATED_RECIPE.substitutions,
    parents: [
      { id: "123e4567-e89b-12d3-a456-426614174000", title: "Garlic Rice", star_rating: 5 },
    ],
    context: {
      status: "MATCHED",
      matchedCandidateCount: 1,
      totalCandidateCount: 3,
    },
  });

  assertEquals(response.parents[0].title, "Garlic Rice");

  assertThrows(() =>
    GenerateRecipeResponseSchema.parse({
      ...response,
      context: { status: "MATCHED", matchedCandidateCount: 4, totalCandidateCount: 3 },
    })
  );
});
