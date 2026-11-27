import { apiClient } from '../api/config'
import { InvalidRecipeData, validateRecipeDetail } from '../recipes/validation'
import type { RecipeRequest } from '../recipes/types'
import { HttpError } from '../api/http'
import type { RecipeEditorRecord, RecipeSaveConfirmation } from './submission'
import type { RecipeDraft } from './draft'

const recipesPath = '/functions/v1/recipes'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseRecipeResponse(value: unknown, userId: string, expectedId?: string) {
  if (!isRecord(value) || !isRecord(value.recipe) || value.recipe.user_id !== userId ||
    typeof value.recipe.id !== 'string') {
    throw new InvalidRecipeData()
  }
  return validateRecipeDetail(value.recipe, expectedId ?? value.recipe.id)
}

export function createRecipeFormApi(client: typeof apiClient = apiClient) {
  return {
    async updateCookingDetails(id: string, changes: { cooked_at: string } | { notes: string; expected_updated_at: string }, request: RecipeRequest) {
      const response = await client.patchAuthenticatedJson(`${recipesPath}/${encodeURIComponent(id)}`, changes, request)
      const recipe = parseRecipeResponse(response, request.userId, id)
      if ('notes' in changes ? recipe.notes !== changes.notes : recipe.cooked_at !== changes.cooked_at) {
        throw new InvalidRecipeData()
      }
      return recipe
    },
    async save(draft: RecipeDraft, request: RecipeRequest, id?: string, original?: RecipeEditorRecord): Promise<RecipeSaveConfirmation & { record: RecipeEditorRecord }> {
      if (original && (original.id !== id || original.userId !== request.userId)) throw new InvalidRecipeData()
      const notesChanged = !original || draft.notes !== (original.values.notes ?? '')
      const dateChanged = !original || draft.cooked_at !== original.values.cooked_at
      if (original && (notesChanged || dateChanged) && !original.updatedAt) throw new HttpError('http', 'Recipe version is unavailable.', 409)
      const body = {
        title: draft.title,
        ingredients: draft.ingredients,
        instructions: draft.instructions,
        star_rating: draft.star_rating,
        ...(dateChanged ? { cooked_at: draft.cooked_at } : {}),
        ...(notesChanged ? { notes: draft.notes } : {}),
        ...(original && (notesChanged || dateChanged) ? { expected_updated_at: original.updatedAt } : {}),
      }
      const response = id !== undefined
        ? await client.patchAuthenticatedJson(`${recipesPath}/${encodeURIComponent(id)}`, body, request)
        : await client.postAuthenticatedJson(recipesPath, body, request)
      const recipe = parseRecipeResponse(response, request.userId, id)
      const cookingDetailsMatch = (recipe.notes ?? '') === draft.notes && (recipe.cooked_at ?? null) === draft.cooked_at
      // A title save must not acknowledge cooking details the editor has never shown.
      return { id: recipe.id, record: { id: recipe.id, userId: request.userId, values: draft, updatedAt: cookingDetailsMatch ? recipe.updated_at : original?.updatedAt } }
    },
  }
}

export const recipeFormApi = createRecipeFormApi()
