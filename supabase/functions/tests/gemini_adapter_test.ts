import {
  GoogleGenerativeAI,
  GoogleGenerativeAIError,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from "npm:@google/generative-ai@0.21.0";
import {
  assertEquals,
  assertFalse,
  assertRejects,
  assertThrows,
  assert,
} from "jsr:@std/assert@1";
import {
  AIError,
  type AIOperationLog,
  GeminiAdapter,
  type GenerateText,
  parseExtractionResponse,
  parseGenerationResponse,
} from "../_shared/ai/GeminiAdapter.ts";
import type { GenerateRecipeContext } from "../_shared/ai/AIProvider.ts";
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

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_PARENT_ID = "22222222-2222-4222-8222-222222222222";

const VALID_GENERATED = {
  recipe: {
    title: "Egg Fried Rice",
    ingredients: [
      { name: "rice", quantity: 2, unit: "cups", inferred: false },
      { name: "eggs", quantity: 2, unit: null, inferred: false },
      { name: "soy sauce", quantity: null, unit: null, quantityText: "a splash", inferred: true },
    ],
    instructions: [
      { step: 1, text: "Scramble the eggs, then fold in the rice." },
      { step: 2, text: "Season with soy sauce and serve." },
    ],
  },
  substitutions: [
    { original: "soy sauce", replacement: "tamari", reason: "gluten-free" },
  ],
  parentRecipeIds: [PARENT_ID],
};

const MATCHED_CONTEXT: GenerateRecipeContext = {
  status: "MATCHED",
  pantryItems: ["rice", "eggs"],
  preferences: "quick weeknight dinner",
  recipes: [{
    id: PARENT_ID,
    title: "Garlic Fried Rice",
    ingredients: [
      { name: "rice", quantity: 2, unit: "cups", inferred: false },
      { name: "garlic", quantity: 2, unit: "cloves", inferred: false },
    ],
    instructions: [
      { step: 1, text: "Fry the garlic." },
      { step: 2, text: "Toss in the rice." },
    ],
    flavor_scores: null,
    star_rating: 5,
    created_at: "2026-10-01T00:00:00.000Z",
    // BE-10: 1 matched ingredient (rice) / 2 unique recipe ingredients.
    overlap_ratio: 0.5,
    matched_ingredients: ["rice"],
  }],
  totalCandidateCount: 4,
  matchedCandidateCount: 1,
  truncated: false,
};

const COLD_START_CONTEXT: GenerateRecipeContext = {
  status: "NO_SAVED_RECIPES",
  pantryItems: ["rice", "eggs"],
  recipes: [],
  totalCandidateCount: 0,
  matchedCandidateCount: 0,
  truncated: false,
};

function adapterWith(
  generateText: GenerateText,
  log: (entry: AIOperationLog) => void = () => {},
): GeminiAdapter {
  return new GeminiAdapter({ generateText, log, sleep: async () => {} });
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

Deno.test("parseExtractionResponse rejects non-sequential step numbers", () => {
  const raw = JSON.stringify({
    ...VALID_RECIPE,
    instructions: [
      { step: 1, text: "Boil the chicken." },
      { step: 3, text: "Serve." },
    ],
  });

  const error = assertThrows(() => parseExtractionResponse(raw), AIError);

  assertEquals(error.code, "invalid_output");
  assertEquals(error.detail, "instructions.1.step");
});

Deno.test("parseExtractionResponse keeps an empty instruction list valid", () => {
  const raw = JSON.stringify({ ...VALID_RECIPE, instructions: [] });

  const recipe = parseExtractionResponse(raw);

  assertEquals(recipe.instructions.length, 0);
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

Deno.test("extractRecipe waits before retrying a rate limit", async () => {
  let calls = 0;
  const delays: number[] = [];
  const adapter = new GeminiAdapter({
    generateText: async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("Quota exceeded"), { status: 429 });
      }
      return JSON.stringify(VALID_RECIPE);
    },
    log: () => {},
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  const recipe = await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(calls, 2);
  assertEquals(delays.length, 1);
  assertEquals(delays[0] >= 250 && delays[0] < 500, true);
  assertEquals(recipe.title, "Boiled Chicken");
});

function rateLimitWithDetails(errorDetails: unknown): GoogleGenerativeAIFetchError {
  return Object.assign(
    new GoogleGenerativeAIFetchError("Quota exceeded", 429, "Too Many Requests"),
    {
      errorDetails,
    },
  );
}

function retryInfo(retryDelay: unknown): Record<string, unknown> {
  return { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay };
}

Deno.test("extractRecipe honors SDK RetryInfo durations within the retry budget", async () => {
  for (
    const [retryDelay, expectedMs] of [
      ["2s", 2000],
      ["2.5s", 2500],
      ["0s", 0],
      ["0.000000001s", 1],
      ["5s", 5000],
    ] as const
  ) {
    let calls = 0;
    const delays: number[] = [];
    const adapter = new GeminiAdapter({
      generateText: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(rateLimitWithDetails([retryInfo(retryDelay)]));
        assertEquals(delays, [expectedMs], "cooldown must finish before the next call");
        return Promise.resolve(JSON.stringify(VALID_RECIPE));
      },
      log: () => {},
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    await adapter.extractRecipe({ rawText: NOTES });

    assertEquals(calls, 2);
    assertEquals(delays, [expectedMs]);
  }
});

Deno.test("extractRecipe uses jitter for missing or malformed SDK retry metadata", async () => {
  const malformed = [
    undefined,
    null,
    {},
    [],
    [null],
    [retryInfo(undefined)],
    [retryInfo(2)],
    [retryInfo("-1s")],
    [retryInfo("NaNs")],
    [retryInfo("Infinitys")],
    [retryInfo("2 seconds")],
    [retryInfo("0.1234567890s")],
    [{ "@type": "unrelated", retryDelay: "30s" }],
  ];
  for (const errorDetails of malformed) {
    let calls = 0;
    const delays: number[] = [];
    const adapter = new GeminiAdapter({
      generateText: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(rateLimitWithDetails(errorDetails));
        return Promise.resolve(JSON.stringify(VALID_RECIPE));
      },
      log: () => {},
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    await adapter.extractRecipe({ rawText: NOTES });

    assertEquals(calls, 2);
    assertEquals(delays.length, 1);
    assertEquals(Number.isInteger(delays[0]) && delays[0] >= 250 && delays[0] < 500, true);
  }
});

Deno.test("extractRecipe skips retry when the provider cooldown exceeds the budget", async () => {
  for (const retryDelay of ["5.000000001s", "15s", "9".repeat(400) + "s"]) {
    let calls = 0;
    const delays: number[] = [];
    const adapter = new GeminiAdapter({
      generateText: () => {
        calls += 1;
        return Promise.reject(rateLimitWithDetails([retryInfo(retryDelay)]));
      },
      log: () => {},
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    const error = await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

    assertEquals(error.code, "rate_limited");
    assertEquals(calls, 1);
    assertEquals(delays, []);
  }
});

Deno.test("extractRecipe honors the longest valid cooldown and still tries at most twice", async () => {
  let calls = 0;
  const delays: number[] = [];
  const adapter = new GeminiAdapter({
    generateText: () => {
      calls += 1;
      return Promise.reject(
        rateLimitWithDetails([null, retryInfo("bad"), retryInfo("3s"), retryInfo("1s")]),
      );
    },
    log: () => {},
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });

  const error = await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

  assertEquals(error.code, "rate_limited");
  assertEquals(calls, 2);
  assertEquals(delays, [3000]);
});

Deno.test("extractRecipe exposes the provider cooldown as retryAfterSeconds for the AI-05 client", async () => {
  for (
    const [retryDelay, expectedSeconds] of [
      ["15s", 15],
      // Just over the retry budget: still reported, rounded up to whole seconds.
      ["5.000000001s", 6],
      // An overflowing duration clamps to the one-hour ceiling.
      ["9".repeat(400) + "s", 3600],
    ] as const
  ) {
    const adapter = new GeminiAdapter({
      generateText: () => Promise.reject(rateLimitWithDetails([retryInfo(retryDelay)])),
      log: () => {},
      sleep: async () => {},
    });

    const error = await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

    assertEquals(error.code, "rate_limited");
    assertEquals(error.retryAfterSeconds, expectedSeconds);
  }
});

Deno.test("extractRecipe leaves retryAfterSeconds undefined without usable RetryInfo", async () => {
  for (const errorDetails of [undefined, null, [], [null], [retryInfo("bad")], [{ "@type": "type.googleapis.com/google.rpc.Other" }]]) {
    const adapter = new GeminiAdapter({
      generateText: () => Promise.reject(rateLimitWithDetails(errorDetails)),
      log: () => {},
      sleep: async () => {},
    });

    const error = await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

    assertEquals(error.code, "rate_limited");
    assertEquals(error.retryAfterSeconds, undefined);
  }
});

Deno.test("extractRecipe does not retry unexpected local or SDK exceptions", async () => {
  for (
    const unexpected of [
      new Error("local failure with private prompt: " + NOTES),
      new TypeError("Cannot read properties of undefined"),
      new Error("quota calculation failed"),
      new GoogleGenerativeAIError("Unexpected SDK failure"),
      new GoogleGenerativeAIError(
        "Error fetching from https://generativelanguage.googleapis.com/test: local bug",
      ),
      { status: NaN },
      { status: Infinity },
      { status: 200 },
      null,
      "unexpected value",
    ]
  ) {
    let calls = 0;
    const delays: number[] = [];
    const entries: AIOperationLog[] = [];
    const adapter = new GeminiAdapter({
      generateText: () => {
        calls += 1;
        return Promise.reject(unexpected);
      },
      log: (entry) => {
        entries.push(entry);
      },
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    const error = await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

    assertEquals(error.code, "internal_error");
    assertEquals(error.retryable, false);
    assertEquals(calls, 1);
    assertEquals(delays, []);
    assertFalse(error.message.includes(NOTES));
    assertFalse(JSON.stringify(entries).includes(NOTES));
  }
});

Deno.test("extractRecipe retries recognized transport failures including SDK-wrapped fetch errors", async () => {
  for (
    const transportError of [
      new TypeError("fetch failed"),
      new TypeError("Failed to fetch"),
      new TypeError("NetworkError when attempting to fetch resource."),
      new TypeError("error sending request for url (https://example.test): connection closed"),
      Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
      new GoogleGenerativeAIError(
        "Error fetching from https://generativelanguage.googleapis.com/test: fetch failed",
      ),
      new GoogleGenerativeAIError(
        "Error fetching from https://generativelanguage.googleapis.com/test: error sending request for url (https://example.test): connection refused",
      ),
    ]
  ) {
    let calls = 0;
    const adapter = adapterWith(() => {
      calls += 1;
      return Promise.reject(transportError);
    });

    const error = await assertRejects(() => adapter.extractRecipe({ rawText: NOTES }), AIError);

    assertEquals(error.code, "provider_unavailable");
    assertEquals(error.retryable, true);
    assertEquals(calls, 2);
  }
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

Deno.test("extractRecipe does not retry permanent 4xx failures", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    const adapter = adapterWith(async () => {
      calls += 1;
      throw Object.assign(new Error("Request rejected"), { status });
    });

    const error = await assertRejects(
      () => adapter.extractRecipe({ rawText: NOTES }),
      AIError,
    );

    assertEquals(error.code, "provider_rejected");
    assertEquals(error.retryable, false);
    assertEquals(calls, 1, `status ${status} must not be retried`);
  }
});

Deno.test("a 4xx mentioning quota is rejected, not treated as a rate limit", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    throw Object.assign(new Error("Quota exceeded for this project"), { status: 403 });
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "provider_rejected");
  assertEquals(calls, 1);
});

Deno.test("extractRecipe maps a blocked response from response.text() to provider_rejected without retrying", async () => {
  let calls = 0;
  // Exercise the default path: callModel -> generateContent -> response.text().
  const fakeClient = {
    getGenerativeModel: () => ({
      generateContent: () => {
        calls += 1;
        return Promise.resolve({
          response: {
            text: () => {
              // Exactly what the SDK throws on a blocked prompt/candidate:
              // a GoogleGenerativeAIResponseError with no HTTP status.
              throw new GoogleGenerativeAIResponseError("Response was blocked due to SAFETY", {
                promptFeedback: { blockReason: "SAFETY" },
              });
            },
          },
        });
      },
    }),
  } as unknown as GoogleGenerativeAI;

  const adapter = new GeminiAdapter({
    client: fakeClient,
    log: () => {},
    sleep: async () => {},
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "provider_rejected");
  assertEquals(error.retryable, false);
  assertEquals(calls, 1, "a safety block must not consume the bounded retry");
});

Deno.test("both operations classify PROHIBITED_CONTENT as provider_rejected even when text() is empty", async () => {
  const operations: Array<{
    label: string;
    run: (adapter: GeminiAdapter) => Promise<unknown>;
  }> = [
    { label: "extract", run: (adapter) => adapter.extractRecipe({ rawText: NOTES }) },
    {
      label: "generate",
      run: (adapter) => adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT),
    },
  ];

  for (const operation of operations) {
    let calls = 0;
    let textCalls = 0;
    const fakeClient = {
      getGenerativeModel: () => ({
        generateContent: () => {
          calls += 1;
          return Promise.resolve({
            response: {
              // SDK 0.21.0 does not throw for this newer block reason.
              candidates: [{ finishReason: "PROHIBITED_CONTENT", content: { parts: [] } }],
              text: () => {
                textCalls += 1;
                return "";
              },
            },
          });
        },
      }),
    } as unknown as GoogleGenerativeAI;

    const adapter = new GeminiAdapter({
      client: fakeClient,
      log: () => {},
      sleep: async () => {},
    });

    const error = await assertRejects(
      () => operation.run(adapter),
      AIError,
      undefined,
      operation.label,
    );

    assertEquals(error.code, "provider_rejected", operation.label);
    assertEquals(error.retryable, false, operation.label);
    assertEquals(calls, 1, `${operation.label}: a blocked candidate must not be retried`);
    assertEquals(
      textCalls,
      0,
      `${operation.label}: blocked finish reasons must be checked before text()`,
    );
  }
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

Deno.test("extractRecipe treats HTTP 408 as a retryable timeout", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    throw Object.assign(new Error("Request rejected"), { status: 408 });
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "provider_timeout");
  assertEquals(error.retryable, true);
  assertEquals(calls, 2);
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

Deno.test("a throwing log sink cannot trigger a retry", async () => {
  let calls = 0;
  const adapter = new GeminiAdapter({
    generateText: async () => {
      calls += 1;
      return JSON.stringify(VALID_RECIPE);
    },
    log: () => {
      throw new Error("log sink down");
    },
  });

  const recipe = await adapter.extractRecipe({ rawText: NOTES });

  assertEquals(recipe.title, "Boiled Chicken");
  assertEquals(calls, 1);
});

Deno.test("a throwing log sink cannot mask a provider error", async () => {
  let calls = 0;
  const adapter = new GeminiAdapter({
    generateText: async () => {
      calls += 1;
      throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    },
    log: () => {
      throw new Error("log sink down");
    },
    sleep: async () => {},
  });

  const error = await assertRejects(
    () => adapter.extractRecipe({ rawText: NOTES }),
    AIError,
  );

  assertEquals(error.code, "provider_unavailable");
  assertEquals(calls, 2);
});

Deno.test("generateRecipe uses the Chef prompt, candidate IDs and validated output", async () => {
  let prompt = "";
  const logs: AIOperationLog[] = [];
  const adapter = adapterWith(
    async (value) => {
      prompt = value;
      return JSON.stringify(VALID_GENERATED);
    },
    (entry) => logs.push(entry),
  );

  const result = await adapter.generateRecipe(
    { pantryItems: ["rice", "eggs"], preferences: "quick weeknight dinner" },
    MATCHED_CONTEXT,
  );

  assertEquals(result.recipe.title, "Egg Fried Rice");
  assertEquals(result.substitutions, [
    { original: "soy sauce", replacement: "tamari", reason: "gluten-free" },
  ]);
  assertEquals(result.parentRecipeIds, [PARENT_ID]);
  assert(prompt.includes(`[ID: ${PARENT_ID}]`));
  assert(prompt.includes("Available pantry ingredients: rice, eggs"));
  assert(prompt.includes("User preferences: quick weeknight dinner"));
  assert(prompt.includes('Respect the "User preferences" line'));

  assertEquals(logs.length, 1);
  assertEquals(logs[0].op, "generate");
  assertEquals(logs[0].promptId, "chef");
  assertEquals(logs[0].promptVersion, "1.1.0");
  assertFalse(JSON.stringify(logs).includes("Egg Fried Rice"));
});

Deno.test("generateRecipe cold start sends no candidate IDs and accepts no parents", async () => {
  let prompt = "";
  const adapter = adapterWith(async (value) => {
    prompt = value;
    return JSON.stringify({ ...VALID_GENERATED, parentRecipeIds: [] });
  });

  const result = await adapter.generateRecipe({ pantryItems: ["rice", "eggs"] }, COLD_START_CONTEXT);

  assertEquals(result.parentRecipeIds, []);
  assert(prompt.includes("No historical matching recipes available for context."));
  assertFalse(prompt.includes(`[ID: ${PARENT_ID}]`));
});

Deno.test("generateRecipe accepts JSON wrapped in a markdown fence", async () => {
  const adapter = adapterWith(
    async () => "```json\n" + JSON.stringify(VALID_GENERATED) + "\n```",
  );

  const result = await adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT);

  assertEquals(result.recipe.instructions.length, 2);
});

Deno.test("generateRecipe rejects an invented parent ID without retrying", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    return JSON.stringify({ ...VALID_GENERATED, parentRecipeIds: [FOREIGN_PARENT_ID] });
  });

  const error = await assertRejects(
    () => adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(error.detail, "parentRecipeIds");
  assertEquals(error.retryable, false);
  assertEquals(calls, 1);
  assertFalse(error.message.includes(FOREIGN_PARENT_ID));
});

Deno.test("generateRecipe rejects a parent ID when there are no candidates", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    return JSON.stringify(VALID_GENERATED);
  });

  const error = await assertRejects(
    () => adapter.generateRecipe({ pantryItems: ["rice"] }, COLD_START_CONTEXT),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(error.detail, "parentRecipeIds");
  assertEquals(calls, 1);
});

Deno.test("generateRecipe rejects malformed output without retrying", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    return JSON.stringify({ ...VALID_GENERATED, substitutions: undefined });
  });

  const error = await assertRejects(
    () => adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(calls, 1);
});

Deno.test("generateRecipe rejects an orphan substitution without retrying", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    return JSON.stringify({
      ...VALID_GENERATED,
      substitutions: [{ original: "quinoa", replacement: "rice" }],
    });
  });

  const error = await assertRejects(
    () => adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(error.detail, "substitutions.0.original");
  assertEquals(error.retryable, false);
  assertEquals(calls, 1);
});

