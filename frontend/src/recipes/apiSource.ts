import { apiClient } from '../api/config'
import { InvalidRecipeData, validateRecipeDetail, validateRecipeList } from './validation'
import type { RecipeSource } from './types'
import { supportsDiscovery } from './discoveryTypes'

const recipesPath = '/functions/v1/recipes'
const pageSize = 1000
const discoveryPageSize = 24
const discoveryCapabilities = {
  searchModes: ['title', 'ingredients', 'both'],
  sorts: ['newest', 'rating'],
  filters: [],
} as const
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function createRecipeSource(client: typeof apiClient = apiClient): RecipeSource {
  return {
    mode: 'live',
    discovery: {
      ...discoveryCapabilities,
      async page({ criteria, continuation, ...request }) {
        if (!supportsDiscovery(discoveryCapabilities, criteria) ||
          (continuation !== null && (typeof continuation !== 'string' || continuation.length === 0))) {
          throw new InvalidRecipeData()
        }
        const params = new URLSearchParams({ pagination: 'cursor', limit: String(discoveryPageSize), sort: criteria.sort })
        if (criteria.search) {
          if (criteria.searchMode !== 'ingredients') params.set('title', criteria.search)
          if (criteria.searchMode !== 'title') params.set('ingredient', criteria.search)
        }
        if (continuation !== null) params.set('cursor', continuation)
        const payload = await client.getAuthenticatedJson(`${recipesPath}?${params}`, request)
        request.signal.throwIfAborted()
        if (!isRecord(payload) || !Array.isArray(payload.recipes) || payload.recipes.length > discoveryPageSize ||
          !payload.recipes.every((recipe) => isRecord(recipe) && recipe.user_id === request.userId)) {
          throw new InvalidRecipeData()
        }
        const hasMore = payload.has_more
        const nextCursor = payload.next_cursor
        const nextPage = hasMore === true && payload.recipes.length > 0 && typeof nextCursor === 'string' && nextCursor.length > 0
          ? nextCursor
          : hasMore === false && nextCursor === null
            ? null
            : undefined
        if (nextPage === undefined) throw new InvalidRecipeData()
        return {
          recipes: validateRecipeList(payload.recipes),
          nextPage,
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
