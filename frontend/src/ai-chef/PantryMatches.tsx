import { useContext, useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { writeJournalCriteria } from '../journal/indexNavigation'
import { PaperCard } from '../journal/Scrapbook'
import { RecipeError } from '../recipes/RecipeStates'
import { RecipeSourceContext, RecipeIntegrationUnavailable } from '../recipes/source'
import { useRecipeDiscovery } from '../recipes/useRecipeDiscovery'
import { initialDiscoveryCriteria } from '../recipes/discoveryTypes'

export function PantrySlip({ title, closeLabel, onClose, children }: {
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}) {
  const heading = useRef<HTMLParagraphElement>(null)
  const label = useId()
  useLayoutEffect(() => { heading.current?.focus() }, [])

  return <PaperCard surface="fresh" tape="sage" id="ai-chef-pantry-slip" role="region" aria-labelledby={label}
    className="mm-ai-chef__pantry-slip" onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }}>
    <p className="mm-ai-chef__slip-title" ref={heading} id={label} tabIndex={-1}>{title}</p>
    {children}
    <button type="button" className="button button-secondary mm-button--small" onClick={onClose}>{closeLabel}</button>
  </PaperCard>
}

export function PantryMatches({ ingredient, onLeave }: {
  ingredient: string
  onLeave: () => void
}) {
  const criteria = { ...initialDiscoveryCriteria, search: ingredient.trim(), searchMode: 'ingredients' } as const
  const { discovery } = useContext(RecipeSourceContext)
  const query = useRecipeDiscovery(criteria, false, 'first-page')
  const shown = query.error ? undefined : query.recipes?.slice(0, 3)
  const error = discovery ? query.error : new RecipeIntegrationUnavailable()
  return shown ? <>
      <p role="status">{shown.length > 0
        ? `Showing ${shown.length} saved ${shown.length === 1 ? 'recipe' : 'recipes'} that match ${ingredient}.`
        : `No saved recipes matched ${ingredient}.`}</p>
      {shown.length > 0 && <>
        <ul>
          {shown.map(({ id, title }) => <li key={id}><Link to={`/app/recipes/${encodeURIComponent(id)}`} onClick={onLeave}>{title}</Link></li>)}
        </ul>
        <Link to={`/app/recipes?${writeJournalCriteria(criteria)}`} onClick={onLeave}>See all matches</Link>
      </>}
    </> : error ? <RecipeError error={error} onRetry={() => { void query.refetch() }} />
      : <p role="status">{query.isPaused ? 'Recipe search will resume when you reconnect.' : 'Looking through your saved recipes…'}</p>
}
