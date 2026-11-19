import { useEffect, useId, useState } from 'react'
import { ChevronRight, RefreshCw, CookingPot, NotebookPen } from 'lucide-react'
import { categories, promptLibrary, selectSuggestions, type Suggestion, type SuggestionContext } from './suggestions'

export function SuggestedPrompts({ context, busy, draft, onSelect }: { context: SuggestionContext; busy: boolean; draft: string; onSelect: (prompt: Suggestion) => void }) {
  const id = useId()
  const [interacting, setInteracting] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [selection, setSelection] = useState(() => ({ context, prompts: selectSuggestions(context) }))
  useEffect(() => {
    if (busy || draft || interacting || selection.context === context) return
    setSelection(current => ({ context, prompts: selectSuggestions(context, current.prompts.map(p => p.id)) }))
  }, [context, busy, draft, interacting, selection.context])
  const chip = (prompt: Suggestion) => <button key={prompt.id} type="button" disabled={busy} onClick={() => { onSelect(prompt); setExpanded(false) }}>{prompt.workflow === 'create' ? <NotebookPen size={13} aria-hidden="true" /> : <CookingPot size={13} aria-hidden="true" />}{prompt.label}</button>
  return <section className="mori-chat-prompts" aria-labelledby={id} onFocusCapture={() => setInteracting(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false) }}>
    <div className="mori-prompts-heading"><h3 id={id}>Suggested prompts</h3><button type="button" aria-expanded={expanded} aria-controls={`${id}-library`} onClick={() => setExpanded(!expanded)}>{expanded ? 'See less' : 'See more'}<ChevronRight size={12} aria-hidden="true" /></button><button type="button" disabled={busy} aria-label="Shuffle suggested prompts" onClick={() => { setSelection(current => ({ context, prompts: selectSuggestions(context, current.prompts.map(p => p.id)) })); setRevision(value => value + 1) }}><RefreshCw size={13} aria-hidden="true" /></button></div>
    <div key={revision} id={`${id}-library`} className={expanded ? 'mori-prompts-library' : 'mori-prompts-chips'} role="group" aria-label="Suggested prompts">{expanded ? categories.map(category => <section key={category}><h4>{category}</h4><div>{promptLibrary.filter(p => p.category === category).map(chip)}</div></section>) : selection.prompts.map(chip)}</div>
  </section>
}
