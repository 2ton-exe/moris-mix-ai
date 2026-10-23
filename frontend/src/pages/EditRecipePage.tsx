import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import { recipeFormApi } from '../recipe-form/api'
import type { RecipeEditorRecord, SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'

export default function EditRecipePage({ record, isLoading = false, loadError, onRetry, save, notesSupported = true }: {
  record?: RecipeEditorRecord; isLoading?: boolean; loadError?: Error; onRetry?: () => void
  save?: SaveRecipeDraft; notesSupported?: boolean
}) {
  const { recipeId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const [loadedRecord, setLoadedRecord] = useState<RecipeEditorRecord>()
  const [requestLoading, setRequestLoading] = useState(false)
  const [requestError, setRequestError] = useState<Error>()
  const [retryCount, setRetryCount] = useState(0)
  const submit = useRecipeSave(save, recipeId)
  useUnsavedChangesGuard(dirty)
  useEffect(() => {
    if (record || loadError || isLoading) {
      setRequestLoading(false)
      return
    }
    if (!recipeId || !user?.id) {
      setRequestLoading(false)
      return
    }
    const controller = new AbortController()
    setLoadedRecord(undefined)
    setRequestError(undefined)
    setRequestLoading(true)
    void recipeFormApi.load(recipeId, { userId: user.id, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setLoadedRecord(result) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setRequestError(error instanceof Error ? error : new Error()) })
      .finally(() => { if (!controller.signal.aborted) setRequestLoading(false) })
    return () => controller.abort()
  }, [record, loadError, isLoading, recipeId, retryCount, user?.id])
  const activeRecord = record ?? loadedRecord
  const activeLoading = isLoading || requestLoading
  const activeError = loadError ?? requestError
  const retry = onRetry ?? (() => setRetryCount((count) => count + 1))
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
