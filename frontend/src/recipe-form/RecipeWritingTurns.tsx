import { useJournalPageTurn } from '../journal/JournalPageTurn'

export function RecipeWritingTurns({ page, total, text, single, onTurn }: {
  page: number
  total: number
  text: string
  single: boolean
  onTurn: (page: number) => void
}) {
  const { isTurning } = useJournalPageTurn()
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
