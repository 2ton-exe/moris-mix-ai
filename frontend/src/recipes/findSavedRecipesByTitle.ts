import { initialDiscoveryCriteria, supportsDiscovery, type RecipeContinuation, type RecipeDiscoverySource } from './discoveryTypes'
import type { RecipeRequest, RecipeSummary } from './types'
import { InvalidRecipeData, validateRecipeList } from './validation'

export async function findSavedRecipesByTitle(
  source: RecipeDiscoverySource | undefined,
  { title, userId, signal }: RecipeRequest & { title: string },
) {
  const criteria = { ...initialDiscoveryCriteria, search: title }
  if (!source || !supportsDiscovery(source, criteria)) throw new InvalidRecipeData()

  const recipes = new Map<string, RecipeSummary>()
  const visited = new Set<RecipeContinuation>()
  let continuation: RecipeContinuation | null = null
  do {
    const page = await source.page({ criteria, continuation, userId, signal })
    signal.throwIfAborted()
    for (const recipe of validateRecipeList(page.recipes)) recipes.set(recipe.id, recipe)
    continuation = page.nextPage
    if (continuation !== null) {
      if (visited.has(continuation)) throw new InvalidRecipeData()
      visited.add(continuation)
    }
  } while (continuation !== null)
  return [...recipes.values()]
}
