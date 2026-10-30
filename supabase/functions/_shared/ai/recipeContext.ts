import {
  authenticateRequest,
  type AuthContext,
  type AuthDeps,
} from "../auth.ts";
import { type GenerateRecipeInput } from "./AIProvider.ts";
import {
  ChefContextCandidateSchema,
  ChefMaxCandidatesSchema,
  ChefRecipeContextInputSchema,
  ChefRecipeContextOptionsSchema,
  ChefRecipeContextResultSchema,
  ChefTopKSchema,
  RankedRecipeContextItemSchema,
  RecipeIdParamSchema,
  type ChefContextCandidate,
  type ChefRecipeContextResult,
  type RankedRecipeContextItem,
} from "./schemas.ts";

export type RecipeCandidate = ChefContextCandidate;

export const CHEF_CANDIDATE_SELECT_COLUMNS =
  "id, user_id, title, ingredients, instructions, flavor_scores, star_rating, created_at";

export type BuildChefRecipeContextOptions = {
  topK?: number;
  maxCandidates?: number;
};

export type RequestChefRecipeContextResult =
  | { ok: true; data: ChefRecipeContextResult }
  | { ok: false; response: Response };

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isServiceRoleKeyValue(key: unknown): boolean {
  if (typeof key !== "string") {
    return false;
  }
  const trimmed = key.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.toLowerCase().startsWith("sb_secret_")) {
    return true;
  }
  const parts = trimmed.split(".");
  if (parts.length === 3 && parts[1]) {
    const payload = decodeBase64UrlJson(parts[1]);
    if (payload?.role === "service_role") {
      return true;
    }
  }
  return false;
}

export function validateAuthContext(
  auth: AuthContext,
): { userId: string; supabase: AuthContext["supabase"] } {
  if (!auth || typeof auth !== "object") {
    throw new Error("INVALID_AUTH_CONTEXT: missing authentication context");
  }

  if (
    !auth.supabase ||
    typeof auth.supabase !== "object" ||
    typeof auth.supabase.from !== "function"
  ) {
    throw new Error("INVALID_AUTH_CONTEXT: missing caller-scoped Supabase client");
  }

  const clientKey = (auth.supabase as unknown as { supabaseKey?: unknown }).supabaseKey;
  if (isServiceRoleKeyValue(clientKey)) {
    throw new Error("INVALID_AUTH_CONTEXT: service-role client is prohibited");
  }

  if (!auth.user || typeof auth.user !== "object") {
    throw new Error("INVALID_AUTH_CONTEXT: missing authenticated user");
  }

  if (
    auth.user.role !== null &&
    auth.user.role !== undefined &&
    auth.user.role !== "authenticated"
  ) {
    throw new Error("INVALID_AUTH_CONTEXT: authenticated user role required");
  }

  const parsedUserId = RecipeIdParamSchema.safeParse(auth.user.id);
  if (!parsedUserId.success) {
    throw new Error("INVALID_USER_ID: user.id must be a valid UUID");
  }

  return {
    userId: parsedUserId.data,
    supabase: auth.supabase,
  };
}

