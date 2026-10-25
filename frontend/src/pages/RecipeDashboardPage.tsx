import { useContext, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { RecipeCard } from '../recipes/RecipeCard'
import { RecipeError, RecipeSkeleton } from '../recipes/RecipeStates'
import { isRecipeAccessError } from '../recipes/errors'
import { DiscoveryControls } from '../recipes/DiscoveryControls'
import { useDiscoveryControls } from '../recipes/useDiscoveryControls'
import { useRecipeDiscovery } from '../recipes/useRecipeDiscovery'
import { RecipeSourceContext } from '../recipes/source'

export default function RecipeDashboardPage() {
  const location = useLocation()
  const { user } = useAuth()
  const source = useContext(RecipeSourceContext)
  const controls = useDiscoveryControls(source.discovery)
  const query = useRecipeDiscovery(controls.criteria, controls.waiting)
  const restorePaginationFocus = useRef(false)
  const retryPageButton = useRef<HTMLButtonElement>(null)
  const loadMoreButton = useRef<HTMLButtonElement>(null)
  const endOfResults = useRef<HTMLParagraphElement>(null)
  const firstPageRetryButton = useRef<HTMLButtonElement>(null)
  const restoreFirstPageFocus = useRef(false)
  useEffect(() => {
    if (query.isFetchingNextPage || !restorePaginationFocus.current) return
    restorePaginationFocus.current = false
    const focused = document.activeElement
    if (focused !== document.body && document.contains(focused)) return
    const target = query.isFetchNextPageError ? retryPageButton.current
      : query.hasNextPage ? loadMoreButton.current : endOfResults.current
    target?.focus()
  }, [query.hasNextPage, query.isFetchNextPageError, query.isFetchingNextPage])
  useEffect(() => {
    if (query.isFetching || !restoreFirstPageFocus.current) return
    restoreFirstPageFocus.current = false
    const focused = document.activeElement
    if (focused !== document.body && document.contains(focused)) return
    const target = document.getElementById('collection-heading') ?? document.getElementById('no-results-heading') ?? document.getElementById('empty-heading')
    target?.focus()
  }, [query.isError, query.isFetching])
  const recipeDeleted = typeof location.state === 'object' && location.state !== null &&
    'recipeDeleted' in location.state && location.state.recipeDeleted === true &&
    'accountId' in location.state && location.state.accountId === user?.id
  const recipes = controls.waiting || isRecipeAccessError(query.error) ? undefined : query.recipes
  return (
    <>
      <div className="journal-heading">
        <div><h1>Your cooking journal</h1><p className="intro">A little inspiration, a few ingredients, and the meals you make your own.</p></div>
        <Link className="button button-primary" to="/app/recipes/new">Start a recipe</Link>
        {source.mode !== 'unavailable' && !isRecipeAccessError(query.error) && <button className="button button-secondary" type="button" disabled={query.isFetching || controls.waiting} onClick={() => { void query.refetch() }}>
          {query.isFetching ? 'Refreshing…' : 'Refresh recipes'}
        </button>}
      </div>
      <DiscoveryControls adapter={source.discovery} criteria={controls.draft} onChange={controls.change} onReset={controls.reset} />
      {recipeDeleted && <p className="recipe-operation-feedback" role="status">Recipe deleted. Your collection has been updated.</p>}
      {controls.waiting ? <p role="status">Waiting to search…</p> : query.isPending && <RecipeSkeleton />}
      {query.isPaused && <p role="status">You appear to be offline. Your recipes will load when you reconnect.</p>}
      {!controls.waiting && query.error && (!query.isFetchNextPageError || isRecipeAccessError(query.error)) && <RecipeError error={query.error} retryButtonRef={firstPageRetryButton} onRetry={() => {
        restoreFirstPageFocus.current = true
        void query.refetch()
      }} />}
      {recipes && <>
        {query.isFetching && !query.isFetchingNextPage && <p className="recipe-update" role="status">Updating your collection…</p>}
        {query.isError && !query.isFetchNextPageError && <p className="recipe-update">Showing your last loaded collection. Refresh to try again.</p>}
        {recipes.length > 0 ? (
          <section className="recipe-collection" aria-labelledby="collection-heading">
            <h2 id="collection-heading" className="collection-heading" tabIndex={-1}>Saved recipes <span>({recipes.length})</span></h2>
            <ul className="recipe-grid">{recipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} />)}</ul>
          </section>
        ) : controls.criteria.search || Object.keys(controls.criteria.filters).length > 0 ? (
          <section className="journal-empty" aria-labelledby="no-results-heading">
            <h2 id="no-results-heading" tabIndex={-1}>No recipes match your search.</h2>
            <p>Try another search or reset your filters.</p>
            <button className="button button-secondary" type="button" onClick={controls.reset}>Show all recipes</button>
          </section>
        ) : (
          <section className="journal-empty" aria-labelledby="empty-heading">
            <span className="empty-mark" aria-hidden="true">✧</span>
            <h2 id="empty-heading" tabIndex={-1}>A fresh page for your next favorite.</h2>
            <p>You haven’t saved any recipes yet. Start with a dish you love and make a little room for discovery.</p>
            <Link className="button button-primary" to="/demo-recipe">Explore a demonstration recipe</Link>
          </section>
        )}
        {query.isFetchNextPageError && <div className="request-state request-error">
          <p role="alert">Could not load more recipes. Your loaded recipes are still here.</p>
          <button ref={retryPageButton} className="button button-secondary" type="button" disabled={query.isFetching} onClick={() => {
            restorePaginationFocus.current = true
            void query.loadMore()
          }}>Retry loading more</button>
        </div>}
        {query.hasNextPage && !query.isFetchNextPageError && <div className="discovery-pagination">
          <button ref={loadMoreButton} className="button button-secondary" type="button" disabled={query.isFetching} onClick={() => {
            restorePaginationFocus.current = true
            void query.loadMore()
          }}>{query.isFetchingNextPage ? 'Loading more…' : 'Load more'}</button>
        </div>}
        {query.isFetchingNextPage && <p role="status">Loading more recipes…</p>}
        {source.discovery && recipes.length > 0 && !query.hasNextPage && !query.isError && <p ref={endOfResults} className="discovery-end" role="status" tabIndex={-1}>End of results.</p>}
      </>}
    </>
  )
}
