import { HttpError } from '../api/http'
import { ErrorState } from '../components/ErrorState'
import { RecipeIntegrationUnavailable } from './source'

export function RecipeError({ error, onRetry, detail = false }: {
  error: Error
  onRetry: () => void
  detail?: boolean
}) {
  let message = detail ? 'Could not load this recipe. Please try again.' : 'Could not load your recipes. Please try again.'
  let canRetry = true
  if (error instanceof RecipeIntegrationUnavailable) {
    message = 'Your recipe journal is not connected yet. Please check back soon. You can still explore the demonstration recipe.'
    return <div className="request-state request-error"><p role="status">{message}</p></div>
  } else if (error instanceof HttpError) {
    if (error.status === 401) {
      message = 'Your session could not be verified. Please log out and sign in again.'
      canRetry = false
    } else if (error.status === 403) {
      message = detail ? 'You do not have permission to view this recipe.' : 'You do not have permission to view this collection.'
      canRetry = false
    } else if (error.status === 404) {
      message = detail ? 'This recipe could not be found. It may have been removed or may not be available to you.' : 'Your recipe collection is currently unavailable.'
      canRetry = false
    } else if (error.kind === 'configuration') {
      message = 'The recipe service is not configured. Please contact the site owner.'
      canRetry = false
    }
  }
  return <ErrorState message={message} onRetry={canRetry ? onRetry : undefined} />
}

export function RecipeSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className={`recipe-loading ${detail ? 'recipe-loading-detail' : ''}`} role="status">
      <span className="visually-hidden">{detail ? 'Loading recipe…' : 'Loading your recipes…'}</span>
      <div className={detail ? 'recipe-detail-skeleton' : 'recipe-grid'} aria-hidden="true">
        {Array.from({ length: detail ? 2 : 3 }, (_, index) => (
          <div className="recipe-skeleton" key={index}><span /><span /><span /></div>
        ))}
      </div>
    </div>
  )
}
