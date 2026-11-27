import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { ErrorState } from '../components/ErrorState'
import { RecipeEditorSkeleton } from '../recipe-form/RecipeEditorSkeleton'
import { journalReturnTo } from '../journal/indexNavigation'
import { JournalShell } from '../journal/JournalShell'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import type { RecipeEditorRecord, SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { RecipeImagePanel } from '../recipes/RecipeImagePanel'
import { useRecipe } from '../recipes/queries'

export default function EditRecipePage({ record, isLoading = false, loadError, onRetry, save, notesSupported = true }: {
  record?: RecipeEditorRecord; isLoading?: boolean; loadError?: Error; onRetry?: () => void
  save?: SaveRecipeDraft; notesSupported?: boolean
}) {
  const { recipeId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [dirty, setDirty] = useState(false)
  const query = useRecipe(recipeId, !record && !isLoading && !loadError)
  const navigationConfirmation = useUnsavedChangesGuard(dirty, { guardLogout: true })
  const loadedRecord = query.data && user?.id ? {
    id: query.data.id,
    userId: user.id,
    updatedAt: query.data.updated_at,
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
  const submit = useRecipeSave(save, recipeId, activeRecord)
  const activeLoading = isLoading || (!record && !loadError && query.isLoading)
  const activeError = loadError ?? (!record ? query.error : undefined)
  const recoveryHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { recoveryHeading.current?.focus() }, [activeError, activeLoading, recipeId])
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
  const initialSection = new URLSearchParams(location.search).get('section') === 'method' ? 'method' : undefined
  if (canEdit || (activeLoading && !activeError)) return <div className="recipe-form mm-recipe-form-editor mm-edit-recipe">
    <RecipeEditorFrame mode="edit" connected showBack={false} focusHeading={!!canEdit && !initialSection}
      headingIntro="Your journal keeps the last saved version while you edit."
      navigationConfirmation={navigationConfirmation}>
    {canEdit ? <RecipeForm key={`${user?.id}:${activeRecord.id}:${initialSection ?? 'start'}`} mode="edit" initialSection={initialSection} initialValues={activeRecord.values} onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} cancelLabel="Back to recipe" onCancel={() => navigate(`/app/recipes/${encodeURIComponent(recipeId)}`, { state: location.state })}
    notice={activeError && <ErrorState message={message} onRetry={canRetry ? retry : undefined} />}
    supplement={import.meta.env.VITE_RECIPE_IMAGES === 'true' && <RecipeImagePanel key={`${user?.id}:image-${activeRecord.id}`} recipeId={activeRecord.id} recipeTitle={activeRecord.values.title} allowUpload />}
    /> : <RecipeEditorSkeleton showHeading={false} />}
    </RecipeEditorFrame>
  </div>
  return <JournalShell mode="writing" account={<div className="journal-account"><span>{user?.email}</span></div>}>
    <section className="mm-recipe-recovery" aria-labelledby="edit-unavailable-heading">
      <h1 id="edit-unavailable-heading" ref={recoveryHeading} tabIndex={-1}>Recipe unavailable</h1>
      {activeError ? <ErrorState message={message} onRetry={canRetry ? retry : undefined} />
        : <p className="request-state" role="status">This recipe is unavailable. Open a recipe from your journal to edit it.</p>}
      <div className="mm-recipe-recovery__actions">
        <Link className={`button ${activeError && canRetry ? 'button-secondary' : 'button-primary'}`} to={journalReturnTo(location.state)}>Browse your recipes</Link>
      </div>
    </section>
  </JournalShell>
}
