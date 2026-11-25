import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './detail-dialog.css'

export function ReviewDetailDialog({ title, action, closeLabel = 'Done', unsavedMessage, closeDisabled = false, onClosed, children }: {
  title: string
  action: string
  closeLabel?: string
  unsavedMessage?: string
  closeDisabled?: boolean
  onClosed?: () => void
  children: ReactNode
}) {
  const headingId = useId()
  const warningId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useLayoutEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])

  function requestClose() {
    if (closeDisabled || confirming) return
    if (unsavedMessage) {
      lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setConfirming(true)
    } else {
      dialog.current?.close()
    }
  }

  useLayoutEffect(() => {
    if (!confirming && lastFocus.current) {
      if (open) lastFocus.current.focus()
      lastFocus.current = null
    }
  }, [confirming, open])

  function keepEditing() {
    setConfirming(false)
  }

  return <>
    <button type="button" className="mm-review-detail-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>{action}</button>
    <dialog ref={dialog} className="mm-review-detail-dialog" aria-labelledby={open ? headingId : undefined}
      onCancel={(event) => {
        if (!closeDisabled && !unsavedMessage && !confirming) return
        event.preventDefault()
        if (confirming) keepEditing()
        else requestClose()
      }}
      onClose={() => { setOpen(false); setConfirming(false); onClosed?.() }}>
      {open && <>
        <h2 id={headingId}>{title}</h2>
        <div className="mm-review-detail-dialog__content" inert={confirming}>{children}</div>
        {confirming && <div className="mm-review-detail-dialog__confirmation">
          <p id={warningId}>{unsavedMessage}</p>
          <button type="button" className="button button-primary" aria-describedby={warningId} autoFocus onClick={keepEditing}>Keep editing note</button>
          <button type="button" className="button button-secondary" onClick={() => dialog.current?.close()}>Discard note</button>
        </div>}
        <button type="button" className="button button-secondary" hidden={confirming} disabled={closeDisabled} onClick={requestClose}>{closeLabel}</button>
      </>}
    </dialog>
  </>
}
