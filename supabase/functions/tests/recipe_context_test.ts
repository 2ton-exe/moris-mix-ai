import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";
import { type AuthContext } from "../_shared/auth.ts";
import {
  buildChefRecipeContext,
  CHEF_CANDIDATE_SELECT_COLUMNS,
  compareOrdinal,
  compareRankedCandidates,
  compareUuidOrdinal,
  computeIngredientOverlap,
  formatChefRecipeContextForPrompt,
  normalizeIngredientName,
  normalizePantryItems,
  rankCandidateRecipes,
  resolveChefRecipeContextForRequest,
  retrieveCandidateRecipes,
  validateAuthContext,
  validateCandidateRecipe,
  type CandidateWithScore,
  type RecipeCandidate,
} from "../_shared/ai/recipeContext.ts";
import {
  ChefContextCandidateSchema,
  ChefContextStatusSchema,
  ChefRecipeContextResultSchema,
  RankedRecipeContextItemSchema,
  type Recipe,
} from "../_shared/ai/schemas.ts";
import {
  isLegacyServiceRoleJwt,
  isLoopbackHost,
  isModernSecretKey,
  KNOWN_PRODUCTION_REF,
} from "../../../run-local-tests.mjs";

const TEST_SUPABASE_URL = "https://mock-be10-test.supabase.co";
const TEST_ANON_KEY = "sb_publishable_mock_be10_anon_key";

const USER_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A_EMAIL = "be10-user-a@morisscraps.test";
const USER_A_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYWFhYWFhYS1hYWFhLTRhYWEtOGFhYS1hYWFhYWFhYWFhYWEiLCJlbWFpbCI6ImJlMTAtdXNlci1hQG1vcmlzc2NyYXBzLnRlc3QiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig_user_a";

const USER_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_B_EMAIL = "be10-user-b@morisscraps.test";
const USER_B_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYmJiYmJiYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJiYmJiYmIiLCJlbWFpbCI6ImJlMTAtdXNlci1iQG1vcmlzc2NyYXBzLnRlc3QiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig_user_b";

const INVALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ.bad_sig";

function mockIng(name: string) {
  return { name, quantity: 1, unit: "piece", inferred: false };
}

function createMockRecipe(overrides: Partial<RecipeCandidate> = {}): RecipeCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: USER_A_ID,
    title: "Garlic Rice",
    ingredients: [mockIng("rice"), mockIng("garlic")],
    instructions: [{ step: 1, text: "Saute garlic and add rice." }],
    flavor_scores: { sweet: 0, salty: 2, sour: 0, bitter: 0, umami: 3, spicy: 0 },
    star_rating: 5,
    created_at: "2026-10-25T10:00:00.000Z",
    ...overrides,
  };
}

function createMockAuth(
  supabase: SupabaseClient,
  userId: string = USER_A_ID,
  role: string | null = "authenticated",
): AuthContext {
  return {
    user: {
      id: userId,
      email: USER_A_EMAIL,
      role,
    },
    supabase,
  };
}

type CapturedQueryCall = {
  table: string;
  selectColumns: string | null;
  eqFilters: Array<[string, unknown]>;
  orFilter: string | null;
  orders: Array<[string, { ascending?: boolean }]>;
  limitValue: number | null;
};

function createRecordingSupabaseMock(options: {
  primaryResponse: { data: unknown; error: { message: string; code?: string } | null };
  probeResponse?: { data: unknown; error: { message: string; code?: string } | null };
  supabaseKey?: string;
}): { client: SupabaseClient; calls: CapturedQueryCall[] } {
  const calls: CapturedQueryCall[] = [];
  let queryIndex = 0;

  const clientObj: Record<string, unknown> = {
    from: (table: string) => {
      const currentIndex = queryIndex++;
      const captured: CapturedQueryCall = {
        table,
        selectColumns: null,
        eqFilters: [],
        orFilter: null,
        orders: [],
        limitValue: null,
      };
      calls.push(captured);

      const builder = {
        select: (cols: string) => {
          captured.selectColumns = cols;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          captured.eqFilters.push([col, val]);
          return builder;
        },
        or: (filter: string) => {
          captured.orFilter = filter;
          return builder;
        },
        order: (col: string, opts: { ascending?: boolean }) => {
          captured.orders.push([col, opts]);
          return builder;
        },
        limit: (n: number) => {
          captured.limitValue = n;
          return builder;
        },
        then: (resolve: (val: unknown) => void) => {
          if (currentIndex === 0) {
            resolve(options.primaryResponse);
          } else {
            resolve(options.probeResponse ?? { data: [], error: null });
          }
        },
      };
      return builder;
    },
  };

  if (options.supabaseKey !== undefined) {
    clientObj.supabaseKey = options.supabaseKey;
  }

  return {
    client: clientObj as unknown as SupabaseClient,
    calls,
  };
}

function getAllPermutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    const remaining = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of getAllPermutations(remaining)) {
      result.push([current, ...perm]);
    }
  }
  return result;
}

Deno.test("normalizeIngredientName trims, lowercases, collapses whitespace, and rejects non-strings", () => {
  assertEquals(normalizeIngredientName("  Fresh   Garlic  "), "fresh garlic");
  assertEquals(normalizeIngredientName("SOY\t\nSAUCE"), "soy sauce");
  assertEquals(normalizeIngredientName(""), "");
  assertThrows(() => normalizeIngredientName(123 as unknown as string), Error, "INVALID_INGREDIENT_NAME");
  assertThrows(() => normalizeIngredientName(null as unknown as string), Error, "INVALID_INGREDIENT_NAME");
});

Deno.test("normalizePantryItems deduplicates, normalizes, and rejects non-array or non-string inputs", () => {
  const input = [" Garlic ", "garlic", "RICE", "  ", "", "rice", "Olive   Oil"];
  assertEquals(normalizePantryItems(input), ["garlic", "rice", "olive oil"]);

  assertThrows(
    () => normalizePantryItems("garlic" as unknown as string[]),
    Error,
    "INVALID_PANTRY_ITEMS",
  );
  assertThrows(
    () => normalizePantryItems(null as unknown as string[]),
    Error,
    "INVALID_PANTRY_ITEMS",
  );
  assertThrows(
    () => normalizePantryItems(["garlic", 42 as unknown as string]),
    Error,
    "INVALID_PANTRY_ITEMS",
  );
});

