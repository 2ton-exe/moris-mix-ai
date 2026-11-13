import { useLayoutEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { Mori } from '../journal/Mori'
import { PaperCard } from '../journal/Scrapbook'

export function UnsavedChangesDialog({ onKeepEditing, onDiscardChanges }: {
  onKeepEditing: () => void
  onDiscardChanges: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const discardRef = useRef<HTMLButtonElement>(null)
  const keepEditingAction = useRef(onKeepEditing)
  keepEditingAction.current = onKeepEditing

  useLayoutEffect(() => {
    const active = document.activeElement
    const previousFocus = active instanceof HTMLElement && active !== document.body ? active : null
    keepEditingRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        keepEditingAction.current()
        return
      }
      if (event.key !== 'Tab') return

      const first = keepEditingRef.current
      const last = discardRef.current
      if (!first || !last) return
      const focusIsInside = dialogRef.current?.contains(document.activeElement) ?? false
      if (!focusIsInside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
      else document.getElementById('journal-content')?.focus()
    }
  }, [])

  return createPortal(<div className="mm-recipe-navigation-backdrop">
    <PaperCard
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      surface="fresh"
      tape="burgundy"
      className="mm-recipe-navigation-dialog"
    >
      <div className="mm-recipe-navigation-dialog__heading">
        <Mori mood="worried" size={62} label="Mori is concerned about your unsaved recipe" />
        <div>
          <p className="mm-recipe-index__eyebrow">A note before you go</p>
          <h2 id={titleId}>Leave without saving?</h2>
        </div>
      </div>
      <p id={descriptionId} className="mm-recipe-navigation-dialog__message">
        You have unsaved changes. Leave this page without saving?
      </p>
      <div className="mm-recipe-navigation-dialog__actions">
        <button ref={keepEditingRef} className="button button-primary" type="button" onClick={onKeepEditing}>Keep Editing</button>
        <button ref={discardRef} className="button button-danger" type="button" onClick={onDiscardChanges}>Discard Changes</button>
      </div>
    </PaperCard>
  </div>, document.getElementById('journal-overlays') ?? document.body)
}
