import { useContext, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/context'
import { RecipeCollectionPages } from '../recipes/RecipeCollectionPages'
import { RecipeError, RecipeSkeleton } from '../recipes/RecipeStates'
import { isRecipeAccessError } from '../recipes/errors'
import { DiscoveryControls } from '../recipes/DiscoveryControls'
import { useDiscoveryControls } from '../recipes/useDiscoveryControls'
import { useRecipeDiscovery } from '../recipes/useRecipeDiscovery'
import { RecipeSourceContext } from '../recipes/source'
import { Mori } from '../journal/Mori'
import { PaperCard, Tape } from '../journal/Scrapbook'
import { MoriDialogueLauncher } from '../journal/MoriDialogue'
import type { MoriDialogueLine } from '../journal/MoriDialogue'
import { JournalCompanion } from '../journal/JournalFacingPage'
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
  const navigate = useNavigate()
  const { isTurning, requestPageTurn } = useJournalPageTurn()
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
  const endOfResults = useRef<HTMLParagraphElement>(null)
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
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const phone = useJournalMedia('(max-width: 599.98px)')
  const perPage = phone ? 1 : 2
  const indexView = params.get('view') === 'index' || (params.get('view') !== 'collection' && (Boolean(controls.draft.search) || controls.criteria.sort !== 'newest' || controls.criteria.searchMode !== 'title' || Object.keys(controls.criteria.filters).length > 0))
  const anchored = new URLSearchParams(params)
  const entry = Number(params.get('entry'))
  const hasAnchor = params.has('entry') && Number.isSafeInteger(entry) && entry >= 0
  if (hasAnchor) anchored.set('leaf', String(Math.floor(entry / perPage) + 1))
  const leaf = journalPage(anchored, recipes?.length ?? 0, { hasMore: query.hasNextPage || query.isPending, perPage })
  const spread = Math.floor(leaf / 2)
  const pages = single ? [leaf] : spread === 0 ? [0, 1] : [spread * 2, spread * 2 + 1]
  const rightPage = pages.at(-1)!
  const needed = indexView && hasAnchor ? entry + 1 : rightPage * perPage
  const returnFocusId = typeof location.state?.focusRecipe === 'string' ? location.state.focusRecipe
    : hasAnchor ? recipes?.[entry]?.id : undefined
  const restoreKey = `${location.key}:${indexView}:${single}:${perPage}:${returnFocusId ?? ''}`
  useEffect(() => { if (!recipeLink(returnFocusId)) collectionTitle.current?.focus() }, [facingPage, returnFocusId])
  const pageSearch = (page: number) => {
    const next = new URLSearchParams(params)
    next.set('leaf', String(page))
    next.set('entry', String((page - 1) * perPage))
    return `?${next}`
  }
  const pageLink = (page: number) => ({ pathname: location.pathname, search: pageSearch(page), hash: location.hash })
  const turnCollectionPage = (page: number, direction: 'forward' | 'backward') => {
    if (isTurning || page < 1) return
    const search = pageSearch(page)
    requestPageTurn(direction, () => {
      void navigate({ pathname: location.pathname, search, hash: location.hash }, {
        state: { journalAccount: user?.id }, preventScrollReset: true, flushSync: true,
      })
    }, search)
  }
  const viewLink = (view: 'collection' | 'index') => {
    const next = new URLSearchParams(params)
    next.set('view', view)
    return `?${next}`
  }
  // A spread is a window over server results, never an assertion of their total.
  // Continue the opaque cursor to fill a spread or restore a saved index anchor,
  // including when the inactive account-scoped query has expired or on reload.
  useEffect(() => {
    if ((!indexView || hasAnchor) && recipes && recipes.length < needed && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError && !controls.waiting) void query.loadMore()
  }, [indexView, hasAnchor, recipes, needed, query, controls.waiting])
  const canNext = (recipes?.length ?? 0) > needed || query.hasNextPage
  const canPrevious = single ? leaf > 1 : spread > 0
  useEffect(() => {
    if (!recipes || restoredLocation.current === restoreKey) return
    const card = recipeLink(returnFocusId)
    if (card) { card.focus(); restoredLocation.current = restoreKey }
  }, [recipes, restoreKey, returnFocusId])
  useEffect(() => {
    if (params.has('leaf') && !returnFocusId) document.getElementById('collection-heading')?.focus()
  }, [leaf, params, returnFocusId])
  const hasSearch = Boolean(controls.criteria.search) || Object.keys(controls.criteria.filters).length > 0
  const moriLines: readonly MoriDialogueLine[] = recipes?.length === 0 && !hasSearch
    ? [{
      id: 'empty-journal', speaker: 'Mori', expression: 'cheer',
      text: "Welcome to your MORI'S MIX journal. This fresh page is ready for a recipe you love and the little details that make it yours.",
      choices: [
        { id: 'start-recipe', label: 'Write your first recipe' },
        { id: 'maybe-later', label: 'Maybe later' },
      ],
    }]
    : recipes?.length === 0
      ? [{
        id: 'no-matches', speaker: 'Mori', expression: 'think',
        text: 'No recipe cards match this search yet. Try a different title or ingredient, or clear the search to see your full collection.',
        choices: [{ id: 'clear-search', label: 'Clear my search', nextLineId: 'search-cleared' }],
      }, {
        id: 'search-cleared', speaker: 'Mori', expression: 'wave',
        text: 'Your search is cleared. The collection below will show the recipes that match your current view.',
      }]
      : [{
        id: 'recipe-index', speaker: 'Mori', expression: 'wave',
        text: 'Your saved recipes live in the collection below. Search by title or ingredient, then open a scrap to revisit its ingredients, method, and notes.',
        choices: [
          { id: 'show-collection', label: 'Show me the collection', nextLineId: 'collection-tip' },
          { id: 'start-recipe', label: 'Write another recipe' },
        ],
      }, {
        id: 'collection-tip', speaker: 'Mori', expression: 'happy',
        text: 'Choose any recipe card in the index to open its full journal entry.',
      }]
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
              <Mori mood="wave" size={126} label="Mori the chef waving hello" animated />
              <p className="mm-recipe-index__eyebrow">A fresh page for MORI'S MIX</p>
              <h2 id="empty-heading" tabIndex={-1}>A fresh page for your next favorite.</h2>
              <p>Your journal is ready for its first scrap. Start with a dish you love and write down what makes it yours.</p>
              <Link className="button button-primary" to="/app/recipes/new">Add Your First Scrap</Link>
              <Link className="button button-secondary" to="/app/quick-entry" state={{ journalReturn: location.pathname + location.search }}>Organize cooking notes with Mori</Link>
              <span className="mm-handwriting mm-recipe-empty__note">Your first recipe becomes page one.</span>
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
        {source.discovery && recipes && recipes.length > 0 && !query.hasNextPage && !query.isError && (indexView || !canNext) && <p ref={endOfResults} className="discovery-end" role="status" tabIndex={-1}>End of results.</p>}
  </>
  return <>
    <RecipeCollectionPages recipes={recipes} pages={pages} perPage={perPage} index={indexView} titleRef={collectionTitle} sort={controls.criteria.sort}
      hasMore={query.hasNextPage} ownerName={typeof user?.user_metadata?.name === 'string' ? user.user_metadata.name : user?.email?.split('@')[0] ?? 'a cook'}
      header={<div className="mm-collection-tools">
        <Link className="button mm-button--ghost mm-button--small" to="/app/quick-entry" state={{ journalReturn: location.pathname + location.search }}>Quick AI Entry</Link>
        <Link className="button mm-button--ghost mm-button--small" to="/app/recipes/new" state={{ journalReturn: location.pathname + location.search }}>Start a recipe</Link>
        <Link className="button mm-button--ghost mm-button--small" to={viewLink(indexView ? 'collection' : 'index')} state={{ journalAccount: user?.id }}>{indexView ? 'My scraps' : 'Search & index'}</Link>
        {source.mode !== 'unavailable' && !isRecipeAccessError(query.error) && <button className="button mm-button--ghost mm-button--small" type="button" disabled={query.isFetching || controls.waiting} onClick={() => { void query.refetch() }}>{query.isFetching ? 'Refreshing…' : 'Refresh recipes'}</button>}
      </div>}
      controls={<DiscoveryControls adapter={source.discovery} criteria={controls.draft} onChange={controls.change} onReset={controls.reset} />}
      status={<>
      {recipeDeleted && <p className="recipe-operation-feedback" role="status">Recipe deleted. Your collection has been updated.</p>}
      {controls.waiting ? <p role="status">Waiting to search…</p> : query.isPending && <RecipeSkeleton />}
      {query.isPaused && <p role="status">You appear to be offline. Your recipes will load when you reconnect.</p>}
      {!controls.waiting && query.error && (!query.isFetchNextPageError || isRecipeAccessError(query.error)) && <RecipeError error={query.error} retryButtonRef={firstPageRetryButton} onRetry={() => {
        restoreFirstPageFocus.current = true
        void query.refetch()
      }} />}
      {recipes && query.isFetching && !query.isFetchingNextPage && <p className="recipe-update" role="status">Updating your collection…</p>}
      {recipes && query.isError && !query.isFetchNextPageError && <p className="recipe-update">Showing your last loaded collection. Refresh to try again.</p>}
      </>}
      empty={recipes ? empty : null} pagination={recipes ? pagination : null}
      turns={<>
        {canPrevious ? <Link className="button mm-button--page-turn" to={pageLink(single ? leaf - 1 : Math.max(1, pages[0] - 2))}
          aria-disabled={isTurning || undefined} tabIndex={isTurning ? -1 : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            turnCollectionPage(single ? leaf - 1 : Math.max(1, pages[0] - 2), 'backward')
          }}>← Previous page</Link> : <span />}
        {canNext && <Link className="button mm-button--page-turn" to={pageLink(single ? leaf + 1 : rightPage + 1)}
          aria-disabled={isTurning || undefined} tabIndex={isTurning ? -1 : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            turnCollectionPage(single ? leaf + 1 : rightPage + 1, 'forward')
          }}>Next page →</Link>}
        {!canNext && <span className="mm-collection-last">Last loaded page</span>}
        {rightPage > 1 && <Link className="button mm-button--page-turn" to={viewLink('index')} state={{ journalAccount: user?.id }}>Search &amp; index</Link>}
      </>}
    />
    {source.mode !== 'unavailable' && !isRecipeAccessError(query.error) && <JournalCompanion><MoriDialogueLauncher
      lines={moriLines} completionText="Whenever you are ready, your journal is here."
      onChoice={(choice) => { if (choice.id === 'clear-search') controls.reset() }}
    /></JournalCompanion>}
  </>
}