Deno.test("computeIngredientOverlap calculates accurate ratio, protects against division by zero, and validates inputs", () => {
  const pantrySet = new Set(["garlic", "rice", "salt"]);
  const ingredients = [
    mockIng("Garlic"),
    mockIng("Rice"),
    mockIng("Chicken"),
    mockIng("garlic"),
  ];
  const { ratio, matchedIngredients } = computeIngredientOverlap(ingredients, pantrySet);
  assertEquals(ratio, 2 / 3);
  assertEquals(matchedIngredients, ["garlic", "rice"]);

  assertEquals(computeIngredientOverlap([], pantrySet), { ratio: 0, matchedIngredients: [] });
  const emptyNames = [
    { name: "   ", quantity: null, unit: null, inferred: false },
    { name: "", quantity: null, unit: null, inferred: false },
  ];
  assertEquals(computeIngredientOverlap(emptyNames, pantrySet), { ratio: 0, matchedIngredients: [] });

  assertThrows(
    () => computeIngredientOverlap("garlic" as unknown as Array<{ name: string }>, pantrySet),
    Error,
    "INVALID_INGREDIENTS",
  );
  assertThrows(
    () => computeIngredientOverlap(ingredients, ["garlic"] as unknown as Set<string>),
    Error,
    "INVALID_PANTRY_SET",
  );
});

Deno.test("compareOrdinal and compareUuidOrdinal provide deterministic case-normalized UUID comparison", () => {
  assertEquals(compareOrdinal("apple", "banana"), -1);
  assertEquals(compareOrdinal("banana", "apple"), 1);
  assertEquals(compareOrdinal("same", "same"), 0);

  const lowerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const upperB = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
  assertEquals(compareUuidOrdinal(lowerA, upperB), -1);
  assertEquals(compareUuidOrdinal(upperB, lowerA), 1);
  assertEquals(compareUuidOrdinal(lowerA, lowerA.toUpperCase()), 0);
  assertThrows(() => compareUuidOrdinal("not-a-uuid", lowerA));
});

