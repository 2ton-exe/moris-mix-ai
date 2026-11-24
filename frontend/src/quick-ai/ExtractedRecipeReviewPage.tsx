import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { moriReviewKeyFromState } from '../mori/routeState'
import { useMoriReviewCompletion } from '../mori/MoriCompanionContext'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import { JournalShell } from '../journal/JournalShell'
import { JOURNAL_SINGLE_LAYOUT_QUERY } from '../journal/pageTurnMotion'
import { useJournalMedia } from '../journal/useJournalMedia'
import { journalReturnTo } from '../journal/indexNavigation'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import { RecipeForm } from '../recipe-form/RecipeForm'
import type { RecipeEditorState, RecipeDraft } from '../recipe-form/draft'
import { UnsavedChangesDialog } from '../recipe-form/UnsavedChangesDialog'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { confirmedSave } from '../recipe-form/submission'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from './draft'
import type { QuickAiDraftReadStatus, QuickAiDraftWriteResult } from './draft'
import { mapExtractedRecipeToDraft } from './recipeDraft'
import './quickAiEntry.css'

type ReviewStorageIssue = Exclude<QuickAiDraftReadStatus, 'available'> | 'write-failed' | 'verification-failed' | 'handoff-changed' | 'saved-clear-failed'

function sourceNotesReturn(state: unknown) {
  if (typeof state === 'object' && state !== null && 'sourceJournalReturn' in state && typeof state.sourceJournalReturn === 'string') {
    return journalReturnTo({ journalReturn: state.sourceJournalReturn })
  }
  return '/app/recipes'
}

export function ExtractedRecipeReviewPage({ save }: { save?: SaveRecipeDraft }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <p role="alert">Sign in to review an extracted recipe.</p>
  const reviewIdentity = moriReviewKeyFromState(location.state)
  return <ExtractedRecipeReviewSession key={`${user.id}:${reviewIdentity}`} userId={user.id} save={save} />
}

