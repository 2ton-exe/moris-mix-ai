import { recipeDraftSchema } from '../recipe-form/draft'
import type { RecipeDraft } from '../recipe-form/draft'
import type { ExtractedRecipe } from './extractRecipe'

/** Maps only fields the existing editor and recipe draft contract can represent. */
export function mapExtractedRecipeToDraft(recipe: ExtractedRecipe): RecipeDraft | null {
  const parsed = recipeDraftSchema.safeParse({
    title: recipe.title,
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      ...(ingredient.quantityText === undefined ? {} : { quantityText: ingredient.quantityText }),
      inferred: ingredient.inferred,
    })),
    instructions: recipe.instructions.map((instruction) => ({ step: instruction.step, text: instruction.text })),
    star_rating: null,
    cooked_at: null,
    notes: '',
  })
  return parsed.success ? parsed.data : null
}
