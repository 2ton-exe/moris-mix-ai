import { useContext, useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { HttpError, httpErrorCode } from '../api/http'
import { readChefDraftResult, writeChefDraft } from '../ai-chef/draft'
import { generateRecipeApi, revisionErrorMessage, revisionNoteLimit } from '../ai-chef/generateRecipe'
import { lineageApi } from '../ai-chef/lineage'
import { recipeFormApi } from '../recipe-form/api'
import { ReviewDetailDialog } from '../recipe-form/ReviewDetailDialog'
import { useRecipe } from './queries'
import { recipeKeys } from './queryOptions'
import { RecipeSourceContext } from './source'
import type { RecipeDetail } from './types'

function recipePath(id: string) {
  return '/app/recipes/' + encodeURIComponent(id)
}

export function RecipeRevisionTools({ recipe, userId, onReload }: {
  recipe: RecipeDetail
  userId: string
  onReload: () => void
}) {
  return <>
    <ReviewDetailDialog title="Make a version for next time" action="Revise with Mori">
      <RevisionRequest recipe={recipe} userId={userId} onReload={onReload} />
    </ReviewDetailDialog>
    <ReviewDetailDialog title="Record this cook" action="Record cooking">
      <CookingRecord recipe={recipe} userId={userId} />
    </ReviewDetailDialog>
    <ReviewDetailDialog title="Linked recipes" action="Linked recipes">
      <LinkedRecipes childId={recipe.id} userId={userId} />
    </ReviewDetailDialog>
  </>
}

function RevisionRequest({ recipe, userId, onReload }: {
  recipe: RecipeDetail
  userId: string
  onReload: () => void
}) {
  const navigate = useNavigate()
  const id = useId()
  const notes = recipe.notes ?? ''
  const [excerpt, setExcerpt] = useState('')
  const [replace, setReplace] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notesChanged, setNotesChanged] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => inFlight.current?.abort(), [])
  const draft = readChefDraftResult(userId).draft
  const replaceDraft = Boolean(draft.handoff)
  const validExcerpt = excerpt.trim().length > 0 && excerpt.length <= revisionNoteLimit && notes.includes(excerpt)

  async function revise() {
    if (!validExcerpt || inFlight.current || (replaceDraft && !replace) || draft.handoff?.savedRecipeId) return

    const controller = new AbortController()
    inFlight.current = controller
    const timeout = AbortSignal.timeout(45_000)
    const signal = AbortSignal.any([controller.signal, timeout])
    setPending(true)
    setError('')
    setNotesChanged(false)
    try {
      const response = await generateRecipeApi.revise(recipe.id, excerpt, { userId, signal })
      signal.throwIfAborted()
      const current = readChefDraftResult(userId).draft
      if (JSON.stringify(current.handoff) !== JSON.stringify(draft.handoff)) {
        setError('Your AI Chef preview changed. Open it before starting this revision.')
        return
      }
      writeChefDraft(userId, {
        input: current.input,
        completedReview: false,
        handoff: {
          request: { sourceRecipeId: recipe.id, noteExcerpt: excerpt }, response,
          selectedParentIds: [recipe.id], saved: false,
        },
      })
      navigate('/app/chef/review', { state: { chefGenerationSucceeded: true } })
    } catch (failure) {
      if (controller.signal.aborted) return
      setNotesChanged(failure instanceof HttpError && httpErrorCode(failure) === 'REVISION_NOTE_CHANGED')
      setError(revisionErrorMessage(failure, timeout.aborted))
    } finally {
      if (!controller.signal.aborted) setPending(false)
      inFlight.current = null
    }
  }

  if (!notes.trim()) return <>
    <p>Add a Personal Note about how this recipe went, then ask Mori to revise it.</p>
    <Link to={recipePath(recipe.id) + '/edit'}>Edit Personal Notes</Link>
  </>

  return <div className="mm-revision-tools" role="group" aria-labelledby={id + '-select'}>
    <label id={id + '-select'} htmlFor={id + '-notes'}>Select text from your Personal Notes</label>
    <textarea id={id + '-notes'} value={notes} rows={5} readOnly onSelect={(event) => {
      const field = event.currentTarget
      setExcerpt(field.value.slice(field.selectionStart, field.selectionEnd))
      setNotesChanged(false)
      setError('')
    }} />
    {excerpt && <><p>Note to share with Mori</p><blockquote>{excerpt}</blockquote></>}
    {excerpt.length > revisionNoteLimit && <p role="status">Select up to {revisionNoteLimit} characters.</p>}
    {error && <p role="alert">{error}</p>}
    {notesChanged && <button type="button" className="button button-secondary" onClick={() => {
      setExcerpt('')
      setNotesChanged(false)
      setError('')
      onReload()
    }}>Reload recipe notes</button>}
    {draft.handoff?.savedRecipeId ? <Link to="/app/chef/review">Open the existing AI Chef review</Link> : <>
      {replaceDraft && <label><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} /> Replace my current unsaved AI Chef preview</label>}
      <button type="button" className="button button-primary" disabled={!validExcerpt || pending || (replaceDraft && !replace)}
        onClick={() => { void revise() }}>{pending ? 'Asking Mori…' : 'Ask Mori for a revision'}</button>
    </>}
  </div>
}

