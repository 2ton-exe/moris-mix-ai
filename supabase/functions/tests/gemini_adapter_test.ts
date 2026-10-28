import {
  assertEquals,
  assertFalse,
  assertRejects,
} from "jsr:@std/assert@1";
import {
  AIError,
  type AIOperationLog,
  GeminiAdapter,
  type GenerateText,
} from "../_shared/ai/GeminiAdapter.ts";
import { buildExtractionPrompt } from "../_shared/ai/prompts.ts";

const NOTES = "Boiled chicken with garlic and a splash of soy sauce.";

const VALID_RECIPE = {
  title: "Boiled Chicken",
  ingredients: [
    { name: "chicken", quantity: 1, unit: "whole", inferred: false },
    { name: "soy sauce", quantity: null, unit: null, quantityText: "a splash", inferred: true },
  ],
  instructions: [
    { step: 1, text: "Boil the chicken with garlic and soy sauce." },
  ],
};

function adapterWith(
  generateText: GenerateText,
  log: (entry: AIOperationLog) => void = () => {},
): GeminiAdapter {
  return new GeminiAdapter({ generateText, log });
}

Deno.test("extractRecipe returns a parsed recipe from valid JSON", async () => {
  const adapter = adapterWith(async () => JSON.stringify(VALID_RECIPE));

  const recipe = await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(recipe.title, "Boiled Chicken");
  assertEquals(recipe.ingredients[1].quantity, null);
  assertEquals(recipe.ingredients[1].inferred, true);
});

Deno.test("extractRecipe accepts JSON wrapped in a markdown fence", async () => {
  const adapter = adapterWith(async () => "```json\n" + JSON.stringify(VALID_RECIPE) + "\n```");

  const recipe = await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(recipe.instructions.length, 1);
});

Deno.test("extractRecipe rejects non-JSON output", async () => {
  const adapter = adapterWith(async () => "Sure! Here is your recipe: ...");

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(error.retryable, false);
});

Deno.test("extractRecipe rejects JSON that fails the schema", async () => {
  const adapter = adapterWith(async () => JSON.stringify({ ...VALID_RECIPE, title: 123 }));

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertFalse(error.message.includes("Boiled Chicken"));
});

Deno.test("extractRecipe rejects impossible values and reports the field path", async () => {
  const adapter = adapterWith(async () =>
    JSON.stringify({
      ...VALID_RECIPE,
      ingredients: [{ name: "salt", quantity: -1, unit: null, inferred: false }],
    })
  );

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(error.detail, "ingredients.0.quantity");
});

Deno.test("extractRecipe retries once after a transient provider failure", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    return JSON.stringify(VALID_RECIPE);
  });

  const recipe = await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(calls, 2);
  assertEquals(recipe.title, "Boiled Chicken");
});

Deno.test("extractRecipe stops after two failed attempts", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    throw Object.assign(new Error("Service Unavailable"), { status: 503 });
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(calls, 2);
  assertEquals(error.code, "provider_unavailable");
});

Deno.test("extractRecipe does not retry invalid output", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    return "not json";
  });

  await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

  assertEquals(calls, 1);
});

Deno.test("extractRecipe classifies a quota error as rate_limited", async () => {
  const adapter = adapterWith(async () => {
    throw Object.assign(new Error("Quota exceeded"), { status: 429 });
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "rate_limited");
});

Deno.test("extractRecipe classifies an abort as provider_timeout", async () => {
  const adapter = adapterWith(async () => {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    throw abort;
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "provider_timeout");
});

Deno.test("extractRecipe normalises null optional fields instead of failing", async () => {
  const withNulls = {
    ...VALID_RECIPE,
    ingredients: [
      { name: "chicken", quantity: 1, unit: "whole", quantityText: null, inferred: false },
      { name: "garlic", quantity: null, unit: null, quantityText: "some", inferred: true },
    ],
    flavor_scores: null,
  };
  const adapter = adapterWith(async () => JSON.stringify(withNulls));

  const recipe = await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(recipe.ingredients[0].quantityText, undefined);
  assertEquals(recipe.flavor_scores, undefined);
});

Deno.test("extractRecipe logs metadata without prompt or recipe text", async () => {
  const entries: AIOperationLog[] = [];
  const adapter = adapterWith(
    async () => JSON.stringify(VALID_RECIPE),
    (entry) => entries.push(entry),
  );

  await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(entries.length, 1);
  assertEquals(entries[0].promptId, "extraction");
  assertEquals(entries[0].promptVersion, "1.0.0");
  assertEquals(entries[0].outcome, "success");

  const serialized = JSON.stringify(entries);
  assertFalse(serialized.includes("chicken"));
  assertFalse(serialized.includes("garlic"));
});

Deno.test("buildExtractionPrompt inserts notes literally", () => {
  const notes = "Use $& and $1 exactly as written.";

  const prompt = buildExtractionPrompt(notes);

  assertEquals(prompt.includes(notes), true);
});

Deno.test("an injected generator does not require an API key", () => {
  const adapter = new GeminiAdapter({ generateText: async () => "{}" });

  assertEquals(adapter instanceof GeminiAdapter, true);
});
