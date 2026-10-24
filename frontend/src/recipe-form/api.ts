import { apiClient } from '../api/config'
import { InvalidRecipeData, validateRecipeDetail } from '../recipes/validation'
import type { RecipeRequest } from '../recipes/types'
import type { RecipeSaveConfirmation } from './submission'
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
    async save(draft: RecipeDraft, request: RecipeRequest, id?: string): Promise<RecipeSaveConfirmation> {
      const body = {
        title: draft.title,
        ingredients: draft.ingredients,
        instructions: draft.instructions,
        star_rating: draft.star_rating,
        cooked_at: draft.cooked_at,
        notes: draft.notes,
      }
      const response = id !== undefined
        ? await client.patchAuthenticatedJson(`${recipesPath}/${encodeURIComponent(id)}`, body, request)
        : await client.postAuthenticatedJson(recipesPath, body, request)
      return { id: parseRecipeResponse(response, request.userId, id).id }
    },
  }
}

export const recipeFormApi = createRecipeFormApi()
