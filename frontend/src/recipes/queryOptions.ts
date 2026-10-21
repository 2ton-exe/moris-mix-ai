import { HttpError } from '../api/http'

// Account prefix supports FE-05/06 invalidating all recipe data for a user.
export const recipeKeys = {
  all: (userId: string | null) => ['recipes', userId] as const,
  lists: (userId: string | null) => [...recipeKeys.all(userId), 'list'] as const,
  detail: (userId: string | null, id: string) => [...recipeKeys.all(userId), 'detail', id] as const,
}

export function retryRecipeQuery(failureCount: number, error: Error) {
  // Includes network, 408, 429, 5xx; excludes 401/403/404 and invalid contracts.
  return error instanceof HttpError && error.retryable && failureCount < 2
}
