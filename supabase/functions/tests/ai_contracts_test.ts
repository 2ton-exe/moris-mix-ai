import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  CreateRecipeRequestSchema,
  ExtractedRecipeSchema,
  GeneratedRecipeSchema,
  GenerateRecipeRequestSchema,
  GenerateRecipeResponseSchema,
  IngredientSchema,
  UpdateRecipeRequestSchema,
} from "../_shared/ai/schemas.ts";
import {
  MOCK_EXTRACTED_RECIPE,
  MOCK_GENERATED_RECIPE,
  MOCK_MALFORMED_GENERATED_RECIPE,
  MOCK_MALFORMED_RECIPE,
} from "../_shared/ai/mocks.ts";

Deno.test("generation deduplicates pantry identities before entering the pipeline", () => {
  const request = GenerateRecipeRequestSchema.parse({
    pantryItems: [
      " Green   onions ",
      "scallions",
      "EGGS",
      "egg",
      "chicken breast",
      "chicken thigh",
    ],
  });
  assertEquals(request.pantryItems, [
    "Green onions",
    "EGGS",
    "chicken breast",
    "chicken thigh",
  ]);
});

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

Deno.test("GeneratedRecipeSchema rejects a substitution that names no generated ingredient", () => {
  assertThrows(() =>
    GeneratedRecipeSchema.parse({
      recipe: MOCK_EXTRACTED_RECIPE,
      substitutions: [{ original: "quinoa", replacement: "rice" }],
      parentRecipeIds: [],
    })
  );

  const parsed = GeneratedRecipeSchema.parse(MOCK_GENERATED_RECIPE);
  assertEquals(parsed.substitutions[0].original, "soy sauce");
});

Deno.test("GenerateRecipeRequestSchema trims pantry items and enforces the input caps", () => {
  const parsed = GenerateRecipeRequestSchema.parse({
    pantryItems: ["  chicken  ", "rice"],
    preferences: "  spicy, 30 minutes  ",
  });
  assertEquals(parsed.pantryItems, ["chicken", "rice"]);
  assertEquals(parsed.preferences, "spicy, 30 minutes");

  assertThrows(() => GenerateRecipeRequestSchema.parse({ pantryItems: [] }));
  assertThrows(() =>
    GenerateRecipeRequestSchema.parse({ pantryItems: ["   "] })
  );
  assertThrows(() =>
    GenerateRecipeRequestSchema.parse({ pantryItems: ["x".repeat(101)] })
  );
  assertThrows(() =>
    GenerateRecipeRequestSchema.parse({
      pantryItems: Array.from({ length: 101 }, () => "rice"),
    })
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
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        title: "Garlic Rice",
        star_rating: 5,
      },
    ],
    candidate_token: "v1.test-token",
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
      context: {
        status: "MATCHED",
        matchedCandidateCount: 4,
        totalCandidateCount: 3,
      },
    })
  );

  // AI-07: proposed parents require a token, and no parents must mean no token.
  assertThrows(() =>
    GenerateRecipeResponseSchema.parse({
      ...response,
      candidate_token: null,
    })
  );
  assertThrows(() =>
    GenerateRecipeResponseSchema.parse({
      ...response,
      parents: [],
      candidate_token: "v1.test-token",
    })
  );
});

Deno.test("manual create, edit and AI extraction normalize units identically without losing amounts", () => {
  const ingredients = [
    { name: "garlic", quantity: 2, unit: " cloves " },
    {
      name: "oil",
      quantity: 1,
      unit: "tablespoons",
      quantityText: "as needed",
    },
    { name: "flour", quantity: 0.5, unit: " Grandma’s mug " },
    { name: "eggs", quantity: 2, unit: "" },
    { name: "salt", quantityText: "to taste" },
    { name: "sauce", quantity: 1, unit: "T" },
    { name: "pepper", quantity: 1, unit: "t" },
  ];
  const expected = [
    { name: "garlic", quantity: 2, unit: "clove", inferred: false },
    {
      name: "oil",
      quantity: 1,
      unit: "tbsp",
      quantityText: "as needed",
      inferred: false,
    },
    { name: "flour", quantity: 0.5, unit: "Grandma’s mug", inferred: false },
    { name: "eggs", quantity: 2, unit: null, inferred: false },
    {
      name: "salt",
      quantity: null,
      unit: null,
      quantityText: "to taste",
      inferred: false,
    },
    { name: "sauce", quantity: 1, unit: "tbsp", inferred: false },
    { name: "pepper", quantity: 1, unit: "tsp", inferred: false },
  ];
  assertEquals(
    CreateRecipeRequestSchema.parse({
      title: "Rice",
      ingredients,
      instructions: [],
    }).ingredients,
    expected,
  );
  assertEquals(
    UpdateRecipeRequestSchema.parse({ ingredients }).ingredients,
    expected,
  );
  assertEquals(
    ExtractedRecipeSchema.parse({
      title: "Rice",
      ingredients,
      instructions: [],
    }).ingredients,
    expected,
  );
  assertEquals(
    GeneratedRecipeSchema.parse({
      recipe: { title: "Rice", ingredients, instructions: [] },
      substitutions: [],
      parentRecipeIds: [],
    }).recipe.ingredients,
    expected,
  );
});

Deno.test("write and AI schemas require positive supplied quantities and safe bounded units", () => {
  const invalidIngredients = [
    { name: " ", quantity: 1, unit: "cup" },
    { name: "rice", quantity: 0, unit: "cup" },
    { name: "rice", quantity: -1, unit: "cup" },
    { name: "rice", quantity: Infinity, unit: "cup" },
    { name: "rice", quantity: 1, unit: "x".repeat(101) },
    { name: "rice", quantity: 1, unit: "mug\nfull" },
  ];
  for (const ingredient of invalidIngredients) {
    const body = { title: "Rice", ingredients: [ingredient], instructions: [] };
    assertEquals(CreateRecipeRequestSchema.safeParse(body).success, false);
    assertEquals(
      UpdateRecipeRequestSchema.safeParse({ ingredients: [ingredient] })
        .success,
      false,
    );
    assertEquals(ExtractedRecipeSchema.safeParse(body).success, false);
  }
  assertEquals(
    IngredientSchema.parse({
      name: "rice",
      quantity: 0,
      unit: "an arbitrary legacy unit",
    }).unit,
    "an arbitrary legacy unit",
  );
  assertEquals(
    IngredientSchema.parse({
      name: "rice",
      quantity: 0,
      unit: "an arbitrary legacy unit",
    }).quantity,
    0,
  );
});


Deno.test("GeneratedRecipeSchema normalizes matching substitution and ingredient names", () => {
  const result = GeneratedRecipeSchema.parse({
    ...MOCK_GENERATED_RECIPE,
    recipe: { ...MOCK_EXTRACTED_RECIPE, ingredients: [
      { name: " soy sauce ", quantity: 1, unit: "tbsp", inferred: false },
    ] },
    substitutions: [{ original: " soy sauce ", replacement: "tamari" }],
  });
  assertEquals(result.recipe.ingredients[0].name, "soy sauce");
  assertEquals(result.substitutions[0].original, "soy sauce");
});
