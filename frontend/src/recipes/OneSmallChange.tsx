import { useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { journalRecordKey, useJournalRecord } from '../journal/journalRecord'
import { PaperCard, ScrapbookButton } from '../journal/Scrapbook'
import type { RecipeDetail } from './types'

const trialSchema = z.object({
  change: z.string().trim().min(1).max(400),
  reflection: z.string().max(400),
  repeat: z.enum(['undecided', 'yes', 'no']),
})

const blankTrial: z.infer<typeof trialSchema> = { change: '', reflection: '', repeat: 'undecided' }

export function OneSmallChange({ recipe, userId, close, reviewNote, setNoteDirty }: {
  recipe: RecipeDetail; userId: string; close: () => void;
  reviewNote: (text: string, base: string) => Promise<string | undefined>; setNoteDirty: (dirty: boolean) => void
}) {
  const record = useJournalRecord(journalRecordKey(userId, 'trial', recipe.id), trialSchema)
  const [draft, setDraft] = useState(record.value ?? blankTrial)
  const [base] = useState(recipe.notes ?? '')
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const initialControl = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const dirty = JSON.stringify(draft) !== JSON.stringify(record.value ?? blankTrial)

  useEffect(() => { initialControl.current?.focus() }, [])

  function update(next: typeof draft) {
    setDraft(next)
    setNoteDirty(JSON.stringify(next) !== JSON.stringify(record.value ?? blankTrial))
    setError('')
    setStatus('')
  }

  function saveTrial() {
    const parsed = trialSchema.safeParse(draft)
    if (!parsed.success) { setError('Enter a planned change to save this trial.'); initialControl.current?.focus(); return }
    if (!record.write(parsed.data)) { setError('This browser could not save the trial. Your text is still here.'); return }
    setDraft(parsed.data)
    setNoteDirty(false)
    setError('')
    setStatus('Trial saved on this browser.')
  }

  function removeTrial() {
    if (!record.write(null)) { setError('This browser could not clear the trial.'); return }
    setDraft(blankTrial)
    setNoteDirty(false)
    setError('')
    setStatus('Trial removed.')
    initialControl.current?.focus()
  }

  async function prepareNote() {
    if (pending || !record.value || dirty) return
    const { change, reflection, repeat } = record.value
    const decision = repeat === 'yes' ? 'Try it again: Yes' : repeat === 'no' ? 'Try it again: No' : ''
    setPending(true)
    setError('')
    const issue = await reviewNote([change, reflection.trim(), decision].filter(Boolean).join('\n'), base)
    if (issue) setError(issue)
    setPending(false)
  }

  return <PaperCard surface="ruled" className="mm-reading-tools__slip">
    <form onSubmit={(event) => { event.preventDefault(); saveTrial() }}>
      <p>Saved on this browser.</p>
      {record.unreadable && <p>Any previously saved trial is unavailable. You can still enter a new trial.</p>}
      <label htmlFor={`${id}-change`}>Planned change</label>
      <textarea id={`${id}-change`} ref={initialControl} rows={2} maxLength={400} value={draft.change} disabled={pending} required
        onChange={(event) => update({ ...draft, change: event.target.value })} />
      <label htmlFor={`${id}-reflection`}>Reflection (optional)</label>
      <textarea id={`${id}-reflection`} rows={2} maxLength={400} value={draft.reflection} disabled={pending}
        onChange={(event) => update({ ...draft, reflection: event.target.value })} />
      <label htmlFor={`${id}-repeat`}>Try it again?</label>
      <select id={`${id}-repeat`} value={draft.repeat} disabled={pending} onChange={(event) => {
        const result = trialSchema.shape.repeat.safeParse(event.target.value)
        if (result.success) update({ ...draft, repeat: result.data })
      }}>
        <option value="undecided">Undecided</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
      {error && <p className="field-error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <div className="mm-reading-tools__actions">
        <ScrapbookButton size="small" type="submit" disabled={pending}>Save trial</ScrapbookButton>
        {record.value && <ScrapbookButton size="small" tone="paper" disabled={pending || dirty} onClick={() => { void prepareNote() }}>
          {pending ? 'Loading notes…' : 'Review trial in editor'}
        </ScrapbookButton>}
        {(record.value || record.unreadable) && <ScrapbookButton size="small" tone="paper" disabled={pending} onClick={removeTrial}>Clear trial</ScrapbookButton>}
        <ScrapbookButton size="small" tone="paper" disabled={pending} onClick={() => close()}>{dirty ? 'Cancel trial edits' : 'Close trial'}</ScrapbookButton>
      </div>
    </form>
  </PaperCard>
}
