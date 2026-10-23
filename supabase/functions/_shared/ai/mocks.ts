import { ExtractedRecipe } from "./AIProvider.ts";

export const MOCK_EXTRACTED_RECIPE: ExtractedRecipe = {
  title: "Garlic Soy Chicken",
  ingredients: [
    { name: "chicken", quantity: null, unit: null, quantityText: "some", inferred: true },
    { name: "soy sauce", quantity: null, unit: null, quantityText: "a splash", inferred: true },
    { name: "garlic", quantity: 2, unit: "cloves", quantityText: undefined, inferred: false }
  ],
  instructions: [
    { step: 1, text: "Chop the chicken and peel the garlic cloves." },
    { step: 2, text: "Boil the chicken with a splash of soy sauce and the garlic for 20 minutes." }
  ],
  flavor_scores: {
    sweet: 1, salty: 4, sour: 0, bitter: 0, umami: 4, spicy: 0
  }
};

// NEW: Malformed fixture to prove Zod works
export const MOCK_MALFORMED_RECIPE = {
  title: 123, // Invalid: should be a string
  ingredients: "not an array", // Invalid
  instructions: []
};

import { GeneratedRecipe } from "./AIProvider.ts"; // Add GeneratedRecipe to your imports at the top!

// NEW: Valid and Malformed Generated Recipe Mocks
export const MOCK_GENERATED_RECIPE: GeneratedRecipe = {
  recipe: MOCK_EXTRACTED_RECIPE,
  parentRecipeIds: ["123e4567-e89b-12d3-a456-426614174000"]
};

export const MOCK_MALFORMED_GENERATED_RECIPE = {
  recipe: "This is just a string, not an object", // Invalid
  parentRecipeIds: [123, 456] // Invalid (should be strings)
};