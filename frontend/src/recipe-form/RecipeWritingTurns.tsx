import type { ReactNode } from 'react'
import { useJournalPageTurn } from '../journal/JournalPageTurn'

export function RecipeWritingTurns({ page, total, text, single, onTurn, review }: {
  page: number
  total: number
  text: string
  single: boolean
  onTurn: (page: number) => void
  review?: { current: string; next?: string; previous?: string; save: ReactNode; exit: ReactNode }
}) {
  const { isTurning } = useJournalPageTurn()
  if (review) {
    return <div className="mm-review-footer">
      <p className="mm-review-progress" role="status">{review.current}</p>
      <nav className="mm-review-controls" aria-label="Recipe writing pages">
        {review.exit}
        {review.previous && <button type="button" className="button button-secondary" disabled={isTurning} onClick={() => onTurn(page - 1)}>
          <span aria-hidden="true">←</span> Previous: {review.previous}
        </button>}
        {review.next
          ? <button key="next" type="button" className="button button-primary" disabled={isTurning} onClick={(event) => { event.preventDefault(); onTurn(page + 1) }}>
            Next: {review.next} <span aria-hidden="true">→</span>
          </button>
          : review.save}
      </nav>
    </div>
  }
  const pageNoun = single ? 'Page' : 'Pages'
  return <nav className="mm-reading-turns mm-writing-turns" aria-label="Recipe writing pages">
    <button type="button" className="button mm-button--page-turn" aria-label={`Previous ${pageNoun}`} disabled={page === 0 || isTurning} onClick={() => onTurn(page - 1)}>
      <span aria-hidden="true">←</span> Previous {pageNoun.toLowerCase()}
    </button>
    <span className="mm-reading-indicator" aria-live="polite" aria-atomic="true">{text}</span>
    <button type="button" className="button mm-button--page-turn" aria-label={`Next ${pageNoun}`} disabled={page >= total - 1 || isTurning} onClick={() => onTurn(page + 1)}>
      Next {pageNoun.toLowerCase()} <span aria-hidden="true">→</span>
    </button>
  </nav>
}
