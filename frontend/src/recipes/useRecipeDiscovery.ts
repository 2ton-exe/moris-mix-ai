import { useContext, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/context'
import { HttpError } from '../api/http'
import { useRecipes } from './queries'
import { recipeKeys } from './queryOptions'
import { RecipeSourceContext } from './source'
import { InvalidRecipeData, validateRecipeList } from './validation'
import { supportsDiscovery } from './discoveryTypes'
import type { RecipeContinuation, RecipeDiscoveryCriteria, RecipeDiscoveryPage } from './discoveryTypes'

export function useRecipeDiscovery(criteria: RecipeDiscoveryCriteria, waiting: boolean) {
  const source = useContext(RecipeSourceContext)
  const { user, isAuthenticated, isLoading } = useAuth()
  const userId = user?.id ?? null
  const adapter = source.discovery
  const legacy = useRecipes(!adapter)
  const infinite = useInfiniteQuery({
    queryKey: adapter ? recipeKeys.discovery(userId, criteria) : [...recipeKeys.all(userId), 'discovery-unavailable'],
    enabled: !!adapter && !waiting && !!userId && isAuthenticated && !isLoading,
    initialPageParam: null as RecipeContinuation | null,
    queryFn: async ({ signal, pageParam }): Promise<RecipeDiscoveryPage> => {
      if (!userId) throw new HttpError('http', 'Authentication required.', 401)
      if (!adapter || !supportsDiscovery(adapter, criteria)) throw new InvalidRecipeData()
      const page = await adapter.page({ userId, signal, criteria, continuation: pageParam })
      signal.throwIfAborted()
      if (!page || !(page.nextPage === null ||
        (typeof page.nextPage === 'string' && page.nextPage.length > 0) ||
        (typeof page.nextPage === 'number' && Number.isSafeInteger(page.nextPage) && page.nextPage >= 0)) ||
        (page.nextPage !== null && page.nextPage === pageParam)) throw new InvalidRecipeData()
      return { recipes: validateRecipeList(page.recipes), nextPage: page.nextPage }
    },
    getNextPageParam: (last, _pages, _lastParam, params) =>
      last.nextPage !== null && !params.includes(last.nextPage) ? last.nextPage : undefined,
  })
  const query = adapter ? infinite : legacy
  const pages = infinite.data?.pages
  // Map preserves the server's first position for each ID while allowing a
  // later overlapping page to update that card's metadata.
  const uniqueRecipes = pages && new Map(pages.flatMap((page) => page.recipes).map((recipe) => [recipe.id, recipe]))
  const recipes = adapter ? uniqueRecipes && [...uniqueRecipes.values()] : legacy.data
  const loadingMore = useRef(false)
  async function loadMore() {
    if (loadingMore.current || infinite.isFetching || !infinite.hasNextPage) return
    loadingMore.current = true
    try { await infinite.fetchNextPage({ cancelRefetch: false }) }
    finally { loadingMore.current = false }
  }
  return {
    recipes,
    error: query.error,
    isPending: query.isPending,
    isPaused: query.isPaused,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    hasNextPage: !!adapter && infinite.hasNextPage,
    isFetchingNextPage: !!adapter && infinite.isFetchingNextPage,
    isFetchNextPageError: !!adapter && infinite.isFetchNextPageError,
    loadMore,
  }
}
