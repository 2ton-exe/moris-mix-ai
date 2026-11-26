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
import { formatCookedDate } from './recipePresentation'
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
  const [note, setNote] = useState('')
  const [recording, setRecording] = useState(false)

  const heading = useId()
  const hasNotes = Boolean(recipe.notes?.trim())

  return <section className="mm-cook-actions" aria-labelledby={heading}>
    <h2 id={heading}>Next time you cook</h2>
    {!hasNotes && <p>Record what you’d change. Mori can use your note to draft the next version.</p>}
    <div className="mm-cook-actions__controls">
      {hasNotes && <ReviewDetailDialog title="Make a version for next time" action="Revise with Mori" closeLabel="Cancel">
        <RevisionRequest recipe={recipe} userId={userId} onReload={onReload} />
      </ReviewDetailDialog>}
      <ReviewDetailDialog title="Record this cook" action="Record cooking" triggerClassName="mm-record-cooking" closeLabel="Back to recipe"
        unsavedMessage={note.trim() ? 'The cooked date is recorded. This cooking note is still unsaved.' : undefined}
        closeDisabled={recording} onClosed={() => setNote('')}>
        <CookingRecord recipe={recipe} userId={userId} note={note} setNote={setNote} pending={recording} setPending={setRecording} />
      </ReviewDetailDialog>
      <ReviewDetailDialog title="Linked recipes" action="Linked recipes">
        <LinkedRecipes childId={recipe.id} userId={userId} />
      </ReviewDetailDialog>
    </div>
  </section>
}

function RevisionRequest({ recipe, userId, onReload }: {
  recipe: RecipeDetail
  userId: string
  onReload: () => void
}) {
  const navigate = useNavigate()
  const id = useId()
  const notes = recipe.notes ?? ''
  const [selection, setSelection] = useState<{ kind: 'whole' | 'excerpt'; text: string } | null>(null)
  const excerpt = selection?.text ?? ''
  const [replace, setReplace] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notesChanged, setNotesChanged] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => inFlight.current?.abort(), [])
  const draft = readChefDraftResult(userId).draft
  const replaceDraft = Boolean(draft.handoff)
  const validExcerpt = excerpt.trim().length > 0 && excerpt.length <= revisionNoteLimit && notes.includes(excerpt)
  const noteLines = [...new Set(notes.split(/\r\n?|\n/).filter((line) => line.trim()))]
  const quickChoices = noteLines.length <= 3 && noteLines.every((line) => line.length <= 160) ? noteLines : []

  function chooseNote(kind: 'whole' | 'excerpt', text: string) {
    if (!text.trim() || notesChanged) return
    setSelection({ kind, text })
    setNotesChanged(false)
    setError('')
  }

  async function revise() {
    if (!validExcerpt || notesChanged || inFlight.current || (replaceDraft && !replace) || draft.handoff?.savedRecipeId) return

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

  const excerptPicker = <div className="mm-revision-tools__excerpt">
    <label htmlFor={id + '-notes'}>Select text from your Personal Notes</label>
    <textarea id={id + '-notes'} value={notes} rows={3} readOnly disabled={pending} onSelect={(event) => {
      const field = event.currentTarget
      chooseNote('excerpt', field.value.slice(field.selectionStart, field.selectionEnd))
    }} />
  </div>

  return <div className="mm-revision-tools">
    <p>Choose what Mori should use to revise <strong>{recipe.title}</strong>. Only the note or excerpt you select is shared.</p>
    {quickChoices.length > 0 ? <>
      <fieldset className="mm-revision-tools__choices" disabled={pending}>
        <legend>Cooking note to share</legend>
        {quickChoices.map((line) => <label key={line}>
          <input type="radio" name={id + '-note'} checked={selection?.kind === 'whole' && line === excerpt}
            onChange={() => chooseNote('whole', line)} />
          <span>{line}</span>
        </label>)}
      </fieldset>
      <details className="mm-revision-tools__excerpt-option">
        <summary>Share part of a note</summary>
        {excerptPicker}
      </details>
    </> : excerptPicker}
    {selection?.kind === 'excerpt' && <section className="mm-revision-tools__preview" aria-label="Excerpt to share with Mori">
      <h3>Excerpt to share with Mori</h3><blockquote>{excerpt}</blockquote>
    </section>}
    {excerpt.length > revisionNoteLimit && <p role="status">Select up to {revisionNoteLimit} characters.</p>}
    {pending && <p role="status">Mori is reviewing your note…</p>}
    {error && <p role="alert">{error}</p>}
    {notesChanged && <button type="button" className="button button-secondary" onClick={() => {
      setSelection(null)
      setNotesChanged(false)
      setError('')
      onReload()
    }}>Reload recipe notes</button>}
    {draft.handoff?.savedRecipeId ? <Link to="/app/chef/review">Open the existing AI Chef review</Link> : <>
      {replaceDraft && <label><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} /> Replace my current unsaved AI Chef preview</label>}
      <button type="button" className="button button-primary" disabled={!validExcerpt || notesChanged || pending || (replaceDraft && !replace)}
        onClick={() => { void revise() }}>{pending ? 'Asking Mori…' : error && !notesChanged ? 'Try revision again' : 'Ask Mori for a revision'}</button>
    </>}
  </div>
}

