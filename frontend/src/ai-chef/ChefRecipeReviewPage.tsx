import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { moriReviewKeyFromState } from '../mori/routeState'
import { useMoriActivity, useMoriReviewCompletion } from '../mori/MoriCompanionContext'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { JournalShell } from '../journal/JournalShell'
import { ReviewSticker } from '../journal/ReviewSticker'
import { useJournalMedia } from '../journal/useJournalMedia'
import ingredientBasket from '../assets/stickers/ingredient-basket.svg'
import { ReviewDetailDialog } from '../recipe-form/ReviewDetailDialog'
import { RecipeEditorFrame } from '../recipe-form/RecipeEditorFrame'
import { RecipeForm } from '../recipe-form/RecipeForm'
import { IngredientEmoji } from '../recipe-form/IngredientEmojiView'
import type { RecipeDraft, RecipeEditorState } from '../recipe-form/draft'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { confirmedSave } from '../recipe-form/submission'
import { mapAiRecipeToDraft } from '../recipe-form/aiRecipeDraft'
import { useRecipeSave } from '../recipe-form/useRecipeSave'
import { useUnsavedChangesGuard } from '../recipe-form/useUnsavedChangesGuard'
import { readChefDraftResult, writeChefDraft } from './draft'
import { ChefProgress } from './ChefProgress'
import type { ChefDraftReadStatus, ChefDraftWriteResult, ChefReviewHandoff } from './draft'
import { LineageApiError, lineageApi, lineageFailureMessage, lineageMatchesSelection } from './lineage'
import './aiChef.css'
import './chefReview.css'

type ReviewStorageIssue = Exclude<ChefDraftReadStatus, 'available'> | 'write-failed' | 'verification-failed' | 'handoff-changed' | 'saved-clear-failed'
type LineageStatus = 'idle' | 'pending' | 'expired' | 'blocked' | 'confirmed'
type LineageAttempt = { status: Exclude<LineageStatus, 'idle'>; message: string }
type FlavorScores = NonNullable<ChefReviewHandoff['response']['recipe']['flavor_scores']>

const flavorIngredients: [keyof FlavorScores, 'strawberry' | 'salt' | 'lemon' | 'chocolate' | 'mushroom' | 'chili'][] = [
  ['sweet', 'strawberry'],
  ['salty', 'salt'],
  ['sour', 'lemon'],
  ['bitter', 'chocolate'],
  ['umami', 'mushroom'],
  ['spicy', 'chili'],
]

