import { HttpError } from '../api/http'

export function isRecipeAccessError(error: Error | null) {
  return error instanceof HttpError && [401, 403, 404].includes(error.status ?? 0)
}
