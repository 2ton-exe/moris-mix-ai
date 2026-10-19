import { useState } from 'react'
import { useNavigate } from 'react-router'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'

export default function CreateRecipePage({ save, notesSupported = false }: { save?: SaveRecipeDraft; notesSupported?: boolean }) {
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const submit = useRecipeSave(save)
  useUnsavedChangesGuard(dirty)
  return <RecipeEditorFrame mode="create" connected={!!save}>
    <RecipeForm mode="create" onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} onCancel={() => navigate('/app')} />
  </RecipeEditorFrame>
}
