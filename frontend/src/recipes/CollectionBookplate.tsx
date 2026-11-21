import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { JournalBookplate } from '../journal/JournalBookplate'
import { MoriEmblem } from '../journal/Mori'
import { journalRecordKey, useJournalRecord } from '../journal/journalRecord'
import { CookNextRibbon } from './RecipeKeepsakes'
import basket from '../assets/stickers/ingredient-basket.svg'
import bowl from '../assets/stickers/mixing-bowl.svg'

const motifs = ['Mori seal', 'Kitchen basket', 'Mixing bowl'] as const
const bookplate = z.object({ motif: z.enum(motifs), nickname: z.string().trim().max(40) })

function InkMotif({ motif }: { motif: typeof motifs[number] }) {
  return motif === 'Mori seal' ? <MoriEmblem size={46} />
    : <img src={motif === 'Kitchen basket' ? basket : bowl} width={46} height={46} alt="" />
}

export function CollectionBookplate({ userId, ownerName }: { userId: string; ownerName: string }) {
  const record = useJournalRecord(journalRecordKey(userId, 'bookplate'), bookplate)
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState('')
  const edit = useRef<HTMLButtonElement>(null)

  function close(message: string) {
    setEditing(false)
    setStatus(message)
    edit.current?.focus()
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = bookplate.safeParse({ nickname: form.get('nickname'), motif: form.get('motif') })
    if (result.success && record.write(result.data)) close('Bookplate saved.')
    else setStatus('This browser could not save your bookplate.')
  }

  return <JournalBookplate ownerName={record.value?.nickname || ownerName} art={<InkMotif motif={record.value?.motif ?? motifs[0]} />}>
    <button ref={edit} type="button" className="button button-secondary mm-button--small" aria-expanded={editing}
      onClick={() => { setEditing(!editing); setStatus('') }}>Customize bookplate</button>
    {record.unreadable && <p>The saved bookplate could not be read.</p>}
    {editing && <form className="mm-journal-tool__form mm-bookplate__form" onSubmit={save}>
      <p>Saved on this browser.</p>
      <fieldset className="mm-ink-choices">
        <legend>Ink motif</legend>
        {motifs.map((motif) => <label key={motif}>
          <input type="radio" name="motif" value={motif} defaultChecked={(record.value?.motif ?? motifs[0]) === motif} />
          <InkMotif motif={motif} />
          <span>{motif}</span>
        </label>)}
      </fieldset>
      <label className="mm-journal-tool__field">Nickname (optional)
        <input name="nickname" type="text" maxLength={40} defaultValue={record.value?.nickname ?? ''} />
      </label>
      <div className="mm-journal-tool__actions">
        <button type="submit" className="button button-primary mm-button--small">Save bookplate</button>
        <button type="button" className="button button-secondary mm-button--small" onClick={() => close('')}>Cancel</button>
        {(record.value || record.unreadable) && <button type="button" className="button button-secondary mm-button--small" onClick={() => {
          if (record.write(null)) close('Default bookplate restored.')
          else setStatus('This browser could not reset your bookplate.')
        }}>Reset bookplate</button>}
      </div>
    </form>}
    <p role="status">{status}</p>
    <CookNextRibbon userId={userId} />
  </JournalBookplate>
}
