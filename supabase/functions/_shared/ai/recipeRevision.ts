import type { AuthContext } from "../auth.ts";
import type { GeneratedRevision } from "./AIProvider.ts";
import { normalizeIngredientName } from "./recipeContext.ts";
import {
  type RecipeRevisionRequest,
  type RecipeRevisionSummary,
  RecipeSchema,
} from "./schemas.ts";

const RevisionSourceSchema = RecipeSchema.pick({
  id: true,
  user_id: true,
  title: true,
  ingredients: true,
  instructions: true,
  notes: true,
  star_rating: true,
});

export type RecipeRevisionContext = {
  source: Omit<
    ReturnType<typeof RevisionSourceSchema.parse>,
    "notes" | "user_id"
  >;
  noteExcerpt: string;
};

export async function loadRecipeRevisionContext(
  auth: AuthContext,
  request: RecipeRevisionRequest,
): Promise<
  | { status: "ready"; context: RecipeRevisionContext }
  | { status: "not_found" }
  | { status: "stale_note" }
> {
  const { data, error } = await auth.supabase.from("recipes")
    .select("id,user_id,title,ingredients,instructions,notes,star_rating")
    .eq("id", request.sourceRecipeId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) throw new Error("Could not read revision source.");
  if (!data) return { status: "not_found" };

  const { notes, user_id, ...source } = RevisionSourceSchema.parse(data);
  if (
    user_id.toLowerCase() !== auth.user.id.toLowerCase() ||
    source.id.toLowerCase() !== request.sourceRecipeId.toLowerCase()
  ) {
    return { status: "not_found" };
  }
  if (!notes?.includes(request.noteExcerpt)) return { status: "stale_note" };
  return {
    status: "ready",
    context: { source, noteExcerpt: request.noteExcerpt },
  };
}

type Amount = RecipeRevisionSummary["before"];
const teaspoonsPerUnit = new Map([
  ["cup", 48],
  ["cups", 48],
  ["tablespoon", 3],
  ["tablespoons", 3],
  ["tbsp", 3],
  ["teaspoon", 1],
  ["teaspoons", 1],
  ["tsp", 1],
]);

function isDifferentAmount(before: Amount, after: Amount): boolean {
  const beforeUnit = before.unit?.trim().toLowerCase() ?? "";
  const afterUnit = after.unit?.trim().toLowerCase() ?? "";
  if (beforeUnit === afterUnit) return before.quantity !== after.quantity;

  // shortcut: only US cup, tablespoon and teaspoon conversions; extend the
  // supported conversions when revisions need to switch between other units.
  const beforeFactor = teaspoonsPerUnit.get(beforeUnit);
  const afterFactor = teaspoonsPerUnit.get(afterUnit);
  return beforeFactor !== undefined && afterFactor !== undefined &&
    before.quantity * beforeFactor !== after.quantity * afterFactor;
}

export function explainRecipeRevision(
  { source, noteExcerpt }: RecipeRevisionContext,
  generated: GeneratedRevision,
): RecipeRevisionSummary | null {
  const proposed = generated.recipe.ingredients;
  if (
    !generated.revisionReason ||
    proposed.length !== source.ingredients.length ||
    generated.substitutions.length > 0 ||
    generated.recipe.instructions.length !== source.instructions.length
  ) {
    return null;
  }

  let change:
    | Omit<
      RecipeRevisionSummary,
      "reason" | "noteExcerpt"
    >
    | undefined;
  for (const [index, original] of source.ingredients.entries()) {
    const draft = proposed[index];
    if (
      normalizeIngredientName(original.name) !==
        normalizeIngredientName(draft.name)
    ) {
      return null;
    }
    if (
      original.quantity === draft.quantity && original.unit === draft.unit &&
      original.quantityText === draft.quantityText
    ) {
      continue;
    }
    if (
      change || original.quantity === null || draft.quantity === null ||
      original.quantityText || draft.quantityText
    ) {
      return null;
    }

    const before = { quantity: original.quantity, unit: original.unit };
    const after = { quantity: draft.quantity, unit: draft.unit };
    if (!isDifferentAmount(before, after)) return null;
    change = { ingredient: original.name, before, after };
  }

  return change
    ? {
      ...change,
      noteExcerpt,
      reason: generated.revisionReason,
    }
    : null;
}
