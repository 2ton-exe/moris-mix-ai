import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { Mori } from '../journal/Mori'
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
  const [entryError, setEntryError] = useState<string | null>(null)
  const [entryStatus, setEntryStatus] = useState('')
  const [storageIssue, setStorageIssue] = useState<string | null>(initialRead.status === 'available' ? null : initialRead.status)
  const [discardOpen, setDiscardOpen] = useState(false)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const pantryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => controller.current?.abort(), [])

  function persistInput(next: { pantryItems: string[]; pantryInput: string; preferences: string }) {
    if (handoff) return
    const nextDraft = { input: next, handoff: null }
    const result = writeChefDraft(userId, nextDraft)
    setStorageIssue(result.persisted ? null : result.reason)
  }

  function updatePantryItems(next: string[]) {
    setPantryItems(next)
    setRequestError(null)
    persistInput({ pantryItems: next, pantryInput, preferences })
  }

  function addCurrentIngredient() {
    setRequestError(null)
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
    setRequestError(null)
  }

  function updatePreferences(value: string) {
    setPreferences(value)
    persistInput({ pantryItems, pantryInput, preferences: value })
    setRequestError(null)
  }

  async function requestSuggestion(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (inFlight.current || handoff) return
    setRequestError(null)
    setEntryError(null)

    const requestBody = {
      pantryItems,
      ...(preferences.trim() ? { preferences: preferences.trim() } : {}),
    }
    const parsed = generateRecipeRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      const pantryIssue = parsed.error.issues.some((issue) => issue.path[0] === 'pantryItems')
      setRequestError(pantryIssue
        ? pantryItems.length === 0
          ? 'Add at least one pantry ingredient before asking Mori.'
          : 'Check the pantry list. Add between 1 and 100 items, each 100 characters or fewer.'
        : `Preferences must be ${MAX_PREFERENCES_CHARS} characters or fewer.`)
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
    <p>{storageIssue === 'read-failed'
      ? 'Mori could not read the last browser draft. This request is still available in this page while you work.'
      : 'This browser could not confirm the saved draft. Your request is available in this page; a reload may lose recent changes.'}</p>
    <button className="button button-secondary mm-button--small" type="button" onClick={() => persistInput({ pantryItems, pantryInput, preferences })}>Try saving this request again</button>
  </div>

  return <section className="mm-ai-chef" aria-labelledby="ai-chef-title" aria-busy={pending}>
    {discardOpen && <UnsavedChangesDialog
      title={handoff?.savedRecipeId ? 'Keep the saved recipe?' : 'Discard Mori’s recipe preview?'}
      message={handoff?.savedRecipeId
        ? 'Your recipe is already in your journal. Forgetting this recovery removes the selected parent links and authorization, but does not delete the recipe.'
        : 'This generated recipe has not been saved. Discarding the preview lets you start a new pantry request.'}
      discardLabel={handoff?.savedRecipeId ? 'Keep recipe and forget links' : 'Discard preview'}
      onKeepEditing={() => setDiscardOpen(false)}
      onDiscardChanges={discardPreview}
    />}
    <header className="mm-ai-chef__heading">
      <div>
        <p className="mm-recipe-index__eyebrow">AI Chef</p>
        <h1 id="ai-chef-title" tabIndex={-1}>What’s in your pantry?</h1>
        <p className="intro">Tell Mori what you have and add any short cooking preferences. Mori will suggest a recipe for you to review before you save it.</p>
      </div>
      <Mori mood="think" size={82} />
    </header>

    {storageWarning}

    {handoff && <aside className="mm-ai-chef__resume" aria-label="Unsaved AI Chef recipe">
      <div>
        <strong>{handoff.savedRecipeId ? 'Your recipe is saved; parent links need attention.' : 'An AI Chef recipe is waiting for you.'}</strong>
        <p>{handoff.savedRecipeId
          ? 'Return to review the selected parent links. Retrying will not create another recipe.'
          : 'Review or save that suggestion before starting another one.'}</p>
      </div>
      <div className="mm-ai-chef__resume-actions">
        <Link className="button button-primary" to="/app/chef/review">Return to recipe review</Link>
        {handoff.savedRecipeId && <Link className="button button-secondary" to={'/app/recipes/' + encodeURIComponent(handoff.savedRecipeId)}>Open saved recipe</Link>}
        <button className="button button-secondary" type="button" onClick={() => setDiscardOpen(true)}>{handoff.savedRecipeId ? 'Forget parent-link retry' : 'Discard preview'}</button>
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
            aria-describedby={entryError ? 'pantry-help pantry-entry-error' : 'pantry-help'}
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
              setRequestError(null)
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

      {requestError && <div className="mm-ai-chef__request-error" role="alert"><p>{requestError}</p><button className="button button-secondary mm-button--small" type="button" disabled={pending} onClick={() => { void requestSuggestion() }}>Try again</button></div>}
      <div className="mm-ai-chef__actions">
        <button className="button button-primary" type="submit" disabled={pending || handoff !== null}>{pending ? 'Mori is thinking…' : 'Ask Mori for a recipe'}</button>
        {pending && <p className="mm-ai-chef__pending" role="status">Mori is checking your pantry and preparing a recipe. This can take a little while.</p>}
      </div>
    </form>

    <p className="mm-ai-chef__save-note">Nothing is added to your journal until you review the recipe and choose Save recipe.</p>
    </PaperCard>
  </section>
}
