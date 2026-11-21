import { useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HttpError } from '../api/http'
import { PaperCard, ScrapbookButton } from '../journal/Scrapbook'
import { recipeFormApi } from '../recipe-form/api'
import { recipeDraftSchema } from '../recipe-form/draft'
import { submissionMessage } from '../recipe-form/submission'
import { recipeKeys } from './queryOptions'
import { RecipeSourceContext } from './source'
import type { RecipeDetail } from './types'

function localToday() {
  const today = new Date()
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

type Status = { kind: 'idle' | 'pending' } | { kind: 'error' | 'uncertain'; message: string }

export function KitchenImprint({ recipe, userId, close, reviewNote, setNoteDirty }: {
  recipe: RecipeDetail; userId: string; close: (message?: string) => void;
  reviewNote: (text: string, base: string) => Promise<void>; setNoteDirty: (dirty: boolean) => void
}) {
  const today = localToday()
  const [date, setDate] = useState(today)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [note, setNote] = useState('')
  const [base] = useState(recipe.notes ?? '')
  const [dateSaved, setDateSaved] = useState(false)
  const [preparingNote, setPreparingNote] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [dateError, setDateError] = useState('')
  const controlId = useId()
  const input = useRef<HTMLInputElement>(null)
  const active = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const source = useContext(RecipeSourceContext)
  const key = recipeKeys.detail(userId, recipe.id)

  useEffect(() => {
    input.current?.focus()
    return () => active.current?.abort()
  }, [])

  function confirm() {
    if (note.trim()) {
      setDateSaved(true)
      setStatus({ kind: 'idle' })
    } else close('Cooking date saved.')
  }

  async function prepareNote() {
    if (preparingNote || !note.trim()) return
    setPreparingNote(true)
    setNoteError('')
    try {
      await reviewNote(note.trim(), base)
    } catch (error) {
      setNoteError(error instanceof Error && !(error instanceof HttpError) && error.name !== 'AbortError'
        ? error.message
        : 'Could not load current Personal Notes. Your observation is still here. Try again.')
    } finally {
      setPreparingNote(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (active.current || dateSaved) return
    const verifyOnly = status.kind === 'uncertain'
    if (!recipeDraftSchema.shape.cooked_at.safeParse(date).success || date > today) {
      setDateError('Enter a valid date on or before today.')
      input.current?.focus()
      return
    }

    const controller = new AbortController()
    active.current = controller
    const { signal } = controller
    const request = { userId, signal }
    setStatus({ kind: 'pending' })
    const reconcile = (updated: RecipeDetail) => {
      queryClient.setQueryData(key, updated)
      void queryClient.invalidateQueries({ queryKey: recipeKeys.lists(userId) })
    }

    async function verify() {
      try {
        const current = await source.detail(recipe.id, request)
        signal.throwIfAborted()
        reconcile(current)
        if (current.cooked_at === date) confirm()
        else setStatus({ kind: 'error', message: 'The cooking date was not recorded. You can try saving again.' })
      } catch {
        if (!signal.aborted) setStatus({ kind: 'uncertain', message: 'Could not check whether the cooking date was saved. Check the current date before retrying.' })
      }
    }

    try {
      if (verifyOnly) {
        await verify()
        return
      }
      const updated = await recipeFormApi.recordCooking(recipe.id, date, request)
      signal.throwIfAborted()
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      signal.throwIfAborted()
      reconcile(updated)
      confirm()
    } catch (error) {
      if (signal.aborted) return
      const rejected = error instanceof HttpError &&
        (error.kind === 'configuration' || (error.kind === 'http' && error.status !== 408 && (error.status ?? 500) < 500))
      if (rejected) setStatus({ kind: 'error', message: submissionMessage(error) })
      else await verify()
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  const pending = status.kind === 'pending'
  const verifyOnly = status.kind === 'uncertain'
  return <PaperCard surface="ruled" className="mm-reading-tools__slip">
    <form noValidate onSubmit={(event) => { void save(event) }}>
      <label htmlFor={controlId}>Cooking date</label>
      <input type="date" id={controlId} ref={input} value={date} max={today} required disabled={pending || verifyOnly || dateSaved}
        aria-invalid={!!dateError} aria-describedby={dateError ? `${controlId}-error` : undefined}
        onChange={(event) => { setDate(event.target.value); setDateError('') }} />
      {dateError && <p className="field-error" role="alert" id={`${controlId}-error`}>{dateError}</p>}
      {(status.kind === 'uncertain' || status.kind === 'error') && <p className="field-error" role="alert">{status.message}</p>}
      <label htmlFor={`${controlId}-note`}>Observation (optional)</label>
      <textarea id={`${controlId}-note`} rows={2} maxLength={400} value={note}
        disabled={pending || preparingNote}
        onChange={(event) => { setNote(event.target.value); setNoteDirty(!!event.target.value.trim()); setNoteError('') }} />
      {noteError && <p className="field-error" role="alert">{noteError}</p>}
      {dateSaved && <p role="status">Cooking date saved.</p>}
      {pending && <p role="status">Checking cooking date…</p>}
      <div className="mm-reading-tools__actions">
        {dateSaved
          ? <ScrapbookButton size="small" disabled={preparingNote || !note.trim()} onClick={() => { void prepareNote() }}>
              {preparingNote ? 'Loading notes…' : 'Review observation in editor'}
            </ScrapbookButton>
          : <ScrapbookButton size="small" type="submit" disabled={pending}>{verifyOnly ? 'Check saved date' : 'Save imprint'}</ScrapbookButton>}
        <ScrapbookButton size="small" tone="paper" disabled={pending || preparingNote} onClick={() => close(dateSaved ? 'Cooking date saved.' : '')}>{dateSaved ? 'Close' : 'Cancel'}</ScrapbookButton>
      </div>
    </form>
  </PaperCard>
}
