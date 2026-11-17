import { z } from "npm:zod@4.6.6";
import type { AuthContext } from "../auth.ts";
import { RecipeSchema } from "../schemas.ts";
import { validateAuthContext } from "./recipeContext.ts";
import type { MoriChatInput, MoriChatMessage, MoriChatPage, MoriChatRecipe } from "./AIProvider.ts";

export const MAX_MORI_CHAT_REQUEST_BYTES = 32 * 1024;

export const MoriChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(1200),
  }).strict()).min(1).max(8),
  page: z.enum(["recipes", "recipe", "new-recipe", "quick-entry", "chef", "other"]),
  recipeId: z.guid().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.messages.at(-1)?.role !== "user") {
    ctx.addIssue({ code: "custom", path: ["messages"], message: "The last message must be from the user." });
  }
  if (value.recipeId && value.page !== "recipe") {
    ctx.addIssue({ code: "custom", path: ["recipeId"], message: "A recipe ID is only allowed on the recipe page." });
  }
});

export type MoriChatRequest = z.infer<typeof MoriChatRequestSchema>;

const SEARCH_STOP_WORDS = new Set([
  "about", "another", "any", "can", "could", "did", "do", "does", "find",
  "for", "from", "help", "how", "have", "i", "in", "ingredient", "ingredients",
  "is", "it", "make", "me", "my", "of", "one", "recipe", "recipes", "saved",
  "some", "suggest", "that", "the", "this", "to", "use", "what", "with", "would",
  "you", "your",
]);

/** Up to three useful terms keep the existing indexed RPC bounded and user-scoped. */
export function moriChatSearchTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  return [...new Set(words.filter((word) => word.length >= 3 && word.length <= 32 && !SEARCH_STOP_WORDS.has(word)))].slice(0, 3);
}

function toMoriRecipe(value: unknown, userId: string): MoriChatRecipe {
  const parsed = RecipeSchema.parse(value);
  if (parsed.user_id.toLowerCase() !== userId.toLowerCase()) {
    throw new Error("MORI_RECIPE_OWNER_MISMATCH");
  }
  return {
    id: parsed.id,
    title: parsed.title,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
    notes: parsed.notes,
    star_rating: parsed.star_rating,
    cooked_at: parsed.cooked_at,
  };
}

function isRowArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function buildMoriChatInput(
  auth: AuthContext,
  request: MoriChatRequest,
): Promise<MoriChatInput> {
  const { userId, supabase } = validateAuthContext(auth);
  const messages: MoriChatMessage[] = request.messages;
  const page: MoriChatPage = request.page;
  let unavailable = false;
  let currentRecipe: MoriChatRecipe | null = null;
  const ranked = new Map<string, { recipe: MoriChatRecipe; hits: number; updatedAt: string }>();

  if (request.recipeId) {
    const { data, error } = await supabase.from("recipes")
      .select("id, user_id, title, raw_input, notes, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at")
      .eq("id", request.recipeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      unavailable = true;
    } else if (data) {
      try {
        currentRecipe = toMoriRecipe(data, userId);
      } catch {
        unavailable = true;
      }
    }
  }

  const terms = moriChatSearchTerms(messages.at(-1)?.content ?? "");
  if (terms.length > 0) {
    const results = await Promise.all(terms.map((term) => supabase.rpc("search_recipes", {
      p_search: term,
      p_sort: "newest",
      p_limit: 5,
      p_offset: 0,
    })));
    for (const result of results) {
      if (result.error || !isRowArray(result.data)) {
        unavailable = true;
        continue;
      }
      for (const row of result.data) {
        try {
          const recipe = toMoriRecipe(row, userId);
          const previous = ranked.get(recipe.id);
          const updatedAt = typeof row === "object" && row !== null && typeof (row as { updated_at?: unknown }).updated_at === "string"
            ? (row as { updated_at: string }).updated_at
            : "";
          ranked.set(recipe.id, {
            recipe,
            hits: (previous?.hits ?? 0) + 1,
            updatedAt,
          });
        } catch {
          unavailable = true;
        }
      }
    }
  }

  if (terms.length === 0 || ranked.size === 0) {
    const { data, error } = await supabase.from("recipes")
      .select("id, user_id, title, raw_input, notes, ingredients, instructions, flavor_scores, star_rating, cooked_at, image_url, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error || !isRowArray(data)) {
      unavailable = true;
    } else {
      for (const row of data) {
        try {
          const recipe = toMoriRecipe(row, userId);
          if (!ranked.has(recipe.id)) {
            const updatedAt = typeof row === "object" && row !== null && typeof (row as { updated_at?: unknown }).updated_at === "string"
              ? (row as { updated_at: string }).updated_at
              : "";
            ranked.set(recipe.id, { recipe, hits: 0, updatedAt });
          }
        } catch {
          unavailable = true;
        }
      }
    }
  }

  const recipes = [...ranked.values()]
    .sort((a, b) => b.hits - a.hits || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map(({ recipe }) => recipe);

  return {
    messages,
    page,
    currentRecipe,
    recipes,
    savedRecipesStatus: unavailable ? "unavailable" : recipes.length > 0 ? "available" : "empty",
  };
}
