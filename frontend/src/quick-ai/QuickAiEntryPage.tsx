import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { HttpError } from '../api/http'
import { useAuth } from '../auth/context'
import { Mori } from '../journal/Mori'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { PaperCard, ScrapLabel } from '../journal/Scrapbook'
import { journalReturnTo } from '../journal/indexNavigation'
import { InvalidExtractionResponse, extractRecipeApi, MAX_EXTRACTION_INPUT_CHARS } from './extractRecipe'
import type { ExtractedRecipe, QuickAiEntryHandoff } from './extractRecipe'
import { readQuickAiEntryDraft, writeQuickAiEntryDraft } from './draft'
import type { QuickAiBlockReason, QuickAiEntryDraft } from './draft'
import './quickAiEntry.css'

interface EntryError {
  code: string
  message: string
  retryable: boolean
  blockReason?: QuickAiBlockReason
  retryAfterSeconds?: number
}

type ExtractRecipe = typeof extractRecipeApi.extract

function errorCode(error: unknown) {
  if (error instanceof InvalidExtractionResponse) return 'INVALID_EXTRACTION_RESPONSE'
  if (!(error instanceof HttpError) || typeof error.payload !== 'object' || error.payload === null || Array.isArray(error.payload)) return null
  const envelope = (error.payload as Record<string, unknown>).error
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return null
  return typeof (envelope as Record<string, unknown>).code === 'string' ? (envelope as Record<string, string>).code : null
}

function parseRetryAfterSeconds(error: unknown): number | undefined {
  const raw = error instanceof HttpError ? error.retryAfter : undefined
  if (raw === undefined || !raw.trim()) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined
}

function retryAfterSeconds(error: unknown, fallback: number) {
  return parseRetryAfterSeconds(error) ?? fallback
}

function secondsUntilUtcReset() {
  const now = new Date()
  return Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000))
}

function describeExtractionError(error: unknown): EntryError {
  const code = errorCode(error)
  if (error instanceof HttpError && error.kind === 'network') {
    return { code: 'NETWORK_ERROR', message: 'Mori could not reach the kitchen right now. Your notes are still here; you can retry when your connection is back.', retryable: true }
  }
  if (error instanceof HttpError && error.kind === 'configuration') {
    return { code: 'SERVICE_CONFIGURATION', message: 'The recipe organizer is not configured yet. Your notes are still here.', retryable: false }
  }

  switch (code) {
    case 'UNAUTHORIZED':
      return { code, message: 'Your session could not be verified. Sign out and sign in again to continue. Your notes are still here.', retryable: false }
    case 'QUOTA_EXCEEDED':
      return { code, message: "You've reached today's AI organizing limit. Keep editing your notes and return after the daily limit resets.", retryable: false, blockReason: 'quota', retryAfterSeconds: retryAfterSeconds(error, secondsUntilUtcReset()) }
    case 'AI_RATE_LIMITED':
      return { code, message: 'Mori is temporarily busy. Your notes are safe; wait for the provider cooldown before retrying.', retryable: true, blockReason: 'provider-rate-limit', retryAfterSeconds: retryAfterSeconds(error, 30) }
    case 'AUTH_SERVICE_RATE_LIMITED':
      return { code, message: 'Mori could not verify your session just now. Your notes are safe; please try again when authentication is available.', retryable: true, blockReason: 'auth-service-rate-limit', retryAfterSeconds: retryAfterSeconds(error, 30) }
    case 'AI_OUTPUT_INVALID':
    case 'INVALID_EXTRACTION_RESPONSE':
      return { code, message: "Mori couldn't validate the recipe it returned. Your notes are still here; you can edit them or retry.", retryable: true }
    case 'AI_UNAVAILABLE':
    case 'AI_TIMEOUT':
    case 'QUOTA_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return { code, message: 'Mori could not organize those notes just now. Your original notes are still here; please try again shortly.', retryable: true }
    case 'AI_PROVIDER_REJECTED':
      return { code, message: "Mori couldn't process those notes. Your original text is still here; try editing it and submitting again.", retryable: true }
    case 'AI_DISABLED':
      return { code, message: 'AI organizing is temporarily unavailable. Your notes are still here.', retryable: false }
    case 'INPUT_TOO_LARGE':
      return { code, message: `Please keep your notes to ${MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters or fewer. Your text is still here.`, retryable: false }
    case 'VALIDATION_ERROR':
      return { code, message: 'Add a few cooking notes before asking Mori to organize them.', retryable: false }
    default:
      if (error instanceof HttpError && error.status === 401) {
        return { code: 'UNAUTHORIZED', message: 'Your session could not be verified. Sign out and sign in again to continue. Your notes are still here.', retryable: false }
      }
      return { code: 'UNKNOWN_ERROR', message: 'Mori could not organize those notes just now. Your original text is still here; please try again.', retryable: true }
  }
}