Deno.test("generateRecipe rejects non-JSON output", async () => {
  const adapter = adapterWith(async () => "Here is a recipe you might like!");

  const error = await assertRejects(
    () => adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
});

Deno.test("generateRecipe retries once after a transient provider failure", async () => {
  let calls = 0;
  const adapter = adapterWith(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    return JSON.stringify(VALID_GENERATED);
  });

  const result = await adapter.generateRecipe({ pantryItems: ["rice"] }, MATCHED_CONTEXT);

  assertEquals(calls, 2);
  assertEquals(result.recipe.title, "Egg Fried Rice");
});

Deno.test("parseGenerationResponse rejects parents outside the supplied set", () => {
  const error = assertThrows(
    () => parseGenerationResponse(JSON.stringify(VALID_GENERATED), new Set()),
    AIError,
  );

  assertEquals(error.code, "invalid_output");
  assertEquals(error.operation, "generate");
});

Deno.test("buildExtractionPrompt inserts notes literally", () => {
  const notes = "Use $& and $1 exactly as written.";

  const prompt = buildExtractionPrompt(notes);

  assertEquals(prompt.includes(notes), true);
});

Deno.test("a blank AI_MODEL falls back to the pinned default model", async () => {
  const previous = Deno.env.get("AI_MODEL");
  const entries: AIOperationLog[] = [];

  Deno.env.set("AI_MODEL", "   ");
  try {
    // The constructor reads AI_MODEL, so build the adapter after setting it.
    const adapter = new GeminiAdapter({
      generateText: async () => JSON.stringify(VALID_RECIPE),
      log: (entry) => entries.push(entry),
    });

    await adapter.extractRecipe({ rawText: NOTES });
  } finally {
    if (previous === undefined) Deno.env.delete("AI_MODEL");
    else Deno.env.set("AI_MODEL", previous);
  }

  assertEquals(entries[0].model, "gemini-3.5-flash-lite");
});

Deno.test("an injected generator does not require an API key", () => {
  const adapter = new GeminiAdapter({ generateText: async () => "{}" });

  assertEquals(adapter instanceof GeminiAdapter, true);
});
