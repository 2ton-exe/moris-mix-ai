import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/context'
import { RecipeCollectionPages } from '../recipes/RecipeCollectionPages'
import { RecipeError, RecipeSkeleton } from '../recipes/RecipeStates'
import { isRecipeAccessError } from '../recipes/errors'
import { DiscoveryControls } from '../recipes/DiscoveryControls'
import { useDiscoveryControls } from '../recipes/useDiscoveryControls'
import { useRecipeDiscovery } from '../recipes/useRecipeDiscovery'
import { RecipeSourceContext } from '../recipes/source'
import { PaperCard, Tape } from '../journal/Scrapbook'
import { useMoriActivity, useMoriGuidance } from '../mori/MoriCompanionContext'
import { useMoriHeadingFocusKey } from '../mori/routeState'
import { useJournalMedia } from '../journal/useJournalMedia'
import { JournalFacingPageContext } from '../journal/JournalLayoutContext'
import { useJournalPageTurn } from '../journal/JournalPageTurn'
import { journalPage, readJournalCriteria, writeJournalCriteria } from '../journal/indexNavigation'

function recipeLink(id: unknown) {
  return typeof id === 'string' ? Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-recipe-id]'))
    .find((element) => element.dataset.recipeId === id) : undefined
}

export default function RecipeDashboardPage() {
  const location = useLocation()
  const moriFocusKey = useMoriHeadingFocusKey()
  const navigate = useNavigate()
  const { isTurning, requestPageTurn } = useJournalPageTurn()
  const [catalogStarts, setCatalogStarts] = useState([0])
  const [collectionStarts, setCollectionStarts] = useState([0])
  const measureCatalog = useCallback((starts: number[]) => {
    setCatalogStarts((current) => current.length === starts.length && current.every((start, index) => start === starts[index]) ? current : starts)
  }, [])
  const measureCollection = useCallback((starts: number[]) => {
    setCollectionStarts((current) => current.length === starts.length && current.every((start, index) => start === starts[index]) ? current : starts)
  }, [])
  const [turnSearch, setTurnSearch] = useState<string | null>(null)
  const { user } = useAuth()
  const source = useContext(RecipeSourceContext)
  const facingPage = useContext(JournalFacingPageContext)
  const [params, setParams] = useSearchParams()
  const otherAccount = location.state?.journalAccount !== undefined && location.state.journalAccount !== user?.id
  const controls = useDiscoveryControls(source.discovery, {
    draft: readJournalCriteria(otherAccount ? new URLSearchParams() : params, source.discovery),
    onChange: (criteria) => {
      const next = writeJournalCriteria(criteria)
      next.set('view', 'index')
      setParams(next, { replace: true, state: { journalAccount: user?.id } })
    },
  })
  useEffect(() => {
    if (otherAccount) {
      const clean = new URLSearchParams()
      if (params.get('view') === 'index') clean.set('view', 'index')
      setParams(clean, { replace: true, state: { journalAccount: user?.id } })
    }
  }, [otherAccount, params, setParams, user?.id])
  const query = useRecipeDiscovery(controls.criteria, controls.waiting)
  const restorePaginationFocus = useRef(false)
  const retryPageButton = useRef<HTMLButtonElement>(null)
  const loadMoreButton = useRef<HTMLButtonElement>(null)
  const endOfResultsRef = useRef<HTMLParagraphElement>(null)
  const firstPageRetryButton = useRef<HTMLButtonElement>(null)
  const restoreFirstPageFocus = useRef(false)
  const collectionTitle = useRef<HTMLHeadingElement>(null)
  const restoredLocation = useRef<string | null>(null)
  useEffect(() => {
    if (query.isFetchingNextPage || !restorePaginationFocus.current) return
    restorePaginationFocus.current = false
    const focused = document.activeElement
    if (focused !== document.body && document.contains(focused)) return
    const target = query.isFetchNextPageError ? retryPageButton.current
      : (query.hasNextPage ? loadMoreButton.current : endOfResultsRef.current) ?? document.querySelector<HTMLElement>('[data-index-next]')
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
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const phone = useJournalMedia('(max-width: 599.98px)')
  const perPage = phone ? 1 : 2
  const indexView = params.get('view') === 'index' || (params.get('view') !== 'collection' && (Boolean(controls.draft.search) || controls.criteria.sort !== 'newest' || controls.criteria.searchMode !== 'title' || Object.keys(controls.criteria.filters).length > 0))
  const collectionCriteriaKey = JSON.stringify(controls.criteria)
  useEffect(() => { setCollectionStarts([0]) }, [collectionCriteriaKey, indexView])
  const pagedIndex = indexView && typeof ResizeObserver !== 'undefined'
  const pagedCollection = !indexView && !single && typeof ResizeObserver !== 'undefined'
  const displayParams = turnSearch === null ? params : new URLSearchParams(turnSearch)
  const anchored = new URLSearchParams(displayParams)
  const entry = Number(displayParams.get('entry'))
  const hasAnchor = !(turnSearch !== null && !indexView && displayParams.has('leaf')) && displayParams.has('entry') && Number.isSafeInteger(entry) && entry >= 0
  if (hasAnchor) anchored.set('leaf', String(pagedCollection
    ? Math.max(1, collectionStarts.filter((start) => start <= entry).length)
    : Math.floor(entry / perPage) + 1))
  const leaf = journalPage(anchored, pagedCollection ? collectionStarts.length : recipes?.length ?? 0, {
    hasMore: query.hasNextPage || query.isPending, perPage: pagedCollection ? 1 : perPage,
  })
  const spread = Math.floor(leaf / 2)
  const pages = single ? [leaf] : spread === 0 ? [0, 1] : [spread * 2, spread * 2 + 1]
  const rightPage = pages.at(-1)!
  const catalogPage = catalogStarts.filter((start) => start <= (hasAnchor ? entry : 0)).length - 1
  const catalogStart = catalogStarts[catalogPage] ?? 0
  const nextCatalogStart = catalogStarts[catalogPage + 1]
  const previousCatalogStart = catalogStarts[catalogPage - 1]
  const collectionNeeded = collectionStarts[rightPage] ?? (recipes?.length ?? 0) + (query.hasNextPage || query.isPending ? 1 : 0)
  const needed = hasAnchor ? Math.max(entry + 1, pagedCollection ? collectionNeeded : 0)
    : pagedCollection ? collectionNeeded : rightPage * perPage
  const returnFocusId = typeof location.state?.focusRecipe === 'string' ? location.state.focusRecipe
    : hasAnchor ? recipes?.[entry]?.id : undefined
  const restoreKey = `${location.key}:${indexView}:${single}:${perPage}:${pagedCollection ? collectionStarts.join(',') : ''}:${returnFocusId ?? ''}`
  useEffect(() => { if (!recipeLink(returnFocusId)) collectionTitle.current?.focus() }, [facingPage, returnFocusId, moriFocusKey])
  const pageSearch = (page: number) => {
    const next = new URLSearchParams(params)
    if (pagedIndex || pagedCollection) next.delete('leaf')
    else next.set('leaf', String(page))
    next.set('entry', String(pagedIndex ? page : pagedCollection ? collectionStarts[page - 1] ?? recipes?.length ?? 0 : (page - 1) * perPage))
    return `?${next}`
  }
  const latestPageSearch = useRef(pageSearch)
  latestPageSearch.current = pageSearch
  const pageLink = (page: number) => ({ pathname: location.pathname, search: pageSearch(page), hash: location.hash })
  const turnCollectionPage = (page: number, direction: 'forward' | 'backward') => {
    if (isTurning || page < (pagedIndex ? 0 : 1)) return
    const search = pageSearch(page)
    requestPageTurn(direction, () => setTurnSearch(pagedIndex ? search : `${search}&leaf=${page}`), () => {
      const settledSearch = latestPageSearch.current(page)
      setTurnSearch(null)
      void navigate({ pathname: location.pathname, search: settledSearch, hash: location.hash }, {
        state: { journalAccount: user?.id }, preventScrollReset: true, flushSync: true,
      })
    }, undefined, () => setTurnSearch(null))
  }
  const viewLink = (view: 'collection' | 'index') => {
    const next = new URLSearchParams(params)
    next.set('view', view)
    next.delete('entry')
    next.delete('leaf')
    return `?${next}`
  }
  // A spread is a window over server results, never an assertion of their total.
  // Continue the opaque cursor to fill a spread or restore a saved index anchor,
  // including when the inactive account-scoped query has expired or on reload.
  useEffect(() => {
    if ((!indexView || hasAnchor) && recipes && recipes.length < needed && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError && !controls.waiting) void query.loadMore()
  }, [indexView, hasAnchor, recipes, needed, query, controls.waiting])
  const nextPage = pagedIndex ? nextCatalogStart
    : pagedCollection ? collectionStarts[rightPage] !== undefined || query.hasNextPage ? rightPage + 1 : undefined
    : (recipes?.length ?? 0) > needed || query.hasNextPage ? single ? leaf + 1 : rightPage + 1 : undefined
  const previousPage = pagedIndex ? previousCatalogStart
    : pagedCollection ? spread > 0 ? pages[0] - 1 : undefined
    : (single ? leaf > 1 : spread > 0) ? single ? leaf - 1 : Math.max(1, pages[0] - 2) : undefined
  useEffect(() => {
    if (!recipes || restoredLocation.current === restoreKey) return
    const card = recipeLink(returnFocusId)
    if (card) { card.focus(); restoredLocation.current = restoreKey }
  }, [recipes, restoreKey, returnFocusId])
  useEffect(() => {
    if (!isTurning && params.has('leaf') && !returnFocusId) document.getElementById('collection-heading')?.focus()
  }, [isTurning, leaf, params, returnFocusId])
  const hasSearch = Boolean(controls.criteria.search) || Object.keys(controls.criteria.filters).length > 0
  const guidanceAvailable = source.mode !== 'unavailable' && !isRecipeAccessError(query.error)
  useMoriGuidance(!guidanceAvailable || recipes?.length !== 0 ? null : {
    message: hasSearch
      ? 'No recipe cards match this search yet. Try another title or ingredient, or clear the search to see your full collection.'
      : "Your fresh journal is ready for a recipe you love. Let's write your first scrap.",
    action: hasSearch
      ? { label: 'Clear my search', onClick: controls.reset }
      : { label: 'Write your first recipe', onClick: () => navigate('/app/recipes/new') },
  })
  useMoriActivity(query.error ? { kind: 'confused', message: 'The collection needs a little attention. Use the recipe error controls to try again.' } : null)
  const empty = controls.criteria.search || Object.keys(controls.criteria.filters).length > 0 ? (
          <section className="journal-empty" aria-labelledby="no-results-heading">
            <h2 id="no-results-heading" tabIndex={-1}>No recipes match your search.</h2>
            <p>Try another search or reset your filters.</p>
            <button className="button button-secondary" type="button" onClick={controls.reset}>Show all recipes</button>
          </section>
        ) : (
          <section className="journal-empty mm-recipe-empty" aria-labelledby="empty-heading">
            <PaperCard surface="fresh" className="mm-recipe-empty__card">
              <Tape variant="sage" className="mm-recipe-empty__tape" />
              <h2 id="empty-heading" tabIndex={-1}>A fresh page for your next favorite.</h2>
              <p>Your journal is ready for its first scrap. Start with a dish you love and write down what makes it yours.</p>
              <Link className="button button-primary" to="/app/recipes/new">Add your first recipe</Link>
              <Link className="button button-secondary" to="/app/quick-entry" state={{ journalReturn: location.pathname + location.search }}>Organize cooking notes with Mori</Link>
            </PaperCard>
          </section>
)
  const pagination = <>
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

  </>
  return <div data-journal-ready={(query.isFetchNextPageError || query.isPaused) && turnSearch !== null ? 'error' : turnSearch !== null && (query.isPending || controls.waiting || ((recipes?.length ?? 0) < needed && query.hasNextPage)) ? 'false' : 'true'} className="mm-page-column">
    <RecipeCollectionPages recipes={recipes} pages={pages} perPage={perPage} index={indexView} titleRef={collectionTitle} sort={controls.criteria.sort}
      catalog={pagedIndex ? { start: catalogStart, end: nextCatalogStart ?? recipes?.length ?? 0, indicator: `Page ${catalogPage + 1}`, measure: measureCatalog } : undefined}
      collection={pagedCollection ? { starts: collectionStarts, measure: measureCollection } : undefined}
      hasMore={query.hasNextPage} ownerName={typeof user?.user_metadata?.name === 'string' ? user.user_metadata.name : user?.email?.split('@')[0] ?? 'a cook'}
      header={<div className="mm-collection-tools">
        <Link className="button button-secondary mm-button--small" to={viewLink(indexView ? 'collection' : 'index')} state={{ journalAccount: user?.id }}>{indexView ? 'Browse journal' : 'Search & index'}</Link>
        {source.mode !== 'unavailable' && !isRecipeAccessError(query.error) && <button className="button button-secondary mm-button--small" type="button" disabled={query.isFetching || controls.waiting} onClick={() => { void query.refetch() }}>{query.isFetching ? 'Refreshing…' : 'Refresh recipes'}</button>}
      </div>}
      controls={<DiscoveryControls adapter={source.discovery} criteria={controls.draft} onChange={controls.change} onReset={controls.reset} />}
      status={<>
      {recipeDeleted && <p className="recipe-operation-feedback" role="status">Recipe deleted.</p>}
      {controls.waiting ? <p role="status">Waiting to search…</p> : query.isPending && <RecipeSkeleton index={indexView} />}
      {query.isPaused && <p role="status">You appear to be offline. Your recipes will load when you reconnect.</p>}
      {!controls.waiting && query.error && (!query.isFetchNextPageError || isRecipeAccessError(query.error)) && <RecipeError error={query.error} retryButtonRef={firstPageRetryButton} onRetry={() => {
        restoreFirstPageFocus.current = true
        void query.refetch()
      }} />}
      {recipes && query.isFetching && !query.isFetchingNextPage && <p className="recipe-update" role="status">Updating your collection…</p>}
      {recipes && query.isError && !query.isFetchNextPageError && <p className="recipe-update" role="status">Showing your last loaded collection. Refresh to try again.</p>}
      </>}
      endOfResults={source.discovery && recipes && recipes.length > 0 && !query.hasNextPage && !query.isError && (nextPage === undefined || (indexView && !pagedIndex))
        ? <p ref={endOfResultsRef} className="discovery-end" role="status" tabIndex={-1}>End of results.</p> : null}
      empty={recipes ? empty : null} pagination={recipes ? pagination : null}
      previous={<>
        {previousPage !== undefined ? <Link className="button mm-button--page-turn" to={pageLink(previousPage)}
          aria-disabled={isTurning || undefined} tabIndex={isTurning ? -1 : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            turnCollectionPage(previousPage, 'backward')
          }}>← Previous page</Link> : <span />}
      </>}
      next={<>
        {nextPage !== undefined && <Link className="button mm-button--page-turn" data-index-next={pagedIndex || undefined} to={pageLink(nextPage)}
          aria-disabled={isTurning || undefined} tabIndex={isTurning ? -1 : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            turnCollectionPage(nextPage, 'forward')
          }}>Next page →</Link>}

      </>}
    />

  </div>
}
