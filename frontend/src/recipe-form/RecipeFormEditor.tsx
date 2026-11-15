import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { RecipeDraft, RecipeEditorState } from './draft'
import { emptyRecipeDraft, editorState, moveRow, validateEditor } from './draft'
import { confirmedSave, RecipeSubmissionError, submissionMessage } from './submission'
import { RecipeFormField } from './RecipeFormField'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { requestJournalPageTurnFrom } from '../journal/JournalPageTurn'
import { useJournalMedia } from '../journal/useJournalMedia'
import { RecipeWritingTurns } from './RecipeWritingTurns'
import { formPagePosition, leafAnchorForPage, leafIndexForAnchor, leafKeyForFieldPath, recipeFormLeaves, visibleFormLeafIndices } from './physicalFormPages'
import type { RecipeFormLeaf } from './physicalFormPages'
import type { RecipeFormProps } from './RecipeForm'

type RecipeFormEditorProps = Omit<RecipeFormProps, 'initialValues'> & { initialValues?: RecipeDraft }

const PAGE_SCROLL_TOLERANCE = 2

function canScrollInDirection(target: Element, direction: 'up' | 'down') {
  let current: Element | null = target
  while (current) {
    if (current instanceof HTMLElement) {
      const overflowY = window.getComputedStyle(current).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        const remaining = direction === 'down'
          ? current.scrollHeight - current.clientHeight - current.scrollTop
          : current.scrollTop
        if (remaining > PAGE_SCROLL_TOLERANCE) return true
      }
    }
    current = current.parentElement
  }
  return false
}

