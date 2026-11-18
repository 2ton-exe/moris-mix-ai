import { JournalPagination } from '../journal/JournalPagination'
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
      <nav className="mm-review-controls" aria-label="Recipe review actions">{review.exit}{!review.next && review.save}</nav>
      <JournalPagination label="Recipe writing pages" leftNumber={text} rightNumber={text}
        previous={review.previous && <button type="button" className="button mm-button--page-turn" disabled={isTurning} aria-label={`Previous: ${review.previous}`} onClick={() => onTurn(page - 1)}>← Previous</button>}
        next={review.next && <button type="button" className="button mm-button--page-turn" disabled={isTurning} aria-label={`Next: ${review.next}`} onClick={() => onTurn(page + 1)}>Next →</button>} />
    </div>
  }
  const pageNoun = single ? 'Page' : 'Pages'
  return <JournalPagination label="Recipe writing pages" leftNumber={text} rightNumber={text}
    previous={page > 0 && <button type="button" className="button mm-button--page-turn" aria-label={`Previous ${pageNoun}`} disabled={isTurning} onClick={() => onTurn(page - 1)}>← Previous</button>}
    next={page < total - 1 && <button type="button" className="button mm-button--page-turn" aria-label={`Next ${pageNoun}`} disabled={isTurning} onClick={() => onTurn(page + 1)}>Next →</button>} />
}
