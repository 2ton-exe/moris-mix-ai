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

// Host props are intentionally ready for FE-04's useRecipe() result. This
// branch does not copy its loader, QueryClient, keys, or protected journal shell.
export default function EditRecipePage({ record, isLoading = false, loadError, onRetry, save, notesSupported = false }: {
  record?: RecipeEditorRecord; isLoading?: boolean; loadError?: Error; onRetry?: () => void
  save?: SaveRecipeDraft; notesSupported?: boolean
}) {
  const { recipeId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const submit = useRecipeSave(save, recipeId)
  useUnsavedChangesGuard(dirty)
  let message = 'Could not load this recipe. Please try again.'
  let canRetry = true
  if (loadError instanceof HttpError && [401, 403, 404].includes(loadError.status ?? 0)) {
    canRetry = false
    message = loadError.status === 401 ? 'Sign in again to edit this recipe.' : loadError.status === 403 ? 'You do not have permission to edit this recipe.' : 'This recipe could not be found.'
  }
  const available = record && record.id === recipeId && record.userId === user?.id
  const accessDenied = loadError instanceof HttpError && [401, 403, 404].includes(loadError.status ?? 0)
  const canEdit = available && !accessDenied
  return <RecipeEditorFrame mode="edit" connected={!!save}>
    {isLoading && !canEdit && <LoadingState message="Loading recipe for editing…" />}
    {loadError && <ErrorState message={message} onRetry={canRetry ? onRetry : undefined} />}
    {canEdit && <RecipeForm key={record.id} mode="edit" initialValues={record.values} onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} onCancel={() => navigate('/app')} />}
    {!canEdit && !isLoading && !loadError && <p className="request-state" role="status">This recipe is not available for editing yet. Please return when your journal is connected.</p>}
    {!canEdit && <div className="actions"><Link className="button button-secondary" to="/app">Back to journal</Link></div>}
  </RecipeEditorFrame>
}
