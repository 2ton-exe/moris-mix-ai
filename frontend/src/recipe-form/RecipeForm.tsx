import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { RecipeDraft, RecipeDraftInput, RecipeEditorState } from './draft'
import { editorState, emptyRecipeDraft, moveRow, recipeDraftSchema, validateEditor } from './draft'
import { confirmedSave, RecipeSubmissionError, submissionMessage } from './submission'
import type { RecipeSaveConfirmation } from './submission'
import { RecipeFormField } from './RecipeFormField'

type RecipeFormProps = {
  mode: 'create' | 'edit'
  initialValues?: RecipeDraftInput
  onSubmit?: (draft: RecipeDraft, context: { signal: AbortSignal }) => Promise<RecipeSaveConfirmation>
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
  notesSupported?: boolean
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

function RecipeFormEditor({ mode, initialValues, onSubmit, onCancel, onDirtyChange, notesSupported = false }: Omit<RecipeFormProps, 'initialValues'> & { initialValues?: RecipeDraft }) {
  const prefix = useId()
  const [state, setState] = useState(() => editorState(initialValues ?? emptyRecipeDraft()))
  const [baseline, setBaseline] = useState(() => JSON.stringify(state))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [hasConfirmedSave, setHasConfirmedSave] = useState(false)
  const [pending, setPending] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const submitting = useRef(false)
  const lifetime = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const nextFocus = useRef<string | null>(null)
  const dirty = JSON.stringify(state) !== baseline
  const saved = hasConfirmedSave && !dirty

  // Finish focus during the DOM commit, before a user can type into the next
  // field. A delayed animation-frame callback can otherwise steal their focus.
  useLayoutEffect(() => {
    if (pending || !nextFocus.current) return
    const path = nextFocus.current
    nextFocus.current = null
    const input = path === 'first-error'
      ? formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      : formRef.current?.elements.namedItem(path)
    if (input instanceof HTMLElement) input.focus()
  }, [state, errors, pending])

  useEffect(() => () => {
    lifetime.current++
    controller.current?.abort()
    onDirtyChange?.(false)
  }, [onDirtyChange])
  useLayoutEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function change(next: RecipeEditorState) {
    setState(next)
    onDirtyChange?.(JSON.stringify(next) !== baseline)
    setErrors({})
    setMessage(null)
  }

  function field(path: string, hint = false) {
    const id = `${prefix}-${path}`
    return { id, name: path, 'aria-invalid': Boolean(errors[path]),
      'aria-describedby': [hint ? `${id}-hint` : '', errors[path] ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined }
  }

  function focusError() { nextFocus.current = 'first-error' }
  function focusField(name: string) { nextFocus.current = name }

  function addIngredient() {
    change({ ...state, ingredients: [...state.ingredients, { key: crypto.randomUUID(), name: '', quantity: '', unit: '', quantityText: '', inferred: false }] })
    setAnnouncement('Ingredient added.')
    focusField(`ingredients.${state.ingredients.length}.name`)
  }

  function removeIngredient(key: string, index: number) {
    const next = state.ingredients.filter((row) => row.key !== key)
    change({ ...state, ingredients: next })
    setAnnouncement(`Ingredient ${index + 1} removed.`)
    focusField(next.length ? `ingredients.${Math.min(index, next.length - 1)}.name` : 'add-ingredient')
  }

  function addStep() {
    change({ ...state, instructions: [...state.instructions, { key: crypto.randomUUID(), text: '' }] })
    setAnnouncement('Cooking step added.')
    focusField(`instructions.${state.instructions.length}.text`)
  }

  function removeStep(key: string, index: number) {
    const next = state.instructions.filter((row) => row.key !== key)
    change({ ...state, instructions: next })
    setAnnouncement(`Step ${index + 1} removed.`)
    focusField(next.length ? `instructions.${Math.min(index, next.length - 1)}.text` : 'add-step')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || saved) return
    setMessage(null)
    const result = validateEditor(state)
    if (!result.success) {
      const next: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const path = issue.path.join('.')
        next[path] = path === 'title' ? 'Enter a recipe title.' : path.endsWith('.quantity') ? 'Enter a finite number, or leave the quantity blank.' : path === 'star_rating' ? 'Choose a rating from 1 to 5, or leave it unrated.' : path === 'cooked_at' ? 'Enter a valid calendar date.' : 'Check this value.'
      }
      setErrors(next)
      setMessage('Please check the highlighted fields.')
      focusError()
      return
    }
    const startedAt = lifetime.current
    const request = new AbortController()
    controller.current = request
    submitting.current = true
    setPending(true)
    try {
      if (!onSubmit) throw new RecipeSubmissionError('unavailable')
      if (result.data.notes && !notesSupported) throw new RecipeSubmissionError('notes-unsupported')
      const confirmation = await onSubmit(result.data, { signal: request.signal })
      if (lifetime.current !== startedAt || request.signal.aborted) return
      if (!confirmedSave(confirmation)) throw new Error('Missing persistence confirmation')
      setBaseline(JSON.stringify(state))
      onDirtyChange?.(false)
      setHasConfirmedSave(true)
    } catch (error) {
      if (lifetime.current !== startedAt || request.signal.aborted) return
      if (error instanceof RecipeSubmissionError && error.kind === 'validation') {
        const next: Record<string, string> = {}
        for (const issue of error.violations) {
          if (formRef.current?.elements.namedItem(issue.path)) next[issue.path] = issue.code === 'too-long' ? 'This value is too long. Please shorten it.' : issue.code === 'required' ? 'Enter a value for this field.' : 'Check this value.'
        }
        setErrors(next)
        focusError()
      }
      setMessage(submissionMessage(error))
    } finally {
      if (lifetime.current === startedAt) {
        submitting.current = false
        controller.current = null
        setPending(false)
      }
    }
  }

  function cancel() {
    onCancel?.()
  }

  const editingCreatedRecipe = mode === 'create' && hasConfirmedSave
  return <form className="recipe-form" ref={formRef} noValidate aria-label={mode === 'create' ? editingCreatedRecipe ? 'Edit saved recipe' : 'Create recipe' : 'Edit recipe'} aria-busy={pending} onSubmit={(event) => { void submit(event) }}>
    <fieldset className="recipe-form-controls" disabled={pending}>
      <legend className="visually-hidden">Recipe details</legend>
      <section className="recipe-form-section" aria-labelledby={`${prefix}-details`}>
        <h2 id={`${prefix}-details`}>A name to remember</h2>
        <RecipeFormField id={field('title').id} label="Recipe title" error={errors.title}>
          <input {...field('title')} required value={state.title} onChange={(event) => change({ ...state, title: event.target.value })} />
        </RecipeFormField>
      </section>

      <section className="recipe-form-section" aria-labelledby={`${prefix}-ingredients`}>
        <h2 id={`${prefix}-ingredients`}>Ingredients</h2>
        <p className="field-hint">Use your own units. Leave amounts blank when you cook by feel.</p>
        {!state.ingredients.length && <p className="editor-empty">No ingredients added.</p>}
        {state.ingredients.map((item, index) => <fieldset className="recipe-editor-row" key={item.key}>
          <legend>Ingredient {index + 1}</legend>
          <RecipeFormField id={field(`ingredients.${index}.name`).id} label={`Ingredient ${index + 1} name`} error={errors[`ingredients.${index}.name`]}>
            <input {...field(`ingredients.${index}.name`)} value={item.name} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, name: event.target.value } : row) })} />
          </RecipeFormField>
          <div className="recipe-amount-row">
            <RecipeFormField id={field(`ingredients.${index}.quantity`).id} label={`Ingredient ${index + 1} quantity`} error={errors[`ingredients.${index}.quantity`]}>
              <input {...field(`ingredients.${index}.quantity`)} inputMode="decimal" value={item.quantity} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, quantity: event.target.value } : row) })} />
            </RecipeFormField>
            <RecipeFormField id={field(`ingredients.${index}.unit`).id} label={`Ingredient ${index + 1} unit`} error={errors[`ingredients.${index}.unit`]}>
              <input {...field(`ingredients.${index}.unit`)} value={item.unit} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, unit: event.target.value } : row) })} />
            </RecipeFormField>
          </div>
          <RecipeFormField id={field(`ingredients.${index}.quantityText`).id} label={`Ingredient ${index + 1} amount description`} hint="Optional wording, such as “to taste”. When present, this is displayed instead of the numeric amount.">
            <input {...field(`ingredients.${index}.quantityText`, true)} value={item.quantityText} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, quantityText: event.target.value } : row) })} />
          </RecipeFormField>
          <div className="recipe-row-actions">
            <button type="button" disabled={index === 0} onClick={() => { change({ ...state, ingredients: moveRow(state.ingredients, index, -1) }); setAnnouncement(`Ingredient ${index + 1} moved up.`) }} aria-label={`Move ingredient ${index + 1} up`}>Move up</button>
            <button type="button" disabled={index === state.ingredients.length - 1} onClick={() => { change({ ...state, ingredients: moveRow(state.ingredients, index, 1) }); setAnnouncement(`Ingredient ${index + 1} moved down.`) }} aria-label={`Move ingredient ${index + 1} down`}>Move down</button>
            <button type="button" onClick={() => removeIngredient(item.key, index)} aria-label={`Remove ingredient ${index + 1}`}>Remove</button>
          </div>
        </fieldset>)}
        <button className="button button-secondary" type="button" name="add-ingredient" onClick={addIngredient}>Add ingredient</button>
      </section>

      <section className="recipe-form-section" aria-labelledby={`${prefix}-steps`}>
        <h2 id={`${prefix}-steps`}>In the kitchen</h2>
        {!state.instructions.length && <p className="editor-empty">No cooking steps added.</p>}
        {state.instructions.map((item, index) => <fieldset className="recipe-editor-row" key={item.key}>
          <legend>Step {index + 1}</legend>
          <RecipeFormField id={field(`instructions.${index}.text`).id} label={`Step ${index + 1} description`} error={errors[`instructions.${index}.text`]}>
            <textarea {...field(`instructions.${index}.text`)} rows={3} value={item.text} onChange={(event) => change({ ...state, instructions: state.instructions.map((row) => row.key === item.key ? { ...row, text: event.target.value } : row) })} />
          </RecipeFormField>
          <div className="recipe-row-actions">
            <button type="button" disabled={index === 0} onClick={() => { change({ ...state, instructions: moveRow(state.instructions, index, -1) }); setAnnouncement(`Step ${index + 1} moved up.`) }} aria-label={`Move step ${index + 1} up`}>Move up</button>
            <button type="button" disabled={index === state.instructions.length - 1} onClick={() => { change({ ...state, instructions: moveRow(state.instructions, index, 1) }); setAnnouncement(`Step ${index + 1} moved down.`) }} aria-label={`Move step ${index + 1} down`}>Move down</button>
            <button type="button" onClick={() => removeStep(item.key, index)} aria-label={`Remove step ${index + 1}`}>Remove</button>
          </div>
        </fieldset>)}
        <button className="button button-secondary" type="button" name="add-step" onClick={addStep}>Add cooking step</button>
      </section>

      <section className="recipe-form-section" aria-labelledby={`${prefix}-journal`}>
        <h2 id={`${prefix}-journal`}>Your journal notes</h2>
        <div className="recipe-amount-row">
          <RecipeFormField id={field('star_rating').id} label="Rating" error={errors.star_rating}>
            <select {...field('star_rating')} value={state.rating} onChange={(event) => change({ ...state, rating: event.target.value })}>
              <option value="">Unrated</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}
            </select>
          </RecipeFormField>
          <RecipeFormField id={field('cooked_at').id} label="Cooked date" error={errors.cooked_at}>
            <input {...field('cooked_at')} type="date" value={state.cookedDate} onChange={(event) => change({ ...state, cookedDate: event.target.value })} />
          </RecipeFormField>
        </div>
        <RecipeFormField id={field('notes').id} label="Notes" error={errors.notes} hint={notesSupported ? 'Optional. Keep the little things you want to remember.' : 'Local draft only. Notes have no published saving contract yet and stay on this page.'}>
          <textarea {...field('notes', true)} rows={5} value={state.notes} onChange={(event) => change({ ...state, notes: event.target.value })} />
        </RecipeFormField>
      </section>
      {message && <p className="field-error" role="alert">{message}</p>}
      {saved && <p className="recipe-save-success" role="status">Recipe saved.</p>}
      {pending && <p role="status">Saving your recipe…</p>}
      <div className="actions recipe-form-actions">
        <button className="button button-primary" type="submit" disabled={pending || saved}>{pending ? 'Saving…' : mode === 'create' && !editingCreatedRecipe ? 'Save recipe' : 'Save changes'}</button>
        {onCancel && <button className="button button-secondary" type="button" onClick={cancel}>Back to journal</button>}
      </div>
      <p className="field-hint">{dirty ? 'You have unsaved changes.' : 'Changes are saved only after the recipe service confirms them.'}</p>
    </fieldset>
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </form>
}
