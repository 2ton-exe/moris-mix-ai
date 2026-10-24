import { apiClient } from '../api/config'
import { InvalidRecipeData, validateRecipeDetail, validateRecipeList } from './validation'
import type { RecipeSource } from './types'

const recipesPath = '/functions/v1/recipes'
const pageSize = 1000
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function createRecipeSource(client: typeof apiClient = apiClient): RecipeSource {
  return {
    mode: 'live',
    async list(request) {
      const recipes: ReturnType<typeof validateRecipeList> = []
      for (let offset = 0; ; offset += pageSize) {
        const payload = await client.getAuthenticatedJson(`${recipesPath}?limit=${pageSize}&offset=${offset}`, request)
        if (!isRecord(payload) || !Array.isArray(payload.recipes) || payload.recipes.length > pageSize ||
          !payload.recipes.every((recipe) => isRecord(recipe) && recipe.user_id === request.userId)) {
          throw new InvalidRecipeData()
        }
        recipes.push(...validateRecipeList(payload.recipes))
        if (payload.recipes.length < pageSize) return recipes
      }
    },
    async detail(id, request) {
      const payload = await client.getAuthenticatedJson(`${recipesPath}/${encodeURIComponent(id)}`, request)
      if (!isRecord(payload) || !isRecord(payload.recipe) || payload.recipe.user_id !== request.userId) {
        throw new InvalidRecipeData()
      }
      return validateRecipeDetail(payload.recipe, id)
    },
    async deleteRecipe(id, request) {
      const payload = await client.deleteAuthenticatedJson(`${recipesPath}/${encodeURIComponent(id)}`, request)
      if (payload !== null) throw new InvalidRecipeData()
    },
  }
}
