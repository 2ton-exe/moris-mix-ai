import { mapAiRecipeToDraft } from '../recipe-form/aiRecipeDraft'
import type { RecipeDraft } from '../recipe-form/draft'
import type { ExtractedRecipe } from './extractRecipe'

/** Maps only fields the existing editor and recipe draft contract can represent. */
export function mapExtractedRecipeToDraft(recipe: ExtractedRecipe): RecipeDraft | null {
  return mapAiRecipeToDraft(recipe)
}