function renderIngredient(ingredient: ExtractedRecipe['ingredients'][number]) {
  const amount = ingredient.quantityText ?? (ingredient.quantity === null ? '' : String(ingredient.quantity))
  return [amount, ingredient.unit, ingredient.name].filter(Boolean).join(' ')
}

function RecipePreview({ handoff }: { handoff: QuickAiEntryHandoff }) {
  return <section className="mm-quick-ai__preview" aria-labelledby="quick-ai-preview-title">
    <div className="mm-quick-ai__preview-header">
      <div>
        <p className="mm-quick-ai__eyebrow">Ready for your review</p>
        <h2 id="quick-ai-preview-title">{handoff.recipe.title}</h2>
      </div>
      <ScrapLabel tone="sage">Unsaved preview</ScrapLabel>
    </div>
    <p className="mm-quick-ai__unsaved">This recipe is only a preview. Nothing has been saved to your journal.</p>
    <h3>Ingredients</h3>
    {handoff.recipe.ingredients.length > 0
      ? <ul>{handoff.recipe.ingredients.map((ingredient, index) => <li key={`${ingredient.name}-${index}`}>
        {renderIngredient(ingredient)}{ingredient.inferred && <span> (estimated)</span>}
      </li>)}</ul>
      : <p>No ingredients were identified.</p>}
    <h3>Method</h3>
    {handoff.recipe.instructions.length > 0
      ? <ol>{handoff.recipe.instructions.map((instruction) => <li key={instruction.step}>{instruction.text}</li>)}</ol>
      : <p>No method steps were identified.</p>}
    <details>
      <summary>View original notes</summary>
      <blockquote>{handoff.sourceNotes}</blockquote>
    </details>
  </section>
}

export function QuickAiEntryPage({ extract = extractRecipeApi.extract, onExtracted }: {
  extract?: ExtractRecipe
  /** Optional FE-09 consumer. The handoff is validated and never saved here. */
  onExtracted?: (handoff: QuickAiEntryHandoff) => void
}) {
  const { user } = useAuth()
  if (!user) return <p role="alert">Sign in to use Quick AI Entry.</p>
  return <QuickAiEntrySession key={user.id} userId={user.id} extract={extract} onExtracted={onExtracted} />
}

