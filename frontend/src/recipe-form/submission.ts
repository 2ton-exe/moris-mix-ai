import { HttpError } from '../api/http'
import { retryAfterMessage } from '../api/retryAfter'
import type { RecipeDraft, RecipeDraftInput } from './draft'

// Host UI interfaces, not a backend request/response envelope. A future
// useMutation().mutateAsync adapter must confirm persistence before resolving.
export interface RecipeSaveConfirmation { id: string; statusMessage?: string }
export interface RecipeSaveContext { userId: string; signal: AbortSignal; recipeId?: string }
export type SaveRecipeDraft = (draft: RecipeDraft, context: RecipeSaveContext) => Promise<RecipeSaveConfirmation>
export interface RecipeEditorRecord { id: string; userId: string; values: RecipeDraftInput; updatedAt?: string }

export type FieldViolation = { path: string; code: 'required' | 'invalid' | 'too-long' }
export class RecipeSubmissionError extends Error {
  constructor(readonly kind: 'unavailable' | 'validation' | 'notes-unsupported', readonly violations: FieldViolation[] = []) {
    super('Recipe submission could not be completed.')
    this.name = 'RecipeSubmissionError'
  }
}

export function submissionMessage(error: unknown) {
  if (error instanceof RecipeSubmissionError && error.kind === 'notes-unsupported') {
    return 'Notes are not supported by this recipe service yet. Your draft is still here; nothing has been saved.'
  }
  if (error instanceof RecipeSubmissionError && error.kind === 'unavailable') {
    return 'Saving recipes is not connected yet. Your draft is still here; nothing has been saved.'
  }
  if (error instanceof HttpError) {
    if (error.status === 401) return 'Your session could not be verified. Sign in again before saving. Your draft has not been saved.'
    if (error.status === 403) return 'You do not have permission to save this recipe. Your changes are still here.'
    if (error.status === 404) return 'This recipe is no longer available. Your changes are still here.'
    if (error.status === 409) return 'The recipe conflicts with a change already on the server. Your edits are still here. Check your journal before trying again.'
    if (error.status === 429) return `Saving is temporarily limited. Your changes are still here. ${retryAfterMessage(error.retryAfter)}`
    if (error.kind === 'configuration') return 'Saving is not connected in this environment. Your changes are still here.'
    if (error.status === 400 || error.status === 422) return 'The recipe could not be accepted. Check your entries and try again.'
  }
  if (error instanceof RecipeSubmissionError && error.kind === 'validation') return 'Please check the highlighted fields. Your changes have not been saved.'
  return 'Could not confirm whether your recipe was saved. Your changes are still here. Check your journal before retrying to avoid creating a duplicate.'
}

export function confirmedSave(value: unknown): value is RecipeSaveConfirmation {
  return typeof value === 'object' && value !== null && 'id' in value &&
    typeof value.id === 'string' && value.id.trim().length > 0
}
