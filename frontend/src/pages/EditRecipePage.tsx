import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import type { RecipeEditorRecord, SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { useRecipe } from '../recipes/queries'

export default function EditRecipePage({ record, isLoading = false, loadError, onRetry, save, notesSupported = true }: {
  record?: RecipeEditorRecord; isLoading?: boolean; loadError?: Error; onRetry?: () => void
  save?: SaveRecipeDraft; notesSupported?: boolean
}) {
  const { recipeId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const query = useRecipe(recipeId, !record && !isLoading && !loadError)
  const submit = useRecipeSave(save, recipeId)
  useUnsavedChangesGuard(dirty)
  const loadedRecord = query.data && user?.id ? {
    id: query.data.id,
    userId: user.id,
    values: {
      title: query.data.title,
      ingredients: query.data.ingredients,
      instructions: query.data.instructions,
      star_rating: query.data.star_rating ?? null,
      cooked_at: query.data.cooked_at ?? null,
      notes: query.data.notes ?? '',
    },
  } : undefined
  const activeRecord = record ?? loadedRecord
  const activeLoading = isLoading || (!record && !loadError && query.isLoading)
  const activeError = loadError ?? (!record ? query.error : undefined)
  const retry = onRetry ?? (() => { void query.refetch() })
  let message = 'Could not load this recipe. Please try again.'
  let canRetry = true
  if (activeError instanceof HttpError && [401, 403, 404].includes(activeError.status ?? 0)) {
    canRetry = false
    message = activeError.status === 401 ? 'Sign in again to edit this recipe.' : activeError.status === 403 ? 'You do not have permission to edit this recipe.' : 'This recipe could not be found.'
  }
  const available = activeRecord && activeRecord.id === recipeId && activeRecord.userId === user?.id
  const accessDenied = activeError instanceof HttpError && [401, 403, 404].includes(activeError.status ?? 0)
  const canEdit = available && !accessDenied
  return <RecipeEditorFrame mode="edit" connected>
    {activeLoading && !canEdit && <LoadingState message="Loading recipe for editing…" />}
    {activeError && <ErrorState message={message} onRetry={canRetry ? retry : undefined} />}
    {canEdit && <RecipeForm key={activeRecord.id} mode="edit" initialValues={activeRecord.values} onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} onCancel={() => navigate('/app')} />}
    {!canEdit && !activeLoading && !activeError && <p className="request-state" role="status">This recipe is not available for editing yet. Please return when your journal is connected.</p>}
    {!canEdit && <div className="actions"><Link className="button button-secondary" to="/app">Back to journal</Link></div>}
  </RecipeEditorFrame>
}
