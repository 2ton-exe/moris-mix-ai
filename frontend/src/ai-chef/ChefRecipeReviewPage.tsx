import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { JournalShell } from '../journal/JournalShell'
import { Mori } from '../journal/Mori'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import { RecipeForm } from '../recipe-form/RecipeForm'
import type { RecipeDraft, RecipeEditorState } from '../recipe-form/draft'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { confirmedSave } from '../recipe-form/submission'
import { mapAiRecipeToDraft } from '../recipe-form/aiRecipeDraft'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { readChefDraftResult, writeChefDraft } from './draft'
import type { ChefDraftReadStatus, ChefDraftWriteResult, ChefReviewHandoff } from './draft'
import './aiChef.css'

type ReviewStorageIssue = Exclude<ChefDraftReadStatus, 'available'> | 'write-failed' | 'verification-failed' | 'handoff-changed' | 'saved-clear-failed'

export function ChefRecipeReviewPage({ save }: { save?: SaveRecipeDraft }) {
  const { user } = useAuth()
  if (!user) return <p role="alert">Sign in to review an AI Chef recipe.</p>
  return <ChefReviewSession key={user.id} userId={user.id} save={save} />
}

function ChefReviewSession({ userId, save }: { userId: string; save?: SaveRecipeDraft }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [initialRead] = useState(() => readChefDraftResult(userId))
  const stored = initialRead.draft
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [storageIssue, setStorageIssue] = useState<ReviewStorageIssue | null>(initialRead.status === 'available' ? null : initialRead.status)
  const [lastKnownDraft, setLastKnownDraft] = useState(stored)
  const reviewDraftRef = useRef<RecipeEditorState | null>(stored.handoff?.reviewDraft ?? null)
  const handoff = stored.handoff
  const initialValues = handoff ? mapAiRecipeToDraft(handoff.response.recipe) : null
  const recipeSave = useRecipeSave(save)
  const navigationConfirmation = useUnsavedChangesGuard(dirty || (saved && storageIssue === 'saved-clear-failed'), { warnOnUnload: storageIssue !== null })

  function currentDraft() {
    const result = readChefDraftResult(userId)
    return result.status === 'available' || result.status === 'memory' ? result.draft : lastKnownDraft
  }

  function sameHandoff(current: ChefReviewHandoff | null) {
    return !!handoff && !!current && JSON.stringify(current.request) === JSON.stringify(handoff.request) &&
      JSON.stringify(current.response) === JSON.stringify(handoff.response)
  }

  function storeReviewDraft(state: RecipeEditorState | null) {
    if (!handoff || saved) return false
    reviewDraftRef.current = state
    const current = currentDraft()
    if (!sameHandoff(current.handoff)) {
      setStorageIssue('handoff-changed')
      return false
    }
    const nextHandoff: ChefReviewHandoff = { ...current.handoff!, reviewDraft: state, saved: false }
    const next = { ...current, handoff: nextHandoff }
    setLastKnownDraft(next)
    const result = writeChefDraft(userId, next)
    setStorageIssue(result.persisted ? null : result.reason)
    return result.persisted
  }

  function clearReviewDraftAndLeave() {
    reviewDraftRef.current = null
    if (handoff && !saved) storeReviewDraft(null)
    navigationConfirmation.discardChanges()
  }

  function clearHandoffAfterSave(): ChefDraftWriteResult | null {
    const current = currentDraft()
    if (current.handoff !== null && !sameHandoff(current.handoff)) {
      setStorageIssue('handoff-changed')
      return null
    }
    const next = { ...current, handoff: null }
    setLastKnownDraft(next)
    return writeChefDraft(userId, next)
  }

  async function submit(draft: RecipeDraft, context: { signal: AbortSignal }) {
    const confirmation = await recipeSave(draft, context)
    if (confirmedSave(confirmation)) {
      const result = clearHandoffAfterSave()
      setSaved(true)
      setStorageIssue(result?.persisted ? null : result ? 'saved-clear-failed' : 'handoff-changed')
    }
    return confirmation
  }

  function retryStorage() {
    if (saved) {
      const result = clearHandoffAfterSave()
      setStorageIssue(result?.persisted ? null : result ? 'saved-clear-failed' : 'handoff-changed')
    } else {
      storeReviewDraft(reviewDraftRef.current)
    }
  }

  const reviewDraft = handoff?.reviewDraft ?? null
  if (!handoff || !initialValues) {
    return <ReviewUnavailable userEmail={user?.email} status={initialRead.status} />
  }

  const storageNotice = storageIssue && <div className="mm-ai-chef__storage-warning" role="alert">
    <p>{storageIssue === 'handoff-changed'
      ? 'The saved AI Chef preview changed elsewhere. This review stays open, but it will not overwrite the newer preview.'
      : saved
        ? 'The recipe was saved, but this browser could not clear the old preview. Check your journal before saving again; the preview may reappear after a reload.'
        : 'Your edits are still available in this page, but this browser could not confirm their saved draft. A reload may lose recent changes.'}</p>
    {storageIssue !== 'handoff-changed' && <button className="button button-secondary mm-button--small" type="button" onClick={retryStorage}>Try saving the review again</button>}
  </div>

  return <RecipeForm key={userId} mode="create"
    initialValues={reviewDraft ? undefined : initialValues}
    initialEditorState={reviewDraft ?? undefined}
    initialValuesAreUnsaved
    showExtractionHints
    editorTitle={saved ? 'Your recipe is saved.' : "Review Mori's recipe."}
    notesSupported
    onSubmit={submit}
    onDirtyChange={setDirty}
    onEditorStateChange={storeReviewDraft}
    cancelLabel="Back to AI Chef"
    onCancel={() => navigate('/app/chef')}
    notice={<>
      <ChefGenerationNotice handoff={handoff} saved={saved} />
      {storageNotice}
    </>}
    renderFrame={(content) => <RecipeEditorFrame mode="create" connected
      headingEyebrow={saved ? 'Saved to your journal' : 'AI Chef · unsaved recipe'}
      headingTitle={saved ? 'Your recipe is saved.' : "Review Mori's recipe."}
      headingIntro={<p className="intro">{saved
        ? 'The recipe is in your journal. You can keep editing and choose Save changes when you are ready.'
        : 'Review the ingredients, measurements, and steps. Edit anything you like, then choose Save recipe to add it to your journal.'}</p>}
      navigationConfirmation={{ ...navigationConfirmation, discardChanges: clearReviewDraftAndLeave }}
      backTo="/app/chef" backLabel="Back to AI Chef">{content}</RecipeEditorFrame>} />
}

