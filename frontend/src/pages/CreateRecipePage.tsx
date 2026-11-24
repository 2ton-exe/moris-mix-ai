import { useMemo, useState } from 'react'
import { journalReturnTo } from '../journal/indexNavigation'
import { useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import { editorState, emptyRecipeDraft } from '../recipe-form/draft'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { RecipeImagePanel } from '../recipes/RecipeImagePanel'
import { useAuth } from '../auth/context'

const manualRecipeLocation = z.object({ manualRecipe: z.discriminatedUnion('source', [
  z.object({ userId: z.string(), source: z.literal('quick-entry'), notes: z.string().max(20_000) }),
  z.object({ userId: z.string(), source: z.literal('chef'), ingredients: z.array(z.string().trim().min(1).max(200)).max(100) }),
]) })

export default function CreateRecipePage({ save, notesSupported = true }: { save?: SaveRecipeDraft; notesSupported?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const userId = user?.id
  const manual = useMemo(() => {
    const parsed = manualRecipeLocation.safeParse(location.state)
    if (!parsed.success || !userId || parsed.data.manualRecipe.userId !== userId) return undefined
    const handoff = parsed.data.manualRecipe
    const draft = emptyRecipeDraft()
    if (handoff.source === 'quick-entry') draft.notes = handoff.notes
    else draft.ingredients = handoff.ingredients.map((name) => ({ name, quantity: null, unit: null, inferred: false }))
    return { source: handoff.source, initialEditorState: editorState(draft) }
  }, [location.state, userId])
  const [dirty, setDirty] = useState(false)
  const [savedRecipe, setSavedRecipe] = useState<{ id: string; title: string; userId: string } | null>(null)
  const saveRecipe = useRecipeSave(save)
  const submit: typeof saveRecipe = async (...args) => {
    const result = await saveRecipe(...args)
    if (user) setSavedRecipe({ id: result.id, title: args[0].title, userId: user.id })
    return result
  }
  const navigationConfirmation = useUnsavedChangesGuard(dirty)
  return <RecipeForm key={userId ?? 'signed-out'} mode="create" newRecipeScrapbook onSubmit={submit} onDirtyChange={setDirty} notesSupported={notesSupported}
    initialEditorState={manual?.initialEditorState}
    cancelLabel={manual?.source === 'quick-entry' ? 'Back to cooking notes' : manual ? 'Back to AI Chef' : undefined}
    onCancel={() => navigate(manual ? `/app/${manual.source}` : journalReturnTo(location.state, '/app'))}
    supplement={import.meta.env.VITE_RECIPE_IMAGES === 'true' && savedRecipe?.userId === user?.id && savedRecipe && <RecipeImagePanel key={`${user?.id}:${savedRecipe.id}`} recipeId={savedRecipe.id} recipeTitle={savedRecipe.title} allowUpload />}
    renderFrame={(content) => <RecipeEditorFrame mode="create" connected showBack={false}
      headingIntro="Save with a title. Add ingredients and steps anytime."
      navigationConfirmation={navigationConfirmation}>{content}</RecipeEditorFrame>} />
}