function ExtractedRecipeReviewSession({ userId, save }: { userId: string; save?: SaveRecipeDraft }) {
  const location = useLocation()
  const navigate = useNavigate()
  const single = useJournalMedia(JOURNAL_SINGLE_LAYOUT_QUERY)
  const { markReviewCompleted } = useMoriReviewCompletion()
  const { user, logout } = useAuth()
  const registerLogoutGuard = useContext(JournalLogoutGuardContext)
  const [initialRead] = useState(() => readQuickAiEntryDraftResult(userId))
  const stored = initialRead.draft
  const [dirty, setDirty] = useState(false)
  const [consumed, setConsumed] = useState(false)
  const [storageIssue, setStorageIssue] = useState<ReviewStorageIssue | null>(initialRead.status === 'available' ? null : initialRead.status)
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const reviewDraftRef = useRef<RecipeEditorState | null>(stored.reviewDraft ?? null)
  const lastKnownDraftRef = useRef(stored)
  const handoff = stored.handoff
  const initialValues = handoff ? mapExtractedRecipeToDraft(handoff.recipe) : null
  const recipeSave = useRecipeSave(save)
  const returnState = { journalReturn: sourceNotesReturn(location.state) }
  const guardDirty = dirty || (consumed && storageIssue === 'saved-clear-failed')
  const volatilePostSaveEdits = consumed && dirty
  const navigationConfirmation = useUnsavedChangesGuard(guardDirty, { warnOnUnload: storageIssue !== null })

  function updateStoredReviewDraft(state: RecipeEditorState | null) {
    reviewDraftRef.current = state
    if (consumed) return false
    const result = readQuickAiEntryDraftResult(userId)
    const current = result.status === 'available' || result.status === 'memory'
      ? result.draft
      : lastKnownDraftRef.current
    if (!handoff || JSON.stringify(current.handoff) !== JSON.stringify(handoff)) {
      setStorageIssue('handoff-changed')
      return false
    }
    const next = { ...current, reviewDraft: state }
    lastKnownDraftRef.current = next
    const writeResult = writeQuickAiEntryDraft(userId, next)
    setStorageIssue(writeResult.persisted ? null : writeResult.reason)
    return writeResult.persisted
  }

  function consumeHandoff() {
    const result = readQuickAiEntryDraftResult(userId)
    const current = result.status === 'available' || result.status === 'memory'
      ? result.draft
      : lastKnownDraftRef.current
    const alreadyConsumed = consumed && current.handoff === null
    if (!handoff || (!alreadyConsumed && JSON.stringify(current.handoff) !== JSON.stringify(handoff))) {
      setStorageIssue('handoff-changed')
      return false
    }
    const next = { ...current, handoff: null, reviewDraft: null, completedReview: true }
    lastKnownDraftRef.current = next
    const writeResult: QuickAiDraftWriteResult = writeQuickAiEntryDraft(userId, next)
    setStorageIssue(writeResult.persisted ? null : 'saved-clear-failed')
    return writeResult.persisted
  }

  const requestLogout = useCallback(() => {
    if (!guardDirty || (storageIssue === null && !volatilePostSaveEdits)) return true
    setLogoutConfirmationOpen(true)
    return false
  }, [guardDirty, storageIssue, volatilePostSaveEdits])

  useEffect(() => {
    if (!registerLogoutGuard) return
    return registerLogoutGuard(requestLogout)
  }, [registerLogoutGuard, requestLogout])

  function retryStorage() {
    if (consumed) consumeHandoff()
    else updateStoredReviewDraft(reviewDraftRef.current)
  }

  function keepEditing() {
    if (logoutConfirmationOpen) setLogoutConfirmationOpen(false)
    else navigationConfirmation.keepEditing()
  }

  async function leaveWithoutSaving() {
    setLogoutPending(true)
    setLogoutError(null)
    try {
      await logout()
      setLogoutConfirmationOpen(false)
    } catch {
      setLogoutError('Could not sign out. Your review is still open; try again when you are ready to leave it.')
      setLogoutConfirmationOpen(false)
    } finally {
      setLogoutPending(false)
    }
  }

  function discardAndLeave() {
    if (consumed) consumeHandoff()
    else updateStoredReviewDraft(null)
    navigationConfirmation.discardChanges()
  }

  async function submit(draft: RecipeDraft, context: { signal: AbortSignal }) {
    const confirmation = await recipeSave(draft, context)
    if (confirmedSave(confirmation)) {
      const reviewKey = moriReviewKeyFromState(location.state)
      if (typeof reviewKey === 'number') markReviewCompleted(reviewKey)
      consumeHandoff()
      setConsumed(true)
    }
    return confirmation
  }

  if (!handoff || !initialValues) {
    return <ReviewUnavailable userEmail={user?.email} state={returnState} storageStatus={initialRead.status} message={handoff
      ? 'Mori’s extraction does not fit the recipe form safely. Return to Quick AI Entry to review your notes or organize them again.'
      : undefined} />
  }

  const storageNotice = storageIssue && <ReviewStorageWarning issue={storageIssue} saved={consumed} onRetry={storageIssue === 'handoff-changed' ? undefined : retryStorage} />
  const editorTitle = consumed ? 'Edit saved recipe' : 'Review your recipe'
  const editorIntro = consumed ? undefined : storageIssue === null
    ? 'Review each named section. Save from the final page. Your draft stays in this tab.'
    : 'Review each named section, then save from the final page. Keep this page open while you review.'
  const extractionNotice = !consumed && <ExtractionNotice handoff={handoff} />
  const pageNotice = <>
    {storageNotice}
    {logoutError && <p className="field-error" role="alert">{logoutError}</p>}
  </>

  return <>
    {logoutConfirmationOpen && <UnsavedChangesDialog
      onKeepEditing={keepEditing}
      onDiscardChanges={() => { void leaveWithoutSaving() }}
      title={volatilePostSaveEdits ? 'Leave without saving your changes?' : 'Leave without saving your review?'}
      message={volatilePostSaveEdits
        ? 'Your recipe is saved, but these newer edits are not. Signing out now will discard them. Choose Keep Editing or save your changes first.'
        : 'Your browser could not save this extracted recipe draft. Signing out now may lose recent edits. Choose Keep Editing to retry storage or Save the recipe first.'}
      discardLabel={logoutPending ? 'Signing out…' : 'Sign out anyway'}
    />}
    <RecipeForm key={userId} mode="create"
      initialValues={stored.reviewDraft ? undefined : initialValues}
      initialEditorState={stored.reviewDraft ?? undefined}
      initialValuesAreUnsaved
      showExtractionHints
      reviewWorkflow
      draftKeptInSession={!consumed && storageIssue === null}
      editorTitle={editorTitle}
      editorIntro={editorIntro}
      notesSupported
      onSubmit={submit}
      onDirtyChange={setDirty}
      onEditorStateChange={updateStoredReviewDraft}
      cancelLabel="Back to Mori notes"
      onCancel={() => navigate('/app/quick-entry', { state: returnState })}
      notice={pageNotice}
      supplement={single ? extractionNotice : undefined}
      renderFrame={(content) => <RecipeEditorFrame mode="create" connected showBack={false}
        headingTitle={editorTitle} headingIntro={editorIntro}
        facingPageContent={!single && extractionNotice}
        navigationConfirmation={{ ...navigationConfirmation, discardChanges: discardAndLeave }}>{content}</RecipeEditorFrame>} />
  </>
}