function CookingRecord({ recipe, userId }: { recipe: RecipeDetail; userId: string }) {
  const id = useId()
  const queryClient = useQueryClient()
  const source = useContext(RecipeSourceContext)
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => inFlight.current?.abort(), [])
  const today = new Date()
  const maxDate = [
    today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'),
  ].join('-')
  const [date, setDate] = useState(maxDate)
  const [note, setNote] = useState('')
  const [stage, setStage] = useState<'date' | 'note' | 'review' | 'saved'>('date')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const noteField = useRef<HTMLTextAreaElement>(null)
  const expectedNotes = useRef(recipe.notes ?? null)
  const expectedUpdatedAt = useRef(recipe.updated_at)
  useEffect(() => {
    if (stage === 'note') noteField.current?.focus()
  }, [stage])

  async function update(changes: Parameters<typeof recipeFormApi.updateCookingDetails>[1]) {
    if (inFlight.current) return
    const controller = new AbortController()
    inFlight.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
    const request = { userId, signal }
    const key = recipeKeys.detail(userId, recipe.id)
    setPending(true)
    setError('')
    try {
      let updated: RecipeDetail
      try {
        updated = await recipeFormApi.updateCookingDetails(recipe.id, changes, request)
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof HttpError && [401, 403, 404].includes(failure.status ?? 0)) throw failure
        const current = await source.detail(recipe.id, { userId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
        controller.signal.throwIfAborted()
        if ('notes' in changes && current.notes !== changes.notes) {
          if (failure instanceof HttpError && failure.status === 409) {
            expectedNotes.current = current.notes ?? null
            expectedUpdatedAt.current = current.updated_at
            await queryClient.cancelQueries({ queryKey: key, exact: true })
            controller.signal.throwIfAborted()
            queryClient.setQueryData(key, current)
            setError('Personal Notes changed. Review the updated notes before saving.')
            setStage('note')
            return
          }
          throw failure
        }
        if ('cooked_at' in changes && current.cooked_at !== changes.cooked_at) throw failure
        updated = current
      }
      controller.signal.throwIfAborted()
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      controller.signal.throwIfAborted()
      expectedNotes.current = updated.notes ?? null
      expectedUpdatedAt.current = updated.updated_at
      queryClient.setQueryData(key, updated)
      void queryClient.invalidateQueries({ queryKey: recipeKeys.lists(userId) })
      setStage('notes' in changes ? 'saved' : 'note')
    } catch {
      if (!controller.signal.aborted) setError('Could not confirm this update. Your entry is still here.')
    } finally {
      inFlight.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  const nextNotes = [expectedNotes.current, note.trim()].filter(Boolean).join('\n\n')
  return <form className="mm-revision-tools" onSubmit={(event) => {
    event.preventDefault()
    if (stage === 'date' && date && date <= maxDate) void update({ cooked_at: date })
    if (stage === 'note' && note.trim() && nextNotes.length <= 20_000) {
      setError('')
      setStage('review')
    }
    if (stage === 'review') {
      if (!expectedUpdatedAt.current) {
        setError('The recipe was loaded without its current version. Close this dialog and reload the recipe.')
        return
      }
      void update({ notes: nextNotes, expected_updated_at: expectedUpdatedAt.current })
    }
  }}>
    {stage === 'date' && <>
      <label htmlFor={id + '-date'}>Date cooked</label>
      <input id={id + '-date'} type="date" value={date} required max={maxDate} onChange={(event) => setDate(event.target.value)} />
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Recording…' : 'Record cooked date'}</button>
      {recipe.cooked_at && <button type="button" className="button button-secondary" disabled={pending}
        onClick={() => { setError(''); setStage('note') }}>Keep recorded date and add a note</button>}
    </>}
    {stage === 'note' && <>
      <p role="status">Cooked date recorded. A note is optional.</p>
      <label htmlFor={id + '-note'}>A note for next time</label>
      <textarea id={id + '-note'} ref={noteField} rows={4} value={note} maxLength={20_000} onChange={(event) => setNote(event.target.value)} />
      {nextNotes.length > 20_000 && <p role="status">Shorten your note to fit in Personal Notes.</p>}
      <button type="submit" className="button button-primary" disabled={!note.trim() || nextNotes.length > 20_000}>Review cooking note</button>
    </>}
    {stage === 'review' && <>
      <p>Append this observation to Personal Notes?</p>
      {expectedNotes.current && <details><summary>Current Personal Notes</summary><blockquote>{expectedNotes.current}</blockquote></details>}
      <blockquote>{note.trim()}</blockquote>
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Saving…' : 'Save cooking note'}</button>
      <button type="button" className="button button-secondary" disabled={pending} onClick={() => setStage('note')}>Keep editing</button>
    </>}
    {stage === 'saved' && <p role="status">Saved to Personal Notes.</p>}
    {error && <p role="alert">{error}</p>}
  </form>
}

function LinkedRecipes({ childId, userId }: { childId: string; userId: string }) {
  const query = useQuery({
    queryKey: [...recipeKeys.detail(userId, childId), 'lineage'],
    queryFn: ({ signal }) => lineageApi.get(childId, { userId, signal }),
  })
  if (query.isPending) return <p role="status">Checking linked recipes…</p>
  if (query.isError) return <><p role="alert">Could not load linked recipes.</p><button type="button" onClick={() => { void query.refetch() }}>Try again</button></>
  if (!query.data.lineage.length) return <p>This recipe has no saved links to earlier versions.</p>
  return <ul>{query.data.lineage.map((link) => <LinkedRecipe key={link.id} recipeId={link.parent_recipe_id} />)}</ul>
}

function LinkedRecipe({ recipeId }: { recipeId: string }) {
  const query = useRecipe(recipeId)
  return <li>{query.isPending ? 'Looking up the original recipe…' : query.isError || !query.data ? 'Original recipe unavailable'
    : <Link to={recipePath(query.data.id)}>Based on {query.data.title}</Link>}</li>
}
