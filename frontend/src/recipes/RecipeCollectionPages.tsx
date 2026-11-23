import { JournalPagination } from '../journal/JournalPagination'
import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { MoriEmblem } from '../journal/Mori'
import { PaperCard } from '../journal/Scrapbook'
import { RecipeCard, RecipeCollectionCardMeasure, RecipeIndexCardContent } from './RecipeCard'
import { paginateReading } from './readingPagination'
import type { RecipeSummary } from './types'

export function RecipeCollectionPages({ recipes, pages, perPage, index, catalog, collection, header, controls, status, endOfResults, pagination, previous, next, titleRef, empty, hasMore, ownerName, sort }: {
  recipes?: RecipeSummary[]; pages: number[]; perPage: number; index: boolean
  catalog?: { start: number; end: number; indicator: string; measure: (starts: number[]) => void }
  collection?: { starts: number[]; measure: (starts: number[]) => void }
  header: ReactNode; controls: ReactNode; status: ReactNode; endOfResults: ReactNode; pagination: ReactNode; previous: ReactNode; next: ReactNode
  titleRef: Ref<HTMLHeadingElement>; empty: ReactNode
  hasMore: boolean; ownerName: string; sort: 'newest' | 'rating'
}) {
  const headingRef = useRef<HTMLElement>(null)
  const [headingHeight, setHeadingHeight] = useState(0)
  useLayoutEffect(() => {
    const element = headingRef.current
    if (!element || index || typeof ResizeObserver === 'undefined') return
    const measure = () => setHeadingHeight(element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginBottom))
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [index, pages.length])
  const results = useRef<HTMLDivElement>(null)
  const bank = useRef<HTMLUListElement>(null)
  const measureCatalog = index ? catalog?.measure : collection?.measure
  useLayoutEffect(() => {
    const viewport = results.current
    const list = bank.current
    if (!viewport || !list || !measureCatalog || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const padding = getComputedStyle(viewport)
      const listStyle = getComputedStyle(list)
      // paginateReading already includes 10px between entries.
      const gap = index ? 0 : (parseFloat(listStyle.rowGap) || 0) - 10
      // The index reserves feedback space; collection pages use their actual list padding.
      const reserve = index ? 64 : parseFloat(listStyle.paddingTop) + parseFloat(listStyle.paddingBottom)
      const capacity = viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) - reserve + gap
      if (capacity <= 0) return
      list.style.width = `${viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight)}px`
      const starts = paginateReading(Array.from(list.children, (row, offset) => ({
        id: String(offset), section: 'index', headingHeight: 0, height: row.getBoundingClientRect().height + gap,
      })), capacity).map((page) => Number(page[0] ?? 0))
      measureCatalog(starts)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(list)
    measure()
    return () => observer.disconnect()
  }, [measureCatalog, recipes, index])
  const heading = <header ref={headingRef} className="mm-collection-heading">
    {!index && recipes && <p className="mm-recipe-index__eyebrow">{`${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}${hasMore ? ' loaded' : ''} · ${sort === 'rating' ? 'rating order' : 'newest first'}`}</p>}
    <h1 ref={titleRef} tabIndex={-1}>{index ? 'Recipe index' : 'Your cooking journal'}</h1>
    {!index && <span className="mm-title-swash" aria-hidden="true" />}
    {!index && <p className="mm-collection-owner">This journal belongs to {ownerName}.</p>}
    {header}
  </header>
  const entries = (page: number) => {
    const offset = collection ? collection.starts[page - 1] ?? recipes?.length ?? 0 : (page - 1) * perPage
    const end = collection ? collection.starts[page] ?? recipes?.length ?? offset : offset + perPage
    return <ul className="recipe-grid mm-collection-entries" aria-label={`Recipes on page ${page}`}>
      {recipes?.slice(offset, end).map((recipe, i) => <RecipeCard key={recipe.id} recipe={recipe} folio={offset + i + 1} />)}
    </ul>
  }
  if (index) return <>
    <JournalFacingPage className="mm-facing-content--index mm-page-column">
      {heading}
      <div className="mm-page-body" role="region" aria-label="Recipe search controls" tabIndex={0}>{controls}{catalog && pagination}</div>
    </JournalFacingPage>
    <section className="recipe-collection mm-page-column" aria-labelledby="collection-heading">
      <h2 id="collection-heading" className="collection-heading" tabIndex={-1}>Saved recipes{recipes && <span> ({recipes.length})</span>}</h2>
      <div ref={results} className="mm-page-body mm-index-results" role="region" aria-label="Recipe index results" tabIndex={0}>
        {status}
        {recipes?.length ? <ul className="recipe-grid mm-index-entries">{recipes.slice(catalog?.start ?? 0, catalog?.end).map((recipe, i) => <RecipeCard key={recipe.id} recipe={recipe} folio={(catalog?.start ?? 0) + i + 1} indexCard />)}</ul> : empty}
        {endOfResults}
      </div>
      {catalog && !!recipes?.length && <ul ref={bank} className="recipe-grid mm-index-entries mm-pagination-measure" aria-hidden="true" inert>
        {recipes.map((recipe, offset) => <li className="mm-recipe-card-slot" key={recipe.id}><div className="mm-index-card"><RecipeIndexCardContent recipe={recipe} folio={offset + 1} /></div></li>)}
      </ul>}
    </section>
    <JournalPageFooter><div className="mm-collection-footer">
      {catalog && <JournalPagination label="Recipe index pages" previous={previous} next={next} rightNumber={catalog.indicator} />}
      {!catalog && pagination}
    </div></JournalPageFooter>
  </>
  const [left, right] = pages.length === 2 ? pages : [0, pages[0]]
  const pageOffset = pages.length === 2 ? 1 : 0
  const rightStart = collection ? collection.starts[right] ?? recipes?.length ?? 0 : pages.length === 2 ? right * perPage : (right - 1) * perPage
  const showFrontMatterSpread = pages.length === 2 && left === 0 && !!recipes?.length
  const first = right === 1
  return <>
    {(left > 0 || showFrontMatterSpread) && <JournalFacingPage className="mm-facing-content--collection mm-page-column">
      {left === 0 ? <PaperCard surface="fresh" className="mm-collection-front-matter">
        <MoriEmblem size={30} />
        <span className="mm-collection-front-matter__label">Cooking journal</span>
        <span className="mm-collection-front-matter__owner">{ownerName}</span>
      </PaperCard> : <div className="mm-collection-heading-space" style={{ height: headingHeight }} aria-hidden="true" />}
      {left > 0 && <h1 className="visually-hidden" ref={titleRef} tabIndex={-1}>Your cooking journal</h1>}
      <div className="mm-page-body mm-collection-body" role="region" aria-label={`Recipe collection page ${left + pageOffset}`} tabIndex={0}>{entries(left + pageOffset)}</div>
    </JournalFacingPage>}
    <section className="recipe-collection mm-page-column" aria-labelledby="collection-heading">
      {/* Keep desktop page capacity independent of the selected spread. */}
      {first || pages.length === 2 ? heading : <nav className="mm-collection-tools" aria-label="Collection navigation">{header}</nav>}
      {!first && left === 0 && <h1 className="visually-hidden" ref={titleRef} tabIndex={-1}>Your cooking journal</h1>}
      <h2 id="collection-heading" className="collection-heading visually-hidden" tabIndex={-1}>Saved recipes{recipes && <span> ({recipes.length})</span>}</h2>
      <div ref={results} className="mm-page-body mm-collection-body" role="region" aria-label={`Recipe collection page ${right + pageOffset}`} tabIndex={0}>
        {status}
        {recipes?.length ? <>
          {entries(right + pageOffset)}
          {hasMore && recipes.length <= rightStart && <p role="status">Opening this collection page…</p>}
          {!hasMore && recipes.length <= rightStart && <Link to="/app/recipes/new" className="mm-empty-slot">+ Add a recipe</Link>}
        </> : empty}
        {endOfResults}
      </div>
    </section>
    {collection && !!recipes?.length && <ul ref={bank} className="recipe-grid mm-collection-entries mm-pagination-measure" aria-hidden="true" inert>
      {recipes.map((recipe, itemIndex) => <RecipeCollectionCardMeasure key={recipe.id} recipe={recipe} folio={itemIndex + 1} />)}
    </ul>}
    <JournalPageFooter><div className="mm-collection-footer">
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">{left > 0 || showFrontMatterSpread ? `Collection pages ${left + pageOffset} and ${right + pageOffset}` : `Collection page ${right}`}</span>
      <JournalPagination label="Collection pages" previous={previous} next={next} rightNumber={left > 0 || showFrontMatterSpread ? `Pages ${left + pageOffset}–${right + pageOffset}` : `Page ${right}`} />
      {pagination}
    </div></JournalPageFooter>
  </>
}
