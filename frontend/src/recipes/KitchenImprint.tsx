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

export function KitchenImprint({ recipe, userId, close }: {
  recipe: RecipeDetail; userId: string; journalReturn: string; close: (message?: string) => void
}) {
  const today = localToday()
  const [date, setDate] = useState(today)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (active.current) return
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
        if (current.cooked_at === date) close('Cooking date saved.')
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
      close('Cooking date saved.')
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
      <input type="date" id={controlId} ref={input} value={date} max={today} required disabled={pending || verifyOnly}
        aria-invalid={!!dateError} aria-describedby={dateError ? `${controlId}-error` : undefined}
        onChange={(event) => { setDate(event.target.value); setDateError('') }} />
      {dateError && <p className="field-error" role="alert" id={`${controlId}-error`}>{dateError}</p>}
      {(status.kind === 'uncertain' || status.kind === 'error') && <p className="field-error" role="alert">{status.message}</p>}
      {pending && <p role="status">Checking cooking date…</p>}
      <div className="mm-reading-tools__actions">
        <ScrapbookButton size="small" type="submit" disabled={pending}>{verifyOnly ? 'Check saved date' : 'Save imprint'}</ScrapbookButton>
        <ScrapbookButton size="small" tone="paper" disabled={pending} onClick={() => close()}>Cancel</ScrapbookButton>
      </div>
    </form>
  </PaperCard>
}
