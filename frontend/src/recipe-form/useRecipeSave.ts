import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import type { RecipeDraft } from './draft'
import { RecipeSubmissionError } from './submission'
import type { SaveRecipeDraft } from './submission'

// Local callback boundary only. No fetch, token attachment, query cache, or
// alternate mutation implementation. FS-02 and FE-04 remain integration owners.
export function useRecipeSave(save?: SaveRecipeDraft, expectedId?: string) {
  const { session, user, isAuthenticated, isLoading } = useAuth()
  return async (draft: RecipeDraft, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted()
    if (!isAuthenticated || isLoading || !user || !session?.expires_at || session.user.id !== user.id || session.expires_at * 1000 <= Date.now()) {
      throw new HttpError('http', 'Authentication required.', 401)
    }
    if (!save) throw new RecipeSubmissionError('unavailable')
    const result = await save(draft, { userId: user.id, signal })
    signal.throwIfAborted()
    if (expectedId && result?.id !== expectedId) throw new Error('Unexpected recipe confirmation')
    return result
  }
}
