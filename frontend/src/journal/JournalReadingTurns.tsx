import { JournalPagination } from './JournalPagination'
import { useJournalPageTurn } from './JournalPageTurn'

export function JournalReadingTurns({ page, total, onTurn }: {
  page: number; total: number; onTurn: (page: number) => void
}) {
  const { isTurning } = useJournalPageTurn()
  return <JournalPagination label="Recipe reading pages" leftNumber={`p. ${page * 2 + 1}`} rightNumber={`Page ${page + 1} of ${total}`}
    previous={page > 0 && <button type="button" className="button mm-button--page-turn" aria-label="Previous Page" disabled={isTurning} onClick={() => onTurn(page - 1)}>← Previous</button>}
    next={page < total - 1 && <button type="button" className="button mm-button--page-turn" aria-label="Next Page" disabled={isTurning} onClick={() => onTurn(page + 1)}>Next →</button>} />
}
