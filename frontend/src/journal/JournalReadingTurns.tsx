import { JournalPagination } from './JournalPagination'
import { useJournalPageTurn } from './JournalPageTurn'

export function JournalReadingTurns({ page, total, indicator, onTurn }: {
  page: number; total: number; indicator: string; onTurn: (page: number) => void
}) {
  const { isTurning } = useJournalPageTurn()
  return <JournalPagination label="Recipe reading pages" rightNumber={indicator}
    previous={page > 0 && <button type="button" className="button mm-button--page-turn" aria-label="Previous Page" disabled={isTurning} onClick={() => onTurn(page - 1)}>← Previous</button>}
    next={page < total - 1 && <button type="button" className="button mm-button--page-turn" aria-label="Next Page" disabled={isTurning} onClick={() => onTurn(page + 1)}>Next →</button>} />
}
