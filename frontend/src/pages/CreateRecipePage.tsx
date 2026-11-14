import { useState } from 'react'
import { journalReturnTo } from '../journal/indexNavigation'
import { useLocation, useNavigate } from 'react-router'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { useAuth } from '../auth/context'

export default function CreateRecipePage({ save, notesSupported = true }: { save?: SaveRecipeDraft; notesSupported?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [dirty, setDirty] = useState(false)
  const submit = useRecipeSave(save)
  const navigationConfirmation = useUnsavedChangesGuard(dirty)
  return <RecipeForm key={user?.id ?? 'signed-out'} mode="create" onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} onCancel={() => navigate(journalReturnTo(location.state, '/app'))}
    renderFrame={(content) => <RecipeEditorFrame mode="create" connected navigationConfirmation={navigationConfirmation}>{content}</RecipeEditorFrame>} />
}
