import { useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { recipeKeys } from '../recipes/queryOptions'
import type { RecipeDraft } from './draft'
import { recipeFormApi } from './api'
import { confirmedSave } from './submission'
import type { SaveRecipeDraft } from './submission'

export function useRecipeSave(save?: SaveRecipeDraft, expectedId?: string) {
  const { session, user, isAuthenticated, isLoading } = useAuth()
  const queryClient = useQueryClient()
  const createdId = useRef<string | undefined>(undefined)
  return async (draft: RecipeDraft, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted()
    if (!isAuthenticated || isLoading || !user || !session?.expires_at || session.user.id !== user.id || session.expires_at * 1000 <= Date.now()) {
      throw new HttpError('http', 'Authentication required.', 401)
    }
    const recipeId = expectedId ?? createdId.current
    const context = { userId: user.id, signal, ...(recipeId === undefined ? {} : { recipeId }) }
    const result = save
      ? await save(draft, context)
      : await recipeFormApi.save(draft, context, recipeId)
    if (!confirmedSave(result)) throw new Error('Missing persistence confirmation')
    if (recipeId !== undefined && result.id !== recipeId) throw new Error('Unexpected recipe confirmation')
    if (expectedId === undefined) createdId.current = result.id
    // A confirmed write still needs cache reconciliation if navigation aborted the form.
    void queryClient.invalidateQueries({ queryKey: recipeKeys.lists(user.id) })
    if (recipeId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(user.id, recipeId), exact: true })
    }
    signal.throwIfAborted()
    return result
  }
}