function QuickAiEntrySession({ userId, extract, onExtracted }: {
  userId: string
  extract: ExtractRecipe
  onExtracted?: (handoff: QuickAiEntryHandoff) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [draft, setDraft] = useState<QuickAiEntryDraft>(() => readQuickAiEntryDraft(userId))
  const [loading, setLoading] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [error, setError] = useState<EntryError | null>(null)
  const [handoff, setHandoff] = useState<QuickAiEntryHandoff | null>(() => draft.handoff)
  const [now, setNow] = useState(() => Date.now())
  const notesId = useId()
  const helpId = useId()
  const countId = useId()
  const validationId = useId()
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const requestNumber = useRef(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const retryWait = draft.blockedUntil === null ? 0 : Math.max(0, Math.ceil((draft.blockedUntil - now) / 1000))

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestNumber.current += 1
      requestRef.current?.abort()
      requestRef.current = null
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    if (draft.blockedUntil === null) return
    if (draft.blockedUntil <= now) {
      const nextDraft = { ...draft, blockedUntil: null, blockedReason: null }
      setDraft(nextDraft)
      writeQuickAiEntryDraft(userId, nextDraft)
      if (error?.code === 'QUOTA_EXCEEDED' || error?.code === 'AI_RATE_LIMITED') setError(null)
      return
    }
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(1000, draft.blockedUntil! - now))
    return () => window.clearTimeout(timeout)
  }, [draft, error?.code, now, userId])

  function updateNotes(notes: string) {
    const nextDraft = { ...draft, notes, handoff: null }
    setDraft(nextDraft)
    writeQuickAiEntryDraft(userId, nextDraft)
    setValidationMessage(null)
    setError(null)
    setHandoff(null)
  }

  async function submitNotes() {
    if (inFlight.current || retryWait > 0) return
    const sourceNotes = draft.notes
    if (!sourceNotes.trim()) {
      setValidationMessage('Add a few cooking notes before organizing them.')
      setError(null)
      setHandoff(null)
      notesRef.current?.focus()
      return
    }
    if (sourceNotes.length > MAX_EXTRACTION_INPUT_CHARS) {
      setValidationMessage(`Keep your notes to ${MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters or fewer.`)
      setError(null)
      setHandoff(null)
      notesRef.current?.focus()
      return
    }

    const controller = new AbortController()
    const currentRequest = ++requestNumber.current
    requestRef.current = controller
    inFlight.current = true
    setLoading(true)
    setError(null)
    setValidationMessage(null)
    const pendingDraft = { ...draft, handoff: null }
    setDraft(pendingDraft)
    writeQuickAiEntryDraft(userId, pendingDraft)
    setHandoff(null)
    try {
      const recipe = await extract(sourceNotes, { userId, signal: controller.signal })
      if (controller.signal.aborted || !mounted.current || requestNumber.current !== currentRequest) return
      const nextHandoff: QuickAiEntryHandoff = { sourceNotes, recipe, saved: false }
      const completedDraft = { ...pendingDraft, handoff: nextHandoff }
      setDraft(completedDraft)
      writeQuickAiEntryDraft(userId, completedDraft)
      setHandoff(nextHandoff)
      onExtracted?.(nextHandoff)
    } catch (requestError) {
      if (controller.signal.aborted || !mounted.current || requestNumber.current !== currentRequest) return
      const nextError = describeExtractionError(requestError)
      setError(nextError)
      if (nextError.blockReason && nextError.retryAfterSeconds) {
        const blockedDraft: QuickAiEntryDraft = {
          ...pendingDraft,
          blockedUntil: Date.now() + nextError.retryAfterSeconds * 1000,
          blockedReason: nextError.blockReason,
        }
        setDraft(blockedDraft)
        writeQuickAiEntryDraft(userId, blockedDraft)
        setNow(Date.now())
      }
    } finally {
      if (mounted.current && requestNumber.current === currentRequest) {
        inFlight.current = false
        requestRef.current = null
        setLoading(false)
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitNotes()
  }

  async function signInAgain() {
    try {
      await logout()
      navigate('/login', { replace: true, state: { from: '/app/quick-entry' } })
    } catch {
      setError({ code: 'LOGOUT_FAILED', message: 'Your session could not be verified. Use Log out in the journal header, then sign in again.', retryable: false })
    }
  }

  const describedBy = [helpId, countId, validationMessage ? validationId : null].filter(Boolean).join(' ')
  return <>
    <JournalFacingPage className="mm-facing-content--quick-ai">
      <header className="mm-quick-ai-intro">
        <div>
          <p className="mm-quick-ai-intro__eyebrow">Kitchen scraps, welcome</p>
          <h1 tabIndex={-1}>Quick AI Entry</h1>
          <p className="mm-quick-ai-intro__copy">Jot down the bits you remember. Mori will organize your rough cooking notes into an unsaved recipe preview.</p>
        </div>
        <Mori mood="think" size={58} />
      </header>
    </JournalFacingPage>

    <section className="mm-quick-ai" aria-label="Quick AI Entry notes">
      <nav className="mm-quick-ai__back" aria-label="Sheet navigation">
        <Link to={journalReturnTo(location.state)}><span aria-hidden="true">←</span> Back to journal</Link>
      </nav>
      <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__sheet">
        <div className="mm-quick-ai__sheet-header">
          <p className="mm-quick-ai__eyebrow">Your scratch page</p>
          <h2>Write it the way you remember it.</h2>
          <p>Ingredients, quantities, little tricks, or half-finished thoughts are all useful. You can tidy everything up later.</p>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="mm-quick-ai__field">
            <label htmlFor={notesId}>Cooking notes</label>
            <textarea
              ref={notesRef}
              className="mm-quick-ai__textarea"
              id={notesId}
              name="notes"
              rows={12}
              maxLength={MAX_EXTRACTION_INPUT_CHARS}
              value={draft.notes}
              disabled={loading}
              aria-invalid={validationMessage ? 'true' : undefined}
              aria-describedby={describedBy}
              placeholder="e.g. leftover rice, two eggs, a splash of soy sauce and garlic. Fry the eggs first, then toss everything together; add scallions if we have them."
              onChange={(event) => updateNotes(event.currentTarget.value)}
            />
            <div className="mm-quick-ai__field-meta">
              <p className="mm-quick-ai__helper" id={helpId}>Your notes stay in this browser session so you can come back to them. Maximum {MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters.</p>
              <p className="mm-quick-ai__count" id={countId} aria-live="off">{draft.notes.length.toLocaleString()} / {MAX_EXTRACTION_INPUT_CHARS.toLocaleString()}</p>
            </div>
            {validationMessage && <p className="mm-quick-ai__validation" id={validationId} role="alert">{validationMessage}</p>}
          </div>

          <div className="mm-quick-ai__actions">
            <button className="button button-primary" type="submit" disabled={loading || retryWait > 0}>
              {loading ? 'Mori is organizing…' : retryWait > 0 ? 'Please wait to retry' : error?.retryable ? 'Retry extraction' : 'Organize my notes'}
            </button>
          </div>
          <p className="mm-quick-ai__preservation">Your original notes stay separate from the recipe and are never cleared when you submit.</p>
        </form>

        {loading && <p className="mm-quick-ai__loading" role="status" aria-live="polite"><Mori mood="stir" size={40} animated /> Mori is organizing your notes. Keep this page open, or come back to your saved-in-session draft.</p>}
        {retryWait > 0 && <p className="mm-quick-ai__cooldown" role="status" aria-live="polite">
          {draft.blockedReason === 'quota'
            ? `Today's AI limit is still in effect. You can organize notes again in ${retryWait} ${retryWait === 1 ? 'second' : 'seconds'}.`
            : draft.blockedReason === 'auth-service-rate-limit'
              ? `Please wait ${retryWait} ${retryWait === 1 ? 'second' : 'seconds'} before asking Mori to try again.`
              : `Please wait ${retryWait} ${retryWait === 1 ? 'second' : 'seconds'} for Mori's cooldown before retrying.`}
        </p>}
        {error && <div className="mm-quick-ai__error">
          <p role="alert">{error.message}</p>
          <div className="mm-quick-ai__error-actions">
            <button className="button button-secondary mm-button--small" type="button" onClick={() => notesRef.current?.focus()}>Edit Notes</button>
            {error.code === 'UNAUTHORIZED' && <button className="button button-secondary mm-button--small" type="button" onClick={() => { void signInAgain() }}>Log out and sign in again</button>}
          </div>
        </div>}
      </PaperCard>

      {handoff && <RecipePreview handoff={handoff} />}
    </section>
  </>
}