export function compareOrdinal(a: string, b: string): number {
  if (typeof a !== "string" || typeof b !== "string") {
    throw new Error("INVALID_ORDINAL_INPUT");
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function compareUuidOrdinal(a: string, b: string): number {
  const validA = RecipeIdParamSchema.parse(a);
  const validB = RecipeIdParamSchema.parse(b);
  return compareOrdinal(validA.toLowerCase(), validB.toLowerCase());
}

export function normalizeIngredientName(name: string): string {
  if (typeof name !== "string") {
    throw new Error("INVALID_INGREDIENT_NAME: expected string");
  }
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePantryItems(items: string[]): string[] {
  if (!Array.isArray(items)) {
    throw new Error("INVALID_PANTRY_ITEMS: expected array of strings");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") {
      throw new Error("INVALID_PANTRY_ITEMS: expected string elements");
    }
    const normalized = normalizeIngredientName(item);
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export function computeIngredientOverlap(
  recipeIngredients: Array<{ name: string }>,
  pantrySet: Set<string>,
): { ratio: number; matchedIngredients: string[] } {
  if (!Array.isArray(recipeIngredients)) {
    throw new Error("INVALID_INGREDIENTS: expected array");
  }
  if (!(pantrySet instanceof Set)) {
    throw new Error("INVALID_PANTRY_SET: expected Set");
  }

  const uniqueNames = new Set<string>();
  for (const ing of recipeIngredients) {
    if (!ing || typeof ing !== "object" || typeof ing.name !== "string") {
      throw new Error("INVALID_INGREDIENTS: ingredient name must be a string");
    }
    const normalized = normalizeIngredientName(ing.name);
    if (normalized.length > 0) {
      uniqueNames.add(normalized);
    }
  }

  if (uniqueNames.size === 0) {
    return { ratio: 0, matchedIngredients: [] };
  }

  const matched: string[] = [];
  for (const name of uniqueNames) {
    if (pantrySet.has(name)) {
      matched.push(name);
    }
  }

  matched.sort(compareOrdinal);
  const ratio = matched.length / uniqueNames.size;
  return { ratio, matchedIngredients: matched };
}

export function validateCandidateRecipe(candidate: unknown): RecipeCandidate {
  const parsed = ChefContextCandidateSchema.parse(candidate);
  const timestampMs = Date.parse(parsed.created_at);
  if (!Number.isFinite(timestampMs)) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return parsed;
}

export type CandidateWithScore = {
  candidate: RecipeCandidate;
  overlap_ratio: number;
  matched_ingredients: string[];
};

type ValidatedScoredCandidate = {
  candidate: RecipeCandidate;
  overlap_ratio: number;
  matched_ingredients: string[];
  created_at_ms: number;
};

function compareValidatedScoredCandidates(
  a: ValidatedScoredCandidate,
  b: ValidatedScoredCandidate,
): number {
  if (b.overlap_ratio !== a.overlap_ratio) {
    return b.overlap_ratio - a.overlap_ratio;
  }

  const aRating = a.candidate.star_rating;
  const bRating = b.candidate.star_rating;
  if (aRating !== bRating) {
    if (aRating !== null && bRating !== null) {
      return bRating - aRating;
    }
    if (aRating !== null) {
      return -1;
    }
    return 1;
  }

  if (b.created_at_ms !== a.created_at_ms) {
    return b.created_at_ms - a.created_at_ms;
  }

  return compareUuidOrdinal(a.candidate.id, b.candidate.id);
}

function toValidatedScoredCandidate(item: CandidateWithScore): ValidatedScoredCandidate {
  if (!item || typeof item !== "object") {
    throw new Error("INVALID_SCORED_CANDIDATE");
  }
  if (
    typeof item.overlap_ratio !== "number" ||
    !Number.isFinite(item.overlap_ratio) ||
    item.overlap_ratio < 0 ||
    item.overlap_ratio > 1
  ) {
    throw new Error("INVALID_OVERLAP_RATIO");
  }
  if (
    !Array.isArray(item.matched_ingredients) ||
    item.matched_ingredients.some((ing) => typeof ing !== "string")
  ) {
    throw new Error("INVALID_MATCHED_INGREDIENTS");
  }
  const validCandidate = validateCandidateRecipe(item.candidate);
  return {
    candidate: validCandidate,
    overlap_ratio: item.overlap_ratio,
    matched_ingredients: item.matched_ingredients,
    created_at_ms: Date.parse(validCandidate.created_at),
  };
}

export function compareRankedCandidates(a: CandidateWithScore, b: CandidateWithScore): number {
  const validA = toValidatedScoredCandidate(a);
  const validB = toValidatedScoredCandidate(b);
  return compareValidatedScoredCandidates(validA, validB);
}

export function rankCandidateRecipes(
  candidates: RecipeCandidate[],
  normalizedPantry: string[],
  topK: number = 3,
): { ranked: RankedRecipeContextItem[]; matchedCount: number } {
  if (!Array.isArray(candidates)) {
    throw new Error("INVALID_CANDIDATES: expected array");
  }
  const canonicalPantry = normalizePantryItems(normalizedPantry);
  const boundedTopK = ChefTopKSchema.parse(topK);

  const pantrySet = new Set(canonicalPantry);
  const scored: ValidatedScoredCandidate[] = [];
  let matchedCount = 0;

  for (const rawCandidate of candidates) {
    const candidate = validateCandidateRecipe(rawCandidate);
    const createdAtMs = Date.parse(candidate.created_at);
    const { ratio, matchedIngredients } = computeIngredientOverlap(
      candidate.ingredients,
      pantrySet,
    );
    if (ratio > 0) {
      matchedCount++;
    }
    scored.push({
      candidate,
      overlap_ratio: ratio,
      matched_ingredients: matchedIngredients,
      created_at_ms: createdAtMs,
    });
  }

  scored.sort(compareValidatedScoredCandidates);

  const matchedScored = scored.filter((item) => item.overlap_ratio > 0);
  const selected = matchedScored.slice(0, boundedTopK);

  const ranked: RankedRecipeContextItem[] = selected.map((item) =>
    RankedRecipeContextItemSchema.parse({
      id: item.candidate.id,
      title: item.candidate.title,
      ingredients: item.candidate.ingredients,
      instructions: item.candidate.instructions,
      flavor_scores: item.candidate.flavor_scores,
      star_rating: item.candidate.star_rating,
      created_at: item.candidate.created_at,
      overlap_ratio: item.overlap_ratio,
      matched_ingredients: item.matched_ingredients,
    })
  );

  return { ranked, matchedCount };
}

export async function retrieveCandidateRecipes(
  auth: AuthContext,
  maxLimit: number = 1000,
): Promise<{ candidates: RecipeCandidate[]; truncated: boolean }> {
  const { userId, supabase } = validateAuthContext(auth);
  const boundedLimit = ChefMaxCandidatesSchema.parse(maxLimit);

  const { data, error } = await supabase
    .from("recipes")
    .select(CHEF_CANDIDATE_SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(boundedLimit);

  if (error || !Array.isArray(data)) {
    throw new Error(`CANDIDATE_RETRIEVAL_FAILED: ${error?.message ?? "invalid response"}`);
  }

  for (const row of data) {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof (row as { user_id?: unknown }).user_id !== "string"
    ) {
      throw new Error("CANDIDATE_VALIDATION_FAILED: missing user_id");
    }
    if ((row as { user_id: string }).user_id.toLowerCase() !== userId.toLowerCase()) {
      throw new Error("OWNER_MISMATCH_DETECTED");
    }
  }

  const validatedCandidates = data.map((row) => validateCandidateRecipe(row));

  let truncated = false;
  if (validatedCandidates.length === boundedLimit) {
    const lastCandidate = validatedCandidates[validatedCandidates.length - 1];
    const keysetFilter =
      `created_at.lt.${lastCandidate.created_at},and(created_at.eq.${lastCandidate.created_at},id.gt.${lastCandidate.id})`;

    const { data: probeData, error: probeError } = await supabase
      .from("recipes")
      .select("id, user_id")
      .eq("user_id", userId)
      .or(keysetFilter)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(1);

    if (probeError || !Array.isArray(probeData)) {
      throw new Error(`PROBE_QUERY_FAILED: ${probeError?.message ?? "invalid probe response"}`);
    }

    for (const probeRow of probeData) {
      if (
        typeof probeRow !== "object" ||
        probeRow === null ||
        typeof (probeRow as { user_id?: unknown }).user_id !== "string"
      ) {
        throw new Error("PROBE_QUERY_FAILED: malformed probe row");
      }
      if ((probeRow as { user_id: string }).user_id.toLowerCase() !== userId.toLowerCase()) {
        throw new Error("OWNER_MISMATCH_DETECTED");
      }
      if (!RecipeIdParamSchema.safeParse((probeRow as { id?: unknown }).id).success) {
        throw new Error("PROBE_QUERY_FAILED: invalid probe recipe id");
      }
    }

    truncated = probeData.length > 0;
  }

  return { candidates: validatedCandidates, truncated };
}

export async function buildChefRecipeContext(
  auth: AuthContext,
  input: GenerateRecipeInput,
  options?: BuildChefRecipeContextOptions,
): Promise<ChefRecipeContextResult> {
  validateAuthContext(auth);
  const parsedInput = ChefRecipeContextInputSchema.parse(input);
  const parsedOptions = ChefRecipeContextOptionsSchema.parse(options ?? {});
  const normalizedPantry = normalizePantryItems(parsedInput.pantryItems);

  const { candidates, truncated } = await retrieveCandidateRecipes(
    auth,
    parsedOptions.maxCandidates,
  );

  const totalCandidateCount = candidates.length;

  if (totalCandidateCount === 0) {
    return ChefRecipeContextResultSchema.parse({
      status: "NO_SAVED_RECIPES",
      pantryItems: normalizedPantry,
      preferences: parsedInput.preferences,
      recipes: [],
      totalCandidateCount: 0,
      matchedCandidateCount: 0,
      truncated: false,
    });
  }

  if (normalizedPantry.length === 0) {
    return ChefRecipeContextResultSchema.parse({
      status: "EMPTY_PANTRY",
      pantryItems: [],
      preferences: parsedInput.preferences,
      recipes: [],
      totalCandidateCount,
      matchedCandidateCount: 0,
      truncated,
    });
  }

  const { ranked, matchedCount } = rankCandidateRecipes(
    candidates,
    normalizedPantry,
    parsedOptions.topK,
  );

  if (matchedCount === 0) {
    return ChefRecipeContextResultSchema.parse({
      status: "NO_PANTRY_OVERLAP",
      pantryItems: normalizedPantry,
      preferences: parsedInput.preferences,
      recipes: [],
      totalCandidateCount,
      matchedCandidateCount: 0,
      truncated,
    });
  }

  return ChefRecipeContextResultSchema.parse({
    status: "MATCHED",
    pantryItems: normalizedPantry,
    preferences: parsedInput.preferences,
    recipes: ranked,
    totalCandidateCount,
    matchedCandidateCount: matchedCount,
    truncated,
  });
}

export async function resolveChefRecipeContextForRequest(
  req: Request,
  input: GenerateRecipeInput,
  options?: BuildChefRecipeContextOptions,
  authDeps?: AuthDeps,
): Promise<RequestChefRecipeContextResult> {
  const auth = await authenticateRequest(req, authDeps);
  if (!auth.ok) {
    return auth;
  }
  const data = await buildChefRecipeContext(auth.context, input, options);
  return { ok: true, data };
}

export function formatChefRecipeContextForPrompt(context: ChefRecipeContextResult): string {
  const validContext = ChefRecipeContextResultSchema.parse(context);
  const parts: string[] = [];

  if (validContext.pantryItems.length > 0) {
    parts.push(`Available pantry ingredients: ${validContext.pantryItems.join(", ")}`);
  } else {
    parts.push("Available pantry ingredients: none specified.");
  }

  if (typeof validContext.preferences === "string" && validContext.preferences.trim().length > 0) {
    parts.push(`User preferences: ${validContext.preferences.trim()}`);
  }

  if (validContext.recipes.length === 0) {
    parts.push("No historical matching recipes available for context.");
  } else {
    parts.push(`Relevant historical recipes (${validContext.recipes.length} matching favorites):`);
    for (let i = 0; i < validContext.recipes.length; i++) {
      const recipe = validContext.recipes[i];
      const matchPct = Math.round(recipe.overlap_ratio * 100);
      const ingredientList = recipe.ingredients.map((ing) => ing.name).join(", ");
      const instructionList = recipe.instructions
        .map((inst) => `${inst.step}. ${inst.text}`)
        .join(" ");
      parts.push(
        `Recipe ${i + 1}: "${recipe.title}" (Pantry match: ${matchPct}%, Star rating: ${recipe.star_rating ?? "unrated"}) [ID: ${recipe.id}]\nIngredients: ${ingredientList}\nInstructions: ${instructionList}`,
      );
    }
  }

  // The Chef prompt fences this block with triple quotes. Pantry items, titles
  // and instructions are user data, so escape any triple-quote run to stop user
  // text from closing the fence early. The prompt still instructs the model to
  // treat the whole block as data; this is defense in depth, not the only guard.
  return parts.join("\n\n").replaceAll('"""', '\\"\\"\\"');
}
