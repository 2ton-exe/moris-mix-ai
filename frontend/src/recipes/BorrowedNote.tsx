import { useRef, useState } from 'react'

export function BorrowedNote({ notes, title, onContinue }: {
  notes: string; title: string; onContinue: (text: string) => void
}) {
  const source = useRef<HTMLTextAreaElement>(null)
  const [excerpt, setExcerpt] = useState('')
  const [error, setError] = useState('')

  function preview() {
    const field = source.current
    if (!field) return
    const selection = field.value.slice(field.selectionStart, field.selectionEnd)
    if (!selection.trim()) {
      setError('Select the text you want to copy first.')
      field.focus()
      return
    }
    setExcerpt(selection)
    setError('')
  }

  return <div className="mm-journal-tool">
    <label className="mm-journal-tool__field">Select an excerpt from Personal Notes
      <textarea readOnly ref={source} rows={5} value={notes} />
    </label>
    <button type="button" className="button button-secondary mm-button--small" onClick={preview}>Preview selected excerpt</button>
    {error && <p role="status">{error}</p>}
    {excerpt && <>
      <p>From {title} to a new recipe draft.</p>
      <blockquote className="mm-note-excerpt">{excerpt}</blockquote>
      <div className="mm-journal-tool__actions">
        <button type="button" className="button button-primary mm-button--small" onClick={() => onContinue(excerpt)}>Continue to new recipe</button>
        <button type="button" className="button button-secondary mm-button--small" onClick={() => {
          setExcerpt('')
          source.current?.focus()
        }}>Cancel excerpt</button>
      </div>
    </>}
  </div>
}
