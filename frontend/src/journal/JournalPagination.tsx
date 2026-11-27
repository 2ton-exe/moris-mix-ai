import { useContext, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { JournalPaginationContext } from './JournalLayoutContext'

function PaperCorner({ children, previous = false }: { children: ReactNode; previous?: boolean }) {
  const id = useId()
  return <span className="mm-pagination-action mm-paper-corner">{children}
    <svg className="mm-paper-corner__art" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset=".42" stopColor="var(--mm-color-espresso-200)" />
          <stop offset=".57" stopColor="var(--mm-color-fresh)" />
          <stop offset="1" stopColor="var(--mm-color-parchment-100)" />
        </linearGradient>
      </defs>
      <g transform={previous ? 'translate(64 0) scale(-1 1)' : undefined}>
        <path d="M0 64 Q28 38 64 0 L64 64Z" fill="var(--mm-color-espresso-600)" opacity=".08" />
        <path d="M0 64 Q26 48 32 32 Q49 27 64 0 L64 64Z" fill={`url(#${id})`} />
        <path d="M0 64 Q26 48 32 32 Q49 27 64 0" fill="none" stroke="var(--mm-color-espresso-300)" strokeOpacity=".35" strokeWidth=".7" />
        <path className="mm-paper-corner__arrow" d="M43 49H56M51 44L56 49L51 54" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  </span>
}

/** Separate paper slots; one live control set and an identical reserved baseline. */
export function JournalPagination({ previous, next, rightNumber, label, loading = false }: {
  previous?: ReactNode; next?: ReactNode; rightNumber: ReactNode; label: string; loading?: boolean
}) {
  const slots = useContext(JournalPaginationContext)
  const left = <nav className="mm-pagination-half mm-pagination-half--left" aria-hidden={loading || undefined} inert={loading || undefined} aria-label={`Previous ${label}`}><PaperCorner previous>{previous}</PaperCorner></nav>
  const right = <nav className="mm-pagination-half mm-pagination-half--right" aria-hidden={loading || undefined} inert={loading || undefined} aria-label={label}><span className="mm-pagination-number mm-reading-indicator" aria-live="polite" aria-atomic="true">{rightNumber}</span><PaperCorner>{next}</PaperCorner></nav>
  return <>{slots.left ? createPortal(left, slots.left) : left}{slots.right ? createPortal(right, slots.right) : right}</>
}
