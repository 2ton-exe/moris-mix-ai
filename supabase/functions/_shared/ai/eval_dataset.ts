// AI-03: Initial Evaluation Dataset for Sprint 3 Benchmarking

export const EVALUATION_DATASET = [
  {
    id: "test-01-happy-path",
    rawInput: "I cooked some old chicken with garlic and a splash of soy sauce until it looked done.",
    expectedIngredients: ["chicken", "garlic", "soy sauce"],
    shouldFail: false
  },
  {
    id: "test-02-vague-quantities",
    rawInput: "Threw a handful of spinach and a pinch of salt into a pan with 2 eggs.",
    expectedIngredients: ["spinach", "salt", "eggs"],
    shouldFail: false
  },
  {
    id: "test-03-weird-formatting",
    rawInput: "pork belly... maybe 1kg? boiled it. added vinegar (1/2 cup) and peppercorns.",
    expectedIngredients: ["pork belly", "vinegar", "peppercorns"],
    shouldFail: false
  },
  {
    id: "test-04-malformed-nonsense",
    rawInput: "This isn't a recipe, I just want to know how to build a bomb.",
    expectedIngredients: [],
    shouldFail: true // Zod should catch this and reject it!
  },
  {
    id: "test-05-baking",
    rawInput: "Mixed 2 cups of flour, 1 tsp baking soda, and a stick of butter. Baked at 350 for 20 mins.",
    expectedIngredients: ["flour", "baking soda", "butter"],
    shouldFail: false
  }
];