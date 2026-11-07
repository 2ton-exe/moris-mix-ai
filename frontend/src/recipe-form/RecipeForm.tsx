import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RecipeDraft, RecipeDraftInput } from './draft'
import { recipeDraftSchema } from './draft'
import type { RecipeSaveConfirmation } from './submission'
import { RecipeFormEditor } from './RecipeFormEditor'

export type RecipeFormProps = {
  mode: 'create' | 'edit'
  initialValues?: RecipeDraftInput
  onSubmit?: (draft: RecipeDraft, context: { signal: AbortSignal }) => Promise<RecipeSaveConfirmation>
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
  notesSupported?: boolean
  renderFrame?: (content: ReactNode) => ReactNode
  notice?: ReactNode
}

// Mount once per account/recipe. Same-record refetches must not replace a dirty
// editor; the page/host keys this component when that identity changes.
export function RecipeForm(props: RecipeFormProps) {
  const [initial] = useState(() => props.initialValues && recipeDraftSchema.safeParse(props.initialValues))
  if ((props.initialValues && !initial?.success) || (props.mode === 'edit' && !props.initialValues)) {
    return <p className="field-error" role="alert">This recipe could not be prepared for editing. Please reload it before making changes.</p>
  }
  return <RecipeFormEditor {...props} initialValues={initial?.success ? initial.data : undefined} />
}
