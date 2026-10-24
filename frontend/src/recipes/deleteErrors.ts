import { HttpError } from '../api/http'
import { RecipeIntegrationUnavailable } from './source'

export interface DeleteErrorPresentation {
  message: string
  canRetry: boolean
}

export function presentDeleteError(error: Error | null): DeleteErrorPresentation | null {
  if (!error) return null
  if (error instanceof RecipeIntegrationUnavailable) {
    return { message: 'Recipe deletion is not connected yet. Please check back soon.', canRetry: false }
  }
  if (error.name === 'AbortError') {
    return { message: 'We could not confirm whether this recipe was deleted. Check your collection, then try again.', canRetry: true }
  }
  if (error instanceof HttpError) {
    if (error.status === 401) {
      return { message: 'Your session could not be verified. Sign in again before deleting this recipe.', canRetry: false }
    }
    if (error.status === 403) {
      return { message: 'You do not have permission to delete this recipe.', canRetry: false }
    }
    if (error.status === 404) {
      return { message: 'This recipe is no longer available. Return to your collection to refresh it.', canRetry: false }
    }
    const unexpectedSuccess = error.status !== undefined && error.status >= 200 && error.status < 300
    if (error.kind === 'network' || error.kind === 'invalid-json' || error.retryable || unexpectedSuccess) {
      return { message: 'We could not confirm whether this recipe was deleted. Check your collection, then try again.', canRetry: true }
    }
    if (error.kind === 'configuration') {
      return { message: 'The recipe service is not configured. Please contact the site owner.', canRetry: false }
    }
    return { message: 'The deletion request could not be accepted. Refresh your collection before trying again.', canRetry: false }
  }
  return { message: 'We could not confirm whether this recipe was deleted. Check your collection, then try again.', canRetry: true }
}
