import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RecipeDraft, RecipeDraftInput, RecipeEditorState } from './draft'
import { recipeDraftSchema, recipeEditorStateSchema } from './draft'
import type { RecipeSaveConfirmation } from './submission'
import { confirmedSave } from './submission'
import { RecipeFormEditor } from './RecipeFormEditor'
import { ErrorState } from '../components/ErrorState'

export type RecipeFormProps = {
  mode: 'create' | 'edit'
  initialSection?: 'method'
  initialValues?: RecipeDraftInput
  initialEditorState?: RecipeEditorState
  initialValuesAreUnsaved?: boolean
  initialSaveConfirmation?: RecipeSaveConfirmation
  saveSuccessMessage?: string
  createSubmitLabel?: string
  savedAction?: ReactNode
  onEditSavedRecipe?: () => void
  onSubmit?: (draft: RecipeDraft, context: { signal: AbortSignal }) => Promise<RecipeSaveConfirmation>
  onCancel?: () => void
  cancelLabel?: string
  onDirtyChange?: (dirty: boolean) => void
  onEditorStateChange?: (state: RecipeEditorState) => void
  showExtractionHints?: boolean
  reviewWorkflow?: boolean
  newRecipeScrapbook?: boolean
  editorIntro?: string
  draftKeptInSession?: boolean
  editorTitle?: string
  notesSupported?: boolean
  renderFrame?: (content: ReactNode, initialDesktopReview?: boolean, showingReceipt?: boolean) => ReactNode
  notice?: ReactNode
  reviewPage?: { title: string; content: ReactNode }
  reviewStatus?: ReactNode
  reviewSaveContext?: ReactNode
  reviewReceipt?: ReactNode
  reviewComparison?: (editAmount?: ReactNode) => ReactNode
  comparisonIngredient?: string
  comparisonIngredientIndex?: number
  supplement?: ReactNode
}

// Mount once per account/recipe. Same-record refetches must not replace a dirty
// editor; the page/host keys this component when that identity changes.
export function RecipeForm(props: RecipeFormProps) {
  const [initial] = useState(() => props.initialValues === undefined ? undefined : recipeDraftSchema.safeParse(props.initialValues))
  const [initialState] = useState(() => props.initialEditorState === undefined ? undefined : recipeEditorStateSchema.safeParse(props.initialEditorState))
  if ((props.initialValues !== undefined && !initial?.success) ||
    (props.initialEditorState !== undefined && !initialState?.success) ||
    (props.initialSaveConfirmation !== undefined && !confirmedSave(props.initialSaveConfirmation)) ||
    (props.initialValues !== undefined && props.initialEditorState !== undefined) ||
    (props.mode === 'edit' && props.initialValues === undefined)) {
    const error = <ErrorState message="This recipe could not be prepared for editing. Reload to try again." onRetry={() => window.location.reload()} />
    return props.renderFrame ? props.renderFrame(error) : error
  }
  return <RecipeFormEditor {...props}
    initialValues={initial?.success ? initial.data : undefined}
    initialEditorState={initialState?.success ? initialState.data : undefined} />
}
