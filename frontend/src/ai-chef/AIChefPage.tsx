import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { HttpError } from '../api/http'
import { retryAfterSeconds } from '../api/retryAfter'
import { useMoriActivity, useMoriGuidance } from '../mori/MoriCompanionContext'
import { useMoriFieldFocus } from '../mori/routeState'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalPagination } from '../journal/JournalPagination'
import { useJournalPageTurn } from '../journal/JournalPageTurn'
import { useJournalMedia } from '../journal/useJournalMedia'
import { PaperCard } from '../journal/Scrapbook'
import { UnsavedChangesDialog } from '../recipe-form/UnsavedChangesDialog'
import { formTextPageColumns, formTextRows, replaceFormTextPart, splitFormText } from '../recipe-form/physicalFormPages'
import { MAX_PANTRY_ITEMS, MAX_PREFERENCES_CHARS, addPantryItems, pantryEntryErrorMessage, splitPastedPantryText } from './pantry'
import { generateRecipeApi, generateRecipeErrorMessage, generateRecipeRequestSchema } from './generateRecipe'
import type { ChefReviewHandoff } from './draft'
import { readChefDraftResult, writeChefDraft } from './draft'
import { ChefProgress } from './ChefProgress'
import { PantryCards } from './PantryCards'
import type { PantryCardItem } from './PantryCards'
import { usePantryPageEnds } from './usePantryPageEnds'
import './aiChef.css'

type ChefLeaf =
  | { kind: 'first' }
  | { kind: 'pantry'; id: number }
  | { kind: 'preferences'; part: number }

function leafPage(leaf: ChefLeaf, entries: PantryCardItem[], ends: number[], preferenceCount: number) {
  if (leaf.kind === 'first') return 0
  if (leaf.kind === 'preferences') return ends.length + Math.min(leaf.part, preferenceCount - 1)
  const index = entries.findIndex(({ id }) => id === leaf.id)
  return Math.max(0, ends.findIndex((end) => index < end))
}

export function AIChefPage() {
  const { user } = useAuth()
  if (!user) return <p role="alert">Sign in to use AI Chef.</p>
  return <AIChefSession key={user.id} userId={user.id} />
}

