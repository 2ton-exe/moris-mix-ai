import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { EVALUATION_DATASET } from "../_shared/ai/eval_dataset.ts";
import type { ProviderFailureEvalCase } from "../_shared/ai/eval_dataset.ts";
import {
  AIError,
  GeminiAdapter,
  parseExtractionResponse,
  parseGenerationResponse,
} from "../_shared/ai/GeminiAdapter.ts";
import {
  ChefRecipeContextInputSchema,
  ChefRecipeContextResultSchema,
  MAX_EXTRACTION_INPUT_CHARS,
} from "../_shared/ai/schemas.ts";
import { computeIngredientOverlap, normalizePantryItems } from "../_shared/ai/recipeContext.ts";

/**
 * AI-08: the deterministic half of the evaluation. Every check here runs the
 * real parsers, schemas and error mapping against versioned fixtures, so the
 * suite is reproducible with no provider call, no API key and no network.
 *
 * The live counterpart that measures actual model quality is
 * `tests/ai_extraction_live.ts` (opt-in via RUN_LIVE_AI_TESTS=1).
 */

Deno.test("EVALUATION_DATASET is versioned, uniquely identified and within the request caps", () => {
  assertEquals(/^\d+\.\d+\.\d+$/.test(EVALUATION_DATASET.version), true);

  const allIds = [
    ...EVALUATION_DATASET.extraction.map((testCase) => testCase.id),
    ...EVALUATION_DATASET.generation.map((testCase) => testCase.id),
    ...EVALUATION_DATASET.providerFailures.map((testCase) => testCase.id),
  ];
  assertEquals(new Set(allIds).size, allIds.length, "evaluation case ids must be unique");

  for (const testCase of EVALUATION_DATASET.extraction) {
    assert(testCase.rawInput.length > 0, `${testCase.id}: rawInput must not be empty`);
    assert(
      testCase.rawInput.length <= MAX_EXTRACTION_INPUT_CHARS,
      `${testCase.id}: rawInput exceeds the extraction cap`,
    );
  }

  for (const testCase of EVALUATION_DATASET.generation) {
    const input = ChefRecipeContextInputSchema.safeParse({
      pantryItems: testCase.pantryItems,
    });
    assert(input.success, `${testCase.id}: pantry input violates the Chef request caps`);
    const context = ChefRecipeContextResultSchema.safeParse(testCase.context);
    assert(context.success, `${testCase.id}: context violates ChefRecipeContextResultSchema`);

    // Fixture candidates must match BE-10's own ranking math, or the suite
    // would encode a context the backend could never produce.
    const pantrySet = new Set(normalizePantryItems(testCase.context.pantryItems));
    for (const candidate of testCase.context.recipes) {
      const overlap = computeIngredientOverlap(candidate.ingredients, pantrySet);
      assertEquals(
        candidate.overlap_ratio,
        overlap.ratio,
        `${testCase.id}: ${candidate.id} overlap_ratio must match BE-10`,
      );
      assertEquals(
        candidate.matched_ingredients,
        overlap.matchedIngredients,
        `${testCase.id}: ${candidate.id} matched_ingredients must match BE-10`,
      );
    }
  }

  for (const testCase of EVALUATION_DATASET.providerFailures) {
    assert(testCase.expect.attempts >= 1, `${testCase.id}: attempts must be at least 1`);
    assert(testCase.expect.attempts <= 2, `${testCase.id}: attempts must stay within one retry`);
  }
});

