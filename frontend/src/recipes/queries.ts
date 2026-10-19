import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { recipeKeys } from './queryOptions'
import { RecipeSourceContext } from './source'
import { validateRecipeDetail, validateRecipeList } from './validation'

export function useRecipes() {
  const { user, isAuthenticated, isLoading } = useAuth()
  const source = useContext(RecipeSourceContext)
  const userId = user?.id ?? null
  return useQuery({
    queryKey: recipeKeys.lists(userId),
    enabled: !!userId && isAuthenticated && !isLoading,
    queryFn: async ({ signal }) => {
      if (!userId) throw new HttpError('http', 'Authentication required.', 401)
      const recipes = await source.list({ userId, signal })
      signal.throwIfAborted()
      return validateRecipeList(recipes)
    },
  })
}

export function useRecipe(id: string) {
  const { user, isAuthenticated, isLoading } = useAuth()
  const source = useContext(RecipeSourceContext)
  const userId = user?.id ?? null
  return useQuery({
    queryKey: recipeKeys.detail(userId, id),
    enabled: !!userId && !!id && isAuthenticated && !isLoading,
    queryFn: async ({ signal }) => {
      if (!userId) throw new HttpError('http', 'Authentication required.', 401)
      const recipe = await source.detail(id, { userId, signal })
      signal.throwIfAborted()
      return validateRecipeDetail(recipe, id)
    },
  })
}
