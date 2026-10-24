import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { useQueryClient } from '@tanstack/react-query'
import { recipeKeys } from '../recipes/queryOptions'
import type { RecipeDraft } from './draft'
import { recipeFormApi } from './api'
import { confirmedSave } from './submission'
import type { SaveRecipeDraft } from './submission'

export function useRecipeSave(save?: SaveRecipeDraft, expectedId?: string) {
  const { session, user, isAuthenticated, isLoading } = useAuth()
  const queryClient = useQueryClient()
  return async (draft: RecipeDraft, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted()
    if (!isAuthenticated || isLoading || !user || !session?.expires_at || session.user.id !== user.id || session.expires_at * 1000 <= Date.now()) {
      throw new HttpError('http', 'Authentication required.', 401)
    }
    const context = { userId: user.id, signal }
    const result = save
      ? await save(draft, context)
      : await recipeFormApi.save(draft, context, expectedId)
    if (!confirmedSave(result)) throw new Error('Missing persistence confirmation')
    if (expectedId !== undefined && result?.id !== expectedId) throw new Error('Unexpected recipe confirmation')
    // A confirmed write still needs cache reconciliation if navigation aborted the form.
    void queryClient.invalidateQueries({ queryKey: recipeKeys.lists(user.id), exact: true })
    if (expectedId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(user.id, expectedId), exact: true })
    }
    signal.throwIfAborted()
    return result
  }
}
