import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { HttpError } from '../api/http'
import { retryAfterSeconds } from '../api/retryAfter'
import { useMoriActivity } from '../mori/MoriCompanionContext'
import { PaperCard } from '../journal/Scrapbook'
import { UnsavedChangesDialog } from '../recipe-form/UnsavedChangesDialog'
import { MAX_PANTRY_ITEMS, MAX_PREFERENCES_CHARS, addPantryItems, pantryEntryErrorMessage, splitPastedPantryText } from './pantry'
import { generateRecipeApi, generateRecipeErrorMessage, generateRecipeRequestSchema } from './generateRecipe'
import type { ChefReviewHandoff } from './draft'
import { readChefDraftResult, writeChefDraft } from './draft'
import './aiChef.css'

export function AIChefPage() {
  const { user } = useAuth()
  if (!user) return <p role="alert">Sign in to use AI Chef.</p>
  return <AIChefSession key={user.id} userId={user.id} />
}

function AIChefSession({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [initialRead] = useState(() => readChefDraftResult(userId))
  const [pantryItems, setPantryItems] = useState(initialRead.draft.input.pantryItems)
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
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const pantryInputRef = useRef<HTMLInputElement>(null)
  useMoriActivity(requestError || entryError
    ? { kind: requestErrorForPantry || entryError ? 'attention' : 'confused', message: requestError ?? entryError ?? 'Check your pantry ingredients.' }
    : pending
      ? { kind: 'thinking', message: 'Thinking of something delicious for your pantry…' }
      : null)


  useEffect(() => () => controller.current?.abort(), [])

  useEffect(() => {
    if (!retryBlocked) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retryBlocked])

  function persistInput(next: { pantryItems: string[]; pantryInput: string; preferences: string }) {
    if (handoff) return
    const nextDraft = { input: next, handoff: null }
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
    const result = writeChefDraft(userId, { input: { pantryItems, pantryInput, preferences }, handoff })
    setStorageIssue(result.persisted ? null : result.reason)
  }

  function updatePantryItems(next: string[]) {
    setPantryItems(next)
    clearRequestError()
    persistInput({ pantryItems: next, pantryInput, preferences })
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
    setPantryItems(result.items)
    setPantryInput('')
    persistInput({ pantryItems: result.items, pantryInput: '', preferences })
  }

  function removeIngredient(index: number) {
    updatePantryItems(pantryItems.filter((_, itemIndex) => itemIndex !== index))
    setEntryStatus('Pantry ingredient removed.')
    window.requestAnimationFrame(() => pantryInputRef.current?.focus())
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
      if (pantryIssue) pantryInputRef.current?.focus()
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
      }
      const writeResult = writeChefDraft(userId, nextDraft)
      setStorageIssue(writeResult.persisted ? null : writeResult.reason)
      navigate('/app/chef/review')
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
    setHandoff(null)
    setDiscardOpen(false)
  }

  const savedInputCount = pantryItems.length
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

  return <section className="mm-ai-chef" aria-labelledby="ai-chef-title">
    {discardOpen && <UnsavedChangesDialog
      title={handoff?.savedRecipeId ? 'Keep the saved recipe?' : 'Discard Mori’s recipe preview?'}
      message={handoff?.savedRecipeId
        ? 'Your recipe is already in your journal. Forgetting this recovery removes the selected parent IDs and candidate authorization from this browser. It does not delete the recipe or undo any parent links already saved.'
        : 'This generated recipe has not been saved. Discarding the preview lets you start a new pantry request.'}
      discardLabel={handoff?.savedRecipeId ? 'Forget recovery details' : 'Discard preview'}
      onKeepEditing={() => setDiscardOpen(false)}
      onDiscardChanges={discardPreview}
    />}
    <header className="mm-ai-chef__heading">
      <div>
        <p className="mm-recipe-index__eyebrow">AI Chef</p>
        <h1 id="ai-chef-title" tabIndex={-1}>What’s in your pantry?</h1>
        <p className="intro">Tell Mori what you have and add any short cooking preferences. Mori will suggest a recipe for you to review before you save it.</p>
      </div>
    </header>

    {storageWarning}

    {handoff && <aside className="mm-ai-chef__resume" aria-label="Unsaved AI Chef recipe">
      <div>
        <strong>{handoff.savedRecipeId
          ? handoff.lineageStatus === 'confirmed'
            ? handoff.selectedParentIds.length > 0 ? 'Your recipe and selected parent links are saved.' : 'Your recipe is saved; no parent links were selected.'
            : 'Your recipe is saved; parent links need attention.'
          : 'An AI Chef recipe is waiting for you.'}</strong>
        <p>{handoff.savedRecipeId
          ? handoff.lineageStatus === 'confirmed'
            ? 'Open the saved recipe or clear these recovery details.'
            : 'Return to review the parent-link recovery. Retrying will not create another recipe.'
          : 'Review or save that suggestion before starting another one.'}</p>
      </div>
      <div className="mm-ai-chef__resume-actions">
        <Link className="button button-primary" to="/app/chef/review">Return to recipe review</Link>
        {handoff.savedRecipeId && <Link className="button button-secondary" to={'/app/recipes/' + encodeURIComponent(handoff.savedRecipeId)}>Open saved recipe</Link>}
        <button className="button button-secondary" type="button" onClick={() => setDiscardOpen(true)}>{handoff.savedRecipeId ? 'Forget saved recovery' : 'Discard preview'}</button>
      </div>
    </aside>}

    <PaperCard className="mm-ai-chef__paper" surface="fresh" tape="sage">
    <form className="mm-ai-chef__form" onSubmit={(event) => { void requestSuggestion(event) }}>
      <fieldset disabled={pending || handoff !== null}>
        <legend>Pantry ingredients</legend>
        <p className="mm-ai-chef__help" id="pantry-help">Add up to {MAX_PANTRY_ITEMS} items. Press Enter or choose Add ingredient. Duplicate items are skipped.</p>
        <div className="mm-ai-chef__ingredient-entry">
          <label className="visually-hidden" htmlFor="ai-chef-pantry-item">Pantry ingredient</label>
          <input
            ref={pantryInputRef}
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
              setPantryItems(result.items)
              setPantryInput('')
              setEntryError(null)
              setEntryStatus(`Added ${result.added} ${result.added === 1 ? 'ingredient' : 'ingredients'}${result.duplicates ? `; skipped ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}` : ''}.`)
              persistInput({ pantryItems: result.items, pantryInput: '', preferences })
            }}
          />
          <button className="button button-secondary" type="button" onClick={addCurrentIngredient}>Add ingredient</button>
        </div>
        {entryError && <p id="pantry-entry-error" className="field-error" role="alert">{entryError}</p>}
        <p className="visually-hidden" role="status" aria-live="polite">{entryStatus}</p>
        <section className="mm-ai-chef__pantry-list" aria-label={`Pantry list, ${savedInputCount} ${savedInputCount === 1 ? 'item' : 'items'}`}>
          {pantryItems.length === 0
            ? <p className="mm-ai-chef__empty">Your pantry list will appear here.</p>
            : <ul>{pantryItems.map((item, index) => <li key={`${item.toLowerCase()}-${index}`}>
              <span>{item}</span>
              <button className="mm-ai-chef__remove" type="button" aria-label={`Remove ${item}`} onClick={() => removeIngredient(index)}>Remove</button>
            </li>)}</ul>}
        </section>
        <label className="mm-ai-chef__preferences-label" htmlFor="ai-chef-preferences">Cooking preferences <span>(optional)</span></label>
        <textarea
          id="ai-chef-preferences"
          value={preferences}
          maxLength={MAX_PREFERENCES_CHARS}
          aria-describedby="ai-chef-preferences-help"
          placeholder="Quick meal, spicy, no frying…"
          rows={3}
          onChange={(event) => updatePreferences(event.currentTarget.value)}
        />
        <p id="ai-chef-preferences-help" className="mm-ai-chef__help">Preferences apply to this request only. {preferences.length} / {MAX_PREFERENCES_CHARS} characters.</p>
      </fieldset>

      {requestError && <div className="mm-ai-chef__request-error" role="alert"><p id={requestErrorForPantry ? 'ai-chef-request-error' : undefined}>{requestError}</p><button className="button button-secondary mm-button--small" type="button" disabled={pending || retryBlocked} onClick={() => { void requestSuggestion() }}>Try again</button></div>}
      <div className="mm-ai-chef__actions">
        <button className="button button-primary" type="submit" disabled={pending || retryBlocked || handoff !== null}>{pending ? 'Mori is thinking…' : 'Ask Mori for a recipe'}</button>
        {retryBlocked && <p role="status">The service asked you to wait before retrying. Your pantry and preferences remain available.</p>}
        {pending && <p className="mm-ai-chef__pending" role="status">Mori is checking your pantry and preparing a recipe. This can take a little while.</p>}
      </div>
    </form>

    <p className="mm-ai-chef__save-note">Nothing is added to your journal until you review the recipe and choose Save recipe.</p>
    </PaperCard>
  </section>
}
