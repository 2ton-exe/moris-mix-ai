import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import { JournalShell } from '../journal/JournalShell'
import { Mori } from '../journal/Mori'
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
  if (!user) return <p role="alert">Sign in to review an extracted recipe.</p>
  return <ExtractedRecipeReviewSession key={user.id} userId={user.id} save={save} />
}

function ExtractedRecipeReviewSession({ userId, save }: { userId: string; save?: SaveRecipeDraft }) {
  const location = useLocation()
  const navigate = useNavigate()
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
    const next = { ...current, handoff: null, reviewDraft: null }
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
  const pageNotice = <>
    <ExtractionNotice handoff={handoff} saved={consumed} />
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
      editorTitle={consumed ? 'Your recipe is saved.' : "Review Mori's recipe."}
      notesSupported
      onSubmit={submit}
      onDirtyChange={setDirty}
      onEditorStateChange={updateStoredReviewDraft}
      cancelLabel="Back to Mori notes"
      onCancel={() => navigate('/app/quick-entry', { state: returnState })}
      notice={pageNotice}
      renderFrame={(content) => <RecipeEditorFrame mode="create" connected
        headingEyebrow={consumed ? 'Saved to your journal' : 'AI-extracted, unsaved recipe'}
        headingTitle={consumed ? 'Your recipe is saved.' : "Review Mori's recipe."}
        headingIntro={<p className="intro">{consumed ? 'You can continue editing and choose Save changes to update this recipe.' : 'Check estimates and incomplete details, then save only when you are satisfied.'}</p>}
        navigationConfirmation={{ ...navigationConfirmation, discardChanges: discardAndLeave }}
        backTo="/app/quick-entry" backState={returnState} backLabel="Back to Mori notes">{content}</RecipeEditorFrame>} />
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

function ExtractionNotice({ handoff, saved }: { handoff: NonNullable<ReturnType<typeof readQuickAiEntryDraftResult>['draft']['handoff']>; saved: boolean }) {
  const flavorScores = handoff.recipe.flavor_scores
  return <section className="recipe-form-notice" aria-label="AI extraction details">
    <strong>{saved ? 'AI-extracted recipe saved to your journal' : 'AI-extracted, unsaved recipe'}</strong>
    <p>{saved ? 'Mori organized your original cooking notes into this saved recipe. The notes and optional flavor estimates remain separate.' : 'Mori organized your cooking notes into this editable draft. Review estimated and incomplete details before choosing Save recipe.'}</p>
    <details>
      <summary>Original cooking notes</summary>
      <blockquote>{handoff.sourceNotes}</blockquote>
    </details>
    {flavorScores && <details>
      <summary>Mori’s optional flavor estimates</summary>
      <p>These AI estimates are informational only. They are not recipe fields and will not be saved.</p>
      <ul>{Object.entries(flavorScores).map(([flavor, score]) => <li key={flavor}>{flavor}: {score} / 5</li>)}</ul>
    </details>}
  </section>
}

function ReviewUnavailable({ userEmail, state, storageStatus, message }: { userEmail?: string; state: { journalReturn: string }; storageStatus: QuickAiDraftReadStatus; message?: string }) {
  const storageMessage = storageStatus === 'unavailable'
    ? 'Your browser could not access session storage, so this extraction could not be restored. Return to Quick AI Entry and keep your notes open while you work.'
    : storageStatus === 'read-failed'
      ? 'Your browser could not read the saved session draft. Return to Quick AI Entry and recover or re-enter your source notes before leaving.'
      : undefined
  return <JournalShell mode="writing" account={<div className="journal-account"><span>{userEmail}</span></div>} pageClassName="mm-journal-editor">
    <JournalFacingPage className="mm-facing-content--editor">
      <nav className="mm-recipe-detail__back" aria-label="Sheet navigation"><Link to="/app/quick-entry" state={state}>← Back to Mori notes</Link></nav>
      <header className="mm-recipe-editor-heading">
        <div>
          <p className="mm-recipe-index__eyebrow">AI recipe preview</p>
          <h1 tabIndex={-1}>Nothing is waiting to be reviewed</h1>
          <p className="intro">{message ?? (storageMessage ? 'This extraction could not be restored from this browser session.' : 'This unsaved extraction is missing or could not be prepared. Return to Quick AI Entry to restore your notes or organize them again.')}</p>
        </div>
        <Mori mood="think" size={82} />
      </header>
      {storageMessage && <p role="alert" className="mm-quick-ai__storage-warning">{storageMessage}</p>}
      <Link className="button button-primary" to="/app/quick-entry" state={state}>Open Quick AI Entry</Link>
    </JournalFacingPage>
  </JournalShell>
}
