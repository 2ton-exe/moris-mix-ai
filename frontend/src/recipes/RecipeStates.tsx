import { useLayoutEffect, useRef, useState, type Ref, type ReactNode } from 'react'
import { HttpError } from '../api/http'
import { retryAfterMessage } from '../api/retryAfter'
import { InvalidRecipeData } from './validation'
import { ErrorState } from '../components/ErrorState'
import { RecipeCollectionCardContent, RecipeIndexCardContent } from './RecipeCard'
import { RecipeIdentity } from './RecipeIdentity'
import { RecipeScrapArtwork } from './RecipeScrapArtwork'
import { JournalFacingPage, JournalPageFooter } from '../journal/JournalFacingPage'
import { JournalPagination } from '../journal/JournalPagination'
import { useJournalMedia } from '../journal/useJournalMedia'
import { PaperClip } from '../journal/Scrapbook'
import { RecipeIntegrationUnavailable } from './source'

export function RecipeError({ error, onRetry, detail = false, retryButtonRef }: {
  error: Error
  onRetry: () => void
  detail?: boolean
  retryButtonRef?: Ref<HTMLButtonElement>
}) {
  let message = detail ? 'Could not load this recipe. Please try again.' : 'Could not load your recipes. Please try again.'
  let canRetry = true
  if (error instanceof InvalidRecipeData || (error instanceof HttpError && error.kind === 'invalid-json')) {
    message = `${detail ? 'Could not load this recipe.' : 'Could not load your recipes.'} The returned information could not be checked safely. Please try again.`
  }
  if (error instanceof RecipeIntegrationUnavailable) {
    message = 'Your recipe journal is not connected yet. Please check back soon. You can still explore the demonstration recipe.'
    return <div className="request-state request-error"><p role="status">{message}</p></div>
  } else if (error instanceof HttpError) {
    if (error.status === 401) {
      message = 'Your session could not be verified. Please log out and sign in again.'
      canRetry = false
    } else if (error.status === 403) {
      message = detail ? 'You do not have permission to view this recipe.' : 'You do not have permission to view this collection.'
      canRetry = false
    } else if (error.status === 404) {
      message = detail ? 'This recipe could not be found. It may have been removed or may not be available to you.' : 'Your recipe collection is currently unavailable.'
      canRetry = false
    } else if (error.status === 429) {
      message = `The recipe service is temporarily limited. ${retryAfterMessage(error.retryAfter)}`
    } else if (error.kind === 'configuration') {
      message = 'The recipe service is not configured. Please contact the site owner.'
      canRetry = false
    }
  }
  return <ErrorState message={message} onRetry={canRetry ? onRetry : undefined} retryButtonRef={retryButtonRef} />
}

export function RecipeSkeleton({ index = false }: { index?: boolean }) {
  const list = useRef<HTMLUListElement>(null)
  const [count, setCount] = useState(3)
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  useLayoutEffect(() => {
    const element = list.current
    const body = element?.closest('.mm-page-body')
    if (!element || !body || single || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const row = element.firstElementChild
      if (!row) return
      const style = getComputedStyle(element)
      const gap = parseFloat(style.rowGap) || 0
      const available = body.getBoundingClientRect().bottom - element.getBoundingClientRect().top - (parseFloat(style.paddingBottom) || 0)
      const rowHeight = row.getBoundingClientRect().height
      if (rowHeight > 0) setCount(Math.max(1, Math.min(3, Math.floor((available + gap) / (rowHeight + gap)))))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [single, index])
  return <div className="recipe-loading" role="status">
    <span className="visually-hidden">Loading your recipes…</span>
    <ul ref={list} className={`recipe-grid ${index ? 'mm-index-entries' : 'mm-collection-entries'}`} aria-hidden="true" inert>
      {Array.from({ length: single ? 1 : count }, (_, offset) => <li className="mm-recipe-card-slot" key={offset}>
        <div className={`${index ? 'mm-index-card' : `mm-collection-entry${offset % 2 ? ' is-flipped' : ''}`} mm-skeleton-card`}>
          {index ? <RecipeIndexCardContent /> : <RecipeCollectionCardContent folio={offset + 1} />}
        </div>
      </li>)}
    </ul>
  </div>
}

export function RecipeReadingSkeleton({ back, publicDemo = false }: { back: ReactNode; publicDemo?: boolean }) {
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  return <><span className="visually-hidden" role="status">{publicDemo ? 'Loading demonstration recipe…' : 'Loading recipe…'}</span><article className="journal-recipe mm-recipe-detail__article mm-page-column mm-continuation mm-reading-skeleton" aria-busy="true">
    <JournalFacingPage className="mm-facing-content--recipe mm-page-column mm-continuation-facing">
      <nav className="recipe-back mm-recipe-detail__back" aria-label="Recipe navigation"><span className="mm-back-clip"><PaperClip />{back}</span></nav>
      <div className="mm-continuation-body mm-continuation-left">
        <RecipeIdentitySkeleton publicDemo={publicDemo} />
      </div>
    </JournalFacingPage>
    <div className="mm-reading-running-head">{single ? <span className="mm-reading-return">{back}</span> : 'From your journal'}</div>
    <div className="mm-reading-request-status" />
    <div className="mm-continuation-body mm-continuation-right">
      <div className="mm-skeleton-mobile-identity"><RecipeIdentitySkeleton publicDemo={publicDemo} /></div>
      <div className="mm-reading-page-content" aria-hidden="true">
        {['Ingredients', publicDemo ? 'Instructions' : 'In the kitchen'].map(heading => <section className="mm-unit-group" key={heading}>
          <div className="mm-reading-unit"><div className="mm-section-heading mm-unit-heading"><h2>{heading}</h2></div>
            <div className="mm-unit-content mm-skeleton-copy">{Array.from({ length: 4 }, (_, index) => <p key={index}><span className="mm-skeleton-line" /></p>)}</div>
          </div>
        </section>)}
      </div>
    </div>
    <JournalPageFooter>
      {!publicDemo && <div className="mm-footer-actions" aria-hidden="true"><div className="mm-reading-footer"><span className="mm-skeleton-line mm-skeleton-action" /></div></div>}
      <JournalPagination loading label="Recipe reading pages" rightNumber={<span className="mm-skeleton-line mm-skeleton-action" />} />
    </JournalPageFooter>
  </article></>
}

function RecipeIdentitySkeleton({ publicDemo }: { publicDemo: boolean }) {
  return <RecipeIdentity publicDemo={publicDemo} loading
    artwork={<RecipeScrapArtwork title="" size="detail" loading />}
    title={<span className="mm-skeleton-line" />}
    metadata={<div className="mm-recipe-metadata"><span className="mm-skeleton-line mm-skeleton-line--short" /></div>} />
}
