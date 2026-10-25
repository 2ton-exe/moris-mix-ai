import { apiClient } from '../api/config'
import { InvalidRecipeData, validateRecipeDetail, validateRecipeList } from './validation'
import type { RecipeSource } from './types'
import { supportsDiscovery } from './discoveryTypes'

const recipesPath = '/functions/v1/recipes'
const pageSize = 1000
const discoveryPageSize = 24
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function createRecipeSource(client: typeof apiClient = apiClient): RecipeSource {
  return {
    mode: 'live',
    discovery: {
      searchModes: [],
      sorts: ['newest'],
      filters: [],
      async page({ criteria, continuation, ...request }) {
        if (!supportsDiscovery({ searchModes: [], sorts: ['newest'], filters: [] }, criteria)) {
          throw new InvalidRecipeData()
        }
        const offset = continuation ?? 0
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - discoveryPageSize) {
          throw new InvalidRecipeData()
        }
        const payload = await client.getAuthenticatedJson(`${recipesPath}?limit=${discoveryPageSize}&offset=${offset}`, request)
        request.signal.throwIfAborted()
        if (!isRecord(payload) || !Array.isArray(payload.recipes) || payload.recipes.length > discoveryPageSize ||
          !payload.recipes.every((recipe) => isRecord(recipe) && recipe.user_id === request.userId)) {
          throw new InvalidRecipeData()
        }
        return {
          recipes: validateRecipeList(payload.recipes),
          // BE-06 explicitly defines a short page as the terminal indicator.
          nextPage: payload.recipes.length === discoveryPageSize ? offset + discoveryPageSize : null,
        }
      },
    },
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
