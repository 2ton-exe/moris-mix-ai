import { useState } from 'react'
import { journalReturnTo } from '../journal/indexNavigation'
import { useLocation, useNavigate } from 'react-router'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { RecipeImagePanel } from '../recipes/RecipeImagePanel'
import { useAuth } from '../auth/context'

export default function CreateRecipePage({ save, notesSupported = true }: { save?: SaveRecipeDraft; notesSupported?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [dirty, setDirty] = useState(false)
  const [savedRecipe, setSavedRecipe] = useState<{ id: string; title: string; userId: string } | null>(null)
  const saveRecipe = useRecipeSave(save)
  const submit: typeof saveRecipe = async (...args) => {
    const result = await saveRecipe(...args)
    if (user) setSavedRecipe({ id: result.id, title: args[0].title, userId: user.id })
    return result
  }
  const navigationConfirmation = useUnsavedChangesGuard(dirty)
  return <RecipeForm key={user?.id ?? 'signed-out'} mode="create" onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} onCancel={() => navigate(journalReturnTo(location.state, '/app'))}
    supplement={savedRecipe?.userId === user?.id && savedRecipe && <RecipeImagePanel key={`${user?.id}:${savedRecipe.id}`} recipeId={savedRecipe.id} recipeTitle={savedRecipe.title} allowUpload />}
    renderFrame={(content) => <RecipeEditorFrame mode="create" connected navigationConfirmation={navigationConfirmation}>{content}</RecipeEditorFrame>} />
}