export function RecipeFormEditor({ mode, initialValues, initialEditorState, initialValuesAreUnsaved = false, initialSaveConfirmation, saveSuccessMessage, onSubmit, onCancel, cancelLabel = 'Back to journal', onDirtyChange, onEditorStateChange, showExtractionHints = false, editorTitle, notesSupported = false, renderFrame, notice, supplement }: RecipeFormEditorProps) {
  const prefix = useId()
  const [state, setState] = useState(() => initialEditorState ?? editorState(initialValues ?? emptyRecipeDraft()))
  const [baseline, setBaseline] = useState<string | null>(() => initialSaveConfirmation ? JSON.stringify(state) : initialValuesAreUnsaved ? null : JSON.stringify(state))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [hasConfirmedSave, setHasConfirmedSave] = useState(initialSaveConfirmation !== undefined)
  const [confirmationMessage, setConfirmationMessage] = useState(initialSaveConfirmation?.statusMessage ?? 'Recipe saved.')
  const [pending, setPending] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [pageAnchor, setPageAnchor] = useState<string>('identity')
  const [overflowingLeaves, setOverflowingLeaves] = useState<string[]>([])
  const submitting = useRef(false)
  const lifetime = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const focusRequest = useRef<string | null>(null)
  const lastFocusedControl = useRef<{ key: string; start: number | null; end: number | null; direction: 'forward' | 'backward' | 'none' | null } | null>(null)
  const previousSingle = useRef<boolean | null>(null)
  const requestedStart = useRef(0)
  const leafBodies = useRef(new Map<string, HTMLDivElement>())
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const leaves = useMemo(() => recipeFormLeaves(state, single), [state, single])
  const currentLeafIndex = leafIndexForAnchor(leaves, pageAnchor)
  const position = formPagePosition(currentLeafIndex, leaves.length, single)
  const visibleIndices = visibleFormLeafIndices(currentLeafIndex, leaves.length, single)
  const visibleSignature = visibleIndices.map((index) => leaves[index]?.key ?? '').join('|')
  const dirty = baseline === null || JSON.stringify(state) !== baseline
  const saved = hasConfirmedSave && !dirty
  const editingCreatedRecipe = mode === 'create' && hasConfirmedSave

  // One controlled draft owns every value. Only current leaves are mounted.
  useLayoutEffect(() => {
    const modeChanged = previousSingle.current !== null && previousSingle.current !== single
    previousSingle.current = single
    const request = focusRequest.current
    if (pending || !request) {
      if (modeChanged && document.activeElement === document.body && lastFocusedControl.current) {
        const remembered = lastFocusedControl.current
        const control = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-form-focus-key]') ?? [])
          .find((element) => element.dataset.formFocusKey === remembered.key)
        if (control) {
          control.focus({ preventScroll: true })
          if ((control instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password'].includes(control.type)) || control instanceof HTMLTextAreaElement) {
            if (remembered.start !== null && remembered.end !== null) control.setSelectionRange(remembered.start, remembered.end, remembered.direction ?? undefined)
          }
        }
      }
      return
    }
    focusRequest.current = null
    let target: HTMLElement | null = null
    if (request === 'leaf-heading') {
      const targetLeafKey = leaves[leafIndexForAnchor(leaves, pageAnchor)]?.key
      target = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-writing-leaf-key]') ?? [])
        .find((element) => element.dataset.writingLeafKey === targetLeafKey)
        ?.querySelector<HTMLElement>('h2[tabindex="-1"]') ?? null
    } else if (request.startsWith('focus-key:')) {
      const key = request.slice('focus-key:'.length)
      target = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-form-focus-key]') ?? [])
        .find((element) => element.dataset.formFocusKey === key) ?? null
    } else if (request.startsWith('name:')) {
      const named = formRef.current?.elements.namedItem(request.slice('name:'.length))
      target = named instanceof HTMLElement ? named : formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null
    }
    target?.focus({ preventScroll: request === 'leaf-heading' })
  }, [state, errors, pending, pageAnchor, single, leaves])

  useLayoutEffect(() => {
    requestedStart.current = single ? currentLeafIndex : Math.floor(currentLeafIndex / 2) * 2
  }, [currentLeafIndex, single])

  useLayoutEffect(() => {
    let frame = 0
    const check = () => {
      const next = Array.from(leafBodies.current.entries())
        .filter(([, element]) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2)
        .map(([key]) => key).sort()
      setOverflowingLeaves((previous) => previous.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    const activeBodies = visibleSignature.split('|').filter(Boolean).flatMap((key) => {
      const body = leafBodies.current.get(key)
      if (!body) return []
      const content = body.querySelector<HTMLElement>('.mm-writing-leaf__content')
      return content ? [body, content] : [body]
    })
    activeBodies.forEach((element) => observer?.observe(element))
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [visibleSignature, state, single])

  useEffect(() => () => {
    lifetime.current++
    controller.current?.abort()
    onDirtyChange?.(false)
  }, [onDirtyChange])

  useLayoutEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useLayoutEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function change(next: RecipeEditorState) {
    setState(next)
    onEditorStateChange?.(next)
    setErrors({})
    setMessage(null)
  }

  function field(path: string, hint = false, focusKey = path) {
    const id = prefix + '-' + path
    return {
      id, name: path, 'aria-invalid': Boolean(errors[path]),
      'aria-describedby': [hint ? id + '-hint' : '', errors[path] ? id + '-error' : ''].filter(Boolean).join(' ') || undefined,
      'data-form-focus-key': focusKey,
    }
  }

  function focusField(path: string) { focusRequest.current = 'name:' + path }
  function focusStable(key: string) { focusRequest.current = 'focus-key:' + key }

  function rememberFocus(target: EventTarget | null) {
    if (!(target instanceof HTMLElement) || !target.dataset.formFocusKey) return
    let start: number | null = null
    let end: number | null = null
    let direction: 'forward' | 'backward' | 'none' | null = null
    try {
      if ((target instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password'].includes(target.type)) || target instanceof HTMLTextAreaElement) {
        start = target.selectionStart
        end = target.selectionEnd
        direction = target.selectionDirection
      }
    } catch { /* Native date and select controls do not expose text selection. */ }
    lastFocusedControl.current = { key: target.dataset.formFocusKey, start, end, direction }
  }

  function turnToPage(page: number): boolean {
    if (page < 0 || page >= position.total) return false
    const firstIndex = single ? page : page * 2
    const leaf = leaves[firstIndex]
    if (!leaf) return false
    return requestJournalPageTurnFrom(formRef.current, page > position.page ? 'forward' : 'backward', () => {
      requestedStart.current = firstIndex
      setPageAnchor(leafAnchorForPage(leaf))
      focusRequest.current = 'leaf-heading'
      setAnnouncement('Opened ' + formPagePosition(firstIndex, leaves.length, single).text + '.')
    })
  }

  function handlePageKeys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])')) return
    const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0
    if (!direction) return
    if (event.key === 'PageDown' && canScrollInDirection(target, 'down')) return
    if (event.key === 'PageUp' && canScrollInDirection(target, 'up')) return
    const page = single ? requestedStart.current : Math.floor(requestedStart.current / 2)
    if (turnToPage(page + direction)) event.preventDefault()
  }

  function fieldPathExists(path: string) {
    if (['title', 'cooked_at', 'star_rating', 'notes'].includes(path)) return true
    const ingredient = /^ingredients\.(\d+)\.(name|quantity|unit|quantityText)$/.exec(path)
    if (ingredient) return Number(ingredient[1]) < state.ingredients.length
    const instruction = /^instructions\.(\d+)\.text$/.exec(path)
    return Boolean(instruction && Number(instruction[1]) < state.instructions.length)
  }

  function showValidationErrors(next: Record<string, string>, firstPath?: string) {
    const first = firstPath ?? Object.keys(next)[0]
    const focusInvalidField = () => {
      setErrors(next)
      if (first && fieldPathExists(first)) {
        const key = leafKeyForFieldPath(first, state)
        setPageAnchor(key)
        focusField(first)
      }
    }
    if (first && fieldPathExists(first)) {
      const targetKey = leafKeyForFieldPath(first, state)
      const targetIndex = leafIndexForAnchor(leaves, targetKey)
      const targetPage = single ? targetIndex : Math.floor(targetIndex / 2)
      if (targetPage !== position.page) {
        const accepted = requestJournalPageTurnFrom(formRef.current, targetPage > position.page ? 'forward' : 'backward', focusInvalidField)
        if (accepted) return
      }
    }
    focusInvalidField()
  }

  function addIngredient() {
    if (state.ingredients.length >= 100) return
    const key = crypto.randomUUID()
    change({ ...state, ingredients: [...state.ingredients, { key, name: '', quantity: '', unit: '', quantityText: '', inferred: false }] })
    setPageAnchor('ingredient:' + key)
    setAnnouncement('Ingredient added.')
    focusStable('ingredient:' + key + ':name')
  }

  function removeIngredient(key: string, index: number) {
    const next = state.ingredients.filter((row) => row.key !== key)
    change({ ...state, ingredients: next })
    const nextRow = next[Math.min(index, next.length - 1)]
    setPageAnchor(nextRow ? 'ingredient:' + nextRow.key : 'ingredients-empty')
    setAnnouncement('Ingredient ' + (index + 1) + ' removed.')
    focusStable(nextRow ? 'ingredient:' + nextRow.key + ':name' : 'add-ingredient')
  }

  function addStep() {
    if (state.instructions.length >= 100) return
    const key = crypto.randomUUID()
    change({ ...state, instructions: [...state.instructions, { key, text: '' }] })
    setPageAnchor('instruction:' + key)
    setAnnouncement('Cooking step added.')
    focusStable('instruction:' + key + ':text')
  }

  function removeStep(key: string, index: number) {
    const next = state.instructions.filter((row) => row.key !== key)
    change({ ...state, instructions: next })
    const nextRow = next[Math.min(index, next.length - 1)]
    setPageAnchor(nextRow ? 'instruction:' + nextRow.key : 'instructions-empty')
    setAnnouncement('Step ' + (index + 1) + ' removed.')
    focusStable(nextRow ? 'instruction:' + nextRow.key + ':text' : 'add-step')
  }

  function moveIngredient(key: string, index: number, offset: number) {
    change({ ...state, ingredients: moveRow(state.ingredients, index, offset) })
    setPageAnchor('ingredient:' + key)
    focusStable('ingredient:' + key + ':name')
    setAnnouncement('Ingredient ' + (index + 1) + ' moved ' + (offset < 0 ? 'up.' : 'down.'))
  }

  function moveInstruction(key: string, index: number, offset: number) {
    change({ ...state, instructions: moveRow(state.instructions, index, offset) })
    setPageAnchor('instruction:' + key)
    focusStable('instruction:' + key + ':text')
    setAnnouncement('Step ' + (index + 1) + ' moved ' + (offset < 0 ? 'up.' : 'down.'))
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
      const first = result.error.issues.map((issue) => issue.path.join('.')).find(fieldPathExists)
      showValidationErrors(next, first)
      setMessage('Please check the highlighted fields.')
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
      setConfirmationMessage(confirmation.statusMessage ?? 'Recipe saved.')
    } catch (error) {
      if (lifetime.current !== startedAt || request.signal.aborted) return
      if (error instanceof RecipeSubmissionError && error.kind === 'validation') {
        const next: Record<string, string> = {}
        for (const issue of error.violations) {
          if (fieldPathExists(issue.path)) next[issue.path] = issue.code === 'too-long' ? 'This value is too long. Please shorten it.' : issue.code === 'required' ? 'Enter a value for this field.' : 'Check this value.'
        }
        showValidationErrors(next)
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

  const errorPaths = Object.keys(errors).filter(fieldPathExists)
  const errorLeafIndices = Array.from(new Set(errorPaths.map((path) => leafIndexForAnchor(leaves, leafKeyForFieldPath(path, state)))))
  const otherErrorLeafIndices = errorLeafIndices.filter((index) => !visibleIndices.includes(index))
  const faceIndex = single ? -1 : visibleIndices[0]
  const pageIndex = single ? currentLeafIndex : visibleIndices[1]

  function visitNextErrorPage() {
    const index = otherErrorLeafIndices[0]
    if (index === undefined) return
    const path = errorPaths.find((candidate) => leafIndexForAnchor(leaves, leafKeyForFieldPath(candidate, state)) === index)
    const key = path ? leafKeyForFieldPath(path, state) : leaves[index]?.key
    if (!key) return
    const targetPage = single ? index : Math.floor(index / 2)
    const openErrorPage = () => {
      if (index >= 0) requestedStart.current = single ? index : Math.floor(index / 2) * 2
      setPageAnchor(key)
      if (path) focusField(path)
      else focusRequest.current = 'leaf-heading'
      setAnnouncement('Opened another page with an error.')
    }
    if (targetPage !== position.page) {
      const accepted = requestJournalPageTurnFrom(formRef.current, targetPage > position.page ? 'forward' : 'backward', openErrorPage)
      if (accepted) return
    }
    openErrorPage()
  }

  function renderLeaf(leaf: RecipeFormLeaf, index: number) {
    const leafNumber = index + 1
    const headingId = prefix + '-leaf-' + index
    const overflowing = overflowingLeaves.includes(leaf.key)
    const sectionTitle = leaf.kind === 'identity' ? 'Recipe identity' : leaf.kind.startsWith('ingredient') ? 'Ingredients' : 'Cooking method'
    let pageContent: ReactNode

    if (leaf.kind === 'identity') {
      pageContent = <>
        <section className="recipe-form-section" aria-labelledby={headingId}>
          <h2 id={headingId} tabIndex={-1}>Recipe identity</h2>
          <RecipeFormField id={field('title').id} label="Recipe title" error={errors.title}>
            <textarea {...field('title')} required maxLength={200} rows={Math.min(3, Math.max(1, Math.ceil(state.title.length / 32)))} value={state.title} onChange={(event) => change({ ...state, title: event.target.value })} />
          </RecipeFormField>
        </section>
        <section className="recipe-form-section" aria-labelledby={prefix + '-journal'}>
          <h2 id={prefix + '-journal'}>Date and personal notes</h2>
          <div className="recipe-amount-row">
            <RecipeFormField id={field('cooked_at').id} label="Cooked date" error={errors.cooked_at}>
              <input {...field('cooked_at')} type="date" value={state.cookedDate} onChange={(event) => change({ ...state, cookedDate: event.target.value })} />
            </RecipeFormField>
            <RecipeFormField id={field('star_rating').id} label="Rating" error={errors.star_rating}>
              <select {...field('star_rating')} value={state.rating} onChange={(event) => change({ ...state, rating: event.target.value })}>
                <option value="">Unrated</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}
              </select>
            </RecipeFormField>
          </div>
          <RecipeFormField id={field('notes').id} label="Notes" error={errors.notes} hint={notesSupported ? 'Optional. Keep the little things you want to remember.' : 'Local draft only. Notes have no published saving contract yet and stay on this page.'}>
            <textarea {...field('notes', true)} maxLength={20_000} rows={5} value={state.notes} onChange={(event) => change({ ...state, notes: event.target.value })} />
          </RecipeFormField>
        </section>
        {supplement}
      </>
    } else if (leaf.kind === 'ingredients' || leaf.kind === 'ingredients-empty') {
      const items = leaf.rowKeys.map((key) => {
        const rowIndex = state.ingredients.findIndex((row) => row.key === key)
        return rowIndex >= 0 ? { item: state.ingredients[rowIndex], rowIndex } : null
      }).filter((entry): entry is { item: RecipeEditorState['ingredients'][number]; rowIndex: number } => entry !== null)
      const containsLast = items.some(({ item }) => item.key === state.ingredients.at(-1)?.key)
      pageContent = <section className="recipe-form-section" aria-labelledby={headingId}>
        <h2 id={headingId} tabIndex={-1}>Ingredients</h2>
        <p className="field-hint">Use your own units. Leave amounts blank when you cook by feel.</p>
        {!items.length && <p className="editor-empty">No ingredients added yet. Start with one you reach for every time.</p>}
        {items.map(({ item, rowIndex }) => <fieldset className="recipe-editor-row" key={item.key}>
          <legend>Ingredient {rowIndex + 1}{state.ingredients.length > 1 ? ' of ' + state.ingredients.length : ''}</legend>
          {showExtractionHints && item.inferred && <label className="recipe-ai-estimate">
            <input type="checkbox" checked={item.inferred} aria-label={`Mori estimated ingredient ${rowIndex + 1}`} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, inferred: event.target.checked } : row) })} />
            <span>Mori estimated this ingredient. Review it before saving; uncheck once confirmed.</span>
          </label>}
          {showExtractionHints && !item.quantity.trim() && !item.quantityText.trim() && <p className="recipe-ai-gap" role="note">No amount was extracted. Add one if you know it.</p>}
          {showExtractionHints && !item.unit.trim() && (item.quantity.trim() || item.quantityText.trim()) && <p className="recipe-ai-gap" role="note">No unit was extracted. Add one if you know it.</p>}
          <RecipeFormField id={field('ingredients.' + rowIndex + '.name').id} label={'Ingredient ' + (rowIndex + 1) + ' name'} error={errors['ingredients.' + rowIndex + '.name']}>
            <input {...field('ingredients.' + rowIndex + '.name', false, 'ingredient:' + item.key + ':name')} maxLength={200} value={item.name} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, name: event.target.value } : row) })} />
          </RecipeFormField>
          <div className="recipe-amount-row">
            <RecipeFormField id={field('ingredients.' + rowIndex + '.quantity').id} label={'Ingredient ' + (rowIndex + 1) + ' quantity'} error={errors['ingredients.' + rowIndex + '.quantity']}>
              <input {...field('ingredients.' + rowIndex + '.quantity', false, 'ingredient:' + item.key + ':quantity')} inputMode="decimal" value={item.quantity} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, quantity: event.target.value } : row) })} />
            </RecipeFormField>
            <RecipeFormField id={field('ingredients.' + rowIndex + '.unit').id} label={'Ingredient ' + (rowIndex + 1) + ' unit'} error={errors['ingredients.' + rowIndex + '.unit']}>
              <input {...field('ingredients.' + rowIndex + '.unit', false, 'ingredient:' + item.key + ':unit')} maxLength={100} value={item.unit} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, unit: event.target.value } : row) })} />
            </RecipeFormField>
          </div>
          <RecipeFormField id={field('ingredients.' + rowIndex + '.quantityText').id} label={'Ingredient ' + (rowIndex + 1) + ' amount description'} hint="Optional; for example, ‘to taste’. This takes priority over the numeric amount.">
            <input {...field('ingredients.' + rowIndex + '.quantityText', true, 'ingredient:' + item.key + ':quantityText')} maxLength={200} value={item.quantityText} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, quantityText: event.target.value } : row) })} />
          </RecipeFormField>
          <div className="recipe-row-actions">
            <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === 0} onClick={() => moveIngredient(item.key, rowIndex, -1)} aria-label={'Move ingredient ' + (rowIndex + 1) + ' up'}>Move up</button>
            <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === state.ingredients.length - 1} onClick={() => moveIngredient(item.key, rowIndex, 1)} aria-label={'Move ingredient ' + (rowIndex + 1) + ' down'}>Move down</button>
            <button className="button mm-button--icon" type="button" onClick={() => removeIngredient(item.key, rowIndex)} aria-label={'Remove ingredient ' + (rowIndex + 1)}><X size={17} aria-hidden="true" /></button>
          </div>
        </fieldset>)}
        {(!items.length || containsLast) && <button className="button mm-button--ghost mm-button--small" type="button" name="add-ingredient" data-form-focus-key="add-ingredient" onClick={addIngredient} disabled={state.ingredients.length >= 100}>Add ingredient</button>}
      </section>
    } else {
      const items = leaf.kind === 'instructions' ? leaf.rowKeys.map((key) => {
        const rowIndex = state.instructions.findIndex((row) => row.key === key)
        return rowIndex >= 0 ? { item: state.instructions[rowIndex], rowIndex } : null
      }).filter((entry): entry is { item: RecipeEditorState['instructions'][number]; rowIndex: number } => entry !== null) : []
      const containsLast = items.some(({ item }) => item.key === state.instructions.at(-1)?.key)
      pageContent = <section className="recipe-form-section" aria-labelledby={headingId}>
        <h2 id={headingId} tabIndex={-1}>Cooking method</h2>
        {!items.length && <p className="editor-empty">No cooking steps added yet. Write the first thing you do.</p>}
        {items.map(({ item, rowIndex }) => <fieldset className="recipe-editor-row" key={item.key}>
          <legend>Step {rowIndex + 1}{state.instructions.length > 1 ? ' of ' + state.instructions.length : ''}</legend>
          <RecipeFormField id={field('instructions.' + rowIndex + '.text').id} label={'Step ' + (rowIndex + 1) + ' description'} error={errors['instructions.' + rowIndex + '.text']} hint="Long steps stay in this field. Scroll inside it to review the full text.">
            <textarea {...field('instructions.' + rowIndex + '.text', true, 'instruction:' + item.key + ':text')} maxLength={2_000} rows={4} value={item.text} onChange={(event) => change({ ...state, instructions: state.instructions.map((row) => row.key === item.key ? { ...row, text: event.target.value } : row) })} />
          </RecipeFormField>
          <div className="recipe-row-actions">
            <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === 0} onClick={() => moveInstruction(item.key, rowIndex, -1)} aria-label={'Move step ' + (rowIndex + 1) + ' up'}>Move up</button>
            <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === state.instructions.length - 1} onClick={() => moveInstruction(item.key, rowIndex, 1)} aria-label={'Move step ' + (rowIndex + 1) + ' down'}>Move down</button>
            <button className="button mm-button--icon" type="button" onClick={() => removeStep(item.key, rowIndex)} aria-label={'Remove step ' + (rowIndex + 1)}><X size={17} aria-hidden="true" /></button>
          </div>
        </fieldset>)}
        {(!items.length || containsLast) && <button className="button mm-button--ghost mm-button--small" type="button" name="add-step" data-form-focus-key="add-step" onClick={addStep} disabled={state.instructions.length >= 100}>Add cooking step</button>}
      </section>
    }

    return <fieldset className="recipe-form-controls mm-writing-page-controls" key={leaf.key} disabled={pending}>
      <legend className="visually-hidden">{sectionTitle}</legend>
      <div ref={(element) => { if (element) leafBodies.current.set(leaf.key, element); else leafBodies.current.delete(leaf.key) }}
        className={'mm-page-body mm-writing-leaf' + (leaf.kind === 'identity' ? ' mm-form-identity' : ' mm-form-recipe')}
        data-writing-leaf-key={leaf.key} data-overflowing={overflowing || undefined}
        role="region" aria-label={sectionTitle + ', page ' + leafNumber} tabIndex={0}>
        {single && <h1 className="mm-writing-mobile-title" tabIndex={-1}>{editorTitle ?? (mode === 'create' ? editingCreatedRecipe ? 'Edit saved recipe' : 'A recipe of your own.' : 'Make it your own.')}</h1>}
        <span className="mm-writing-folio" aria-label={'Physical page ' + leafNumber}>Leaf {leafNumber}</span>
        {overflowing && <p className="mm-writing-overflow" role="note">This writing leaf needs a little scrolling. Every field stays together and complete.</p>}
        <div className="mm-writing-leaf__content">{pageContent}</div>
      </div>
    </fieldset>
  }

  const content = <>
    <JournalFacingPage className="mm-facing-content--form mm-page-column">
      {!single && faceIndex >= 0 && leaves[faceIndex] && renderLeaf(leaves[faceIndex], faceIndex)}
    </JournalFacingPage>
    <div className="recipe-form-content mm-writing-pages mm-page-column" data-form-page={single ? currentLeafIndex : Math.floor(currentLeafIndex / 2)}>
      {pageIndex !== undefined && leaves[pageIndex] ? renderLeaf(leaves[pageIndex], pageIndex) : <div className="mm-writing-blank-page" aria-hidden="true" />}
    </div>
    <JournalPageFooter><div className="mm-form-footer">
      {message && <p className="field-error" role="alert">{message}</p>}
      {saved && <p className="recipe-save-success" role="status">{saveSuccessMessage ?? confirmationMessage}</p>}
      {pending && <p role="status">Saving your recipe…</p>}
      {notice}
      {otherErrorLeafIndices.length > 0 && <button className="mm-writing-error-link" type="button" onClick={visitNextErrorPage} aria-label={'Go to another recipe page with errors. ' + otherErrorLeafIndices.length + (otherErrorLeafIndices.length === 1 ? ' other page has' : ' other pages have') + ' errors.'}>{otherErrorLeafIndices.length} other {otherErrorLeafIndices.length === 1 ? 'page has' : 'pages have'} errors</button>}
      <RecipeWritingTurns page={position.page} total={position.total} text={position.text} single={single} onTurn={turnToPage} />
      <div className="actions recipe-form-actions">
        <button className="button button-primary" type="submit" disabled={pending || saved}>{pending ? 'Saving…' : mode === 'create' && !editingCreatedRecipe ? 'Save recipe' : 'Save changes'}</button>
        {onCancel && <button className="button button-secondary" type="button" disabled={pending} onClick={() => onCancel()}>{cancelLabel}</button>}
      </div>
      <p className="field-hint">{dirty ? 'You have unsaved changes.' : 'Changes are saved only after the recipe service confirms them.'}</p>
    </div></JournalPageFooter>
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </>

  return <form className="recipe-form" ref={formRef} noValidate aria-label={mode === 'create' ? editingCreatedRecipe ? 'Edit saved recipe' : 'Create recipe' : 'Edit recipe'} aria-busy={pending}
    onSubmit={(event) => { void submit(event) }} onKeyDown={handlePageKeys}
    onFocusCapture={(event) => rememberFocus(event.target)} onInputCapture={(event) => rememberFocus(event.target)}
    onSelectCapture={(event) => rememberFocus(event.target)} onKeyUpCapture={(event) => rememberFocus(event.target)}
    onMouseUpCapture={(event) => rememberFocus(event.target)}>
    {renderFrame ? renderFrame(content) : content}
  </form>
}