Deno.test("extraction evaluation fixtures meet their declared expectations offline", () => {
  for (const testCase of EVALUATION_DATASET.extraction) {
    if (testCase.expect.kind === "rejects") {
      const error = assertThrows(
        () => parseExtractionResponse(testCase.providerOutput),
        AIError,
        undefined,
        `${testCase.id}: expected the parser to reject`,
      );
      assertEquals(error.code, testCase.expect.errorCode, testCase.id);
      assertEquals(error.detail, testCase.expect.detail, testCase.id);
      assertEquals(error.retryable, false, `${testCase.id}: invalid output must not be retried`);
      continue;
    }

    const recipe = parseExtractionResponse(testCase.providerOutput);

    // An empty expectation means the recipe must have no ingredients, so an
    // injected ingredient cannot slip through as an unchecked extra.
    if (testCase.expect.ingredientNames.length === 0) {
      assertEquals(recipe.ingredients.length, 0, `${testCase.id}: expected no ingredients`);
    }

    for (const expectedName of testCase.expect.ingredientNames) {
      const found = recipe.ingredients.some((ingredient) =>
        ingredient.name.toLowerCase().includes(expectedName.toLowerCase())
      );
      assert(found, `${testCase.id}: missing expected ingredient "${expectedName}"`);
    }

    for (const vagueName of testCase.expect.vagueIngredientNames ?? []) {
      const ingredient = recipe.ingredients.find((item) =>
        item.name.toLowerCase().includes(vagueName.toLowerCase())
      );
      assert(ingredient !== undefined, `${testCase.id}: missing vague ingredient "${vagueName}"`);
      assertEquals(ingredient.quantity, null, `${testCase.id}: ${vagueName} quantity`);
      assert(
        typeof ingredient.quantityText === "string" && ingredient.quantityText.length > 0,
        `${testCase.id}: ${vagueName} must keep the vague wording`,
      );
      assertEquals(ingredient.inferred, true, `${testCase.id}: ${vagueName} inferred`);
    }

    for (const exact of testCase.expect.exactAmounts ?? []) {
      const ingredient = recipe.ingredients.find((item) =>
        item.name.toLowerCase().includes(exact.name.toLowerCase())
      );
      assert(
        ingredient !== undefined,
        `${testCase.id}: missing exact-amount ingredient "${exact.name}"`,
      );
      assertEquals(ingredient.quantity, exact.quantity, `${testCase.id}: ${exact.name} quantity`);
      assertEquals(ingredient.unit, exact.unit, `${testCase.id}: ${exact.name} unit`);
      assertEquals(ingredient.inferred, exact.inferred, `${testCase.id}: ${exact.name} inferred`);
    }

    // A numeric amount the source notes never stated would be an invented
    // quantity. Each quantified ingredient must match a declared amount on
    // name, quantity, unit and inferred, so a duplicate entry with a different
    // amount (for example `eggs: 99` next to a declared `eggs: 2`) also fails.
    for (const ingredient of recipe.ingredients) {
      if (ingredient.quantity === null) continue;
      const declared = (testCase.expect.exactAmounts ?? []).some((exact) =>
        ingredient.name.toLowerCase().includes(exact.name.toLowerCase()) &&
        ingredient.quantity === exact.quantity &&
        (ingredient.unit ?? null) === exact.unit &&
        ingredient.inferred === exact.inferred
      );
      assert(
        declared,
        `${testCase.id}: undeclared quantity for "${ingredient.name}" ` +
          `(quantity=${ingredient.quantity}, unit=${ingredient.unit}, inferred=${ingredient.inferred})`,
      );
    }

    if (testCase.expect.flavorScores === "required") {
      assertNotEquals(recipe.flavor_scores, undefined, `${testCase.id}: flavor_scores`);
    } else {
      assertEquals(recipe.flavor_scores, undefined, `${testCase.id}: flavor_scores`);
    }
  }
});

Deno.test("Chef generation fixtures meet their declared expectations offline", () => {
  for (const testCase of EVALUATION_DATASET.generation) {
    const allowedParentIds = new Set(testCase.context.recipes.map((recipe) => recipe.id));

    if (testCase.expect.kind === "rejects") {
      const error = assertThrows(
        () => parseGenerationResponse(testCase.providerOutput, allowedParentIds),
        AIError,
        undefined,
        `${testCase.id}: expected the parser to reject`,
      );
      assertEquals(error.code, testCase.expect.errorCode, testCase.id);
      assertEquals(error.detail, testCase.expect.detail, testCase.id);
      assertEquals(error.retryable, false, `${testCase.id}: invalid output must not be retried`);
      continue;
    }

    const generated = parseGenerationResponse(testCase.providerOutput, allowedParentIds);

    assertEquals(generated.parentRecipeIds, testCase.expect.parentRecipeIds, testCase.id);
    assertEquals(
      generated.substitutions.map((substitution) => substitution.original),
      testCase.expect.substitutionOriginals,
      testCase.id,
    );
  }
});

Deno.test("provider failure fixtures follow the documented recoverable-error contract", async () => {
  for (const testCase of EVALUATION_DATASET.providerFailures) {
    let attempts = 0;
    const adapter = new GeminiAdapter({
      generateText: () => {
        attempts += 1;
        return Promise.reject(thrownFrom(testCase));
      },
      // The backoff is a test seam; never sleep for real here.
      sleep: () => Promise.resolve(),
      log: () => {},
    });

    const error = await assertRejects(
      () => adapter.extractRecipe({ rawText: "leftover rice and eggs" }),
      AIError,
      undefined,
      `${testCase.id}: expected a typed AIError`,
    );

    assertEquals(error.code, testCase.expect.errorCode, testCase.id);
    assertEquals(error.retryable, testCase.expect.retryable, testCase.id);
    assertEquals(attempts, testCase.expect.attempts, testCase.id);
    if (testCase.expect.retryAfterSeconds !== undefined) {
      assertEquals(error.retryAfterSeconds, testCase.expect.retryAfterSeconds, testCase.id);
    }
  }
});

/** Re-creates the recorded thrown shape exactly as the SDK/transport would. */
function thrownFrom(testCase: ProviderFailureEvalCase): Error {
  const error = testCase.thrown.errorType === "TypeError"
    ? new TypeError(testCase.thrown.message)
    : new Error(testCase.thrown.message);

  if (testCase.thrown.name !== undefined) error.name = testCase.thrown.name;
  if (testCase.thrown.status !== undefined) {
    Object.assign(error, { status: testCase.thrown.status });
  }
  if (testCase.thrown.errorDetails !== undefined) {
    Object.assign(error, { errorDetails: testCase.thrown.errorDetails });
  }
  return error;
}
