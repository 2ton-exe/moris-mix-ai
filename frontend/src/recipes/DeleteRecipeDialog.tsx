import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'

interface DeleteRecipeDialogProps {
  recipeTitle: string
  isPending: boolean
  errorMessage?: string
  canRetry?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteRecipeDialog({ recipeTitle, isPending, errorMessage, canRetry = true, onCancel, onConfirm }: DeleteRecipeDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const pendingStatusRef = useRef<HTMLParagraphElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const wasPendingRef = useRef(false)

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (isPending) {
      wasPendingRef.current = true
      pendingStatusRef.current?.focus()
    } else if (wasPendingRef.current) {
      wasPendingRef.current = false
      if (canRetry) confirmRef.current?.focus()
      else cancelRef.current?.focus()
    }
  }, [isPending, errorMessage, canRetry])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!isPending) onCancel()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [cancelRef.current, confirmRef.current].filter((element): element is HTMLButtonElement =>
      element !== null && !element.disabled,
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="delete-dialog-backdrop">
      <div
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isPending}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
      >
        <span className="recipe-card-label">Delete recipe</span>
        <h2 id={titleId}>Delete “{recipeTitle}”?</h2>
        <p id={descriptionId}>This action cannot be undone. The recipe will be removed from your collection.</p>
        {isPending && <p className="delete-pending" role="status" tabIndex={-1} ref={pendingStatusRef}>Deleting “{recipeTitle}”…</p>}
        {errorMessage && <p className="delete-error" role="alert">{errorMessage}</p>}
        <div className="delete-dialog-actions">
          <button className="button button-secondary" type="button" disabled={isPending} ref={cancelRef} onClick={onCancel}>Cancel</button>
          <button className="button button-danger" type="button" disabled={isPending || !canRetry} ref={confirmRef} onClick={onConfirm}>
            {isPending ? 'Deleting…' : errorMessage && canRetry ? 'Try again' : 'Delete recipe'}
          </button>
        </div>
      </div>
    </div>
  )
}