Deno.test("compareRankedCandidates enforces 4-tier precedence and validates both candidates upfront", () => {
  const itemHigherOverlap: CandidateWithScore = {
    candidate: createMockRecipe({ id: "22222222-2222-4222-8222-222222222222", star_rating: 1 }),
    overlap_ratio: 0.8,
    matched_ingredients: ["garlic"],
  };
  const itemLowerOverlap: CandidateWithScore = {
    candidate: createMockRecipe({ id: "11111111-1111-4111-8111-111111111111", star_rating: 5 }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  assertEquals(compareRankedCandidates(itemHigherOverlap, itemLowerOverlap) < 0, true);

  const itemRated: CandidateWithScore = {
    candidate: createMockRecipe({ id: "11111111-1111-4111-8111-111111111111", star_rating: 1 }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  const itemUnrated: CandidateWithScore = {
    candidate: createMockRecipe({ id: "22222222-2222-4222-8222-222222222222", star_rating: null }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  assertEquals(compareRankedCandidates(itemRated, itemUnrated) < 0, true);
  assertEquals(compareRankedCandidates(itemUnrated, itemRated) > 0, true);

  const itemNewer: CandidateWithScore = {
    candidate: createMockRecipe({
      id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-10-26T00:00:00.000Z",
      star_rating: 5,
    }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  const itemOlder: CandidateWithScore = {
    candidate: createMockRecipe({
      id: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-10-25T00:00:00.000Z",
      star_rating: 5,
    }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  assertEquals(compareRankedCandidates(itemNewer, itemOlder) < 0, true);

  const itemUuidLowerA: CandidateWithScore = {
    candidate: createMockRecipe({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      created_at: "2026-10-25T00:00:00.000Z",
      star_rating: 5,
    }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  const itemUuidUpperB: CandidateWithScore = {
    candidate: createMockRecipe({
      id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
      created_at: "2026-10-25T00:00:00.000Z",
      star_rating: 5,
    }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  assertEquals(compareRankedCandidates(itemUuidLowerA, itemUuidUpperB) < 0, true);

  const invalidTimestampDiffOverlap: CandidateWithScore = {
    candidate: createMockRecipe({ created_at: "not-a-date" }),
    overlap_ratio: 0.9,
    matched_ingredients: ["garlic"],
  };
  assertThrows(
    () => compareRankedCandidates(invalidTimestampDiffOverlap, itemLowerOverlap),
    Error,
    "INVALID_TIMESTAMP",
  );

  const undefinedRatingItem: CandidateWithScore = {
    candidate: createMockRecipe({ star_rating: undefined as unknown as number | null }),
    overlap_ratio: 0.5,
    matched_ingredients: ["garlic"],
  };
  assertThrows(() => compareRankedCandidates(undefinedRatingItem, itemLowerOverlap), Error);
});

Deno.test("rankCandidateRecipes produces identical total order across all 24 input permutations including mixed-case UUIDs and timezone offsets", () => {
  const c1 = createMockRecipe({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    title: "Best Overlap",
    ingredients: [mockIng("garlic"), mockIng("rice")],
    star_rating: 2,
    created_at: "2026-10-20T00:00:00.000Z",
  });
  const c2 = createMockRecipe({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    title: "Half Overlap Rated 5",
    ingredients: [mockIng("garlic"), mockIng("chicken")],
    star_rating: 5,
    created_at: "2026-10-21T10:00:00+02:00",
  });
  const c3 = createMockRecipe({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Half Overlap Rated 5 Same Instant Lower UUID",
    ingredients: [mockIng("rice"), mockIng("chicken")],
    star_rating: 5,
    created_at: "2026-10-21T08:00:00.000Z",
  });
  const c4 = createMockRecipe({
    id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    title: "Half Overlap Rated 5 Same Instant Upper UUID",
    ingredients: [mockIng("garlic"), mockIng("beef")],
    star_rating: 5,
    created_at: "2026-10-21T08:00:00.000Z",
  });

  const expectedIds = [c1.id, c3.id, c4.id, c2.id];
  const permutations = getAllPermutations([c1, c2, c3, c4]);
  assertEquals(permutations.length, 24);

  for (const perm of permutations) {
    const { ranked, matchedCount } = rankCandidateRecipes(perm, ["garlic", "rice"], 10);
    assertEquals(matchedCount, 4);
    assertEquals(ranked.map((r) => r.id), expectedIds);
  }
});

Deno.test("rankCandidateRecipes validates every candidate upfront and rejects invalid topK, timestamps, ratings, UUIDs, and ingredients", () => {
  const valid = createMockRecipe();

  assertThrows(
    () => rankCandidateRecipes([createMockRecipe({ created_at: "not-a-date" })], ["garlic"], 3),
    Error,
    "INVALID_TIMESTAMP",
  );

  assertThrows(
    () =>
      rankCandidateRecipes(
        [
          createMockRecipe({
            id: "11111111-1111-4111-8111-111111111111",
            created_at: "not-a-date",
            ingredients: [mockIng("garlic")],
          }),
          createMockRecipe({
            id: "22222222-2222-4222-8222-222222222222",
            ingredients: [mockIng("garlic"), mockIng("onion")],
          }),
        ],
        ["garlic"],
        3,
      ),
    Error,
    "INVALID_TIMESTAMP",
  );

  assertThrows(
    () => rankCandidateRecipes([createMockRecipe({ created_at: "2026-10-25" })], ["garlic"], 3),
    Error,
    "INVALID_TIMESTAMP",
  );

  assertThrows(
    () => rankCandidateRecipes([createMockRecipe({ created_at: "2026-10-25T10:00:00" })], ["garlic"], 3),
    Error,
    "INVALID_TIMESTAMP",
  );

  assertThrows(
    () =>
      rankCandidateRecipes(
        [
          valid,
          createMockRecipe({
            id: "33333333-3333-4333-8333-333333333333",
            ingredients: [mockIng("unrelated")],
            created_at: "garbage",
          }),
        ],
        ["garlic"],
        3,
      ),
    Error,
    "INVALID_TIMESTAMP",
  );

  for (const badRating of [undefined, 0, 6, 3.5, Number.NaN, Number.POSITIVE_INFINITY, "5"]) {
    assertThrows(() =>
      rankCandidateRecipes(
        [createMockRecipe({ star_rating: badRating as unknown as number | null })],
        ["garlic"],
        3,
      )
    );
  }

  assertThrows(() =>
    rankCandidateRecipes([createMockRecipe({ id: "not-a-uuid" })], ["garlic"], 3)
  );
  assertThrows(() =>
    rankCandidateRecipes([createMockRecipe({ user_id: "not-a-uuid" })], ["garlic"], 3)
  );
  assertThrows(() =>
    rankCandidateRecipes(
      [createMockRecipe({ ingredients: "not-an-array" as unknown as RecipeCandidate["ingredients"] })],
      ["garlic"],
      3,
    )
  );

  for (const invalidTopK of [0, -1, -5, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null]) {
    assertThrows(() =>
      rankCandidateRecipes([valid], ["garlic"], invalidTopK as unknown as number)
    );
  }

  assertEquals(rankCandidateRecipes([valid], ["garlic"], 1).ranked.length, 1);
  assertEquals(rankCandidateRecipes([valid], ["garlic"], 10).ranked.length, 1);
  assertEquals(rankCandidateRecipes([valid], ["garlic"]).ranked.length, 1);
});

Deno.test("rankCandidateRecipes accepts full BE-08 Recipe objects without leaking non-context fields", () => {
  const fullRecipe: Recipe = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: USER_A_ID,
    title: "Full Recipe Contract",
    raw_input: "private raw text",
    notes: "private cooking note",
    ingredients: [mockIng("garlic"), mockIng("rice")],
    instructions: [{ step: 1, text: "Cook." }],
    flavor_scores: null,
    star_rating: 4,
    cooked_at: "2026-10-25",
    image_url: "https://example.com/img.jpg",
    created_at: "2026-10-25T10:00:00.000Z",
    updated_at: "2026-10-25T11:00:00.000Z",
  };

  const { ranked, matchedCount } = rankCandidateRecipes([fullRecipe], ["garlic"], 3);
  assertEquals(matchedCount, 1);
  assertEquals(ranked.length, 1);
  assertEquals("raw_input" in ranked[0], false);
  assertEquals("notes" in ranked[0], false);
  assertEquals("user_id" in ranked[0], false);
  assertEquals("image_url" in ranked[0], false);
});

Deno.test("validateAuthContext rejects invalid user IDs, missing clients, non-authenticated roles, and service-role keys", () => {
  const { client } = createRecordingSupabaseMock({ primaryResponse: { data: [], error: null } });

  assertThrows(
    () => validateAuthContext(createMockAuth(client, "")),
    Error,
    "INVALID_USER_ID",
  );
  assertThrows(
    () => validateAuthContext(createMockAuth(client, "not-a-uuid")),
    Error,
    "INVALID_USER_ID",
  );
  assertThrows(
    () => validateAuthContext(createMockAuth(client, USER_A_ID, "service_role")),
    Error,
    "INVALID_AUTH_CONTEXT",
  );
  assertThrows(
    () => validateAuthContext(createMockAuth(client, USER_A_ID, "anon")),
    Error,
    "INVALID_AUTH_CONTEXT",
  );

  const secretKeyMock = createRecordingSupabaseMock({
    primaryResponse: { data: [], error: null },
    supabaseKey: "sb_secret_live_key_123456",
  });
  assertThrows(
    () => validateAuthContext(createMockAuth(secretKeyMock.client, USER_A_ID)),
    Error,
    "service-role client is prohibited",
  );

  const legacyServiceJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdHJlZiJ9.sig";
  const legacyServiceMock = createRecordingSupabaseMock({
    primaryResponse: { data: [], error: null },
    supabaseKey: legacyServiceJwt,
  });
  assertThrows(
    () => validateAuthContext(createMockAuth(legacyServiceMock.client, USER_A_ID)),
    Error,
    "service-role client is prohibited",
  );
});

Deno.test("retrieveCandidateRecipes enforces exact query filters, required columns, keyset continuation probe, and 0/999/1000/1001 boundaries", async () => {
  const buildBatch = (count: number): RecipeCandidate[] =>
    Array.from({ length: count }, (_, i) => {
      const second = String(59 - Math.floor(i / 20)).padStart(2, "0");
      const hex = i.toString(16).padStart(12, "0");
      return createMockRecipe({
        id: `00000000-0000-4000-8000-${hex}`,
        user_id: USER_A_ID,
        ingredients: [mockIng("rice"), mockIng("onion")],
        star_rating: 3,
        created_at: `2026-10-25T10:00:${second}.000Z`,
      });
    });

  const mock0 = createRecordingSupabaseMock({ primaryResponse: { data: [], error: null } });
  const res0 = await retrieveCandidateRecipes(createMockAuth(mock0.client), 1000);
  assertEquals(res0.candidates.length, 0);
  assertEquals(res0.truncated, false);
  assertEquals(mock0.calls.length, 1);
  assertEquals(mock0.calls[0], {
    table: "recipes",
    selectColumns: CHEF_CANDIDATE_SELECT_COLUMNS,
    eqFilters: [["user_id", USER_A_ID]],
    orFilter: null,
    orders: [
      ["created_at", { ascending: false }],
      ["id", { ascending: true }],
    ],
    limitValue: 1000,
  });

  const rows999 = buildBatch(999);
  const mock999 = createRecordingSupabaseMock({ primaryResponse: { data: rows999, error: null } });
  const res999 = await retrieveCandidateRecipes(createMockAuth(mock999.client), 1000);
  assertEquals(res999.candidates.length, 999);
  assertEquals(res999.truncated, false);
  assertEquals(mock999.calls.length, 1);

  const rows1000 = buildBatch(1000);
  const lastRow = rows1000[999];
  const expectedKeyset =
    `created_at.lt.${lastRow.created_at},and(created_at.eq.${lastRow.created_at},id.gt.${lastRow.id})`;

  const mock1000Exact = createRecordingSupabaseMock({
    primaryResponse: { data: rows1000, error: null },
    probeResponse: { data: [], error: null },
  });
  const res1000Exact = await retrieveCandidateRecipes(createMockAuth(mock1000Exact.client), 1000);
  assertEquals(res1000Exact.candidates.length, 1000);
  assertEquals(res1000Exact.truncated, false);
  assertEquals(mock1000Exact.calls.length, 2);
  assertEquals(mock1000Exact.calls[1], {
    table: "recipes",
    selectColumns: "id, user_id",
    eqFilters: [["user_id", USER_A_ID]],
    orFilter: expectedKeyset,
    orders: [
      ["created_at", { ascending: false }],
      ["id", { ascending: true }],
    ],
    limitValue: 1,
  });

  const row1001Id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const mock1001 = createRecordingSupabaseMock({
    primaryResponse: { data: rows1000, error: null },
    probeResponse: { data: [{ id: row1001Id, user_id: USER_A_ID }], error: null },
  });
  const ctx1001 = await buildChefRecipeContext(
    createMockAuth(mock1001.client),
    { pantryItems: ["rice", "garlic"] },
  );
  assertEquals(ctx1001.totalCandidateCount, 1000);
  assertEquals(ctx1001.truncated, true);
  assertEquals(ctx1001.recipes.some((r) => r.id === row1001Id), false);
});

Deno.test("retrieveCandidateRecipes rejects malformed/null responses, probe errors, owner mismatches, and invalid maxCandidates", async () => {
  const rows1000 = Array.from({ length: 1000 }, (_, i) =>
    createMockRecipe({ id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}` })
  );

  const nullPrimary = createRecordingSupabaseMock({ primaryResponse: { data: null, error: null } });
  await assertRejects(
    () => retrieveCandidateRecipes(createMockAuth(nullPrimary.client), 1000),
    Error,
    "CANDIDATE_RETRIEVAL_FAILED",
  );

  const nonArrayPrimary = createRecordingSupabaseMock({ primaryResponse: { data: {}, error: null } });
  await assertRejects(
    () => retrieveCandidateRecipes(createMockAuth(nonArrayPrimary.client), 1000),
    Error,
    "CANDIDATE_RETRIEVAL_FAILED",
  );

  const mismatchPrimary = createRecordingSupabaseMock({
    primaryResponse: { data: [createMockRecipe({ user_id: USER_B_ID })], error: null },
  });
  await assertRejects(
    () => retrieveCandidateRecipes(createMockAuth(mismatchPrimary.client), 1000),
    Error,
    "OWNER_MISMATCH_DETECTED",
  );

  const errorProbe = createRecordingSupabaseMock({
    primaryResponse: { data: rows1000, error: null },
    probeResponse: { data: null, error: { message: "Probe timeout", code: "57014" } },
  });
  await assertRejects(
    () => retrieveCandidateRecipes(createMockAuth(errorProbe.client), 1000),
    Error,
    "PROBE_QUERY_FAILED",
  );

  const nullProbe = createRecordingSupabaseMock({
    primaryResponse: { data: rows1000, error: null },
    probeResponse: { data: null, error: null },
  });
  await assertRejects(
    () => retrieveCandidateRecipes(createMockAuth(nullProbe.client), 1000),
    Error,
    "PROBE_QUERY_FAILED",
  );

  const mismatchProbe = createRecordingSupabaseMock({
    primaryResponse: { data: rows1000, error: null },
    probeResponse: {
      data: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", user_id: USER_B_ID }],
      error: null,
    },
  });
  await assertRejects(
    () => retrieveCandidateRecipes(createMockAuth(mismatchProbe.client), 1000),
    Error,
    "OWNER_MISMATCH_DETECTED",
  );

  for (const badMax of [0, -1, 2.5, 1001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null]) {
    await assertRejects(() =>
      retrieveCandidateRecipes(createMockAuth(nullPrimary.client), badMax as unknown as number)
    );
  }
});

Deno.test("buildChefRecipeContext accepts input size limits and preserves preferences through ranking and prompt formatting", async () => {
  const pantryItems = Array.from({ length: 100 }, (_, index) =>
    ` Ingredient ${index} `.padEnd(100, " ")
  );
  const preferences = ` ${"p".repeat(998)} `;
  const mock = createRecordingSupabaseMock({
    primaryResponse: {
      data: [createMockRecipe({ ingredients: [mockIng("ingredient 0")] })],
      error: null,
    },
  });

  const result = await buildChefRecipeContext(createMockAuth(mock.client), {
    pantryItems,
    preferences,
  });

  assertEquals(result.status, "MATCHED");
  assertEquals(result.pantryItems, pantryItems.map((_, index) => `ingredient ${index}`));
  assertEquals(result.preferences, preferences);
  assertEquals(mock.calls.length, 1);
  const prompt = formatChefRecipeContextForPrompt(result);
  assertEquals(prompt.includes(`Available pantry ingredients: ${result.pantryItems.join(", ")}`), true);
  assertEquals(prompt.includes(`User preferences: ${preferences.trim()}`), true);
});

Deno.test("buildChefRecipeContext rejects oversized or unknown input before recipe retrieval", async () => {
  const mock = createRecordingSupabaseMock({ primaryResponse: { data: [], error: null } });
  const auth = createMockAuth(mock.client);

  for (const input of [
    { pantryItems: Array.from({ length: 101 }, () => "garlic") },
    { pantryItems: ["g".repeat(101)] },
    { pantryItems: [" ".repeat(101)] },
    { pantryItems: [], preferences: "p".repeat(1001) },
    { pantryItems: [], unexpected: true },
  ]) {
    const error = await assertRejects(() => buildChefRecipeContext(auth, input), Error);
    assertEquals(error.name, "ZodError");
    assertEquals(mock.calls, []);
  }
});

Deno.test("buildChefRecipeContext enforces strict cold-start precedence, preserves preferences, and rejects corrupt candidates in cold-start paths", async () => {
  const makeAuthWithRows = (rows: unknown[]) =>
    createMockAuth(
      createRecordingSupabaseMock({ primaryResponse: { data: rows, error: null } }).client,
    );

  const resSimultaneousZeroAndEmpty = await buildChefRecipeContext(
    makeAuthWithRows([]),
    { pantryItems: ["   ", ""], preferences: "nut-free" },
  );
  assertEquals(resSimultaneousZeroAndEmpty.status, "NO_SAVED_RECIPES");
  assertEquals(resSimultaneousZeroAndEmpty.pantryItems, []);
  assertEquals(resSimultaneousZeroAndEmpty.preferences, "nut-free");
  assertEquals(resSimultaneousZeroAndEmpty.totalCandidateCount, 0);
  assertEquals(resSimultaneousZeroAndEmpty.matchedCandidateCount, 0);
  assertEquals(resSimultaneousZeroAndEmpty.truncated, false);

  const resNoRecipes = await buildChefRecipeContext(
    makeAuthWithRows([]),
    { pantryItems: [" Garlic "], preferences: "low sodium" },
  );
  assertEquals(resNoRecipes.status, "NO_SAVED_RECIPES");
  assertEquals(resNoRecipes.pantryItems, ["garlic"]);
  assertEquals(resNoRecipes.preferences, "low sodium");

  const savedRecipe = createMockRecipe({
    ingredients: [mockIng("pasta"), mockIng("tomato sauce")],
  });

  const resEmptyPantry = await buildChefRecipeContext(
    makeAuthWithRows([savedRecipe]),
    { pantryItems: ["   ", ""], preferences: "vegetarian" },
  );
  assertEquals(resEmptyPantry.status, "EMPTY_PANTRY");
  assertEquals(resEmptyPantry.recipes, []);
  assertEquals(resEmptyPantry.totalCandidateCount, 1);
  assertEquals(resEmptyPantry.matchedCandidateCount, 0);
  assertEquals(resEmptyPantry.pantryItems, []);
  assertEquals(resEmptyPantry.preferences, "vegetarian");

  await assertRejects(
    () =>
      buildChefRecipeContext(
        makeAuthWithRows([createMockRecipe({ created_at: "garbage" })]),
        { pantryItems: [] },
      ),
    Error,
    "INVALID_TIMESTAMP",
  );

  const resNoOverlap = await buildChefRecipeContext(
    makeAuthWithRows([savedRecipe]),
    { pantryItems: ["garlic", "shallots"] },
  );
  assertEquals(resNoOverlap.status, "NO_PANTRY_OVERLAP");
  assertEquals(resNoOverlap.recipes, []);
  assertEquals(resNoOverlap.totalCandidateCount, 1);
  assertEquals(resNoOverlap.matchedCandidateCount, 0);
  assertEquals(resNoOverlap.pantryItems, ["garlic", "shallots"]);
  assertEquals(resNoOverlap.preferences, undefined);

  const matchingRecipe = createMockRecipe({
    id: "22222222-2222-4222-8222-222222222222",
    title: "Pasta with Garlic",
    ingredients: [mockIng("pasta"), mockIng("garlic")],
  });
  const resMatched = await buildChefRecipeContext(
    makeAuthWithRows([savedRecipe, matchingRecipe]),
    { pantryItems: ["garlic", "olive oil"], preferences: "quick meal" },
  );
  assertEquals(resMatched.status, "MATCHED");
  assertEquals(resMatched.recipes.length, 1);
  assertEquals(resMatched.recipes[0].title, "Pasta with Garlic");
  assertEquals(resMatched.totalCandidateCount, 2);
  assertEquals(resMatched.matchedCandidateCount, 1);
  assertEquals(resMatched.preferences, "quick meal");

  await assertRejects(() =>
    buildChefRecipeContext(
      makeAuthWithRows([matchingRecipe]),
      { pantryItems: "garlic" as unknown as string[] },
    )
  );
  await assertRejects(() =>
    buildChefRecipeContext(
      makeAuthWithRows([matchingRecipe]),
      { pantryItems: ["garlic"] },
      { topK: Number.NaN },
    )
  );
  await assertRejects(() =>
    buildChefRecipeContext(
      makeAuthWithRows([matchingRecipe]),
      { pantryItems: ["garlic"] },
      { maxCandidates: 0 },
    )
  );
});

Deno.test("buildChefRecipeContext propagates database errors without converting to cold start", async () => {
  const failingMock = createRecordingSupabaseMock({
    primaryResponse: { data: null, error: { message: "Connection refused", code: "500" } },
  });

  await assertRejects(
    () => buildChefRecipeContext(createMockAuth(failingMock.client), { pantryItems: ["garlic"] }),
    Error,
    "CANDIDATE_RETRIEVAL_FAILED",
  );
});

Deno.test("resolveChefRecipeContextForRequest enforces BE-04 authentication and multi-user PostgREST isolation", async () => {
  const allStoreRows: RecipeCandidate[] = [
    createMockRecipe({
      id: "11111111-1111-4111-8111-111111111111",
      user_id: USER_A_ID,
      title: "User A Garlic Soup",
      ingredients: [mockIng("garlic"), mockIng("broth")],
      star_rating: 4,
    }),
    createMockRecipe({
      id: "22222222-2222-4222-8222-222222222222",
      user_id: USER_B_ID,
      title: "User B Private Garlic Rice",
      ingredients: [mockIng("garlic"), mockIng("rice")],
      star_rating: 5,
    }),
  ];

  let postgrestCalls = 0;
  const capturedUrls: URL[] = [];

  const mockFetch: typeof fetch = (input, init) => {
    const rawUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const url = new URL(rawUrl);
    const headers = new Headers(init?.headers);
    const authHeader = headers.get("authorization") ?? "";

    if (url.pathname === "/auth/v1/user") {
      if (authHeader === `Bearer ${USER_A_JWT}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: USER_A_ID,
              aud: "authenticated",
              role: "authenticated",
              email: USER_A_EMAIL,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (authHeader === `Bearer ${USER_B_JWT}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: USER_B_ID,
              aud: "authenticated",
              role: "authenticated",
              email: USER_B_EMAIL,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ error_code: "invalid_jwt", message: "Invalid JWT" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    if (url.pathname === "/rest/v1/recipes") {
      postgrestCalls++;
      capturedUrls.push(url);
      const rlsOwner = authHeader === `Bearer ${USER_A_JWT}`
        ? USER_A_ID
        : authHeader === `Bearer ${USER_B_JWT}`
        ? USER_B_ID
        : "";
      const filterUserId = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      const visible = allStoreRows.filter(
        (r) => r.user_id === rlsOwner && (!filterUserId || r.user_id === filterUserId),
      );
      return Promise.resolve(
        new Response(JSON.stringify(visible), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const authDeps = {
    supabaseUrl: TEST_SUPABASE_URL,
    supabaseAnonKey: TEST_ANON_KEY,
    fetch: mockFetch,
  };

  const unauthReq = new Request("http://localhost/functions/v1/chef-context", { method: "POST" });
  const unauthRes = await resolveChefRecipeContextForRequest(
    unauthReq,
    { pantryItems: ["garlic", "rice"] },
    undefined,
    authDeps,
  );
  assertEquals(unauthRes.ok, false);
  if (!unauthRes.ok) {
    assertEquals(unauthRes.response.status, 401);
  }
  assertEquals(postgrestCalls, 0);

  const badJwtReq = new Request("http://localhost/functions/v1/chef-context", {
    method: "POST",
    headers: { Authorization: `Bearer ${INVALID_JWT}` },
  });
  const badJwtRes = await resolveChefRecipeContextForRequest(
    badJwtReq,
    { pantryItems: ["garlic", "rice"] },
    undefined,
    authDeps,
  );
  assertEquals(badJwtRes.ok, false);
  if (!badJwtRes.ok) {
    assertEquals(badJwtRes.response.status, 401);
  }
  assertEquals(postgrestCalls, 0);

  const userAReq = new Request("http://localhost/functions/v1/chef-context", {
    method: "POST",
    headers: { Authorization: `Bearer ${USER_A_JWT}` },
  });
  const userARes = await resolveChefRecipeContextForRequest(
    userAReq,
    { pantryItems: ["garlic", "rice"], preferences: "savory" },
    undefined,
    authDeps,
  );
  assertEquals(userARes.ok, true);
  if (userARes.ok) {
    assertEquals(userARes.data.status, "MATCHED");
    assertEquals(userARes.data.totalCandidateCount, 1);
    assertEquals(userARes.data.matchedCandidateCount, 1);
    assertEquals(userARes.data.recipes.length, 1);
    assertEquals(userARes.data.recipes[0].id, "11111111-1111-4111-8111-111111111111");
    assertEquals(userARes.data.recipes[0].title, "User A Garlic Soup");
    assertEquals(userARes.data.preferences, "savory");
  }
  assertEquals(postgrestCalls, 1);
  assertEquals(capturedUrls[0].searchParams.get("user_id"), `eq.${USER_A_ID}`);
  assertEquals(capturedUrls[0].searchParams.get("order"), "created_at.desc,id.asc");
  assertEquals(capturedUrls[0].searchParams.get("limit"), "1000");
});

Deno.test("formatChefRecipeContextForPrompt formats cold-start and matched states and validates context invariants", () => {
  const coldStartContext = {
    status: "NO_PANTRY_OVERLAP" as const,
    pantryItems: ["garlic", "shallots"],
    preferences: "gluten-free",
    recipes: [],
    totalCandidateCount: 5,
    matchedCandidateCount: 0,
    truncated: false,
  };
  const promptCold = formatChefRecipeContextForPrompt(coldStartContext);
  assertEquals(promptCold.includes("Available pantry ingredients: garlic, shallots"), true);
  assertEquals(promptCold.includes("User preferences: gluten-free"), true);
  assertEquals(promptCold.includes("No historical matching recipes available for context."), true);

  const matchedContext = {
    status: "MATCHED" as const,
    pantryItems: ["garlic", "rice"],
    recipes: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Garlic Fried Rice",
        ingredients: [
          { name: "rice", quantity: 1, unit: "cup", inferred: false },
          { name: "garlic", quantity: 2, unit: "cloves", inferred: false },
        ],
        instructions: [{ step: 1, text: "Fry garlic." }, { step: 2, text: "Toss rice." }],
        flavor_scores: null,
        star_rating: 5,
        created_at: "2026-10-25T00:00:00.000Z",
        overlap_ratio: 1,
        matched_ingredients: ["garlic", "rice"],
      },
    ],
    totalCandidateCount: 1,
    matchedCandidateCount: 1,
    truncated: false,
  };
  const promptMatched = formatChefRecipeContextForPrompt(matchedContext);
  assertEquals(promptMatched.includes("Relevant historical recipes (1 matching favorites):"), true);
  assertEquals(
    promptMatched.includes('Recipe 1: "Garlic Fried Rice" (Pantry match: 100%, Star rating: 5)'),
    true,
  );
  assertEquals(
    promptMatched.includes("[ID: 11111111-1111-4111-8111-111111111111]"),
    true,
  );
  assertEquals(promptMatched.includes("1. Fry garlic. 2. Toss rice."), true);
});

Deno.test("Chef context Zod schemas enforce strict candidate and cross-field state invariants", () => {
  assertEquals(ChefContextStatusSchema.safeParse("MATCHED").success, true);
  assertEquals(ChefContextStatusSchema.safeParse("INVALID").success, false);
  assertEquals(ChefContextCandidateSchema.safeParse(createMockRecipe()).success, true);
  assertEquals(
    ChefContextCandidateSchema.safeParse(createMockRecipe({ created_at: "not-a-date" })).success,
    false,
  );

  const validRankedItem = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Garlic Rice",
    ingredients: [mockIng("garlic")],
    instructions: [{ step: 1, text: "Cook." }],
    flavor_scores: null,
    star_rating: 4,
    created_at: "2026-10-25T10:00:00.000Z",
    overlap_ratio: 1,
    matched_ingredients: ["garlic"],
  };
  assertEquals(RankedRecipeContextItemSchema.safeParse(validRankedItem).success, true);
  assertEquals(
    RankedRecipeContextItemSchema.safeParse({ ...validRankedItem, overlap_ratio: 0 }).success,
    false,
  );
  assertEquals(
    RankedRecipeContextItemSchema.safeParse({ ...validRankedItem, matched_ingredients: [] }).success,
    false,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "MATCHED",
      pantryItems: ["garlic"],
      preferences: "vegan",
      recipes: [validRankedItem],
      totalCandidateCount: 2,
      matchedCandidateCount: 1,
      truncated: false,
    }).success,
    true,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "MATCHED",
      pantryItems: ["rice"],
      preferences: "vegan",
      recipes: [],
      totalCandidateCount: 10,
      matchedCandidateCount: 0,
      truncated: false,
    }).success,
    false,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "MATCHED",
      pantryItems: ["rice"],
      recipes: [],
      totalCandidateCount: 3,
      matchedCandidateCount: 3,
      truncated: false,
    }).success,
    false,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "NO_SAVED_RECIPES",
      pantryItems: ["rice"],
      recipes: [],
      totalCandidateCount: 1,
      matchedCandidateCount: 0,
      truncated: false,
    }).success,
    false,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "NO_SAVED_RECIPES",
      pantryItems: [],
      recipes: [],
      totalCandidateCount: 0,
      matchedCandidateCount: 0,
      truncated: true,
    }).success,
    false,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "EMPTY_PANTRY",
      pantryItems: ["garlic"],
      recipes: [],
      totalCandidateCount: 2,
      matchedCandidateCount: 0,
      truncated: false,
    }).success,
    false,
  );

  assertEquals(
    ChefRecipeContextResultSchema.safeParse({
      status: "NO_PANTRY_OVERLAP",
      pantryItems: ["garlic"],
      recipes: [],
      totalCandidateCount: 2,
      matchedCandidateCount: 1,
      truncated: false,
    }).success,
    false,
  );
});

type HostedRlsConfig =
  | { shouldRun: false }
  | {
    shouldRun: true;
    error?: string;
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    expectedProjectRef: string;
  };

function resolveBe10HostedRlsConfig(
  getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k),
): HostedRlsConfig {
  const isRequired =
    (getEnv("REQUIRE_HOSTED_RLS_INTEGRATION") ?? "").trim().toLowerCase() === "true" ||
    (getEnv("HOSTED_RLS_REQUIRED") ?? "").trim().toLowerCase() === "true";
  const nonProdFlag = (getEnv("RUN_NON_PRODUCTION_TEST_DATABASE_RLS_INTEGRATION") ?? "")
    .trim()
    .toLowerCase();
  const be10Flag = (getEnv("RUN_BE10_RLS_INTEGRATION") ?? "").trim().toLowerCase();
  const optedIn =
    isRequired ||
    nonProdFlag === "true" ||
    nonProdFlag === "1" ||
    be10Flag === "true" ||
    be10Flag === "1";

  if (!optedIn) {
    return { shouldRun: false };
  }

  const url = getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL")?.trim() || "";
  const anonKey =
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY")?.trim() ||
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    "";
  const serviceRoleKey =
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    getEnv("NON_PRODUCTION_TEST_DATABASE_SUPABASE_SECRET_KEY")?.trim() ||
    "";
  const expectedProjectRef =
    getEnv("NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF")?.trim() ||
    getEnv("NON_PRODUCTION_TEST_DATABASE_PROJECT_REF")?.trim() ||
    "";

  const missing: string[] = [];
  if (!url) missing.push("NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL");
  if (!anonKey) missing.push("NON_PRODUCTION_TEST_DATABASE_SUPABASE_ANON_KEY");
  if (!serviceRoleKey) missing.push("NON_PRODUCTION_TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY");
  if (!expectedProjectRef) missing.push("NON_PRODUCTION_TEST_DATABASE_EXPECTED_PROJECT_REF");

  if (missing.length > 0) {
    return {
      shouldRun: true,
      error: `Dedicated non-production RLS test credentials are incomplete: missing ${missing.join(", ")}.`,
      url,
      anonKey,
      serviceRoleKey,
      expectedProjectRef,
    };
  }

  return {
    shouldRun: true,
    url,
    anonKey,
    serviceRoleKey,
    expectedProjectRef,
  };
}

function validateBe10DedicatedTestTarget(
  targetUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  expectedProjectRef: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    throw new Error("Safety guard rejected test target: invalid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Safety guard rejected test target: HTTPS required.");
  }
  if (isLoopbackHost(parsed.hostname)) {
    throw new Error("Safety guard rejected test target: loopback prohibited.");
  }
  const match = parsed.hostname.toLowerCase().match(/^([a-z0-9-]+)\.supabase\.(?:co|net)$/);
  const derivedRef = match ? match[1] : null;
  if (!derivedRef || derivedRef !== expectedProjectRef.trim().toLowerCase()) {
    throw new Error("Safety guard rejected test target: project ref mismatch.");
  }
  if (
    derivedRef === KNOWN_PRODUCTION_REF.toLowerCase() ||
    targetUrl.toLowerCase().includes(KNOWN_PRODUCTION_REF.toLowerCase())
  ) {
    throw new Error("Safety guard rejected test target: refuses to run against production.");
  }
  if (anonKey.trim() === serviceRoleKey.trim()) {
    throw new Error("Safety guard rejected test keys: anon key must not match service role key.");
  }
}

function redactSecrets(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length > 0) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  return out;
}

function createHostedRlsClient(url: string, key: string, bearerJwt?: string): SupabaseClient {
  const trimmedKey = key.trim();
  const isModern =
    trimmedKey.startsWith("sb_secret_") || trimmedKey.startsWith("sb_publishable_");
  const customFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (isModern && !bearerJwt) {
      const auth = headers.get("authorization");
      if (auth && auth.trim().toLowerCase() === `bearer ${trimmedKey.toLowerCase()}`) {
        headers.delete("authorization");
      }
    }
    return fetch(input, { ...init, headers });
  };

  return createClient(url, trimmedKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: bearerJwt ? { Authorization: `Bearer ${bearerJwt}` } : {},
      fetch: customFetch,
    },
  });
}

Deno.test("BE-10 hosted RLS configuration and target safety guards reject production, loopback, and missing required credentials", () => {
  assertEquals(resolveBe10HostedRlsConfig(() => undefined).shouldRun, false);

  const missingReq = resolveBe10HostedRlsConfig((k) =>
    k === "REQUIRE_HOSTED_RLS_INTEGRATION" ? "true" : undefined
  );
  assertEquals(missingReq.shouldRun, true);
  if (missingReq.shouldRun) {
    assertNotEquals(missingReq.error, undefined);
  }

  assertThrows(
    () =>
      validateBe10DedicatedTestTarget(
        `https://${KNOWN_PRODUCTION_REF}.supabase.co`,
        "anon-k",
        "service-k",
        KNOWN_PRODUCTION_REF,
      ),
    Error,
    "production",
  );
  assertThrows(
    () =>
      validateBe10DedicatedTestTarget(
        "https://localhost:54321",
        "anon-k",
        "service-k",
        "test-ref",
      ),
    Error,
    "loopback",
  );
});

const activeBe10RlsConfig = resolveBe10HostedRlsConfig();

Deno.test({
  name: "Live PostgreSQL cross-user RLS isolation for AI Chef recipe context retrieval (hosted integration)",
  ignore: !activeBe10RlsConfig.shouldRun,
  fn: async () => {
    if (!activeBe10RlsConfig.shouldRun) return;
    if (activeBe10RlsConfig.error) {
      throw new Error(activeBe10RlsConfig.error);
    }

    validateBe10DedicatedTestTarget(
      activeBe10RlsConfig.url,
      activeBe10RlsConfig.anonKey,
      activeBe10RlsConfig.serviceRoleKey,
      activeBe10RlsConfig.expectedProjectRef,
    );

    const knownSecrets: string[] = [
      activeBe10RlsConfig.anonKey,
      activeBe10RlsConfig.serviceRoleKey,
    ];
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const userAEmail = `be10-a-${runId}@morisscraps.test`;
    const userBEmail = `be10-b-${runId}@morisscraps.test`;
    const userAPassword = `PassA!${crypto.randomUUID()}9`;
    const userBPassword = `PassB!${crypto.randomUUID()}9`;
    knownSecrets.push(userAPassword, userBPassword);

    const adminClient = createHostedRlsClient(
      activeBe10RlsConfig.url,
      activeBe10RlsConfig.serviceRoleKey,
    );
    const createdUserIds: string[] = [];
    const createdRecipeIds: string[] = [];
    let primaryError: Error | null = null;

    try {
      const { data: userARes, error: errA } = await adminClient.auth.admin.createUser({
        email: userAEmail,
        password: userAPassword,
        email_confirm: true,
      });
      if (errA || !userARes?.user?.id) {
        throw new Error(`Failed creating test user A: ${errA?.message}`);
      }
      const userAId = userARes.user.id;
      createdUserIds.push(userAId);

      const { data: userBRes, error: errB } = await adminClient.auth.admin.createUser({
        email: userBEmail,
        password: userBPassword,
        email_confirm: true,
      });
      if (errB || !userBRes?.user?.id) {
        throw new Error(`Failed creating test user B: ${errB?.message}`);
      }
      const userBId = userBRes.user.id;
      createdUserIds.push(userBId);

      const anonClient = createHostedRlsClient(
        activeBe10RlsConfig.url,
        activeBe10RlsConfig.anonKey,
      );
      const { data: signInA, error: errSignA } = await anonClient.auth.signInWithPassword({
        email: userAEmail,
        password: userAPassword,
      });
      if (errSignA || !signInA?.session?.access_token) {
        throw new Error(`Failed signing in test user A: ${errSignA?.message}`);
      }
      const userAJwt = signInA.session.access_token;
      knownSecrets.push(userAJwt);

      const { data: signInB, error: errSignB } = await anonClient.auth.signInWithPassword({
        email: userBEmail,
        password: userBPassword,
      });
      if (errSignB || !signInB?.session?.access_token) {
        throw new Error(`Failed signing in test user B: ${errSignB?.message}`);
      }
      const userBJwt = signInB.session.access_token;
      knownSecrets.push(userBJwt);

      const rlsClientA = createHostedRlsClient(
        activeBe10RlsConfig.url,
        activeBe10RlsConfig.anonKey,
        userAJwt,
      );
      const rlsClientB = createHostedRlsClient(
        activeBe10RlsConfig.url,
        activeBe10RlsConfig.anonKey,
        userBJwt,
      );

      assertEquals(
        isLegacyServiceRoleJwt(activeBe10RlsConfig.anonKey) ||
          isModernSecretKey(activeBe10RlsConfig.anonKey),
        false,
      );

      const { data: recipeARow, error: errInsertA } = await rlsClientA
        .from("recipes")
        .insert({
          user_id: userAId,
          title: "User A Garlic Pasta",
          ingredients: [mockIng("garlic"), mockIng("pasta")],
          instructions: [{ step: 1, text: "Boil pasta with garlic." }],
          flavor_scores: null,
          star_rating: 4,
        })
        .select("id")
        .single();
      if (errInsertA || !recipeARow?.id) {
        throw new Error(`Failed inserting User A recipe: ${errInsertA?.message}`);
      }
      createdRecipeIds.push(recipeARow.id);

      const { data: recipeBRow, error: errInsertB } = await rlsClientB
        .from("recipes")
        .insert({
          user_id: userBId,
          title: "User B Secret Truffle Garlic Rice",
          ingredients: [mockIng("garlic"), mockIng("rice")],
          instructions: [{ step: 1, text: "Private recipe." }],
          flavor_scores: null,
          star_rating: 5,
        })
        .select("id")
        .single();
      if (errInsertB || !recipeBRow?.id) {
        throw new Error(`Failed inserting User B recipe: ${errInsertB?.message}`);
      }
      createdRecipeIds.push(recipeBRow.id);

      const reqA = new Request("http://localhost/functions/v1/chef-context", {
        method: "POST",
        headers: { Authorization: `Bearer ${userAJwt}` },
      });
      const resA = await resolveChefRecipeContextForRequest(
        reqA,
        { pantryItems: ["garlic", "rice"], preferences: "dinner" },
        undefined,
        {
          supabaseUrl: activeBe10RlsConfig.url,
          supabaseAnonKey: activeBe10RlsConfig.anonKey,
        },
      );

      assertEquals(resA.ok, true);
      if (resA.ok) {
        assertEquals(resA.data.status, "MATCHED");
        assertEquals(resA.data.totalCandidateCount, 1);
        assertEquals(resA.data.matchedCandidateCount, 1);
        assertEquals(resA.data.recipes.length, 1);
        assertEquals(resA.data.recipes[0].id, recipeARow.id);
        assertEquals(resA.data.recipes.some((r) => r.id === recipeBRow.id), false);
        assertEquals(resA.data.preferences, "dinner");
      }
    } catch (err) {
      primaryError = err instanceof Error
        ? new Error(redactSecrets(err.message, knownSecrets))
        : new Error(redactSecrets(String(err), knownSecrets));
    } finally {
      const cleanupErrors: string[] = [];
      if (createdRecipeIds.length > 0) {
        const { error } = await adminClient.from("recipes").delete().in("id", createdRecipeIds);
        if (error) {
          cleanupErrors.push(redactSecrets(error.message, knownSecrets));
        }
      }
      for (const uid of createdUserIds) {
        await adminClient.from("profiles").delete().eq("id", uid);
        const { error } = await adminClient.auth.admin.deleteUser(uid);
        if (error) {
          cleanupErrors.push(redactSecrets(error.message, knownSecrets));
        }
      }
      if (primaryError && cleanupErrors.length > 0) {
        throw new Error(`${primaryError.message} | Cleanup: ${cleanupErrors.join("; ")}`);
      }
      if (primaryError) {
        throw primaryError;
      }
      if (cleanupErrors.length > 0) {
        throw new Error(`Cleanup failed: ${cleanupErrors.join("; ")}`);
      }
    }
  },
});
