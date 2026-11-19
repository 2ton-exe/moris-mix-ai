import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { BrandMark } from './BrandMark'
import { MoriEmblem } from './Mori'
import { JournalSurface, PaperCard } from './Scrapbook'
import { DeskStationery } from './DeskStationery'
import { JournalFacingPageContext, JournalPageFooterContext, JournalPaginationContext } from './JournalLayoutContext'
import { JOURNAL_PAGE_TURN_EVENT, JournalPageTurnContext, JournalPageTurnLayer, useJournalPageTurnManager } from './JournalPageTurn'
import type { JournalTurnDirection } from './JournalPageTurn'
import { useJournalMedia } from './useJournalMedia'

const ringPositions = [0.12, 0.18, 0.24, 0.76, 0.82, 0.88]

function PaperHoles({ side }: { side: 'left' | 'right' }) {
  return <div className={`mm-journal-holes mm-journal-holes--${side}`} aria-hidden="true">
    {ringPositions.map((position) => <span key={position} className="mm-journal-hole" style={{ '--mm-ring-y': position } as CSSProperties} />)}
  </div>
}

/** A flowing paper page. Route content keeps its existing semantics and state. */
export function JournalPageContainer({ className = '', children, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={`mm-journal-page mm-surface--parchment ${className}`}>
    <PaperHoles side="right" />
    {children}
  </div>
}

function PublicLinks({ attached = false }: { attached?: boolean }) {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/+$/, '')
  return <nav className={attached ? 'mm-bookmarks' : 'mm-desk-utilities'} aria-label={attached ? 'Journal sections' : 'Public pages'}>
    <Link className="mm-bookmark" to="/home" aria-current={path === '/home' ? 'page' : undefined}>Home</Link>
    <Link className="mm-bookmark mm-bookmark--mustard" to="/about" aria-current={path === '/about' ? 'page' : undefined}>About</Link>
    <Link className="mm-bookmark mm-bookmark--cream" to="/demo-recipe" aria-current={path === '/demo-recipe' ? 'page' : undefined}>Demo recipe</Link>
  </nav>
}

function JournalNavigation() {
  const { pathname, search, hash, state } = useLocation()
  const path = pathname.replace(/\/+$/, '')
  const creating = path === '/app/recipes/new'
  const quickEntry = /^\/app\/quick-entry(?:\/|$)/.test(path)
  const chef = /^\/app\/chef(?:\/|$)/.test(path)
  const collection = path === '/app' || path === '/app/recipes'
  const returnState = collection ? { journalReturn: pathname + search + hash } : undefined
  return <nav className="mm-bookmarks mm-bookmarks--journal" aria-label="Journal sections">
    <Link className="mm-bookmark" to="/app/recipes" aria-current={!creating && !quickEntry && !chef ? 'page' : undefined}>My recipes</Link>
    <Link className="mm-bookmark mm-bookmark--mustard" to="/app/recipes/new" state={creating ? state : returnState} aria-current={creating ? 'page' : undefined}>New recipe</Link>
    <Link className="mm-bookmark mm-bookmark--rose" to="/app/quick-entry" state={path === '/app/quick-entry' ? state : returnState} aria-current={quickEntry ? 'page' : undefined}>Quick AI Entry</Link>
    <Link className="mm-bookmark mm-bookmark--lilac" to="/app/chef" aria-current={chef ? 'page' : undefined}>AI Chef</Link>
  </nav>
}

