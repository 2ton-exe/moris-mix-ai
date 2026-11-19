import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { useMoriActivity } from '../mori/MoriCompanionContext'
import { ArrowDown, ArrowLeft, ArrowUp, Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { RecipeDraft, RecipeEditorState } from './draft'
import { emptyRecipeDraft, editorState, moveRow, validateEditor } from './draft'
import { confirmedSave, RecipeSubmissionError, submissionMessage } from './submission'
import { RecipeFormField } from './RecipeFormField'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { requestJournalPageTurnFrom, useJournalPageTurn } from '../journal/JournalPageTurn'
import { useJournalMedia } from '../journal/useJournalMedia'
import { RecipeWritingTurns } from './RecipeWritingTurns'
import { DEFAULT_FORM_TEXT_CHARS_PER_LEAF, formPagePosition, formTextPageColumns, formTextPageLimit, formTextPageRows, leafAnchorForPage, leafIndexForAnchor, leafKeyForFieldPath, recipeFormLeaves, recipeFormSection, replaceFormTextPart, splitIdentityNotes, splitInstructionText, visibleFormLeafIndices } from './physicalFormPages'
import type { RecipeFormLeaf } from './physicalFormPages'
import type { RecipeFormProps } from './RecipeForm'
import { useIngredientDrag } from './useIngredientDrag'
import { IngredientEmoji } from './IngredientEmojiView'

type RecipeFormEditorProps = Omit<RecipeFormProps, 'initialValues'> & { initialValues?: RecipeDraft }

function resizeTextarea(target: EventTarget | null) {
  if (!(target instanceof HTMLTextAreaElement)) return
  target.style.height = 'auto'
  target.style.height = `${target.scrollHeight}px`
}

export function RecipeFormEditor({ mode, initialValues, initialEditorState, initialValuesAreUnsaved = false, initialSaveConfirmation, saveSuccessMessage, onSubmit, onCancel, cancelLabel = 'Back to journal', onDirtyChange, onEditorStateChange, showExtractionHints = false, reviewWorkflow = false, draftKeptInSession = false, editorIntro, editorTitle, notesSupported = false, renderFrame, notice, reviewPages, reviewStatus, supplement }: RecipeFormEditorProps) {
  const prefix = useId()
  const [state, setState] = useState(() => initialEditorState ?? editorState(initialValues ?? emptyRecipeDraft()))
  const [baseline, setBaseline] = useState<string | null>(() => initialSaveConfirmation ? JSON.stringify(state) : initialValuesAreUnsaved ? null : JSON.stringify(state))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [hasConfirmedSave, setHasConfirmedSave] = useState(initialSaveConfirmation !== undefined)
  const [confirmationMessage, setConfirmationMessage] = useState(initialSaveConfirmation?.statusMessage ?? 'Recipe saved.')
  const [pending, setPending] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [pageAnchor, setPageAnchor] = useState<string>('identity')
  const [editingIngredientKey, setEditingIngredientKey] = useState<string | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<string | null>(null)
  const { isTurning } = useJournalPageTurn()
  const submitting = useRef(false)
  const lifetime = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const focusRequest = useRef<string | null>(null)
  const lastFocusedControl = useRef<{ key: string; start: number | null; end: number | null; direction: 'forward' | 'backward' | 'none' | null } | null>(null)
  const previousLayout = useRef('')
  const [compact, setCompact] = useState(false)
  const [textPageLength, setTextPageLength] = useState(DEFAULT_FORM_TEXT_CHARS_PER_LEAF)
  const [textPageRows, setTextPageRows] = useState(12)
  const [textPageColumns, setTextPageColumns] = useState(56)
  const requestedStart = useRef(0)
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const desktop = useJournalMedia('(min-width: 1100px)')
  const moveDialog = useRef<HTMLDialogElement>(null)
  const movePosition = useRef<HTMLInputElement>(null)
  const movingIngredient = useRef<string | null>(null)
  const ingredientDrag = useIngredientDrag(`${single}:${compact}:${isTurning}:${pageAnchor}:${pending}`)
  const desktopReview = !single && !!reviewPages?.length
  const leaves = useMemo(() => recipeFormLeaves(state, single, desktopReview ? reviewPages.map(({ title }) => title) : [], compact, desktop, textPageLength, textPageRows, textPageColumns), [state, single, desktopReview, reviewPages, compact, desktop, textPageLength, textPageRows, textPageColumns])
  const currentLeafIndex = leafIndexForAnchor(leaves, previewAnchor ?? pageAnchor)
  const position = formPagePosition(currentLeafIndex, leaves.length, single)
  const visibleIndices = visibleFormLeafIndices(currentLeafIndex, leaves.length, single)
  const finalPage = position.page === position.total - 1
  const reviewValidation = useMemo(() => reviewWorkflow ? validateEditor(state) : null, [reviewWorkflow, state])
  const invalidReviewFields = reviewValidation?.success === false ? reviewValidation.error.issues.map(({ path }) => path[0]) : []
  const estimateCount = showExtractionHints ? state.ingredients.filter((ingredient) => ingredient.inferred).length : 0
  const dirty = baseline === null || JSON.stringify(state) !== baseline
  const saved = hasConfirmedSave && !dirty
  const editingCreatedRecipe = mode === 'create' && hasConfirmedSave
  useMoriActivity(message
    ? { kind: Object.keys(errors).length ? 'attention' : 'confused', message: 'Your recipe needs a little attention. Check the form message before serving it up.' }
    : pending
      ? { kind: 'working', message: 'Putting your recipe safely into the journal…' }
      : celebrating
        ? { kind: 'celebrating', message: 'A fresh scrap for your journal. Recipe saved!' }
        : null)

  useEffect(() => {
    if (!celebrating) return
    const timer = window.setTimeout(() => setCelebrating(false), 2400)
    return () => window.clearTimeout(timer)
  }, [celebrating])


  const rememberFocus = useCallback((target: EventTarget | null) => {
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
  }, [])

  useLayoutEffect(() => {
    const book = formRef.current?.querySelector('.mm-journal-book')
    if (!book || single || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      // Smaller books reserve a whole leaf for each row so controls stay reachable.
      const next = entry.contentRect.height < 740
      if (next === compact) return
      rememberFocus(document.activeElement)
      setCompact(next)
    })
    observer.observe(book)
    return () => observer.disconnect()
  }, [single, compact, rememberFocus])

  useLayoutEffect(() => {
    const form = formRef.current
    if (!form) return
    const measure = () => {
      const leaf = form.querySelector<HTMLElement>('.mm-writing-leaf')
      if (!leaf || leaf.clientWidth <= 0 || leaf.clientHeight <= 0) return
      const next = formTextPageLimit(leaf.clientWidth, leaf.clientHeight)
      const nextRows = formTextPageRows(leaf.clientHeight)
      const nextColumns = formTextPageColumns(leaf.clientWidth)
      setTextPageLength((current) => current === next ? current : next)
      setTextPageRows((current) => current === nextRows ? current : nextRows)
      setTextPageColumns((current) => current === nextColumns ? current : nextColumns)
    }
    const book = form.querySelector<HTMLElement>('.mm-journal-book')
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (book) observer?.observe(book)
    form.querySelectorAll('.mm-writing-leaf').forEach((leaf) => observer?.observe(leaf))
    window.addEventListener('resize', measure)
    measure()
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [single, compact, leaves.length, visibleIndices.join(',')])

  useLayoutEffect(() => {
    formRef.current?.querySelectorAll<HTMLTextAreaElement>('[data-form-autosize]').forEach((textarea) => resizeTextarea(textarea))
  }, [state, leaves])

  // One controlled draft owns every value. Only current leaves are mounted.
  useLayoutEffect(() => {
    const layout = single ? 'single' : compact ? 'compact' : 'spread'
    const modeChanged = previousLayout.current !== '' && previousLayout.current !== layout
    previousLayout.current = layout
    const request = focusRequest.current
    if (pending || isTurning || !request) {
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
    target?.focus({ preventScroll: true })
  }, [state, errors, pending, isTurning, pageAnchor, single, compact, desktop, editingIngredientKey, leaves])

  useLayoutEffect(() => {
    requestedStart.current = single ? currentLeafIndex : Math.floor(currentLeafIndex / 2) * 2
  }, [currentLeafIndex, single])

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
    setCelebrating(false)
    setState(next)
    onEditorStateChange?.(next)
    setErrors({})
    setMessage(null)
  }

  function field(path: string, hint = false, focusKey = path, id = prefix + '-' + path) {
    return {
      id, name: path, 'aria-invalid': Boolean(errors[path]),
      'aria-describedby': [hint ? id + '-hint' : '', errors[path] ? id + '-error' : ''].filter(Boolean).join(' ') || undefined,
      'data-form-focus-key': focusKey,
    }
  }

  function focusField(path: string) { focusRequest.current = 'name:' + path }
  function focusStable(key: string) { focusRequest.current = 'focus-key:' + key }

  function openIngredientEditor(key: string) {
    if (!desktop) return
    setEditingIngredientKey(key)
    focusStable('ingredient:' + key + ':name')
  }

  function finishIngredientEditor(key: string) {
    setEditingIngredientKey(null)
    focusStable('ingredient:' + key + ':edit')
  }

  function prepareFieldForFocus(path: string) {
    const ingredient = /^ingredients\.(\d+)\./.exec(path)
    const row = ingredient ? state.ingredients[Number(ingredient[1])] : null
    if (desktop && row) openIngredientEditor(row.key)
    setPageAnchor(leafKeyForFieldPath(path, state))
    focusField(path)
  }

  function turnToPage(page: number): boolean {
    if (pending || isTurning || ingredientDrag.active() || page < 0 || page >= position.total) return false
    const firstIndex = single ? page : page * 2
    const leaf = leaves[firstIndex]
    if (!leaf) return false
    return requestJournalPageTurnFrom(formRef.current, page > position.page ? 'forward' : 'backward', () => setPreviewAnchor(leafAnchorForPage(leaf)), () => {
      requestedStart.current = firstIndex
      setPageAnchor(leafAnchorForPage(leaf))
      setPreviewAnchor(null)
      focusRequest.current = 'leaf-heading'
      if (!reviewWorkflow) setAnnouncement('Opened ' + formPagePosition(firstIndex, leaves.length, single).text + '.')
    }, undefined, () => setPreviewAnchor(null))
  }

  function handlePageKeys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])')) return
    const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0
    if (!direction) return
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
        prepareFieldForFocus(first)
      }
    }
    if (first && fieldPathExists(first)) {
      const targetKey = leafKeyForFieldPath(first, state)
      const targetIndex = leafIndexForAnchor(leaves, targetKey)
      const targetPage = single ? targetIndex : Math.floor(targetIndex / 2)
      if (targetPage !== position.page) {
        const accepted = requestJournalPageTurnFrom(formRef.current, targetPage > position.page ? 'forward' : 'backward', () => {
          setErrors(next)
          setPreviewAnchor(targetKey)
        }, () => {
          if (first && fieldPathExists(first)) prepareFieldForFocus(first)
          else setPageAnchor(targetKey)
          setPreviewAnchor(null)
        }, undefined, () => setPreviewAnchor(null))
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
    if (desktop) openIngredientEditor(key)
    else focusStable('ingredient:' + key + ':name')
  }

  function removeIngredient(key: string, index: number) {
    const next = state.ingredients.filter((row) => row.key !== key)
    change({ ...state, ingredients: next })
    const nextRow = next[Math.min(index, next.length - 1)]
    setPageAnchor(nextRow ? 'ingredient:' + nextRow.key : 'ingredients-empty')
    setAnnouncement('Ingredient ' + (index + 1) + ' removed.')
    focusStable(nextRow ? 'ingredient:' + nextRow.key + (desktop ? ':edit' : ':name') : 'add-ingredient')
  }

  function addStep() {
    if (state.instructions.length >= 100) return
    const key = crypto.randomUUID()
    change({ ...state, instructions: [...state.instructions, { key, text: '' }] })
    setPageAnchor('instruction:' + key)
    setAnnouncement('Cooking step added.')
    focusStable('instruction:' + key + ':text:0')
  }

  function removeStep(key: string, index: number) {
    const next = state.instructions.filter((row) => row.key !== key)
    change({ ...state, instructions: next })
    const nextRow = next[Math.min(index, next.length - 1)]
    setPageAnchor(nextRow ? 'instruction:' + nextRow.key : 'instructions-empty')
    setAnnouncement('Step ' + (index + 1) + ' removed.')
    focusStable(nextRow ? 'instruction:' + nextRow.key + ':text:0' : 'add-step')
  }

  function moveIngredient(key: string, destination: number) {
    const index = state.ingredients.findIndex((item) => item.key === key)
    if (index < 0 || index === destination || destination < 0 || destination >= state.ingredients.length) return
    const item = state.ingredients[index]
    change({ ...state, ingredients: moveRow(state.ingredients, index, destination - index) })
    setPageAnchor('ingredient:' + key)
    focusStable('ingredient:' + key + (desktop || !single ? ':move' : ':name'))
    setAnnouncement(`${item.name.trim() || 'Ingredient ' + (index + 1)} moved to position ${destination + 1} of ${state.ingredients.length}.`)
  }

  function openIngredientMove(key: string, index: number) {
    if (!moveDialog.current || !movePosition.current) return
    movingIngredient.current = key
    movePosition.current.value = String(index + 1)
    moveDialog.current.showModal()
    movePosition.current.select()
  }

  function confirmIngredientMove() {
    const key = movingIngredient.current
    const position = movePosition.current
    if (!key || !position?.reportValidity()) return
    const destination = position.valueAsNumber - 1
    moveDialog.current?.close()
    moveIngredient(key, destination)
  }

  function moveInstruction(key: string, index: number, offset: number) {
    change({ ...state, instructions: moveRow(state.instructions, index, offset) })
    setPageAnchor('instruction:' + key)
    focusStable('instruction:' + key + ':text:0')
    setAnnouncement('Step ' + (index + 1) + ' moved ' + (offset < 0 ? 'up.' : 'down.'))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || ingredientDrag.active() || moveDialog.current?.open || saved || (reviewWorkflow && !finalPage)) return
    setMessage(null)
    setCelebrating(false)
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
      setCelebrating(true)
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
    if (isTurning || ingredientDrag.active()) return
    const index = otherErrorLeafIndices[0]
    if (index === undefined) return
    const path = errorPaths.find((candidate) => leafIndexForAnchor(leaves, leafKeyForFieldPath(candidate, state)) === index)
    const key = path ? leafKeyForFieldPath(path, state) : leaves[index]?.key
    if (!key) return
    const targetPage = single ? index : Math.floor(index / 2)
    const openErrorPage = () => {
      if (index >= 0) requestedStart.current = single ? index : Math.floor(index / 2) * 2
      setPreviewAnchor(null)
      if (path) prepareFieldForFocus(path)
      else {
        setPageAnchor(key)
        focusRequest.current = 'leaf-heading'
      }
      setAnnouncement('Opened another page with an error.')
    }
    if (targetPage !== position.page) {
      const accepted = requestJournalPageTurnFrom(formRef.current, targetPage > position.page ? 'forward' : 'backward', () => setPreviewAnchor(key), openErrorPage, undefined, () => setPreviewAnchor(null))
      if (accepted) return
    }
    openErrorPage()
  }

  function renderLeaf(leaf: RecipeFormLeaf, index: number) {
    const leafNumber = index + 1
    const headingId = prefix + '-leaf-' + index
    const noteParts = splitIdentityNotes(state.notes, textPageLength, textPageRows, textPageColumns)
    const sectionTitle = reviewWorkflow || leaf.kind === 'review'
      ? recipeFormSection(leaf)
      : leaf.kind === 'identity' ? 'Recipe identity' : leaf.kind === 'notes' ? 'Personal notes' : leaf.kind.startsWith('ingredient') ? 'Ingredients' : 'Cooking method'
    let pageContent: ReactNode

    if (leaf.kind === 'identity') {
      pageContent = <>
        <section className="recipe-form-section" aria-labelledby={headingId}>
          <div className="recipe-section-heading">
            <h2 id={headingId} tabIndex={-1}>{sectionTitle}</h2>
            {reviewWorkflow && <span className="recipe-review-count">{invalidReviewFields.some((field) => field !== 'ingredients' && field !== 'instructions') ? 'Check fields' : 'Ready'}</span>}
          </div>
          <RecipeFormField id={field('title').id} label="Recipe title" error={errors.title}>
            <textarea {...field('title')} required maxLength={200} rows={Math.min(3, Math.max(1, Math.ceil(state.title.length / (single ? 16 : 32))))} value={state.title} onChange={(event) => change({ ...state, title: event.target.value })} />
          </RecipeFormField>
          <h3>Cooking information</h3>
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
          <RecipeFormField id={field('notes').id} label="Notes" error={errors.notes} hint={notesSupported ? undefined : 'Local draft only. Notes have no published saving contract yet.'}>
            <textarea {...field('notes', !notesSupported, 'notes:0')} data-form-page-anchor="notes:0" data-form-autosize maxLength={Math.max(noteParts[0].length, 20_000 - state.notes.length + noteParts[0].length)} rows={4} value={noteParts[0]} onChange={(event) => change({ ...state, notes: replaceFormTextPart(noteParts, 0, event.target.value) })} />
          </RecipeFormField>
        </section>
        {supplement}
      </>
    } else if (leaf.kind === 'notes') {
      const partText = noteParts[leaf.part] ?? ''
      const fieldId = `${prefix}-notes-${leaf.part}`
      const continued = leaf.part > 0
      pageContent = <section className="recipe-form-section" aria-labelledby={headingId}>
        <div className="recipe-section-heading"><h2 id={headingId} tabIndex={-1}>Personal notes{continued && <span className="mm-continued"> · continued</span>}</h2></div>
        <RecipeFormField id={fieldId} label={continued ? 'Notes, continued' : 'Notes'} error={errors.notes} hint={notesSupported ? undefined : 'Local draft only. Notes have no published saving contract yet.'}>
          <textarea {...field('notes', !notesSupported, `notes:${leaf.part}`, fieldId)} data-form-page-anchor={`notes:${leaf.part}`} data-form-autosize maxLength={Math.max(partText.length, 20_000 - state.notes.length + partText.length)} rows={5} value={partText} onChange={(event) => change({ ...state, notes: replaceFormTextPart(noteParts, leaf.part, event.target.value) })} />
        </RecipeFormField>
      </section>
    } else if (leaf.kind === 'review') {
      pageContent = <section className="mm-review-leaf" aria-labelledby={headingId}>
        <h2 id={headingId} tabIndex={-1}>{leaf.title}</h2>
        {reviewPages?.[leaf.index]?.content}
      </section>
    } else if (leaf.kind === 'ingredients' || leaf.kind === 'ingredients-empty') {
      const items = leaf.rowKeys.map((key) => {
        const rowIndex = state.ingredients.findIndex((row) => row.key === key)
        return rowIndex >= 0 ? { item: state.ingredients[rowIndex], rowIndex } : null
      }).filter((entry): entry is { item: RecipeEditorState['ingredients'][number]; rowIndex: number } => entry !== null)
      const containsLast = items.some(({ item }) => item.key === state.ingredients.at(-1)?.key)
      const editing = items.find(({ item }) => item.key === editingIngredientKey)
      pageContent = <section className="recipe-form-section recipe-form-section--ingredients" aria-labelledby={headingId}>
        <div className="recipe-section-heading">
          <h2 id={headingId} tabIndex={-1}>Ingredients</h2>
          {estimateCount > 0 && <span className="recipe-review-count">{estimateCount} to review</span>}
          {reviewWorkflow && estimateCount === 0 && items.length > 0 && <span className="recipe-review-count">{invalidReviewFields.includes('ingredients') ? 'Check fields' : 'Ready'}</span>}
        </div>
        <p className="field-hint">A written amount like “to taste” overrides quantity and unit.</p>
        <div className="recipe-ingredient-list" hidden={desktop && Boolean(editing)}>
          {!items.length && <p className="editor-empty">No ingredients yet.</p>}
          {items.map(({ item, rowIndex }) => {
            const amount = item.quantityText.trim() || [item.quantity.trim(), item.unit.trim()].filter(Boolean).join(' ')
            const card = desktop ? <fieldset className="recipe-editor-row recipe-ingredient-card recipe-ingredient-compact">
              <legend className="visually-hidden">Ingredient {rowIndex + 1}</legend>
              <IngredientEmoji name={item.name} />
              <span className="recipe-ingredient-summary">
                <span className="recipe-ingredient-summary__amount">{amount}</span>
                <span className={item.name.trim() ? 'recipe-ingredient-summary__name' : 'recipe-ingredient-summary__name is-empty'}>{item.name.trim() || 'Name this ingredient'}</span>
                {showExtractionHints && item.inferred && <button className="recipe-ingredient-review" type="button" title="Mark as reviewed"
                  aria-label={`Mark as reviewed: ingredient ${rowIndex + 1}`} data-form-focus-key={`ingredient:${item.key}:review`} onClick={() => {
                    change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, inferred: false } : row) })
                    focusStable('ingredient:' + item.key + ':edit')
                    setAnnouncement('Ingredient ' + (rowIndex + 1) + ' marked as reviewed.')
                  }}><Check size={14} aria-hidden="true" /> Needs review</button>}
              </span>
              <span className="recipe-ingredient-compact__actions">
                <button className="recipe-ingredient-control recipe-ingredient-handle" type="button"
                  title="Drag to reorder. Click to choose a position." aria-label={`Move ingredient ${rowIndex + 1}${item.name.trim() ? ': ' + item.name.trim() : ''}`}
                  aria-haspopup="dialog" data-form-focus-key={`ingredient:${item.key}:move`} disabled={state.ingredients.length < 2}
                  onPointerDown={(event) => ingredientDrag.begin(event, (destination) => moveIngredient(item.key, destination), () => setAnnouncement('Ingredient move cancelled.'))}
                  onClick={(event) => { if (ingredientDrag.shouldOpenMove(event)) openIngredientMove(item.key, rowIndex) }}>
                  <GripVertical size={18} aria-hidden="true" />
                </button>
                <button className="recipe-ingredient-control recipe-ingredient-edit" type="button" title="Edit ingredient details"
                  aria-label={`Edit ingredient ${rowIndex + 1}${item.name.trim() ? ': ' + item.name.trim() : ''}`}
                  data-form-focus-key={`ingredient:${item.key}:edit`} onClick={() => openIngredientEditor(item.key)}>
                  <Pencil size={17} aria-hidden="true" />
                </button>
                <button className="recipe-ingredient-control recipe-ingredient-remove" type="button" title="Remove ingredient"
                  aria-label={`Remove ingredient ${rowIndex + 1}`} data-form-focus-key={`ingredient:${item.key}:remove`}
                  onClick={() => removeIngredient(item.key, rowIndex)}><Trash2 size={17} aria-hidden="true" /></button>
              </span>
            </fieldset> : <fieldset className={'recipe-editor-row' + (single ? '' : ' recipe-ingredient-card')}>
              <legend className={single ? undefined : 'visually-hidden'}>Ingredient {rowIndex + 1}</legend>
              {!single && <div className="recipe-ingredient-card__heading">
                <button className="recipe-ingredient-control recipe-ingredient-handle" type="button"
                  title="Drag or move to position" aria-label={`Move ingredient ${rowIndex + 1}${item.name.trim() ? ': ' + item.name.trim() : ''}`}
                  aria-haspopup="dialog" data-form-focus-key={`ingredient:${item.key}:move`} disabled={state.ingredients.length < 2}
                  onPointerDown={(event) => ingredientDrag.begin(event, (destination) => moveIngredient(item.key, destination), () => setAnnouncement('Ingredient move cancelled.'))}
                  onClick={(event) => { if (ingredientDrag.shouldOpenMove(event)) openIngredientMove(item.key, rowIndex) }}>
                  <GripVertical size={19} aria-hidden="true" />
                </button>
                <span aria-hidden="true">Ingredient {rowIndex + 1}</span>
                <button className="recipe-ingredient-control recipe-ingredient-remove" type="button" title="Remove ingredient"
                  aria-label={`Remove ingredient ${rowIndex + 1}`} onClick={() => removeIngredient(item.key, rowIndex)}><X size={17} aria-hidden="true" /></button>
              </div>}
              {showExtractionHints && item.inferred && <div className="recipe-ai-estimate">
                <span>AI suggested · Needs review</span>
                <button className="button button-secondary" type="button" aria-label={`Mark as reviewed: ingredient ${rowIndex + 1}`} onClick={() => {
                  focusStable('ingredient:' + item.key + ':name')
                  change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, inferred: false } : row) })
                  setAnnouncement('Ingredient ' + (rowIndex + 1) + ' marked as reviewed.')
                }}>Mark as reviewed</button>
              </div>}
              {showExtractionHints && !item.quantityText.trim() && (!item.quantity.trim() || !item.unit.trim()) && <p className="recipe-ai-gap" role="note">
                {!item.quantity.trim() && !item.unit.trim() ? 'Quantity and unit not specified.' : !item.quantity.trim() ? 'Quantity not specified.' : 'Unit not specified.'}
              </p>}
              <div className="recipe-ingredient-fields">
                <RecipeFormField id={field('ingredients.' + rowIndex + '.name').id} label={<><span className="visually-hidden">Ingredient {rowIndex + 1} </span>name</>} error={errors['ingredients.' + rowIndex + '.name']}>
                  <input {...field('ingredients.' + rowIndex + '.name', false, 'ingredient:' + item.key + ':name')} maxLength={200} value={item.name} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, name: event.target.value } : row) })} />
                </RecipeFormField>
                <div className="recipe-amount-row">
                  <RecipeFormField id={field('ingredients.' + rowIndex + '.quantity').id} label={<><span className="visually-hidden">Ingredient {rowIndex + 1} </span>quantity</>} error={errors['ingredients.' + rowIndex + '.quantity']}>
                    <input {...field('ingredients.' + rowIndex + '.quantity', false, 'ingredient:' + item.key + ':quantity')} inputMode="decimal" value={item.quantity} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, quantity: event.target.value } : row) })} />
                  </RecipeFormField>
                  <RecipeFormField id={field('ingredients.' + rowIndex + '.unit').id} label={<><span className="visually-hidden">Ingredient {rowIndex + 1} </span>unit</>} error={errors['ingredients.' + rowIndex + '.unit']}>
                    <input {...field('ingredients.' + rowIndex + '.unit', false, 'ingredient:' + item.key + ':unit')} maxLength={100} value={item.unit} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, unit: event.target.value } : row) })} />
                  </RecipeFormField>
                </div>
                <RecipeFormField id={field('ingredients.' + rowIndex + '.quantityText').id} label={<><span className="visually-hidden">Ingredient {rowIndex + 1} </span>amount description <small>(optional)</small></>} error={errors['ingredients.' + rowIndex + '.quantityText']}>
                  <input {...field('ingredients.' + rowIndex + '.quantityText', false, 'ingredient:' + item.key + ':quantityText')} maxLength={200} value={item.quantityText} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === item.key ? { ...row, quantityText: event.target.value } : row) })} />
                </RecipeFormField>
              </div>
              {single && <div className="recipe-row-actions">
                <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === 0} onClick={() => moveIngredient(item.key, rowIndex - 1)} aria-label={'Move ingredient ' + (rowIndex + 1) + ' up'}><ArrowUp size={16} aria-hidden="true" /> Up</button>
                <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === state.ingredients.length - 1} onClick={() => moveIngredient(item.key, rowIndex + 1)} aria-label={'Move ingredient ' + (rowIndex + 1) + ' down'}><ArrowDown size={16} aria-hidden="true" /> Down</button>
                <button className="button button-secondary mm-row-remove mm-button--small" type="button" title="Remove" onClick={() => removeIngredient(item.key, rowIndex)} aria-label={'Remove ingredient ' + (rowIndex + 1)}><X size={16} aria-hidden="true" /> Remove</button>
              </div>}
            </fieldset>
            return desktop || !single ? <div className="recipe-ingredient-slot" data-ingredient-slot={rowIndex} key={item.key}>{card}</div>
              : <Fragment key={item.key}>{card}</Fragment>
          })}
          {(!items.length || containsLast) && <button className="button mm-row-add" type="button" name="add-ingredient" data-form-focus-key="add-ingredient" onClick={addIngredient} disabled={state.ingredients.length >= 100}><Plus size={16} aria-hidden="true" /> Add ingredient</button>}
        </div>
        {desktop && editing && <div className="recipe-ingredient-edit-step" aria-labelledby={prefix + '-ingredient-edit-title'}>
          <div className="recipe-ingredient-edit-step__navigation">
            <button className="recipe-ingredient-back" type="button" onClick={() => finishIngredientEditor(editing.item.key)}><ArrowLeft size={16} aria-hidden="true" /> Back to ingredients</button>
            <span>Ingredient {editing.rowIndex + 1} of {state.ingredients.length}</span>
          </div>
          <div className="recipe-ingredient-edit-step__title">
            <IngredientEmoji name={editing.item.name} />
            <h3 id={prefix + '-ingredient-edit-title'}>Ingredient details</h3>
          </div>
          {showExtractionHints && editing.item.inferred && <div className="recipe-ai-estimate">
            <span>AI suggested · Needs review</span>
            <button className="button button-secondary mm-button--small" type="button" aria-label={`Mark as reviewed: ingredient ${editing.rowIndex + 1}`} onClick={() => {
              change({ ...state, ingredients: state.ingredients.map((row) => row.key === editing.item.key ? { ...row, inferred: false } : row) })
              focusStable('ingredient:' + editing.item.key + ':name')
              setAnnouncement('Ingredient ' + (editing.rowIndex + 1) + ' marked as reviewed.')
            }}>Mark as reviewed</button>
          </div>}
          {showExtractionHints && !editing.item.quantityText.trim() && (!editing.item.quantity.trim() || !editing.item.unit.trim()) && <p className="recipe-ai-gap" role="note">
            {!editing.item.quantity.trim() && !editing.item.unit.trim() ? 'Quantity and unit not specified.' : !editing.item.quantity.trim() ? 'Quantity not specified.' : 'Unit not specified.'}
          </p>}
          <div className="recipe-ingredient-fields">
            <RecipeFormField id={field('ingredients.' + editing.rowIndex + '.name').id} label={<><span className="visually-hidden">Ingredient {editing.rowIndex + 1} </span>name</>} error={errors['ingredients.' + editing.rowIndex + '.name']}>
              <input {...field('ingredients.' + editing.rowIndex + '.name', false, 'ingredient:' + editing.item.key + ':name')} maxLength={200} value={editing.item.name} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === editing.item.key ? { ...row, name: event.target.value } : row) })} />
            </RecipeFormField>
            <div className="recipe-amount-row">
              <RecipeFormField id={field('ingredients.' + editing.rowIndex + '.quantity').id} label={<><span className="visually-hidden">Ingredient {editing.rowIndex + 1} </span>quantity</>} error={errors['ingredients.' + editing.rowIndex + '.quantity']}>
                <input {...field('ingredients.' + editing.rowIndex + '.quantity', false, 'ingredient:' + editing.item.key + ':quantity')} inputMode="decimal" value={editing.item.quantity} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === editing.item.key ? { ...row, quantity: event.target.value } : row) })} />
              </RecipeFormField>
              <RecipeFormField id={field('ingredients.' + editing.rowIndex + '.unit').id} label={<><span className="visually-hidden">Ingredient {editing.rowIndex + 1} </span>unit</>} error={errors['ingredients.' + editing.rowIndex + '.unit']}>
                <input {...field('ingredients.' + editing.rowIndex + '.unit', false, 'ingredient:' + editing.item.key + ':unit')} maxLength={100} value={editing.item.unit} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === editing.item.key ? { ...row, unit: event.target.value } : row) })} />
              </RecipeFormField>
            </div>
            <RecipeFormField id={field('ingredients.' + editing.rowIndex + '.quantityText').id} label={<><span className="visually-hidden">Ingredient {editing.rowIndex + 1} </span>amount description <small>(optional)</small></>} error={errors['ingredients.' + editing.rowIndex + '.quantityText']}>
              <input {...field('ingredients.' + editing.rowIndex + '.quantityText', false, 'ingredient:' + editing.item.key + ':quantityText')} maxLength={200} value={editing.item.quantityText} onChange={(event) => change({ ...state, ingredients: state.ingredients.map((row) => row.key === editing.item.key ? { ...row, quantityText: event.target.value } : row) })} />
            </RecipeFormField>
          </div>
          <div className="recipe-ingredient-edit-step__actions">
            <button className="button button-primary" type="button" onClick={() => finishIngredientEditor(editing.item.key)}>Done</button>
          </div>
        </div>}
      </section>
    } else {
      const items = leaf.kind === 'instructions' ? leaf.rowKeys.map((key) => {
        const rowIndex = state.instructions.findIndex((row) => row.key === key)
        const part = leaf.kind === 'instructions' ? leaf.textParts.find((entry) => entry.rowKey === key)?.part ?? 0 : 0
        return rowIndex >= 0 ? { item: state.instructions[rowIndex], rowIndex, part } : null
      }).filter((entry): entry is { item: RecipeEditorState['instructions'][number]; rowIndex: number; part: number } => entry !== null) : []
      const containsLast = items.some(({ item }) => item.key === state.instructions.at(-1)?.key)
      pageContent = <section className="recipe-form-section" aria-labelledby={headingId}>
        <div className="recipe-section-heading">
          <h2 id={headingId} tabIndex={-1}>{sectionTitle}</h2>
          {reviewWorkflow && items.length > 0 && <span className="recipe-review-count">{invalidReviewFields.includes('instructions') ? 'Check fields' : 'Ready'}</span>}
        </div>
        {!items.length && <p className="editor-empty">No cooking steps yet.</p>}
        {items.map(({ item, rowIndex, part }) => {
          const parts = splitInstructionText(item.text, textPageLength, textPageRows, textPageColumns)
          const partText = parts[part] ?? ''
          const fieldId = `${prefix}-instructions-${rowIndex}-${part}`
          return <fieldset className="recipe-editor-row" key={item.key}>
          <legend>Step {rowIndex + 1}{state.instructions.length > 1 ? ' of ' + state.instructions.length : ''}{part > 0 ? ' · continued' : ''}</legend>
          <RecipeFormField id={fieldId} label={'Step ' + (rowIndex + 1) + (part > 0 ? ' continued' : '') + ' description'} error={errors['instructions.' + rowIndex + '.text']}>
            <textarea {...field('instructions.' + rowIndex + '.text', false, `instruction:${item.key}:text:${part}`, fieldId)} data-form-page-anchor={`instruction:${item.key}:part:${part}`} data-form-autosize maxLength={Math.max(partText.length, 2_000 - item.text.length + partText.length)} rows={4} value={partText} onChange={(event) => change({ ...state, instructions: state.instructions.map((row) => row.key === item.key ? { ...row, text: replaceFormTextPart(parts, part, event.target.value) } : row) })} />
          </RecipeFormField>
          {part === 0 && <div className="recipe-row-actions">
            <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === 0} onClick={() => moveInstruction(item.key, rowIndex, -1)} aria-label={'Move step ' + (rowIndex + 1) + ' up'}><ArrowUp size={16} aria-hidden="true" /> Up</button>
            <button className="button button-secondary mm-button--small" type="button" disabled={rowIndex === state.instructions.length - 1} onClick={() => moveInstruction(item.key, rowIndex, 1)} aria-label={'Move step ' + (rowIndex + 1) + ' down'}><ArrowDown size={16} aria-hidden="true" /> Down</button>
            <button className="button button-secondary mm-row-remove mm-button--small" type="button" title="Remove" onClick={() => removeStep(item.key, rowIndex)} aria-label={'Remove step ' + (rowIndex + 1)}><X size={16} aria-hidden="true" /> Remove</button>
          </div>}
        </fieldset>
        })}
        {(!items.length || containsLast) && <button className="button mm-row-add" type="button" name="add-step" data-form-focus-key="add-step" onClick={addStep} disabled={state.instructions.length >= 100}><Plus size={16} aria-hidden="true" /> Add cooking step</button>}
      </section>
    }

    return <fieldset className="recipe-form-controls mm-writing-page-controls" key={leaf.key} disabled={pending}>
      <legend className="visually-hidden">{sectionTitle}</legend>
      <div className={'mm-page-body mm-writing-leaf' + (leaf.kind === 'identity' ? ' mm-form-identity' : leaf.kind === 'review' ? '' : ' mm-form-recipe')}
        data-writing-leaf-key={leaf.key}
        role="region" aria-label={sectionTitle + ', page ' + leafNumber} tabIndex={0}>
        {single && <h1 className="mm-writing-mobile-title" tabIndex={-1}>{editorTitle ?? (mode === 'create' ? editingCreatedRecipe ? 'Edit saved recipe' : 'New recipe' : 'Edit recipe')}</h1>}
        {single && editorIntro && leaf.kind === 'identity' && <p className="mm-review-intro">{editorIntro}</p>}
        <div className="mm-writing-leaf__content">{(!desktopReview || (hasConfirmedSave && !visibleIndices.includes(1))) && (single || leafNumber % 2 === 0 || pageIndex === undefined || !leaves[pageIndex]) && notice}{pageContent}</div>
      </div>
    </fieldset>
  }

  const saveButton = <button key="save" className="button button-primary" type="submit" disabled={pending || saved}>
    {pending ? 'Saving…' : mode === 'create' && !editingCreatedRecipe ? 'Save recipe' : 'Save changes'}
  </button>
  const exitButton = onCancel && <button className={reviewWorkflow ? 'button mm-review-exit' : 'button button-secondary'} type="button" disabled={pending} onClick={onCancel}>{cancelLabel}</button>

  function sectionsOnPage(page: number) {
    const first = single ? page : page * 2
    return [...new Set(leaves.slice(first, first + (single ? 1 : 2)).map(recipeFormSection))].join(' and ')
  }

  const content = <>
    <JournalFacingPage className="mm-facing-content--form mm-page-column mm-journal-editor">
      {!single && faceIndex >= 0 && leaves[faceIndex] && renderLeaf(leaves[faceIndex], faceIndex)}
    </JournalFacingPage>
    <div className="recipe-form-content mm-writing-pages mm-page-column" data-form-page={single ? currentLeafIndex : Math.floor(currentLeafIndex / 2)}>
      {pageIndex !== undefined && leaves[pageIndex] ? renderLeaf(leaves[pageIndex], pageIndex) : <div className="mm-writing-blank-page" aria-hidden="true" />}
    </div>
    <JournalPageFooter><div className="mm-form-footer">
      {desktopReview && !hasConfirmedSave && !visibleIndices.includes(1) && reviewStatus}
      {message && <p className="field-error" role="alert">{message}</p>}
      {saved && <p className="recipe-save-success" role="status">{saveSuccessMessage ?? confirmationMessage}</p>}
      {pending && <p role="status">Saving your recipe…</p>}
      {otherErrorLeafIndices.length > 0 && <button className="mm-writing-error-link" type="button" onClick={visitNextErrorPage} aria-label={'Go to another recipe page with errors. ' + otherErrorLeafIndices.length + (otherErrorLeafIndices.length === 1 ? ' other page has' : ' other pages have') + ' errors.'}>{otherErrorLeafIndices.length} other {otherErrorLeafIndices.length === 1 ? 'page has' : 'pages have'} errors</button>}
      <RecipeWritingTurns page={position.page} total={position.total} text={position.text} single={single} onTurn={turnToPage}
        review={reviewWorkflow ? {
          current: `${sectionsOnPage(position.page)} · Step ${position.page + 1} of ${position.total}`,
          previous: position.page > 0 ? sectionsOnPage(position.page - 1) : undefined,
          next: finalPage ? undefined : sectionsOnPage(position.page + 1),
          save: saveButton,
          exit: exitButton,
        } : undefined} />
      {!reviewWorkflow && <div className="actions recipe-form-actions">{saveButton}{exitButton}</div>}
      {reviewWorkflow && finalPage && estimateCount > 0 && <p className="field-hint">{estimateCount} ingredient {estimateCount === 1 ? 'estimate still needs' : 'estimates still need'} review.</p>}
      {dirty && <p className="field-hint">{draftKeptInSession ? "Draft kept in this tab" : "Unsaved changes"}</p>}
    </div></JournalPageFooter>
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </>

  return <form className={reviewWorkflow ? "recipe-form mm-recipe-review" : "recipe-form"} ref={formRef} noValidate aria-label={mode === 'create' ? editingCreatedRecipe ? 'Edit saved recipe' : 'Create recipe' : 'Edit recipe'} aria-busy={pending}
    onSubmit={(event) => { void submit(event) }} onKeyDown={handlePageKeys}
    onFocusCapture={(event) => {
      const target = event.target
      rememberFocus(target)
      if (target.dataset.formFocusKey && target.matches('input[name], textarea[name], select[name]')) {
        setPageAnchor(target.dataset.formPageAnchor ?? leafKeyForFieldPath(target.getAttribute('name') ?? '', state))
      }
    }} onInputCapture={(event) => { resizeTextarea(event.target); rememberFocus(event.target) }}
    onSelectCapture={(event) => rememberFocus(event.target)} onKeyUpCapture={(event) => rememberFocus(event.target)}
    onMouseUpCapture={(event) => rememberFocus(event.target)}>
    {renderFrame ? renderFrame(content) : content}
    <dialog className="recipe-ingredient-move" ref={moveDialog} aria-labelledby={prefix + '-move-title'}>
      <h2 id={prefix + '-move-title'}>Move ingredient</h2>
      <label htmlFor={prefix + '-move-position'}>Move to position</label>
      <input id={prefix + '-move-position'} ref={movePosition} type="number" min={1} max={state.ingredients.length}
        required aria-describedby={prefix + '-move-range'} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); confirmIngredientMove() }
        }} />
      <p id={prefix + '-move-range'} className="field-hint">Choose a position from 1 to {state.ingredients.length}.</p>
      <div className="actions">
        <button type="button" className="mm-button mm-button--paper" onClick={() => moveDialog.current?.close()}>Cancel</button>
        <button type="button" className="mm-button mm-button--burgundy" onClick={confirmIngredientMove}>Move ingredient</button>
      </div>
    </dialog>
  </form>
}