function uniqueCandidateParents(handoff: ChefReviewHandoff) {
  const seen = new Set<string>()
  return handoff.response.parents.filter((parent) => {
    const id = parent.id.toLowerCase()
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function safeSelectedParentIds(handoff: ChefReviewHandoff) {
  const candidates = new Set(uniqueCandidateParents(handoff).map((parent) => parent.id.toLowerCase()))
  const seen = new Set<string>()
  return handoff.selectedParentIds.filter((id) => {
    const normalized = id.toLowerCase()
    if (!candidates.has(normalized) || seen.has(normalized) || seen.size >= 10) return false
    seen.add(normalized)
    return true
  })
}

function permanentLineageFailure(error: unknown) {
  return error instanceof LineageApiError &&
    ['expired-token', 'invalid-token', 'wrong-user', 'not-candidate', 'ownership', 'unauthorized', 'validation'].includes(error.reason)
}

async function persistOrReconcileLineage(
  handoff: ChefReviewHandoff,
  userId: string,
  signal: AbortSignal,
  checkBeforePost: boolean,
): Promise<LineageAttempt> {
  const candidateChildId = handoff.savedRecipeId
  const selected = safeSelectedParentIds(handoff)
  const request = { userId, signal }
  if (!candidateChildId || selected.length === 0) {
    return { status: 'blocked', message: 'Your recipe is safe, but Mori could not verify the selected parent links.' }
  }
  const childId: string = candidateChildId
  const candidates = uniqueCandidateParents(handoff).map((parent) => parent.id)

  async function readPersisted() {
    return await lineageApi.get(childId, request)
  }

  if (checkBeforePost) {
    try {
      const current = await readPersisted()
      if (lineageMatchesSelection(current, childId, selected)) return { status: 'confirmed', message: '' }
      if (current.lineage.length > 0) {
        return {
          status: 'blocked',
          message: 'Your recipe is safe, but Mori found a different set of parent links than you selected. The links were not changed.',
        }
      }
    } catch (error) {
      if (permanentLineageFailure(error)) {
        return { status: 'blocked', message: lineageFailureMessage(error) }
      }
      return {
        status: 'pending',
        message: 'Your recipe was saved, but Mori could not check whether its parent links were already saved. Your recipe is safe; try checking again.',
      }
    }
  }

  try {
    if (!handoff.response.candidate_token) throw new LineageApiError('validation')
    const response = await lineageApi.save(
      childId,
      candidates,
      selected,
      handoff.response.candidate_token,
      request,
    )
    if (lineageMatchesSelection(response, childId, selected)) return { status: 'confirmed', message: '' }
    throw new LineageApiError('invalid-response', true)
  } catch (error) {
    if (error instanceof LineageApiError && error.reason === 'expired-token') {
      return { status: 'expired', message: lineageFailureMessage(error) }
    }
    if (permanentLineageFailure(error)) {
      return { status: 'blocked', message: lineageFailureMessage(error) }
    }
    try {
      const current = await readPersisted()
      if (lineageMatchesSelection(current, childId, selected)) return { status: 'confirmed', message: '' }
      if (current.lineage.length > 0) {
        return {
          status: 'blocked',
          message: 'Your recipe is safe, but Mori found a different set of parent links than you selected. The links were not changed.',
        }
      }
    } catch {
      return { status: 'pending', message: lineageFailureMessage(error) }
    }
    return { status: 'pending', message: lineageFailureMessage(error) }
  }
}

export function ChefRecipeReviewPage({ save }: { save?: SaveRecipeDraft }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <p role="alert">Sign in to review an AI Chef recipe.</p>
  const reviewIdentity = moriReviewKeyFromState(location.state)
  return <ChefReviewSession key={`${user.id}:${reviewIdentity}`} userId={user.id} save={save} />
}

function ChefReviewSession({ userId, save }: { userId: string; save?: SaveRecipeDraft }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { markReviewCompleted } = useMoriReviewCompletion()
  const { user } = useAuth()
  const [initialRead] = useState(() => readChefDraftResult(userId))
  const stored = initialRead.draft
  const reviewRouteState = useRef(location.state)
  const generationSucceeded = useRef(Boolean(stored.handoff) && typeof reviewRouteState.current === 'object' && reviewRouteState.current !== null &&
    'chefGenerationSucceeded' in reviewRouteState.current && reviewRouteState.current.chefGenerationSucceeded === true)
  useMoriActivity(generationSucceeded.current ? { kind: 'celebrating', message: 'Your recipe idea is ready for review.' } : null)
  const originalHandoff = useRef(stored.handoff)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(Boolean(stored.handoff?.savedRecipeId))
  const [handoff, setHandoff] = useState(stored.handoff)
  const [lineageStatus, setLineageStatus] = useState<LineageStatus>(stored.handoff?.lineageStatus ?? 'idle')
  const [lineageMessage, setLineageMessage] = useState(() => {
    const status = stored.handoff?.lineageStatus
    if (!status || status === 'confirmed') return ''
    if (status === 'blocked') return 'Your recipe is safe, but Mori could not confirm the selected parent links. The links remain unchanged.'
    const reason = status === 'expired' ? 'expired-token' : 'unavailable'
    return lineageFailureMessage(new LineageApiError(reason, status === 'pending'))
  })
  const [lineageBusy, setLineageBusy] = useState(false)
  const [selectionAnnouncement, setSelectionAnnouncement] = useState('')
  const [storageIssue, setStorageIssue] = useState<ReviewStorageIssue | null>(initialRead.status === 'available' ? null : initialRead.status)
  const [lastKnownDraft, setLastKnownDraft] = useState(stored)
  const reviewDraftRef = useRef<RecipeEditorState | null>(stored.handoff?.reviewDraft ?? null)
  const initialValues = handoff ? mapAiRecipeToDraft(handoff.response.recipe) : null
  const recipeSave = useRecipeSave(save, handoff?.savedRecipeId)
  const lineageLock = useRef(false)
  const lineageController = useRef<AbortController | null>(null)
  const navigationConfirmation = useUnsavedChangesGuard(dirty || (saved && storageIssue !== null), { warnOnUnload: storageIssue !== null })

  useEffect(() => {
    if (!generationSucceeded.current) return
    const state = typeof reviewRouteState.current === 'object' && reviewRouteState.current !== null ? reviewRouteState.current : null
    const nextState = state ? {
      ...('moriKeepOpen' in state && state.moriKeepOpen === true ? { moriKeepOpen: true } : {}),
      ...('moriReviewKey' in state ? { moriReviewKey: state.moriReviewKey } : {}),
    } : null
    navigate(location.pathname, { replace: true, state: nextState })
  }, [location.pathname, navigate])

  useEffect(() => () => lineageController.current?.abort(), [])

  function currentDraft() {
    const result = readChefDraftResult(userId)
    return result.status === 'available' || result.status === 'memory' ? result.draft : lastKnownDraft
  }

  function sameHandoff(current: ChefReviewHandoff | null) {
    const original = originalHandoff.current
    return !!original && !!current && JSON.stringify(current.request) === JSON.stringify(original.request) &&
      JSON.stringify(current.response) === JSON.stringify(original.response)
  }

  function persistHandoffProgress(nextHandoff: ChefReviewHandoff): ChefDraftWriteResult | null {
    const current = currentDraft()
    if (!sameHandoff(current.handoff)) {
      setStorageIssue('handoff-changed')
      return null
    }
    const persistedHandoff = { ...nextHandoff, reviewDraft: reviewDraftRef.current }
    const next = { ...current, handoff: persistedHandoff }
    setLastKnownDraft(next)
    setHandoff({ ...persistedHandoff, reviewDraft: handoff?.reviewDraft ?? null })
    const result = writeChefDraft(userId, next)
    setStorageIssue(result.persisted ? null : result.reason)
    return result
  }

  function storeReviewDraft(state: RecipeEditorState | null) {
    if (!handoff || saved || handoff.savedRecipeId) return false
    reviewDraftRef.current = state
    const current = currentDraft()
    if (!sameHandoff(current.handoff)) {
      setStorageIssue('handoff-changed')
      return false
    }
    return Boolean(persistHandoffProgress({ ...current.handoff!, reviewDraft: state, saved: false })?.persisted)
  }

  function clearReviewDraftAndLeave() {
    reviewDraftRef.current = null
    if (handoff && !saved) storeReviewDraft(null)
    navigationConfirmation.discardChanges()
  }

  function clearHandoffAfterSave(): ChefDraftWriteResult | null {
    const current = currentDraft()
    if (current.handoff && !sameHandoff(current.handoff)) {
      setStorageIssue('handoff-changed')
      return null
    }
    const clearableHandoff = current.handoff ?? handoff
    if (!clearableHandoff || clearableHandoff.lineageStatus !== 'confirmed') return null
    const next = { ...current, handoff: null, completedReview: true }
    setLastKnownDraft(next)
    const result = writeChefDraft(userId, next)
    setStorageIssue(result.persisted ? null : 'saved-clear-failed')
    return result
  }

  async function submit(draft: RecipeDraft, context: { signal: AbortSignal }) {
    const confirmation = await recipeSave(draft, context)
    if (!confirmedSave(confirmation) || !handoff) return confirmation
    const reviewKey = moriReviewKeyFromState(location.state)
    if (typeof reviewKey === 'number') markReviewCompleted(reviewKey)
    setSaved(true)
    if (handoff.savedRecipeId) {
      return {
        ...confirmation,
        statusMessage: lineageStatus === 'confirmed'
          ? handoff.selectedParentIds.length > 0 ? 'Recipe and selected parent links saved.' : 'Recipe saved.'
          : 'Recipe saved. Parent links still need attention.',
      }
    }

    const selectedParentIds = safeSelectedParentIds(handoff)
    const progress: ChefReviewHandoff = {
      ...handoff,
      reviewDraft: reviewDraftRef.current,
      selectedParentIds,
      savedRecipeId: confirmation.id,
      lineageStatus: selectedParentIds.length > 0 ? 'pending' : 'confirmed',
      saved: false,
    }
    setLineageStatus(progress.lineageStatus ?? 'confirmed')
    setLineageMessage(selectedParentIds.length > 0
      ? 'Your recipe is saved. Mori is saving the selected parent links now.'
      : '')
    const checkpoint = persistHandoffProgress(progress)
    if (!checkpoint?.persisted) {
      if (selectedParentIds.length > 0) {
        setLineageMessage('Your recipe is saved, but this browser could not save its parent-link recovery details.')
      }
      return {
        ...confirmation,
        statusMessage: selectedParentIds.length > 0
          ? 'Recipe saved. Parent links are waiting for this browser to save their recovery details.'
          : 'Recipe saved.',
      }
    }
    if (selectedParentIds.length === 0) {
      clearHandoffAfterSave()
      return { ...confirmation, statusMessage: 'Recipe saved.' }
    }
    if (lineageLock.current) return { ...confirmation, statusMessage: 'Recipe saved. Parent links still need attention.' }

    lineageLock.current = true
    setLineageBusy(true)
    let outcome: LineageAttempt
    try {
      outcome = await persistOrReconcileLineage(progress, userId, context.signal, false)
    } finally {
      lineageLock.current = false
      setLineageBusy(false)
    }
    setLineageStatus(outcome.status)
    setLineageMessage(outcome.message)
    const updated: ChefReviewHandoff = { ...progress, lineageStatus: outcome.status }
    const savedProgress = persistHandoffProgress(updated)
    if (outcome.status === 'confirmed' && savedProgress?.persisted) clearHandoffAfterSave()
    return {
      ...confirmation,
      statusMessage: outcome.status === 'confirmed'
        ? 'Recipe and selected parent links saved.'
        : 'Recipe saved. Parent links still need attention.',
    }
  }

  function retryStorage() {
    if (saved) {
      if (!handoff) return
      if (lineageStatus === 'confirmed') {
        clearHandoffAfterSave()
      } else {
        persistHandoffProgress(handoff)
      }
    } else {
      storeReviewDraft(reviewDraftRef.current)
    }
  }

  function changeParentSelection(parentId: string, selected: boolean) {
    if (!handoff || saved || handoff.savedRecipeId) return
    const parent = uniqueCandidateParents(handoff).find((candidate) => candidate.id.toLowerCase() === parentId.toLowerCase())
    if (!parent) return
    const current = safeSelectedParentIds(handoff)
    const alreadySelected = current.some((id) => id.toLowerCase() === parent.id.toLowerCase())
    if (selected === alreadySelected) return
    if (selected && current.length >= 10) {
      setSelectionAnnouncement('You can select up to 10 parent recipes.')
      return
    }
    const nextSelection = selected ? [...current, parent.id] : current.filter((id) => id.toLowerCase() !== parent.id.toLowerCase())
    persistHandoffProgress({ ...handoff, selectedParentIds: nextSelection })
    setSelectionAnnouncement(selected
      ? parent.title + ' selected. It will be linked when you save.'
      : parent.title + ' removed. It will not be linked when you save.')
  }

  async function retryLineage() {
    if (!handoff || !handoff.savedRecipeId || lineageStatus !== 'pending' || lineageLock.current || storageIssue) return
    lineageLock.current = true
    setLineageBusy(true)
    setLineageMessage('Your recipe is saved. Mori is checking whether the selected parent links were already saved.')
    const checkpoint = persistHandoffProgress(handoff)
    if (!checkpoint?.persisted) {
      setLineageMessage('Your recipe is safe, but this browser could not save the parent-link recovery details. Try saving them again before retrying.')
      lineageLock.current = false
      setLineageBusy(false)
      return
    }
    const controller = new AbortController()
    lineageController.current = controller
    try {
      const outcome = await persistOrReconcileLineage(handoff, userId, controller.signal, true)
      setLineageStatus(outcome.status)
      setLineageMessage(outcome.message)
      const updated: ChefReviewHandoff = { ...handoff, lineageStatus: outcome.status }
      const savedProgress = persistHandoffProgress(updated)
      if (outcome.status === 'confirmed' && savedProgress?.persisted) clearHandoffAfterSave()
    } finally {
      lineageController.current = null
      lineageLock.current = false
      setLineageBusy(false)
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
        ? storageIssue === 'saved-clear-failed'
          ? 'Your recipe is safe, but this browser could not clear the saved preview. Its recovery details are preserved; the preview may reappear after a reload.'
          : 'Your recipe is safe, but this browser could not confirm its recovery details. Keep this page open while you retry; reloading may lose parent-link recovery.'
        : 'Your edits are still available in this page, but this browser could not confirm their saved draft. A reload may lose recent changes.'}</p>
    {storageIssue !== 'handoff-changed' && <button className="button button-secondary mm-button--small" type="button" onClick={retryStorage}>{saved
      ? lineageStatus === 'confirmed' ? 'Try clearing the saved preview' : 'Try saving parent-link recovery again'
      : 'Try saving the review again'}</button>}
  </div>

  const completionMessage = saved && lineageStatus === 'confirmed'
    ? handoff.selectedParentIds.length > 0 ? 'Recipe and selected parent links saved.' : 'Recipe saved.'
    : saved ? 'Recipe saved. Parent links still need attention.' : undefined

  const generationNotice = (compact = false) => <ChefGenerationNotice
    compact={compact}
    handoff={handoff}
    saved={saved}
    selectedParentIds={safeSelectedParentIds(handoff)}
    selectionDisabled={saved || Boolean(handoff.savedRecipeId)}
    selectionAnnouncement={selectionAnnouncement}
    lineageStatus={lineageStatus}
    lineageMessage={lineageMessage}
    lineageBusy={lineageBusy}
    storageUnavailable={storageIssue !== null}
    onParentSelection={changeParentSelection}
    onRetryLineage={() => { void retryLineage() }}
  />

  return <RecipeForm key={userId} mode="create"
    initialValues={reviewDraft ? undefined : initialValues}
    initialEditorState={reviewDraft ?? undefined}
    initialValuesAreUnsaved={!handoff.savedRecipeId}
    initialSaveConfirmation={handoff.savedRecipeId ? { id: handoff.savedRecipeId, statusMessage: completionMessage } : undefined}
    saveSuccessMessage={completionMessage}
    showExtractionHints
    editorTitle={saved ? 'Your recipe is saved.' : "Review Mori's recipe."}
    notesSupported
    onSubmit={submit}
    onDirtyChange={setDirty}
    onEditorStateChange={storeReviewDraft}
    cancelLabel="Back to AI Chef"
    onCancel={() => navigate('/app/chef')}
    notice={<>{generationNotice()}{storageNotice}</>}
    reviewPage={{ title: 'Recipe inspiration', content: <>{generationNotice(true)}{storageNotice}</> }}
    reviewStatus={storageNotice}
    renderFrame={(content) => <RecipeEditorFrame mode="create" connected showBack={false}
      headingTitle={saved ? 'Your recipe is saved.' : <>Review Mori's recipe.<ReviewSticker kind="sparkle" className="mm-chef-review__title-sparkle" /></>}
      facingPageContent={<ChefProgress stage={saved ? 'saved' : 'review'} />}
      navigationConfirmation={{ ...navigationConfirmation, discardChanges: clearReviewDraftAndLeave }}>{content}</RecipeEditorFrame>} />
}

function SuggestedIngredientIcon({ name }: { name: string }) {
  switch (name.trim().toLowerCase()) {
    case 'rice': return <ReviewSticker kind="rice" />
    case 'tomato':
    case 'tomatoes': return <ReviewSticker kind="tomato" />
    case 'garlic': return <ReviewSticker kind="garlic" />
    case 'egg':
    case 'eggs': return <ReviewSticker kind="egg" />
    case 'pork': return <ReviewSticker kind="pork" />
    default: return <IngredientEmoji name={name} />
  }
}

function ChefGenerationNotice({
  handoff,
  saved,
  selectedParentIds,
  selectionDisabled,
  selectionAnnouncement,
  lineageStatus,
  lineageMessage,
  lineageBusy,
  storageUnavailable,
  onParentSelection,
  onRetryLineage,
  compact,
}: {
  handoff: ChefReviewHandoff
  saved: boolean
  selectedParentIds: string[]
  selectionDisabled: boolean
  selectionAnnouncement: string
  lineageStatus: LineageStatus
  lineageMessage: string
  lineageBusy: boolean
  storageUnavailable: boolean
  onParentSelection: (parentId: string, selected: boolean) => void
  onRetryLineage: () => void
  compact: boolean
}) {
  const ingredientsHeading = useId()
  const smallSpread = useJournalMedia('(max-width: 1279.98px), (max-height: 839.98px)')
  const { request, response } = handoff
  const flavorScores = response.recipe.flavor_scores
  const ingredients = [...new Set(response.recipe.ingredients.map(({ name }) => name))]
  const parents = uniqueCandidateParents(handoff)
  const showAllIngredients = !compact || (ingredients.length <= (smallSpread ? 5 : 6)
    && ingredients.every((name) => name.length <= 22) && ingredients.join('').length <= (smallSpread ? 34 : 68))
  const showAllParents = !compact || (parents.length <= (smallSpread ? 1 : 2) && parents.every((parent) => parent.title.length <= 40))
  const showFullRequest = !compact || (!request.preferences && request.pantryItems.length <= 6 && request.pantryItems.every((item) => item.length <= 18))

  const ingredientList = <ul role="list">{ingredients.map((name) => <li key={name}>
    {compact ? <SuggestedIngredientIcon name={name} /> : <IngredientEmoji name={name} />}
    <span>{name}</span>
  </li>)}</ul>
  const parentChoices = <>
    <ul className="mm-ai-chef__parent-choices" role="list">{parents.map((parent) => {
      const selected = selectedParentIds.some((id) => id.toLowerCase() === parent.id.toLowerCase())
      const limitReached = !selected && selectedParentIds.length >= 10
      const parentStatus = selectionDisabled && selected
        ? lineageStatus === 'confirmed' ? 'Link saved' : 'Link not confirmed'
        : null
      return <li key={parent.id} className={selected ? 'is-selected' : undefined}>
        <label className="mm-ai-chef__parent-choice">
          <input
            type="checkbox"
            data-form-focus-key={`chef-parent:${parent.id}`}
            checked={selected}
            disabled={selectionDisabled || limitReached}
            onChange={(event) => onParentSelection(parent.id, event.currentTarget.checked)}
          />
          <span className="mm-ai-chef__parent-choice-copy">
            <strong>{parent.title}</strong>{parent.star_rating !== null && <span> · {parent.star_rating} / 5 stars</span>}
            {parentStatus && <span className="mm-ai-chef__parent-choice-status">{parentStatus}</span>}
          </span>
        </label>
      </li>
    })}</ul>
    {selectionAnnouncement && <p className="visually-hidden" role="status">{selectionAnnouncement}</p>}
  </>
  const requestContent = <>
    <p><strong>What you entered</strong></p>
    <ul>{request.pantryItems.map((item, index) => <li key={item + '-' + index}>{item}</li>)}</ul>
    {request.preferences && <p><strong>Preferences:</strong> {request.preferences}</p>}
  </>
  const substitutions = <section aria-label="Suggested substitutions" className="mm-ai-chef__substitutions">
    <ul>{response.substitutions.map((substitution, index) => <li key={substitution.original + '-' + substitution.replacement + '-' + index}>
      <strong>{substitution.original}</strong><span aria-hidden="true"> → </span><span className="visually-hidden"> can be replaced with </span><strong>{substitution.replacement}</strong>
      {substitution.reason && <p>{substitution.reason}</p>}
    </li>)}</ul>
  </section>
  const flavorContent = flavorScores && <>
    <p>Preview only. Flavor estimates stay out of your saved recipe.</p>
    <dl className="mm-ai-chef__flavors">{flavorIngredients.map(([flavor, ingredient]) => {
      const score = flavorScores[flavor]
      const icon = compact ? <ReviewSticker kind={ingredient} /> : <IngredientEmoji name={ingredient} />
      return <div key={flavor} data-flavor={flavor}>
        <dt>{icon}{flavor}</dt>
        <dd>
          <span className="visually-hidden">{score} out of 5</span>
          <span className="mm-ai-chef__flavor-slots" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => {
            const fill = Math.min(1, Math.max(0, score - index))
            return <span key={index} className="mm-ai-chef__flavor-slot" data-filled={fill === 1}>
              {fill > 0 && <span style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}>{icon}</span>}
            </span>
          })}</span>
        </dd>
      </div>
    })}</dl>
  </>
  const stateMessage = <p className="mm-ai-chef__review-state">{saved ? 'Saved to your journal' : 'Unsaved preview'}</p>

  return <section className={'mm-ai-chef__review-notice' + (compact ? ' mm-chef-review__inspiration' : '')} aria-label="AI Chef generation details">
    {!compact && stateMessage}
    <section aria-labelledby={ingredientsHeading} className="mm-ai-chef__draft-ingredients">
      <h3 id={ingredientsHeading}>{compact && <img src={ingredientBasket} alt="" />}Ingredients in this suggestion</h3>
      {showAllIngredients ? ingredientList : <ReviewDetailDialog title="Ingredients in this suggestion" action={`All suggested ingredients (${ingredients.length})`}>
        {ingredientList}
      </ReviewDetailDialog>}
    </section>
    <section aria-label="Suggested parent recipes" className="mm-ai-chef__suggestions">
      <h3>{compact && <ReviewSticker kind="book" />}From your journal</h3>
      {!saved && parents.length > 0 && <p>Only selected recipes will be linked when you save.</p>}
      {parents.length > 0 ? <>
        {showAllParents ? parentChoices : <ReviewDetailDialog title="From your journal" action={`Choose journal recipes (${parents.length})`}>
          <p>{selectedParentIds.length} selected. You can link up to 10 recipes.</p>
          {parentChoices}
        </ReviewDetailDialog>}
        <p className="mm-ai-chef__selection-count">{selectedParentIds.length} of 10 parent recipes selected.</p>
      </> : <p>{response.context.status === 'NO_SAVED_RECIPES'
        ? 'There are no saved recipes to suggest yet.'
        : 'Mori did not suggest any journal recipes for this idea.'}</p>}
      {saved && lineageMessage && <div className="mm-ai-chef__lineage-recovery" role={lineageBusy ? 'status' : 'alert'}>
        <p>{lineageMessage}</p>
        {lineageStatus === 'pending' && handoff.savedRecipeId && <button
          className="button button-secondary mm-button--small"
          type="button"
          disabled={lineageBusy || storageUnavailable}
          onClick={onRetryLineage}
        >{lineageBusy ? 'Working on parent links…' : 'Check and retry parent links'}</button>}
        {handoff.savedRecipeId && <Link className="button button-secondary mm-button--small" to={'/app/recipes/' + encodeURIComponent(handoff.savedRecipeId)}>Open saved recipe</Link>}
      </div>}
    </section>
    {compact ? <>
      <section className="mm-chef-review__request">
        <h3><ReviewSticker kind="chat" />Your request</h3>
        {showFullRequest ? requestContent : <>
          <p>{request.pantryItems.length} {request.pantryItems.length === 1 ? 'ingredient' : 'ingredients'}{request.preferences ? ' and preferences' : ''}</p>
          <ReviewDetailDialog title="Your request" action="Full request">{requestContent}</ReviewDetailDialog>
        </>}
      </section>
      {flavorContent && <section className="mm-chef-review__flavor-card">
        <h3><ReviewSticker kind="flask" />Mori’s optional flavor estimates</h3>
        {flavorContent}
      </section>}
      <div className="mm-chef-review__margin">
        {stateMessage}
        {response.substitutions.length > 0 && <ReviewDetailDialog title="Suggested substitutions" action="Suggested substitutions">
          {substitutions}
        </ReviewDetailDialog>}
        <span className="mm-chef-review__margin-sticker" aria-hidden="true">
          <ReviewSticker kind="garlic" /><ReviewSticker kind="tomato" />
        </span>
      </div>
    </> : <>
      <details><summary>Your request</summary>{requestContent}</details>
      {response.substitutions.length > 0 && <details><summary>Suggested substitutions</summary>{substitutions}</details>}
      {flavorContent && <details><summary>Mori’s optional flavor estimates</summary>{flavorContent}</details>}
    </>}
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
          <h1 tabIndex={-1}>Nothing is waiting to be reviewed</h1>
          <p className="intro">{storageMessage}</p>
        </div>
      </header>
      <Link className="button button-primary" to="/app/chef">Open AI Chef</Link>
    </JournalFacingPage>
  </JournalShell>
}
