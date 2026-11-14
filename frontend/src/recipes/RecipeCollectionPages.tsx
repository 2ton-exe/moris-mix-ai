import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { RecipeCard } from './RecipeCard'
import type { RecipeSummary } from './types'

export function RecipeCollectionPages({ recipes, pages, perPage, index, header, controls, status, pagination, turns, titleRef, empty, hasMore, ownerName, sort }: {
  recipes?: RecipeSummary[]; pages: number[]; perPage: number; index: boolean
  header: ReactNode; controls: ReactNode; status: ReactNode; pagination: ReactNode; turns: ReactNode
  titleRef: Ref<HTMLHeadingElement>; empty: ReactNode
  hasMore: boolean; ownerName: string; sort: 'newest' | 'rating'
}) {
  const heading = <header className="mm-collection-heading">
    <p className="mm-recipe-index__eyebrow">{index ? 'Index insert' : `${recipes?.length ?? 0} scraps${hasMore ? ' loaded' : ''} · ${sort === 'rating' ? 'rating order' : 'newest first'}`}</p>
    <h1 ref={titleRef} tabIndex={-1}>{index ? 'Recipe index' : 'Your cooking journal'}</h1>
    {!index && <span className="mm-title-swash" aria-hidden="true" />}
    {!index && <p className="mm-collection-owner">This journal belongs to {ownerName}. A place for the meals that become yours.</p>}
    {header}
  </header>
  const entries = (page: number) => {
    const offset = (page - 1) * perPage
    return <ul className="recipe-grid mm-collection-entries" aria-label={`Recipes on page ${page}`}>
      {recipes?.slice(offset, offset + perPage).map((recipe, i) => <RecipeCard key={recipe.id} recipe={recipe} folio={offset + i + 1} />)}
    </ul>
  }
  if (index) return <>
    <JournalFacingPage className="mm-facing-content--index mm-page-column">
      {heading}
      <div className="mm-page-body" role="region" aria-label="Recipe search controls" tabIndex={0}>{controls}</div>
    </JournalFacingPage>
    <section className="recipe-collection mm-page-column" aria-labelledby="collection-heading">
      <h2 id="collection-heading" className="collection-heading" tabIndex={-1}>Saved recipes <span>({recipes?.length ?? 0})</span></h2>
      <div className="mm-page-body mm-index-results" role="region" aria-label="Recipe index results" tabIndex={0}>
        {status}
        {recipes?.length ? <ul className="recipe-grid mm-index-entries">{recipes.map((recipe, i) => <RecipeCard key={recipe.id} recipe={recipe} folio={i + 1} indexCard />)}</ul> : empty}
      </div>
    </section>
    <JournalPageFooter><div className="mm-collection-footer">{pagination}</div></JournalPageFooter>
  </>
  const [left, right] = pages.length === 2 ? pages : [0, pages[0]]
  const first = right === 1
  return <>
    {left > 0 && <JournalFacingPage className="mm-facing-content--collection mm-page-column">
      <h1 className="visually-hidden" ref={titleRef} tabIndex={-1}>Your cooking journal</h1>
      <div className="mm-page-body mm-collection-body" role="region" aria-label={`Recipe collection page ${left}`} tabIndex={0}>{entries(left)}</div>
      <span className="mm-recipe-page-number mm-collection-left-number" aria-hidden="true">p. {left}</span>
    </JournalFacingPage>}
    <section className="recipe-collection mm-page-column" aria-labelledby="collection-heading">
      {first && heading}
      {!first && left === 0 && <h1 className="visually-hidden" ref={titleRef} tabIndex={-1}>Your cooking journal</h1>}
      <h2 id="collection-heading" className="collection-heading visually-hidden" tabIndex={-1}>Saved recipes <span>({recipes?.length ?? 0})</span></h2>
      <div className="mm-page-body mm-collection-body" role="region" aria-label={`Recipe collection page ${right}`} tabIndex={0}>
        {status}
        {recipes?.length ? <>
          {entries(right)}
          {hasMore && recipes.length < right * perPage && <p role="status">Opening this collection page…</p>}
          {!hasMore && recipes.length < right * perPage && <Link to="/app/recipes/new" className="mm-empty-slot">+ Room for your next scrap</Link>}
        </> : empty}
      </div>
    </section>
    <JournalPageFooter><div className="mm-collection-footer">
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">{left > 0 ? `Collection pages ${left} and ${right}` : `Collection page ${right}`}</span>
      <nav className="mm-page-turns" aria-label="Recipe index pages">{turns}<span className="mm-recipe-page-number" aria-hidden="true">p. {right}</span></nav>
      {pagination}
    </div></JournalPageFooter>
  </>
}
