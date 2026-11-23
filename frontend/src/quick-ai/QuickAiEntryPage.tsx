import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, Ref } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { HttpError, httpErrorCode } from '../api/http'
import { aiRateLimitReason } from '../api/aiRateLimit'
import { retryAfterMessage, retryAfterSeconds as parseRetryAfter } from '../api/retryAfter'
import { useAuth } from '../auth/context'
import { useMoriActivity } from '../mori/MoriCompanionContext'
import { useMoriFieldFocus } from '../mori/routeState'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalPagination } from '../journal/JournalPagination'
import { useJournalPageTurn } from '../journal/JournalPageTurn'
import { useJournalMedia } from '../journal/useJournalMedia'
import { PaperCard, ScrapLabel } from '../journal/Scrapbook'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import { journalReturnTo } from '../journal/indexNavigation'
import { UnsavedChangesDialog } from '../recipe-form/UnsavedChangesDialog'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { formTextPageLimit, formTextRows, replaceFormTextPart, splitFormText } from '../recipe-form/physicalFormPages'
import { InvalidExtractionResponse, extractRecipeApi, MAX_EXTRACTION_INPUT_CHARS } from './extractRecipe'
import type { QuickAiEntryHandoff } from './extractRecipe'
import { readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from './draft'
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
// Leave 55s beyond Gemini's 65s maximum attempt and retry budget for auth/quota work.
const EXTRACTION_TIMEOUT_MS = 120_000

function parseRetryAfterSeconds(error: unknown): number | undefined {
  return parseRetryAfter(error instanceof HttpError ? error.retryAfter : undefined)
}

function retryAfterSeconds(error: unknown, fallback?: number) {
  return parseRetryAfterSeconds(error) ?? fallback
}

function secondsUntilUtcReset() {
  const now = new Date()
  return Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000))
}

