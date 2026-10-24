import { useContext, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { RecipeIntegrationUnavailable, RecipeSourceContext } from './source'
import { recipeKeys } from './queryOptions'

interface DeleteRecipeVariables {
  recipeId: string
  userId: string
}

type DeleteRecipeResult = DeleteRecipeVariables

export function useDeleteRecipe() {
  const { user, isAuthenticated, isLoading } = useAuth()
  const source = useContext(RecipeSourceContext)
  const queryClient = useQueryClient()
  const userId = user?.id ?? null
  const controllers = useRef(new Set<AbortController>())

  useEffect(() => () => {
    for (const controller of controllers.current) controller.abort()
    controllers.current.clear()
  }, [userId])

  const mutation = useMutation<DeleteRecipeResult, Error, DeleteRecipeVariables>({
    mutationFn: async ({ recipeId, userId: requestedUserId }) => {
      if (!userId || !isAuthenticated || isLoading || requestedUserId !== userId) {
        throw new HttpError('http', 'Authentication required.', 401)
      }
      const deleteRecipe = source.deleteRecipe
      if (!deleteRecipe) throw new RecipeIntegrationUnavailable()

      const controller = new AbortController()
      controllers.current.add(controller)
      try {
        controller.signal.throwIfAborted()
        await deleteRecipe(recipeId, { userId: requestedUserId, signal: controller.signal })
        controller.signal.throwIfAborted()
        return { recipeId, userId: requestedUserId }
      } finally {
        controllers.current.delete(controller)
      }
    },
    onSuccess: ({ recipeId, userId: deletedUserId }) => {
      queryClient.removeQueries({ queryKey: recipeKeys.detail(deletedUserId, recipeId), exact: true })
      void queryClient.invalidateQueries({ queryKey: recipeKeys.lists(deletedUserId), exact: true })
    },
    onError: (_error, { recipeId, userId: failedUserId }) => {
      // Reconcile failures, including interrupted responses, without claiming
      // success or dropping the last confirmed recipe data optimistically.
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(failedUserId, recipeId), exact: true })
      void queryClient.invalidateQueries({ queryKey: recipeKeys.lists(failedUserId), exact: true })
    },
    retry: false,
    // Start immediately so unmount can abort an offline request instead of leaving DELETE queued.
    networkMode: 'always',
  })

  const isAvailable = !!userId && isAuthenticated && !isLoading && !!source.deleteRecipe
  const requestFor = (recipeId: string): DeleteRecipeVariables | null =>
    isAvailable && userId ? { recipeId, userId } : null

  return { mutation, isAvailable, requestFor }
}
