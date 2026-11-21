import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './detail-dialog.css'

export function ReviewDetailDialog({ title, action, children }: { title: string; action: string; children: ReactNode }) {
  const headingId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])

  return <>
    <button type="button" className="mm-review-detail-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>{action}</button>
    <dialog ref={dialog} className="mm-review-detail-dialog" aria-labelledby={open ? headingId : undefined} onClose={() => setOpen(false)}>
      {open && <>
        <h2 id={headingId}>{title}</h2>
        {children}
        <button type="button" className="button button-secondary" onClick={() => dialog.current?.close()}>Done</button>
      </>}
    </dialog>
  </>
}
