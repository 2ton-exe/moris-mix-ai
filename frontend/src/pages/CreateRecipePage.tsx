import { useState } from 'react'
import { useNavigate } from 'react-router'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { RecipeImagePanel } from '../recipes/RecipeImagePanel'

export default function CreateRecipePage({ save, notesSupported = true }: { save?: SaveRecipeDraft; notesSupported?: boolean }) {
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const [savedRecipe, setSavedRecipe] = useState<{ id: string; title: string } | null>(null)
  const saveRecipe = useRecipeSave(save)
  const submit: typeof saveRecipe = async (...args) => {
    const result = await saveRecipe(...args)
    setSavedRecipe({ id: result.id, title: args[0].title })
    return result
  }
  useUnsavedChangesGuard(dirty)
  return <RecipeEditorFrame mode="create" connected>
    <RecipeForm mode="create" onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported} onCancel={() => navigate('/app')} />
    {savedRecipe && <RecipeImagePanel key={savedRecipe.id} recipeId={savedRecipe.id} recipeTitle={savedRecipe.title} allowUpload />}
  </RecipeEditorFrame>
}