function ReviewStorageWarning({ issue, saved, onRetry }: { issue: ReviewStorageIssue; saved: boolean; onRetry?: () => void }) {
  const message = issue === 'handoff-changed'
    ? 'The saved extraction changed elsewhere. This review remains open, but it cannot safely overwrite that newer handoff.'
    : saved
      ? 'The recipe was saved, but this browser could not clear the old extraction. Check your journal before saving again; the preview may reappear after a reload.'
      : 'Your edits are preserved in memory for this account while this app stays open. A reload or closing the tab may erase them.'
  return <div className="mm-quick-ai__storage-warning" role="alert" aria-atomic="true">
    <p>{message}</p>
    {onRetry && <div className="mm-quick-ai__storage-actions">
      <button className="button button-secondary mm-button--small" type="button" onClick={onRetry}>{saved ? 'Try clearing the old preview again' : 'Try saving the review again'}</button>
    </div>}
  </div>
}

function ExtractionNotice({ handoff }: { handoff: NonNullable<ReturnType<typeof readQuickAiEntryDraftResult>['draft']['handoff']> }) {
  const flavorScores = handoff.recipe.flavor_scores
  const words = (value: string) => value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? ''
  const source = ` ${words(handoff.sourceNotes)} `
  const ingredientsToCompare = [...new Set(handoff.recipe.ingredients.map(({ name }) => name))]
    .filter((name) => words(name) && !source.includes(` ${words(name)} `))
  const excerpt = handoff.sourceNotes.split('\n', 5).join('\n').slice(0, 240).trimEnd()
  const hasMore = excerpt.length < handoff.sourceNotes.trimEnd().length
  return <section className="mm-extraction-notes" aria-label="Mori's extraction notes">
    <h2>Original cooking notes</h2>
    {ingredientsToCompare.length > 0 && <p>Check Mori’s wording for <strong>{ingredientsToCompare[0]}</strong> against your notes.</p>}
    <blockquote>{excerpt}{hasMore && '…'}</blockquote>
    {hasMore && <details>
      <summary>Read full cooking notes</summary>
      <blockquote tabIndex={0}>{handoff.sourceNotes}</blockquote>
    </details>}
    {flavorScores && <details>
      <summary>Flavor estimates</summary>
      <p>Flavor estimates are preview only.</p>
      <dl>{Object.entries(flavorScores).map(([flavor, score]) => <div key={flavor}><dt>{flavor}</dt><dd>{score} / 5</dd></div>)}</dl>
    </details>}
  </section>
}

function ReviewUnavailable({ userEmail, state, storageStatus, message }: { userEmail?: string; state: { journalReturn: string }; storageStatus: QuickAiDraftReadStatus; message?: string }) {
  const storageMessage = storageStatus === 'unavailable' || storageStatus === 'read-failed'
    ? 'This browser could not restore the saved draft. Open Quick AI Entry to check your notes.'
    : undefined
  return <JournalShell mode="writing" account={<div className="journal-account"><span>{userEmail}</span></div>} pageClassName="mm-journal-editor">
    <JournalFacingPage className="mm-facing-content--editor">
      <header className="mm-recipe-editor-heading">
        <h1 tabIndex={-1}>No recipe draft to review</h1>
        {storageMessage
          ? <p role="alert" className="mm-quick-ai__storage-warning">{storageMessage}</p>
          : <p className="intro">{message ?? 'Organize your notes in Quick AI Entry to create a draft.'}</p>}
        <Link className="button button-primary" to="/app/quick-entry" state={state}>Open Quick AI Entry</Link>
      </header>
    </JournalFacingPage>
  </JournalShell>
}