/** Presentation only: no router, auth, query, snapshot, or animation providers. */
export function JournalShell({ account, children, pageClassName = '', mode = 'journal', publicNavigation = false, ownerName = 'a cook' }: {
  account?: ReactNode; children: ReactNode; pageClassName?: string
  mode?: 'journal' | 'reading' | 'writing' | 'demo'; publicNavigation?: boolean; ownerName?: string
}) {
  const location = useLocation()
  const companionEnabled = !publicNavigation && (location.pathname === '/app' || location.pathname.startsWith('/app/'))
  const bookRef = useRef<HTMLDivElement>(null)
  const [facingPage, setFacingPage] = useState<HTMLDivElement | null>(null)
  const [leftPagination, setLeftPagination] = useState<HTMLDivElement | null>(null)
  const [singlePrevious, setSinglePrevious] = useState<HTMLDivElement | null>(null)
  const [rightPagination, setRightPagination] = useState<HTMLDivElement | null>(null)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const singleLayout = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const pageTurn = useJournalPageTurnManager({ bookRef, pathname: location.pathname, search: location.search, singleLayout, reducedMotion })
  const requestPageTurn = pageTurn.contextValue.requestPageTurn
  useLayoutEffect(() => {
    const book = bookRef.current
    if (!book) return
    const handleRequest = (event: Event) => {
      const request = event as CustomEvent<{ direction: JournalTurnDirection; prepare: () => void; commit: () => void; expectedSearch?: string; cancel?: () => void; handled: boolean; accepted: boolean }>
      request.detail.handled = true
      request.detail.accepted = requestPageTurn(request.detail.direction, request.detail.prepare, request.detail.commit, request.detail.expectedSearch, request.detail.cancel)
    }
    book.addEventListener(JOURNAL_PAGE_TURN_EVENT, handleRequest)
    return () => book.removeEventListener(JOURNAL_PAGE_TURN_EVENT, handleRequest)
  }, [requestPageTurn])
  useLayoutEffect(() => {
    if (!footer || typeof ResizeObserver === 'undefined') return
    const update = () => footer.closest<HTMLElement>('.mm-journal-page')?.style.setProperty('--mm-footer-height', `${footer.offsetHeight}px`)
    const observer = new ResizeObserver(update)
    observer.observe(footer)
    update()
    return () => observer.disconnect()
  }, [footer])
  return <JournalPageTurnContext.Provider value={pageTurn.contextValue}>
  <JournalSurface material="wood" className={`mm-desk mm-desk--${mode}${companionEnabled ? ' mm-desk--with-companion' : ''}`}>
    <DeskStationery />
    <a className="mm-skip-link" href="#journal-content">Skip to journal content</a>
    <header className="mm-desk-toolbar">
      <Link className="mm-desk-brand" to={publicNavigation ? '/home' : '/app/recipes'}><BrandMark /></Link>
      {!publicNavigation && <PublicLinks />}
      {account}
    </header>
    <div className="mm-journal-stage" id="journal">
      <div ref={bookRef} className="mm-journal-book" data-page-turning={pageTurn.isTurning || undefined}>
        <JournalSurface material="leather" className="mm-journal-board mm-journal-board--left" aria-hidden="true" />
        <JournalSurface material="leather" className="mm-journal-board mm-journal-board--right" aria-hidden="true" />
        <div className="mm-journal-binding" aria-hidden="true" />
        <div className="mm-journal-ring-plate" aria-hidden="true" />
        <div className="mm-journal-stack mm-journal-stack--left" aria-hidden="true" />
        <div className="mm-journal-stack mm-journal-stack--right" aria-hidden="true" />
        <main className="mm-journal-spread" id="journal-content" tabIndex={-1} inert={pageTurn.isTurning} aria-busy={pageTurn.isTurning || undefined}>
          <section className="mm-journal-flyleaf" aria-label="Facing journal page" tabIndex={0}>
            <PaperCard className="mm-bookplate" surface="fresh">
              <MoriEmblem size={46} />
              <span className="mm-bookplate__ex-libris">Cooking journal</span>
              <p>This journal belongs to</p>
              <p className="mm-bookplate__title">{ownerName}</p>
              <span className="mm-bookplate__rule" aria-hidden="true" />
            </PaperCard>
            <PaperHoles side="left" />
            <div ref={setFacingPage} className="mm-facing-slot" />
            <div ref={setLeftPagination} className="mm-pagination-slot mm-pagination-slot--left" />
          </section>
          <JournalPageContainer role="region" aria-label="Journal entries" tabIndex={0} className={pageClassName}>
            {publicNavigation ? <PublicLinks attached /> : <JournalNavigation />}
            <JournalFacingPageContext.Provider value={facingPage}>
              <JournalPageFooterContext.Provider value={footer}>
                <JournalPaginationContext.Provider value={{ left: singleLayout ? singlePrevious : leftPagination, right: rightPagination }}>{children}</JournalPaginationContext.Provider>
              </JournalPageFooterContext.Provider>
            </JournalFacingPageContext.Provider>
            <div className="mm-journal-page-footer">
              <div ref={setFooter} className="mm-footer-actions" />
              <div className="mm-pagination-band"><div ref={setSinglePrevious} className="mm-pagination-single-previous" /><div ref={setRightPagination} className="mm-pagination-slot mm-pagination-slot--right" /></div>
            </div>
          </JournalPageContainer>
        </main>
        <JournalPageTurnLayer turn={pageTurn.turn} />
        <div className="mm-journal-rings" aria-hidden="true">
          {ringPositions.map((position) => <span key={position} className="mm-journal-ring" style={{ '--mm-ring-y': position } as CSSProperties}><span className="mm-journal-ring__half mm-journal-ring__half--left" /><span className="mm-journal-ring__half mm-journal-ring__half--right" /></span>)}
        </div>
      </div>
    </div>
    {/* Portalled confirmations stay above the physical leaves and rings. */}
    <div id="journal-overlays" />
  </JournalSurface>
  </JournalPageTurnContext.Provider>
}