function ChefGenerationNotice({ handoff, saved }: { handoff: ChefReviewHandoff; saved: boolean }) {
  const { request, response } = handoff
  const flavorScores = response.recipe.flavor_scores
  const contextMessage = response.context.status === 'NO_SAVED_RECIPES'
    ? 'This is a fresh start. Mori did not have saved recipes to use as inspiration, so the suggestion came from your pantry request.'
    : response.context.status === 'NO_PANTRY_OVERLAP'
      ? 'No saved recipes matched these pantry items. Mori made this suggestion from your request.'
      : response.context.status === 'MATCHED'
        ? `Mori found ${response.context.matchedCandidateCount} saved ${response.context.matchedCandidateCount === 1 ? 'recipe' : 'recipes'} to use as inspiration.`
        : 'Mori could not use an empty pantry request.'

  return <section className="recipe-form-notice mm-ai-chef__review-notice" aria-label="AI Chef generation details">
    <strong>{saved ? 'AI Chef recipe saved to your journal' : 'AI Chef recipe · unsaved preview'}</strong>
    <p>{saved ? 'Your reviewed recipe was saved. Pantry inputs, preferences, and lineage suggestions remain separate.' : 'Generation has not saved a recipe or created any lineage. Choose Save recipe only after you finish reviewing.'}</p>
    <p className="mm-ai-chef__context">{contextMessage}</p>
    <details>
      <summary>Pantry and preferences used for this request</summary>
      <p>These request details are temporary and will not be saved as recipe notes.</p>
      <ul>{request.pantryItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      {request.preferences && <p><strong>Preferences:</strong> {request.preferences}</p>}
    </details>
    {response.substitutions.length > 0 && <section aria-label="Suggested substitutions" className="mm-ai-chef__suggestions">
      <h2>Suggested substitutions</h2>
      <ul>{response.substitutions.map((substitution, index) => <li key={`${substitution.original}-${substitution.replacement}-${index}`}>
        <strong>{substitution.original}</strong><span aria-hidden="true"> → </span><strong>{substitution.replacement}</strong>
        {substitution.reason && <p>{substitution.reason}</p>}
      </li>)}</ul>
    </section>}
    <section aria-label="Suggested parent recipes" className="mm-ai-chef__suggestions">
      <h2>Recipe inspiration from your journal</h2>
      <p>These are suggestions for review. Saving this recipe will not create parent links; parent approval and removal controls are planned for FE-11.</p>
      {response.parents.length > 0
        ? <ul>{response.parents.map((parent) => <li key={parent.id}>
          <strong>{parent.title}</strong>{parent.star_rating !== null && <span> · {parent.star_rating} / 5 stars</span>}
        </li>)}</ul>
        : <p>{response.context.status === 'NO_SAVED_RECIPES' ? 'There are no saved recipes to suggest yet.' : 'Mori did not suggest any parent recipes.'}</p>}
    </section>
    {flavorScores && <details>
      <summary>Mori’s optional flavor estimates</summary>
      <p>These estimates are informational only. They are not recipe fields and will not be saved.</p>
      <ul>{Object.entries(flavorScores).map(([flavor, score]) => <li key={flavor}>{flavor}: {score} / 5</li>)}</ul>
    </details>}
  </section>
}

function ReviewUnavailable({ userEmail, status }: { userEmail?: string; status: ChefDraftReadStatus }) {
  const storageMessage = status === 'unavailable' || status === 'read-failed'
    ? 'This browser could not restore the saved preview. The recipe remains unsaved; return to AI Chef to make a new suggestion.'
    : 'There is no AI Chef recipe waiting for review. Ask Mori for a suggestion first.'
  return <JournalShell mode="writing" account={<div className="journal-account"><span>{userEmail}</span></div>} pageClassName="mm-journal-editor">
    <JournalFacingPage className="mm-facing-content--editor">
      <nav className="mm-recipe-detail__back" aria-label="Sheet navigation"><Link to="/app/chef">← Back to AI Chef</Link></nav>
      <header className="mm-recipe-editor-heading">
        <div>
          <p className="mm-recipe-index__eyebrow">AI recipe preview</p>
          <h1 tabIndex={-1}>Nothing is waiting to be reviewed</h1>
          <p className="intro">{storageMessage}</p>
        </div>
        <Mori mood="think" size={82} />
      </header>
      <Link className="button button-primary" to="/app/chef">Open AI Chef</Link>
    </JournalFacingPage>
  </JournalShell>
}