function AIChefSession({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const { key: locationKey } = useLocation()
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const cards = useJournalMedia('(min-width: 1024px) and (pointer: fine)')
  const { isTurning, requestPageTurn } = useJournalPageTurn()
  const [initialRead] = useState(() => readChefDraftResult(userId))
  const [pantryEntries, setPantryEntries] = useState(() =>
    initialRead.draft.input.pantryItems.map((name, id) => ({ id, name })))
  const nextIngredientId = useRef(pantryEntries.length)
  const pantryItems = pantryEntries.map(({ name }) => name)
  const [pantryInput, setPantryInput] = useState(initialRead.draft.input.pantryInput)
  const [preferences, setPreferences] = useState(initialRead.draft.input.preferences)
  const [handoff, setHandoff] = useState<ChefReviewHandoff | null>(initialRead.draft.handoff)
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [requestErrorForPantry, setRequestErrorForPantry] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const retryBlocked = retryAt > now
  const [entryError, setEntryError] = useState<string | null>(null)
  const [entryStatus, setEntryStatus] = useState('')
  const [storageIssue, setStorageIssue] = useState<string | null>(initialRead.status === 'available' ? null : initialRead.status)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [guidedPantry, setGuidedPantry] = useState(false)
  const [chefLeaf, setChefLeaf] = useState<ChefLeaf>({ kind: 'first' })
  const [previewLeaf, setPreviewLeaf] = useState<ChefLeaf | null>(null)
  const [preferenceColumns, setPreferenceColumns] = useState(56)
  const [preferenceRows, setPreferenceRows] = useState(12)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const pantryInputRef = useRef<HTMLInputElement>(null)
  const moriFocusPantry = useMoriFieldFocus('pantry', pantryInputRef, setGuidedPantry)
  const pageRef = useRef<HTMLElement>(null)
  const pendingFocus = useRef<'heading' | 'pantry' | null>(null)
  const lastPageFocus = useRef<HTMLElement | null>(null)
  const pantryEnds = usePantryPageEnds({ pageRef, entries: pantryEntries, cards, single, turning: isTurning, handoff: handoff !== null })
  const preferenceParts = splitFormText(preferences, Math.min(MAX_PREFERENCES_CHARS, preferenceColumns * preferenceRows), preferenceRows, preferenceColumns)
  const preferencesStartPage = pantryEnds.length
  const pageCount = handoff ? 1 : preferencesStartPage + preferenceParts.length
  const page = handoff ? 0 : leafPage(previewLeaf ?? chefLeaf, pantryEntries, pantryEnds, preferenceParts.length)
  const continued = page > 0 && page < preferencesStartPage
  const preferencePartIndex = page - preferencesStartPage
  const preferencePart = preferenceParts[preferencePartIndex] ?? ''
  const preferencePartLimit = MAX_PREFERENCES_CHARS - preferenceParts.reduce((sum, part, index) => sum + (index === preferencePartIndex ? 0 : part.length), 0)
  useMoriActivity(requestError || entryError
    ? { kind: requestErrorForPantry || entryError ? 'attention' : 'confused', message: requestError ?? entryError ?? 'Check your pantry ingredients.' }
    : pending
      ? { kind: 'thinking', message: 'Thinking of something delicious for your pantry…' }
      : null)
  useMoriGuidance(pending ? null : handoff
    ? { message: 'Your recipe idea is waiting in review.', action: { label: 'Return to review', onClick: () => navigate('/app/chef/review') } }
    : { message: 'Tell me what you have, and I’ll make an idea for you to review.', action: { label: 'Add ingredients', onClick: () => {
      if (page === 0) pantryInputRef.current?.focus()
      else turnPage(0, 'pantry')
    } } })

  useEffect(() => () => controller.current?.abort(), [])

  useLayoutEffect(() => {
    if (moriFocusPantry) {
      setChefLeaf({ kind: 'first' })
      setPreviewLeaf(null)
    }
  }, [moriFocusPantry, locationKey])

  useLayoutEffect(() => {
    if (!isTurning && page === 0 && chefLeaf.kind === 'pantry') setChefLeaf({ kind: 'first' })
  }, [isTurning, page, chefLeaf])

  useEffect(() => {
    const rememberPageFocus = ({ target }: FocusEvent) => {
      lastPageFocus.current = target instanceof HTMLElement && pageRef.current?.contains(target) ? target : null
    }
    document.addEventListener('focusin', rememberPageFocus)
    return () => document.removeEventListener('focusin', rememberPageFocus)
  }, [])

  useLayoutEffect(() => {
    const content = pageRef.current
    if (!content || isTurning) return
    const previous = lastPageFocus.current
    const lostOnReflow = previous && (!previous.isConnected || previous.closest('[inert]'))
    if (!pendingFocus.current && !lostOnReflow) return

    content.scrollTop = 0
    if (pendingFocus.current === 'pantry' && page === 0) {
      pendingFocus.current = null
      pantryInputRef.current?.focus({ preventScroll: true })
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (!pendingFocus.current && active !== previous && active !== document.body) return
      pendingFocus.current = null
      const target = content.querySelector<HTMLElement>('h2[tabindex="-1"]:not([inert] *)')
        ?? content.querySelector<HTMLElement>('h1')
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [page, isTurning, handoff, pantryEntries, pantryEnds])

  useLayoutEffect(() => {
    const pageElement = pageRef.current?.closest<HTMLElement>('.mm-journal-page')
    if (!pageElement || isTurning) return
    const measure = () => {
      const width = pageRef.current?.clientWidth ?? 0
      const height = pageElement.clientHeight
      if (width <= 0 || height <= 0) return
      const columns = formTextPageColumns(width - 48)
      const rows = Math.max(3, Math.floor((height - 300) / 32))
      setPreferenceColumns((current) => current === columns ? current : columns)
      setPreferenceRows((current) => current === rows ? current : rows)
    }
    let frame = 0
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measure)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(pageElement)
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.cancelAnimationFrame(frame)
    }
  }, [page, single, isTurning])

  useEffect(() => {
    if (!retryBlocked) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retryBlocked])

  function persistInput(next: { pantryItems: string[]; pantryInput: string; preferences: string }) {
    if (handoff) return
    const nextDraft = { input: next, handoff: null, completedReview: false }
    const result = writeChefDraft(userId, nextDraft)
    setStorageIssue(result.persisted ? null : result.reason)
  }

  function clearRequestError() {
    setRequestError(null)
    setRequestErrorForPantry(false)
  }

  function retryDraftStorage() {
    const current = readChefDraftResult(userId)
    if (JSON.stringify(current.draft.handoff) !== JSON.stringify(handoff)) {
      setStorageIssue('handoff-changed')
      return
    }
    const result = writeChefDraft(userId, { input: { pantryItems, pantryInput, preferences }, handoff, completedReview: current.draft.completedReview })
    setStorageIssue(result.persisted ? null : result.reason)
  }

  function appendPantryItems(items: string[]) {
    const added = items.slice(pantryEntries.length).map((name) => ({ id: nextIngredientId.current++, name }))
    if (added.length > 0) setPantryEntries([...pantryEntries, ...added])
  }

  function addCurrentIngredient() {
    clearRequestError()
    const result = addPantryItems(pantryItems, splitPastedPantryText(pantryInput))
    if (result.error) {
      setEntryError(pantryEntryErrorMessage(result.error) ?? 'Check this pantry item.')
      setEntryStatus('')
      return
    }
    setEntryError(null)
    setEntryStatus(result.added === 0
      ? 'That ingredient is already in your pantry list.'
      : `Added ${result.added} ${result.added === 1 ? 'ingredient' : 'ingredients'}${result.duplicates ? `; skipped ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}` : ''}.`)
    appendPantryItems(result.items)
    setPantryInput('')
    persistInput({ pantryItems: result.items, pantryInput: '', preferences })
  }

  function removeIngredient(id: number) {
    const nextEntries = pantryEntries.filter((entry) => entry.id !== id)
    const active = previewLeaf ?? chefLeaf
    if (active.kind === 'pantry' && active.id === id) {
      const index = pantryEntries.findIndex((entry) => entry.id === id)
      const neighbor = nextEntries[Math.min(index, nextEntries.length - 1)]
      setChefLeaf(neighbor ? { kind: 'pantry', id: neighbor.id } : { kind: 'first' })
    }
    pendingFocus.current = page === 0 ? 'pantry' : 'heading'
    setPantryEntries(nextEntries)
    clearRequestError()
    persistInput({ pantryItems: nextEntries.map(({ name }) => name), pantryInput, preferences })
    setEntryStatus('Pantry ingredient removed.')
  }

  function updatePantryInput(value: string) {
    setPantryInput(value)
    persistInput({ pantryItems, pantryInput: value, preferences })
    setEntryError(null)
    clearRequestError()
  }

  function updatePreferences(value: string) {
    setPreferences(value)
    persistInput({ pantryItems, pantryInput, preferences: value })
    clearRequestError()
  }

  function turnPage(next: number, focus: 'heading' | 'pantry' = 'heading') {
    if (next < 0 || next >= pageCount || next === page || isTurning) return false
    const index = pantryEnds[next - 1] ?? 0
    const destination: ChefLeaf = next === 0 ? { kind: 'first' }
      : next < preferencesStartPage ? { kind: 'pantry', id: pantryEntries[index].id }
        : { kind: 'preferences', part: next - preferencesStartPage }
    return requestPageTurn(next > page ? 'forward' : 'backward', () => {
      setPreviewLeaf(destination)
    }, () => {
      setChefLeaf(destination)
      setPreviewLeaf(null)
      pendingFocus.current = focus
    }, undefined, () => setPreviewLeaf(null))
  }

  function handlePageKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
    const direction = event.key === 'PageDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'PageUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (direction && turnPage(page + direction)) event.preventDefault()
  }

  async function requestSuggestion(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (inFlight.current || handoff || Date.now() < retryAt) return
    clearRequestError()
    setEntryError(null)

    const requestBody = {
      pantryItems,
      ...(preferences.trim() ? { preferences: preferences.trim() } : {}),
    }
    const parsed = generateRecipeRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      const pantryIssue = parsed.error.issues.some((issue) => issue.path[0] === 'pantryItems')
      setRequestErrorForPantry(pantryIssue)
      setRequestError(pantryIssue
        ? pantryItems.length === 0
          ? 'Add at least one pantry ingredient before asking Mori.'
          : 'Check the pantry list. Add between 1 and 100 items, each 100 characters or fewer.'
        : `Preferences must be ${MAX_PREFERENCES_CHARS} characters or fewer.`)
      if (pantryIssue && pantryItems.length === 0) {
        if (page === 0) pantryInputRef.current?.focus()
        else turnPage(0, 'pantry')
      }
      return
    }

    inFlight.current = true
    setPending(true)
    const requestController = new AbortController()
    controller.current = requestController
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      requestController.abort()
    }, 45_000)

    try {
      const response = await generateRecipeApi.generate(parsed.data.pantryItems, parsed.data.preferences ?? '', {
        userId,
        signal: requestController.signal,
      })
      requestController.signal.throwIfAborted()
      const nextHandoff: ChefReviewHandoff = { request: parsed.data, response, selectedParentIds: [], saved: false }
      const nextDraft = {
        input: { pantryItems, pantryInput, preferences },
        handoff: nextHandoff,
        completedReview: false,
      }
      const writeResult = writeChefDraft(userId, nextDraft)
      setStorageIssue(writeResult.persisted ? null : writeResult.reason)
      navigate('/app/chef/review', { state: { chefGenerationSucceeded: true } })
    } catch (error) {
      if (requestController.signal.aborted && !timedOut) return
      const wait = error instanceof HttpError ? retryAfterSeconds(error.retryAfter) : undefined
      if (wait !== undefined) {
        const currentTime = Date.now()
        setNow(currentTime)
        setRetryAt(currentTime + wait * 1000)
      }
      setRequestError(generateRecipeErrorMessage(error, timedOut))
    } finally {
      window.clearTimeout(timeoutId)
      inFlight.current = false
      controller.current = null
      setPending(false)
    }
  }

  function discardPreview() {
    const nextDraft = { input: { pantryItems, pantryInput, preferences }, handoff: null }
    const result = writeChefDraft(userId, nextDraft)
    setStorageIssue(result.persisted ? null : result.reason)
    pendingFocus.current = 'pantry'
    setHandoff(null)
    setDiscardOpen(false)
  }

  const pantryPageItems = pantryEntries.slice(pantryEnds[page - 1] ?? 0, pantryEnds[page])
  const pantryList = <section className="mm-ai-chef__pantry-list" aria-label={`Pantry list, ${pantryItems.length} ${pantryItems.length === 1 ? 'item' : 'items'}`}>
    {pantryItems.length === 0
      ? <p className="mm-ai-chef__empty"><strong>No ingredients yet.</strong><span>Add a few above to get your recipe started.</span></p>
      : <PantryCards key={page} items={pantryPageItems} onRemove={removeIngredient} disabled={pending || isTurning} animate={cards} />}
  </section>
  const storageWarning = storageIssue && <div className="mm-ai-chef__storage-warning" role="alert">
    <p>{storageIssue === 'handoff-changed'
      ? 'The saved preview changed elsewhere. Return to recipe review to use its latest recovery details.'
      : storageIssue === 'read-failed'
      ? 'Mori could not read the last browser draft. This request is still available in this page while you work.'
      : 'This browser could not confirm the saved draft. Your request is available in this page; a reload may lose recent changes.'}</p>
    {storageIssue === 'handoff-changed'
      ? <Link className="button button-secondary mm-button--small" to="/app/chef/review">Open current recipe review</Link>
      : <button className="button button-secondary mm-button--small" type="button" onClick={retryDraftStorage}>Try saving this request again</button>}
  </div>

  const progressStage = handoff?.savedRecipeId ? 'saved' : handoff ? 'review' : pending ? 'generating' : 'pantry'

  return <>
    <JournalFacingPage className={`mm-facing-content--ai-chef${cards && single ? ' mm-facing-content--ai-chef-compact' : ''}`}><ChefProgress stage={progressStage} /></JournalFacingPage>
    <section className="mm-ai-chef mm-page-column" aria-labelledby="ai-chef-title">
    {discardOpen && <UnsavedChangesDialog
      title={handoff?.savedRecipeId ? 'Keep the saved recipe?' : 'Discard Mori’s recipe preview?'}
      message={handoff?.savedRecipeId
        ? 'Your recipe is already in your journal. Forgetting this recovery removes the selected parent IDs and candidate authorization from this browser. It does not delete the recipe or undo any parent links already saved.'
        : 'This generated recipe has not been saved. Discarding the preview lets you start a new pantry request.'}
      discardLabel={handoff?.savedRecipeId ? 'Forget recovery details' : 'Discard preview'}
      onKeepEditing={() => setDiscardOpen(false)}
      onDiscardChanges={discardPreview}
    />}
    <PaperCard className="mm-ai-chef__paper" surface="fresh" tape="sage">
    <form id="ai-chef-form" className="mm-ai-chef__form" onSubmit={(event) => { void requestSuggestion(event) }}>
      <section ref={pageRef} className="mm-ai-chef__page" data-chef-pantry={!handoff && page < preferencesStartPage || undefined} role="region" aria-label={`AI Chef page ${page + 1} of ${pageCount}`} tabIndex={0} onKeyDown={handlePageKeyDown}>
        <header className="mm-ai-chef__heading" data-measure-only={page !== 0 && !single || undefined} inert={page !== 0 && !single} aria-hidden={page !== 0 && !single || undefined}>
          <h1 id="ai-chef-title" tabIndex={-1}>What’s in your pantry?</h1>
        </header>
        {handoff && storageWarning}
        {page === 0 && handoff && <aside className="mm-ai-chef__resume" aria-label={handoff.savedRecipeId ? 'Saved AI Chef recipe' : 'Unsaved AI Chef recipe'}>
          <div>
            <h2>{handoff.savedRecipeId
              ? handoff.lineageStatus === 'confirmed'
                ? handoff.selectedParentIds.length > 0 ? 'Your recipe and selected parent links are saved.' : 'Your recipe is saved; no parent links were selected.'
                : 'Your recipe is saved; parent links need attention.'
              : 'Your recipe draft is ready.'}</h2>
            <p>{handoff.savedRecipeId
              ? handoff.lineageStatus === 'confirmed'
                ? 'Open the saved recipe or clear these recovery details.'
                : 'Return to review the parent-link recovery. Retrying will not create another recipe.'
              : 'Review the draft or discard it to edit your pantry.'}</p>
          </div>
          <div className="mm-ai-chef__resume-actions">
            <Link className="button button-primary" to="/app/chef/review">Return to recipe review</Link>
            {handoff.savedRecipeId && <Link className="button button-secondary" to={'/app/recipes/' + encodeURIComponent(handoff.savedRecipeId)}>Open saved recipe</Link>}
            <button className="button button-secondary" type="button" onClick={() => setDiscardOpen(true)}>{handoff.savedRecipeId ? 'Forget saved recovery' : 'Discard preview'}</button>
          </div>
        </aside>}

      {!handoff && <>
        <div className="mm-ai-chef__entry" data-measure-only={page !== 0 || undefined} inert={page !== 0} aria-hidden={page !== 0 || undefined}>
        {storageWarning}
        <fieldset disabled={pending || page !== 0}>
        <legend>Pantry ingredients</legend>
        <p className="mm-ai-chef__help" id="pantry-help">Add up to {MAX_PANTRY_ITEMS} ingredients. Separate pasted items with commas or new lines.</p>
        <div className="mm-ai-chef__ingredient-entry">
          <label className="visually-hidden" htmlFor="ai-chef-pantry-item">Pantry ingredient</label>
          <input
            ref={pantryInputRef}
            className={guidedPantry && moriFocusPantry ? 'mori-guided-focus' : undefined}
            id="ai-chef-pantry-item"
            type="text"
            value={pantryInput}
            aria-invalid={entryError ? 'true' : undefined}
            aria-describedby={`pantry-help${entryError ? ' pantry-entry-error' : ''}${requestErrorForPantry ? ' ai-chef-request-error' : ''}`}
            placeholder="e.g. rice, eggs, tomatoes"
            onChange={(event) => updatePantryInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addCurrentIngredient()
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text')
              if (!/[,\r\n]/.test(pasted)) return
              event.preventDefault()
              clearRequestError()
              const result = addPantryItems(pantryItems, splitPastedPantryText(pasted))
              if (result.error) {
                setEntryError(pantryEntryErrorMessage(result.error) ?? 'Check these pantry items.')
                setEntryStatus('')
                return
              }
              appendPantryItems(result.items)
              setPantryInput('')
              setEntryError(null)
              setEntryStatus(`Added ${result.added} ${result.added === 1 ? 'ingredient' : 'ingredients'}${result.duplicates ? `; skipped ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}` : ''}.`)
              persistInput({ pantryItems: result.items, pantryInput: '', preferences })
            }}
          />
          <button className="button button-secondary" type="button" onClick={addCurrentIngredient}>Add ingredient</button>
        </div>
        {entryError && <p id="pantry-entry-error" className="field-error" role="alert">{entryError}</p>}
        </fieldset>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">{entryStatus}</p>
        <header className="mm-ai-chef__pantry-pages" data-measure-only={!continued || undefined} inert={!continued} aria-hidden={!continued || undefined}>
          <h2 id="ai-chef-pantry-page-title" tabIndex={-1}>Pantry ingredients · continued</h2>
          <p className="mm-ai-chef__help">Return to the first page to add ingredients.</p>
        </header>
        {page < preferencesStartPage && pantryList}
        {page >= preferencesStartPage && <fieldset disabled={pending} aria-label="Cooking preferences">
        <h2 className="mm-ai-chef__pane-title" tabIndex={-1}><label className="mm-ai-chef__preferences-label" htmlFor="ai-chef-preferences">Cooking preferences <span>(optional)</span></label></h2>
        <textarea
          id="ai-chef-preferences"
          value={preferencePart}
          maxLength={preferencePartLimit}
          aria-describedby="ai-chef-preferences-help"
          placeholder="Quick meal, spicy, no frying…"
          rows={Math.max(3, formTextRows(preferencePart, preferenceColumns))}
          onChange={(event) => {
            const next = replaceFormTextPart(preferenceParts, preferencePartIndex, event.currentTarget.value)
            updatePreferences(next)
          }}
        />
        <p id="ai-chef-preferences-help" className="mm-ai-chef__help">This request only · {preferences.length} / {MAX_PREFERENCES_CHARS} characters</p>
        </fieldset>}
        {cards && <div className="mm-ai-chef__measure mm-ai-chef__pantry-list" inert aria-hidden="true">
          <PantryCards items={pantryEntries} />
        </div>}
      </>}

      <div className="mm-ai-chef__notices" hidden={!requestError && !retryBlocked && !pending}>
      {requestError && <div className="mm-ai-chef__request-error" role="alert"><p id={requestErrorForPantry ? 'ai-chef-request-error' : undefined}>{requestError}</p><button className="button button-secondary mm-button--small" type="button" disabled={pending || retryBlocked} onClick={() => { void requestSuggestion() }}>Try again</button></div>}
      {retryBlocked && <p role="status">The service asked you to wait before retrying. Your pantry and preferences remain available.</p>}
      {pending && <p className="mm-ai-chef__pending" role="status">Mori is checking your ingredients; this can take a little while.</p>}
      </div>
      </section>
    </form>
    </PaperCard>
    <JournalPageFooter>
      {!handoff && <div className="mm-ai-chef__footer-actions">
        <button className="button button-primary" type="submit" form="ai-chef-form" disabled={pending || retryBlocked}>{pending ? 'Mori is thinking…' : 'Ask Mori for a recipe'}</button>
        <p className="mm-ai-chef__save-note">Nothing is saved until you choose Save recipe.</p>
      </div>}
      <JournalPagination label="AI Chef pages" rightNumber={`Page ${page + 1} of ${pageCount}`}
        previous={page > 0 && <button type="button" className="button mm-button--page-turn" aria-label="Previous page" disabled={isTurning} onClick={() => turnPage(page - 1)}>← Previous</button>}
        next={page < pageCount - 1 && <button type="button" className="button mm-button--page-turn" aria-label="Next page" disabled={isTurning} onClick={() => turnPage(page + 1)}>Next →</button>} />
    </JournalPageFooter>
    </section>
  </>
}
