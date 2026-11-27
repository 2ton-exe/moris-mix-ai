import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { ChevronDown, RefreshCw, CookingPot, NotebookPen } from 'lucide-react'
import { categories, promptLibrary, selectSuggestions, type Suggestion, type SuggestionContext } from './suggestions'

export function SuggestedPrompts({ context, busy, draft, onSelect, preview = false, navigation }: { context: SuggestionContext; busy: boolean; draft: string; onSelect: (prompt: Suggestion) => void; preview?: boolean; navigation?: ReactNode }) {
  const id = useId()
  const disclosure = useRef<HTMLDetailsElement>(null)
  const [interacting, setInteracting] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(() => ({ context, prompts: selectSuggestions(context) }))
  useEffect(() => {
    if (busy || draft || interacting || selection.context === context) return
    setSelection(current => ({ context, prompts: selectSuggestions(context, current.prompts.map(p => p.id)) }))
  }, [context, busy, draft, interacting, selection.context])
  const chip = (prompt: Suggestion) => <button key={prompt.id} type="button" disabled={busy} onClick={() => {
    if (disclosure.current) disclosure.current.open = false
    setExpanded(false)
    setOpen(false)
    onSelect(prompt)
  }}>{prompt.workflow === 'create' ? <NotebookPen size={13} aria-hidden="true" /> : <CookingPot size={13} aria-hidden="true" />}{prompt.label}</button>
  const interaction = {
    onFocusCapture: () => setInteracting(true),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false)
    },
  }
  const content = <>
    <div className="mori-prompts-actions">
      <button type="button" aria-expanded={expanded} aria-controls={`${id}-library`} onClick={() => setExpanded(!expanded)}>{expanded ? 'See less' : 'See more'}</button>
      <button type="button" disabled={busy} aria-label="Shuffle suggested prompts" onClick={() => {
        setSelection(current => ({ context, prompts: selectSuggestions(context, current.prompts.map(p => p.id)) }))
        setRevision(value => value + 1)
      }}><RefreshCw size={13} aria-hidden="true" /></button>
    </div>
    <div key={revision} id={`${id}-library`} className={expanded ? 'mori-prompts-library' : 'mori-prompts-chips'} role="group" aria-label="Suggested prompts">
      {expanded ? categories.map(category => <section key={category}><h3>{category}</h3><div>{promptLibrary.filter(p => p.category === category).map(chip)}</div></section>) : selection.prompts.map(chip)}
    </div>
  </>
  return <>{preview && <div className="mori-chat-quick-prompts" role="group" aria-label="Ideas for this page">{selection.prompts.slice(0, 2).map(chip)}</div>}
    {navigation ? <div className="mori-chat-prompts" data-open={open || undefined} {...interaction}>
      <div className="mori-chat-prompt-toolbar">
        <button className="mori-chat-prompts-toggle" type="button" aria-expanded={open} aria-controls={`${id}-suggestions`} onClick={() => setOpen(!open)}>Suggested prompts <ChevronDown size={14} aria-hidden="true" /></button>
        {navigation}
      </div>
      <div id={`${id}-suggestions`} className="mori-chat-prompts-content" hidden={!open}>{content}</div>
    </div> : <details ref={disclosure} className="mori-chat-prompts" {...interaction}>
      <summary>Suggested prompts <ChevronDown size={14} aria-hidden="true" /></summary>
      {content}
    </details>}
  </>
}
