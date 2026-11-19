import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { JournalPaginationContext } from './JournalLayoutContext'

/** Separate paper slots; one live control set and an identical reserved baseline. */
export function JournalPagination({ previous, next, rightNumber, label, loading = false }: {
  previous?: ReactNode; next?: ReactNode; rightNumber: ReactNode; label: string; loading?: boolean
}) {
  const slots = useContext(JournalPaginationContext)
  const left = <nav className="mm-pagination-half mm-pagination-half--left" aria-hidden={loading || undefined} inert={loading || undefined} aria-label={`Previous ${label}`}><span className="mm-pagination-action">{previous}</span></nav>
  const right = <nav className="mm-pagination-half mm-pagination-half--right" aria-hidden={loading || undefined} inert={loading || undefined} aria-label={label}><span className="mm-pagination-number mm-reading-indicator" aria-live="polite" aria-atomic="true">{rightNumber}</span><span className="mm-pagination-action">{next}</span></nav>
  return <>{slots.left ? createPortal(left, slots.left) : left}{slots.right ? createPortal(right, slots.right) : right}</>
}
