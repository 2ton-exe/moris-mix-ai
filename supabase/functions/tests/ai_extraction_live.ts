import {
  assert,
  assertEquals,
  assertExists,
} from "jsr:@std/assert@1";
import { GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";

/**
 * Controlled live extraction check — the second half of the AI-04 definition
 * of done. It is skipped unless explicitly enabled, so CI never calls a real
 * provider:
 *
 *   RUN_LIVE_AI_TESTS=1 GEMINI_API_KEY=... \
 *     deno test --allow-env --allow-net supabase/functions/tests/ai_extraction_live.ts
 *
 * Assertions cover the schema and the rules from the prompt. They never assert
 * exact wording, because model output is not deterministic.
 */
const enabled = Deno.env.get("RUN_LIVE_AI_TESTS") === "1";
const hasKey = Boolean(Deno.env.get("GEMINI_API_KEY"));

const VAGUE_AMOUNTS = `Adobo night. Used pork belly (maybe a kilo?), a splash of soy sauce, a handful of peppercorns, some garlic, and 2 bay leaves. Simmered until soft.`;

const NO_TASTE_DESCRIPTION = `Boiled two kamote in water until soft, then mashed them with a fork.`;

const DESCRIBED_TASTE = `Sinigang: 500g pork, 1 pack sinigang mix, kangkong, 2 tomatoes, 1 onion. Boiled the pork first, then added everything and simmered 30 minutes. Turned out sour and a little salty.`;

function liveAdapter(): GeminiAdapter {
  return new GeminiAdapter({ timeoutMs: 45_000, log: () => {} });
}

Deno.test({
  name: "live extraction: vague amounts stay null instead of being invented",
  ignore: !enabled || !hasKey,
  async fn() {
    const recipe = await liveAdapter().extractRecipe({ rawText: VAGUE_AMOUNTS });

    assert(recipe.title.length > 0);
    assert(recipe.ingredients.length >= 3);

    const soy = recipe.ingredients.find((item) => item.name.toLowerCase().includes("soy"));
    assertExists(soy, "expected soy sauce in the extracted ingredients");
    assertEquals(soy.quantity, null);
    assertEquals(soy.inferred, true);
    assertExists(soy.quantityText);
  },
});

Deno.test({
  name: "live extraction: omits flavour scores when taste is never described",
  ignore: !enabled || !hasKey,
  async fn() {
    const recipe = await liveAdapter().extractRecipe({ rawText: NO_TASTE_DESCRIPTION });

    assert(recipe.title.length > 0);
    assert(recipe.instructions.length >= 1);
    assertEquals(recipe.flavor_scores, undefined);
  },
});

Deno.test({
  name: "live extraction: keeps described flavours and steps",
  ignore: !enabled || !hasKey,
  async fn() {
    const recipe = await liveAdapter().extractRecipe({ rawText: DESCRIBED_TASTE });

    assert(recipe.ingredients.length >= 4);
    assert(recipe.instructions.length >= 1);
    assertExists(recipe.flavor_scores, "expected flavour scores for a taste description");
    assert(recipe.flavor_scores.sour >= 1);
  },
});
