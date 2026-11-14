import { useJournalPageTurn } from './JournalPageTurn'

export function JournalReadingTurns({ page, total, onTurn }: {
  page: number; total: number; onTurn: (page: number) => void
}) {
  const { isTurning } = useJournalPageTurn()
  return <nav className="mm-reading-turns" aria-label="Recipe reading pages">
    <button type="button" className="button mm-button--page-turn" aria-label="Previous Page" disabled={page === 0 || isTurning} onClick={() => onTurn(page - 1)}><span aria-hidden="true">←</span> Previous page</button>
    <span className="mm-reading-indicator" aria-live="polite" aria-atomic="true">Page {page + 1} of {total}</span>
    <button type="button" className="button mm-button--page-turn" aria-label="Next Page" disabled={page >= total - 1 || isTurning} onClick={() => onTurn(page + 1)}>Next page <span aria-hidden="true">→</span></button>
  </nav>
}
