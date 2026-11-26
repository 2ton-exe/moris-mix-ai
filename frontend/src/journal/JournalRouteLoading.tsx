import { Link, useLocation } from 'react-router'
import { LoadingState } from '../components/LoadingState'
import { RecipeEditorSkeleton } from '../recipe-form/RecipeEditorSkeleton'
import { RecipeCollectionPages } from '../recipes/RecipeCollectionPages'
import { RecipeReadingSkeleton, RecipeSkeleton } from '../recipes/RecipeStates'
import { PaperCard } from './Scrapbook'
import { QuickAiEntryGuide, QuickAiEntryHeading, quickAiNotesHelp } from '../quick-ai/QuickAiEntryScaffold'
import { JournalPagination } from './JournalPagination'
import { JournalFacingPage, JournalPageFooter } from './JournalFacingPage'
import { useJournalMedia } from './useJournalMedia'
import '../pages/recipeRevisionSample.css'

export function JournalRouteLoading({ message }: { message: string }) {
  const { pathname, search } = useLocation()
  const desktop = useJournalMedia('(min-width: 1100px) and (min-height: 640px)')
  if (pathname === '/demo-recipe' || /^\/app\/recipes\/[^/]+$/.test(pathname) && !pathname.endsWith('/new')) {
    const demo = pathname === '/demo-recipe'
    return <RecipeReadingSkeleton publicDemo={demo} back={<Link to={demo ? '/home' : '/app'}>{demo ? 'Back home' : 'Back to recipes'}</Link>} />
  }
  if (pathname === '/app' || pathname === '/app/recipes') {
    const index = new URLSearchParams(search).get('view') === 'index'
    return <RecipeCollectionPages pages={[1]} perPage={3} index={index} hasMore={false} ownerName="a cook" sort="newest" titleRef={null}
      header={<div className="mm-collection-tools" aria-hidden="true" inert><span className={`button ${index ? 'button-secondary' : 'button-primary'} mm-button--small`}>{index ? 'Browse saved recipes' : 'Search saved recipes'}<kbd className="mm-search-shortcut">/</kbd></span><span className="button button-secondary mm-button--ghost mm-button--small">Refreshing…</span></div>}
      controls={<div className="mm-loading-fields" aria-hidden="true"><span className="mm-skeleton-line mm-skeleton-field" /><span className="mm-skeleton-line mm-skeleton-field" /></div>}
      status={<RecipeSkeleton index={index} />} endOfResults={null} pagination={null} previous={null} next={null} empty={null} />
  }
  if (pathname.endsWith('/try-a-revision')) return <><span className="visually-hidden" role="status">{message}</span>
    <JournalFacingPage className="mm-facing-content--revision-sample"><section className="mm-revision-sample" aria-hidden="true" inert><span className="mm-skeleton-line mm-skeleton-action" /><header><p>Original recipe</p><h1><span className="mm-skeleton-line" /></h1></header><ul className="mm-revision-sample__ingredients">{[0, 1, 2, 3].map(row => <li key={row}><span className="mm-skeleton-line" /></li>)}</ul><p><span className="mm-skeleton-line" /></p></section></JournalFacingPage>
    <div className="mm-revision-sample" aria-busy="true" aria-hidden="true" inert><header><h2>Try a revision</h2><p><span className="mm-skeleton-line" /></p></header><div className="mm-revision-sample__choices">{[0, 1].map(row => <span key={row} className="mm-skeleton-line mm-skeleton-action" />)}</div><section className="mm-revision-sample__draft"><h3>Sample draft</h3><p><span className="mm-skeleton-line" /></p></section></div>
  </>
  if (/\/recipes\/.+\/edit$/.test(pathname) || pathname.endsWith('/new') || pathname.endsWith('/review')) {
    const extractionReview = desktop && pathname === '/app/quick-entry/review'
    return <RecipeEditorSkeleton message={message} extractionReview={extractionReview}
      title={pathname.endsWith('/new') ? 'New recipe' : extractionReview ? 'Review your recipe' : pathname.endsWith('/review') ? 'Review recipe' : 'Edit recipe'} />
  }
  if (desktop && pathname === '/app/quick-entry') return <>
    <span role="status" className="visually-hidden">{message}</span>
    <JournalFacingPage className="mm-facing-content--quick-ai mm-facing-content--quick-ai-task"><div aria-hidden="true" inert><QuickAiEntryGuide /></div></JournalFacingPage>
    <section className="mm-quick-ai mm-page-column" aria-busy="true" aria-hidden="true" inert>
      <QuickAiEntryHeading />
      <nav className="mm-quick-ai__back"><Link to="/app"><span aria-hidden="true">←</span> Back to journal</Link></nav>
      <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__sheet">
        <form>
          <div className="mm-quick-ai__field">
            <label htmlFor="loading-cooking-notes">Cooking notes</label>
            <textarea id="loading-cooking-notes" className="mm-quick-ai__textarea mm-skeleton-block" rows={3} disabled />
            <div className="mm-quick-ai__field-meta">
              <p className="mm-quick-ai__helper">{quickAiNotesHelp}</p>
              <p className="mm-quick-ai__count">0 / 10,000</p>
            </div>
          </div>
          <div className="mm-quick-ai__actions"><button type="button" className="button button-primary" disabled>Organize my notes</button></div>
        </form>
      </PaperCard>
    </section>
    <JournalPageFooter><JournalPagination loading label="Cooking notes pages" rightNumber="Page 1 of 1" /></JournalPageFooter>
  </>
  if (pathname === '/app/quick-entry' || pathname === '/app/chef') {
    const notes = pathname.endsWith('/quick-entry')
    const title = notes ? 'Quick AI Entry' : 'What’s in your pantry?'
    return <><span className="visually-hidden" role="status">{message}</span>
      <JournalFacingPage className="mm-page-column"><div className="mm-loading-fields" aria-hidden="true"><h1>{notes ? 'Your cooking notes' : 'Your pantry'}</h1><span className="mm-skeleton-line" /><span className="mm-skeleton-block mm-skeleton-notes" /></div></JournalFacingPage>
      <section className="mm-page-column" aria-busy="true"><div className="mm-loading-fields" aria-hidden="true" inert><h1>{title}</h1><span className="mm-skeleton-line" /><span className="mm-skeleton-block mm-skeleton-notes" /><span className="mm-skeleton-line mm-skeleton-action" /></div></section>
    </>
  }
  if (pathname === '/home' || pathname === '/about') {
    const home = pathname === '/home'
    const actions = <div className="actions"><span className="mm-skeleton-line mm-skeleton-action" /><span className="mm-skeleton-line mm-skeleton-action" /></div>
    const note = <section className={`mm-public-note ${home ? 'mm-public-preview' : 'mm-public-workflow'}`}><h2><span className="mm-skeleton-line" /></h2><p><span className="mm-skeleton-line" /></p><p><span className="mm-skeleton-line mm-skeleton-line--short" /></p></section>
    if (desktop) return <><span className="visually-hidden" role="status">{message}</span>
      <JournalFacingPage className="mm-facing-content--public mm-public-page"><div aria-busy="true" aria-hidden="true" inert>
        <h1>{home ? 'Good meals deserve a page.' : 'Keep your recipes close.'}</h1>
        <p className="intro"><span className="mm-skeleton-line" /><span className="mm-skeleton-line" /></p>
        {!home && note}{actions}
      </div></JournalFacingPage>
      <div aria-busy="true" aria-hidden="true" inert>{note}</div>
    </>
    return <><span className="visually-hidden" role="status">{message}</span><div aria-busy="true" aria-hidden="true" inert><h1><span className="mm-skeleton-line" /></h1><p className="intro"><span className="mm-skeleton-line" /><span className="mm-skeleton-line" /></p>{home && actions}{note}{!home && <>{note}{actions}</>}</div></>
  }
  if (pathname === '/login' || pathname === '/signup') {
    const signup = pathname === '/signup'
    const fields = signup ? ['Email', 'Password', 'Confirm password'] : ['Email', 'Password']
    return <><span className="visually-hidden" role="status">{message}</span><div className="auth-form mm-loading-fields" aria-busy="true" aria-hidden="true" inert><h1>{signup ? 'Create your account' : 'Welcome back'}</h1><p><span className="mm-skeleton-line" /></p>{fields.map(label => <div className="auth-field" key={label}><span>{label}</span><span className="mm-skeleton-line mm-skeleton-field" /></div>)}<span className="mm-skeleton-line mm-skeleton-action" /></div></>
  }
  if (pathname === '/auth/callback' || pathname === '/verify-email') return <LoadingState message={message} />
  return <><span className="visually-hidden" role="status">{message}</span><div aria-busy="true" aria-hidden="true" inert>
    <h1><span className="mm-skeleton-line" /></h1>
    <p className="intro"><span className="mm-skeleton-line" /></p>
    <div className="actions"><span className="mm-skeleton-line mm-skeleton-action" /><span className="mm-skeleton-line mm-skeleton-action" /></div>
  </div></>
}
