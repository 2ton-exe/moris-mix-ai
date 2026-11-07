import { recipeDraftSchema } from './draft'
import type { RecipeDraft } from './draft'
import type { ExtractedRecipe } from '../quick-ai/extractRecipe'

/** Maps a validated AI recipe into only the fields the shared editor supports. */
export function mapAiRecipeToDraft(recipe: ExtractedRecipe): RecipeDraft | null {
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