function CookingRecord({ recipe, userId, note, setNote, pending, setPending }: {
  recipe: RecipeDetail
  userId: string
  note: string
  setNote: (note: string) => void
  pending: boolean
  setPending: (pending: boolean) => void
}) {
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
  const [stage, setStage] = useState<'date' | 'note' | 'review' | 'saved'>('date')
  const [error, setError] = useState('')
  const noteField = useRef<HTMLTextAreaElement>(null)
  const stageHeading = useRef<HTMLHeadingElement>(null)
  const expectedNotes = useRef(recipe.notes ?? null)
  const expectedUpdatedAt = useRef(recipe.updated_at)
  useEffect(() => {
    if (stage === 'note') noteField.current?.focus()
    if (stage === 'review' || stage === 'saved') stageHeading.current?.focus()
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
      if ('notes' in changes) setNote('')
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
      <p>Log when you made <strong>{recipe.title}</strong>. You can leave a note for the next cook.</p>
      <label htmlFor={id + '-date'}>Date cooked</label>
      <input id={id + '-date'} type="date" value={date} required max={maxDate} onChange={(event) => setDate(event.target.value)} />
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Recording…' : 'Record cooked date'}</button>
      {recipe.cooked_at && <button type="button" className="button button-secondary" disabled={pending}
        onClick={() => { setError(''); setStage('note') }}>Keep recorded date and add a note</button>}
    </>}
    {stage === 'note' && <>
      <p role="status">Cooked date recorded{recipe.cooked_at && <> · <time dateTime={recipe.cooked_at}>{formatCookedDate(recipe.cooked_at)}</time></>}. A note is optional.</p>
      <label htmlFor={id + '-note'}>A note for next time</label>
      <textarea id={id + '-note'} ref={noteField} rows={4} aria-describedby={id + '-note-help'} value={note} maxLength={20_000}
        onChange={(event) => setNote(event.target.value)} />
      <p className="mm-revision-tools__hint" id={id + '-note-help'}>Write what you’d keep or change. For example, “Too salty with ¼ cup soy sauce.”</p>
      {error && expectedNotes.current && <details open><summary>Current Personal Notes</summary><blockquote>{expectedNotes.current}</blockquote></details>}
      {nextNotes.length > 20_000 && <p role="status">Shorten your note to fit in Personal Notes.</p>}
      <button type="submit" className="button button-primary" disabled={!note.trim() || nextNotes.length > 20_000}>Review cooking note</button>
    </>}
    {stage === 'review' && <>
      <h3 ref={stageHeading} tabIndex={-1}>Review your cooking note</h3>
      <p>The cooked date is recorded. Save this note to add it to Personal Notes.</p>
      {expectedNotes.current && <details><summary>Current Personal Notes</summary><blockquote>{expectedNotes.current}</blockquote></details>}
      <blockquote>{note.trim()}</blockquote>
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Saving…' : 'Save cooking note'}</button>
      <button type="button" className="button button-secondary" disabled={pending} onClick={() => setStage('note')}>Keep editing</button>
    </>}
    {stage === 'saved' && <>
      <h3 role="status" ref={stageHeading} tabIndex={-1}>Saved to Personal Notes.</h3>
      <p>Back on the recipe, choose <strong>Revise with Mori</strong> to use this note for your next version.</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>
}

function LinkedRecipes({ childId, userId }: { childId: string; userId: string }) {
  const query = useQuery({
    queryKey: [...recipeKeys.detail(userId, childId), 'lineage'],
    queryFn: ({ signal }) => lineageApi.get(childId, { userId, signal }),
  })
  if (query.isPending) return <><p role="status" className="visually-hidden">Checking linked recipes…</p><ul aria-busy="true" aria-hidden="true"><li><span className="mm-skeleton-line" /></li></ul></>
  if (query.isError) return <><p role="alert">Could not load linked recipes.</p><button type="button" onClick={() => { void query.refetch() }}>Try again</button></>
  if (!query.data.lineage.length) return <p>This recipe has no saved links to earlier versions.</p>
  return <ul>{query.data.lineage.map((link) => <LinkedRecipe key={link.id} recipeId={link.parent_recipe_id} />)}</ul>
}

function LinkedRecipe({ recipeId }: { recipeId: string }) {
  const query = useRecipe(recipeId)
  return <li>{query.isPending ? <><span role="status" className="visually-hidden">Looking up the original recipe…</span><span className="mm-skeleton-line" aria-hidden="true" /></> : query.isError || !query.data ? 'Original recipe unavailable'
    : <Link to={recipePath(query.data.id)}>Based on {query.data.title}</Link>}</li>
}