function describeExtractionError(error: unknown): EntryError {
  const code = error instanceof InvalidExtractionResponse ? 'INVALID_EXTRACTION_RESPONSE' : error instanceof HttpError ? httpErrorCode(error) : undefined
  const rateLimitReason = aiRateLimitReason(code)
  if (error instanceof HttpError && code && rateLimitReason) {
    return { code, message: `${rateLimitReason} ${retryAfterMessage(error.retryAfter)} Your notes are still here.`, retryable: true, blockReason: 'provider-rate-limit', retryAfterSeconds: retryAfterSeconds(error) }
  }
  if (error instanceof HttpError && error.kind === 'network') {
    return { code: 'NETWORK_ERROR', message: 'Mori could not reach the kitchen right now. Your notes are still here; you can retry when your connection is back.', retryable: true }
  }
  if (error instanceof HttpError && error.kind === 'configuration') {
    return { code: 'SERVICE_CONFIGURATION', message: 'The recipe organizer is not configured yet. Your notes are still here.', retryable: false }
  }

  if (error instanceof HttpError && error.status === 401) {
    return { code: 'UNAUTHORIZED', message: 'Your session could not be verified. Sign out and sign in again to continue. Your notes are still here.', retryable: false }
  }
  if (error instanceof HttpError && error.status === 403) {
    return { code: 'FORBIDDEN', message: 'You do not have permission to organize these notes. Your notes are still here.', retryable: false }
  }
  if (error instanceof HttpError && error.status === 429 && !code) {
    return { code: 'RATE_LIMITED', message: 'AI organizing is temporarily limited. Your notes are still here; try again later.', retryable: true, blockReason: 'provider-rate-limit', retryAfterSeconds: parseRetryAfterSeconds(error) }
  }

  switch (code) {
    case 'UNAUTHORIZED':
      return { code, message: 'Your session could not be verified. Sign out and sign in again to continue. Your notes are still here.', retryable: false }
    case 'QUOTA_EXCEEDED':
      return { code, message: "You've reached today's AI organizing limit. Keep editing your notes and return after the daily limit resets.", retryable: false, blockReason: 'quota', retryAfterSeconds: retryAfterSeconds(error, secondsUntilUtcReset()) }
    case 'AI_RATE_LIMITED':
      return { code, message: 'Mori is temporarily busy. Your notes remain in the editor; wait for the provider cooldown before retrying.', retryable: true, blockReason: 'provider-rate-limit', retryAfterSeconds: retryAfterSeconds(error) }
    case 'AUTH_SERVICE_RATE_LIMITED':
      return { code, message: 'Mori could not verify your session just now. Your notes remain in the editor; please try again when authentication is available.', retryable: true, blockReason: 'auth-service-rate-limit', retryAfterSeconds: retryAfterSeconds(error) }
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

function RecipePreview({ handoff, reviewState, headingRef }: { handoff: QuickAiEntryHandoff; reviewState: { journalReturn: string; sourceJournalReturn: string }; headingRef: Ref<HTMLHeadingElement> }) {
  return <section className="mm-quick-ai__preview" aria-labelledby="quick-ai-preview-title">
    <div className="mm-quick-ai__preview-header">
      <h2 id="quick-ai-preview-title" ref={headingRef} tabIndex={-1}>{handoff.recipe.title}</h2>
      <ScrapLabel tone="sage">Unsaved preview</ScrapLabel>
    </div>
    <div className="mm-quick-ai__preview-actions">
      <Link className="button button-primary" to="/app/quick-entry/review" state={reviewState}>Review recipe draft</Link>
    </div>
    <p>{handoff.recipe.ingredients.length} ingredients · {handoff.recipe.instructions.length} cooking steps</p>
    <p>Open the review page to see every ingredient and step before saving. Turn back to your notes pages to edit the original text.</p>
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
  const desktopSpread = useJournalMedia('(min-width: 1100px) and (min-height: 640px)')
  const { isTurning, requestPageTurn } = useJournalPageTurn()
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const registerLogoutGuard = useContext(JournalLogoutGuardContext)
  const [initialRead] = useState(() => readQuickAiEntryDraftResult(userId))
  const [draft, setDraft] = useState<QuickAiEntryDraft>(initialRead.draft)
  const [loading, setLoading] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [error, setError] = useState<EntryError | null>(null)
  const [handoff, setHandoff] = useState<QuickAiEntryHandoff | null>(initialRead.draft.handoff)
  const [persistenceFailed, setPersistenceFailed] = useState(initialRead.status !== 'available')
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [guidedNotes, setGuidedNotes] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [notesPerPage, setNotesPerPage] = useState(480)
  const [charactersPerRow, setCharactersPerRow] = useState(56)
  const [notesRows, setNotesRows] = useState(12)
  const [notesPage, setNotesPage] = useState(0)
  const [showPreview, setShowPreview] = useState(initialRead.draft.handoff !== null)
  const [turningPage, setTurningPage] = useState<number | null>(null)
  useMoriActivity(error
    ? { kind: 'confused', message: error.message }
    : validationMessage
      ? { kind: 'attention', message: validationMessage }
      : loading
        ? { kind: 'working', message: 'Sorting your cooking notes into a recipe…' }
        : null)

  const notesId = useId()
  const helpId = useId()
  const countId = useId()
  const validationId = useId()
  const persistenceWarningId = useId()
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const requestedNotesPage = useRef(0)
  const focusNotesAfterTurn = useRef(false)
  const previewHeadingRef = useRef<HTMLHeadingElement>(null)
  const focusNewPreview = useRef(false)
  const requestRef = useRef<AbortController | null>(null)
  const requestNumber = useRef(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const moriFocusNotes = useMoriFieldFocus('notes', notesRef, setGuidedNotes)
  const retryWait = draft.blockedUntil === null ? 0 : Math.max(0, Math.ceil((draft.blockedUntil - now) / 1000))
  const noteParts = splitFormText(draft.notes, notesPerPage, notesRows, charactersPerRow)
  const pageCount = noteParts.length + (handoff ? 1 : 0)
  const page = turningPage ?? (showPreview && handoff ? noteParts.length : Math.min(notesPage, noteParts.length - 1))
  const notePart = noteParts[page] ?? ''
  const hasUnsavedContent = (draft.notes.trim().length > 0 && draft.completedReview !== true) || handoff !== null
  const navigationConfirmation = useUnsavedChangesGuard(persistenceFailed && hasUnsavedContent, { warnOnUnload: true })

  useLayoutEffect(() => {
    const notes = notesRef.current
    const spread = notes?.closest<HTMLElement>('.mm-journal-spread')
    if (!notes || !spread) return
    const measure = () => {
      const width = notes.clientWidth
      const height = spread.clientHeight
      if (width <= 0 || height <= 0) return
      const columns = Math.max(1, Math.floor(width / 8))
      const rows = Math.max(3, Math.floor((height - 420) / 32))
      setCharactersPerRow((current) => current === columns ? current : columns)
      setNotesRows((current) => current === rows ? current : rows)
      const nextLimit = Math.max(1, Math.floor(Math.min(MAX_EXTRACTION_INPUT_CHARS, 1_600, formTextPageLimit(width, height) * .7, columns * rows)))
      setNotesPerPage((current) => current === nextLimit ? current : nextLimit)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(spread)
    observer?.observe(notes)
    window.addEventListener('resize', measure)
    measure()
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [page])

  useEffect(() => {
    setNotesPage((current) => Math.min(current, noteParts.length - 1))
  }, [noteParts.length])

  useLayoutEffect(() => {
    requestedNotesPage.current = page
    if (!isTurning && focusNotesAfterTurn.current) {
      focusNotesAfterTurn.current = false
      const target = handoff && page === noteParts.length ? previewHeadingRef.current : notesRef.current
      target?.focus({ preventScroll: true })
    }
  }, [handoff, isTurning, page, noteParts.length])

  useLayoutEffect(() => {
    const notes = notesRef.current
    if (!notes || notesPerPage <= 1 || notes.scrollHeight <= notes.clientHeight + 1) return
    setNotesPerPage((current) => Math.max(1, Math.floor(current * .7)))
  }, [charactersPerRow, notePart, notesPerPage])

  const persistDraft = useCallback((nextDraft: QuickAiEntryDraft) => {
    const result = writeQuickAiEntryDraft(userId, nextDraft)
    setPersistenceFailed(!result.persisted)
    return result
  }, [userId])

  const requestLogout = useCallback(() => {
    if (!persistenceFailed || !hasUnsavedContent) return true
    setLogoutConfirmationOpen(true)
    return false
  }, [hasUnsavedContent, persistenceFailed])

  useEffect(() => {
    if (!handoff || !focusNewPreview.current) return
    focusNewPreview.current = false
    setShowPreview(true)
  }, [handoff])

  useLayoutEffect(() => {
    if (!handoff || page !== noteParts.length) return
    const active = document.activeElement
    if (active === document.body || notesRef.current?.form?.contains(active)) {
      previewHeadingRef.current?.focus()
    }
  }, [handoff, page, noteParts.length])

  useEffect(() => {
    if (!registerLogoutGuard) return
    return registerLogoutGuard(requestLogout)
  }, [registerLogoutGuard, requestLogout])

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
      persistDraft(nextDraft)
      if (error?.blockReason === 'quota' || error?.blockReason === 'provider-rate-limit') setError(null)
      return
    }
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(1000, draft.blockedUntil! - now))
    return () => window.clearTimeout(timeout)
  }, [draft, error?.blockReason, now, persistDraft, userId])

  function updateNotes(notes: string) {
    const nextDraft = { ...draft, notes, handoff: null, reviewDraft: null, completedReview: false }
    setDraft(nextDraft)
    persistDraft(nextDraft)
    setValidationMessage(null)
    setError(null)
    setHandoff(null)
    setShowPreview(false)
    setTurningPage(null)
    setCopyStatus(null)
  }

  function turnNotesPage(nextPage: number) {
    const from = requestedNotesPage.current
    if (nextPage < 0 || nextPage >= pageCount || nextPage === page || isTurning) return false
    const accepted = requestPageTurn(nextPage > from ? 'forward' : 'backward', () => {
      requestedNotesPage.current = nextPage
      setTurningPage(nextPage)
    }, () => {
      requestedNotesPage.current = nextPage
      setNotesPage(Math.min(nextPage, noteParts.length - 1))
      setShowPreview(Boolean(handoff && nextPage === noteParts.length))
      setTurningPage(null)
      focusNotesAfterTurn.current = true
    }, undefined, () => {
      requestedNotesPage.current = page
      setTurningPage(null)
    })
    return accepted
  }

  function handlePageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
    const direction = event.key === 'PageDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'PageUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (direction && turnNotesPage(page + direction)) event.preventDefault()
  }

  async function copyNotes() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(draft.notes)
      setCopyStatus('Notes copied to the clipboard.')
    } catch {
      setCopyStatus('Copy is unavailable. Select your notes in the editor and copy them before leaving.')
    }
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
    const timeoutId = window.setTimeout(() => {
      if (!mounted.current || requestNumber.current !== currentRequest) return
      // Invalidate even a transport that ignores abort, so its late result cannot replace a retry.
      requestNumber.current++
      controller.abort()
      requestRef.current = null
      inFlight.current = false
      setLoading(false)
      setError({ code: 'TIMEOUT', message: 'Mori took too long to organize your notes. Your notes are still here; please try again.', retryable: true })
    }, EXTRACTION_TIMEOUT_MS)
    try {
      const recipe = await extract(sourceNotes, { userId, signal: controller.signal })
      if (controller.signal.aborted || !mounted.current || requestNumber.current !== currentRequest) return
      const nextHandoff: QuickAiEntryHandoff = { sourceNotes, recipe, saved: false }
      const completedDraft = { ...draft, handoff: nextHandoff, reviewDraft: null, completedReview: false }
      setDraft(completedDraft)
      persistDraft(completedDraft)
      focusNewPreview.current = true
      setHandoff(nextHandoff)
      onExtracted?.(nextHandoff)
    } catch (requestError) {
      if (controller.signal.aborted || !mounted.current || requestNumber.current !== currentRequest) return
      const nextError = describeExtractionError(requestError)
      setError(nextError)
      if (nextError.blockReason && nextError.retryAfterSeconds) {
        const blockedDraft: QuickAiEntryDraft = {
          ...draft,
          blockedUntil: Date.now() + nextError.retryAfterSeconds * 1000,
          blockedReason: nextError.blockReason,
        }
        setDraft(blockedDraft)
        persistDraft(blockedDraft)
        setNow(Date.now())
      }
    } finally {
      window.clearTimeout(timeoutId)
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

  function keepEditing() {
    if (logoutConfirmationOpen) setLogoutConfirmationOpen(false)
    else navigationConfirmation.keepEditing()
  }

  async function leaveWithoutSaving() {
    if (!logoutConfirmationOpen) {
      navigationConfirmation.discardChanges()
      return
    }

    setLogoutPending(true)
    try {
      await logout()
      setLogoutConfirmationOpen(false)
    } catch {
      setError({ code: 'LOGOUT_FAILED', message: 'Your notes are still in this page. Sign out again when you are ready to leave them.', retryable: false })
      setLogoutConfirmationOpen(false)
    } finally {
      setLogoutPending(false)
    }
  }

  async function signInAgain() {
    if (!requestLogout()) return
    try {
      await logout()
      navigate('/login', { replace: true, state: { from: '/app/quick-entry' } })
    } catch {
      setError({ code: 'LOGOUT_FAILED', message: 'Your session could not be verified. Use Log out in the journal header, then sign in again.', retryable: false })
    }
  }

  const describedBy = [helpId, countId, validationMessage ? validationId : null, persistenceFailed ? persistenceWarningId : null].filter(Boolean).join(' ')
  return <>
    {(navigationConfirmation.open || logoutConfirmationOpen) && <UnsavedChangesDialog
      onKeepEditing={keepEditing}
      onDiscardChanges={() => { void leaveWithoutSaving() }}
      title="Leave without saving your notes?"
      message="Your browser couldn't save these notes. Leaving now may lose them. Copy your notes before leaving, or choose Keep Editing."
      discardLabel={logoutPending ? 'Leaving…' : 'Leave Anyway'}
    />}
    <JournalFacingPage className={`mm-facing-content--quick-ai${desktopSpread ? ' mm-facing-content--quick-ai-task' : ''}`}>
      {desktopSpread ? <section className="mm-quick-ai__support" aria-labelledby="quick-ai-support-title">
        <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__journey">
          <h2 id="quick-ai-support-title">From notes to recipe</h2>
          <ol className="mm-quick-ai__steps">
            <li><span><strong>Write</strong> the ingredients and steps you remember.</span></li>
            <li><span><strong>Review</strong> the draft and make any changes.</span></li>
            <li><span><strong>Choose</strong> when to save it to your journal.</span></li>
          </ol>
        </PaperCard>
        <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__example">
          <h2>Example cooking notes</h2>
          <p>Fried two eggs with garlic, then tossed them with leftover rice and a splash of soy sauce.</p>
        </PaperCard>
      </section> : <>
        <header className="mm-quick-ai-intro">
          <div>
            <h1 tabIndex={-1}>Quick AI Entry</h1>
            <p className="mm-quick-ai-intro__copy">Write what you cooked, including amounts and steps you remember. You can review and edit the draft before saving it.</p>
          </div>
        </header>
        <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__example">
          <h2>Example cooking notes</h2>
          <p>Fried two eggs with garlic, then tossed them with leftover rice and a splash of soy sauce.</p>
        </PaperCard>
      </>}
    </JournalFacingPage>

    <section className="mm-quick-ai mm-page-column" aria-label="Quick AI Entry notes">
      {desktopSpread && <header className="mm-quick-ai-intro mm-quick-ai-intro--task">
        <h1 tabIndex={-1}>Quick AI Entry</h1>
        <p className="mm-quick-ai-intro__copy">Write what you cooked, including amounts and steps you remember. You can review and edit the draft before saving it.</p>
      </header>}
      <nav className="mm-quick-ai__back" aria-label="Sheet navigation">
        <Link to={journalReturnTo(location.state)}><span aria-hidden="true">←</span> Back to journal</Link>
      </nav>
      {page < noteParts.length && <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__sheet" role="region" aria-label={`Cooking notes page ${page + 1} of ${pageCount}`} tabIndex={0} onKeyDown={handlePageKeyDown}>
        <form id={notesId + '-form'} onSubmit={handleSubmit} noValidate>
          <div className="mm-quick-ai__field">
            <label htmlFor={notesId}>Cooking notes</label>
            <textarea
              ref={notesRef}
              className={`mm-quick-ai__textarea${guidedNotes && moriFocusNotes ? ' mori-guided-focus' : ''}`}
              id={notesId}
              name="notes"
              rows={Math.max(3, formTextRows(notePart, charactersPerRow))}
              maxLength={Math.max(notePart.length, MAX_EXTRACTION_INPUT_CHARS - draft.notes.length + notePart.length)}
              value={notePart}
              disabled={loading}
              aria-invalid={validationMessage ? 'true' : undefined}
              aria-describedby={describedBy}
              onChange={(event) => updateNotes(replaceFormTextPart(noteParts, page, event.currentTarget.value))}
            />
            {persistenceFailed && <div className="mm-quick-ai__storage-warning" id={persistenceWarningId} role="alert" aria-atomic="true">
              <p>{draft.notes.trim()
                ? "Your browser couldn't save these notes in session storage. They're preserved in memory for this account while this app stays open, but a reload or closing the tab may erase them."
                : "Your browser couldn't access session storage. Notes you add are held in memory for this account while this app stays open, but a reload or closing the tab may erase them."}</p>
              <div className="mm-quick-ai__storage-actions">
                {hasUnsavedContent && <button className="button button-secondary mm-button--small" type="button" onClick={() => persistDraft(draft)}>Try saving again</button>}
                {draft.notes.length > 0 && <button className="button button-secondary mm-button--small" type="button" onClick={() => { void copyNotes() }}>Copy Notes</button>}
              </div>
              {copyStatus && <p className="mm-quick-ai__copy-status" role="status" aria-live="polite">{copyStatus}</p>}
            </div>}
            <div className="mm-quick-ai__field-meta">
              <p className="mm-quick-ai__helper" id={helpId}>{persistenceFailed
                ? `Your notes stay available in this app while it is open. Maximum ${MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters.`
                : `Your notes are saved in this browser session as you type. Maximum ${MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters.`}</p>
              <p className="mm-quick-ai__count" id={countId} aria-live="off">{draft.notes.length.toLocaleString()} / {MAX_EXTRACTION_INPUT_CHARS.toLocaleString()}</p>
            </div>
            {validationMessage && <p className="mm-quick-ai__validation" id={validationId} role="alert">{validationMessage}</p>}
          </div>

          <div className="mm-quick-ai__actions">
            <button className="button button-primary" type="submit" disabled={loading || retryWait > 0}>
              {loading ? 'Mori is organizing…' : retryWait > 0 ? 'Please wait to retry' : error?.retryable ? 'Retry extraction' : 'Organize my notes'}
            </button>
          </div>
        </form>

        {loading && <p className="mm-quick-ai__loading" role="status" aria-live="polite">Mori is organizing your notes. {persistenceFailed ? 'Keep this page open.' : 'Keep this page open, or come back to your saved-in-session draft.'}</p>}
        {retryWait > 0 && <p className="mm-quick-ai__cooldown" role="timer" aria-live="off">
          {draft.blockedReason === 'quota'
            ? `Today's AI limit is still in effect. Wait at least ${retryWait} ${retryWait === 1 ? 'second' : 'seconds'} before retrying.`
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
      </PaperCard>}

      {handoff && page === noteParts.length && <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__sheet mm-quick-ai__preview-page" role="region" aria-label={`Recipe preview, page ${page + 1} of ${pageCount}`} tabIndex={0} onKeyDown={handlePageKeyDown}>
        <RecipePreview handoff={handoff} headingRef={previewHeadingRef} reviewState={{
        journalReturn: '/app/quick-entry',
        sourceJournalReturn: journalReturnTo(location.state),
        }} />
      </PaperCard>}
    </section>
    <JournalPageFooter><JournalPagination label="Cooking notes pages" rightNumber={`Page ${page + 1} of ${pageCount}`}
      previous={page > 0 && <button type="button" className="button mm-button--page-turn" aria-label="Previous page" disabled={isTurning} onClick={() => turnNotesPage(page - 1)}>← Previous</button>}
      next={page < pageCount - 1 && <button type="button" className="button mm-button--page-turn" aria-label="Next page" disabled={isTurning} onClick={() => turnNotesPage(page + 1)}>Next →</button>} />
    </JournalPageFooter>
  </>
}
