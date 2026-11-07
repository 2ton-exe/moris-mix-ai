import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { BookOpen, House, Info, NotebookPen } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { MoriEmblem } from './Mori'
import { TalkToMoriBookmark } from './TalkToMoriBookmark'
import { JournalSurface, PaperCard } from './Scrapbook'
import { DeskStationery } from './DeskStationery'
import { JournalCompanionContext, JournalFacingPageContext, JournalPageFooterContext } from './JournalLayoutContext'
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
    {children}
  </div>
}

function JournalBookmarks({ publicNavigation = false }: { publicNavigation?: boolean }) {
  const location = useLocation()
  const { pathname } = location
  const creating = pathname === '/app/recipes/new'
  const editing = /^\/app\/recipes\/[^/]+\/edit\/?$/.test(pathname)
  const aiWorkflow = /^\/app\/(?:quick-entry|chef)(?:\/|$)/.test(pathname)
  const className = 'mm-bookmarks'
  if (publicNavigation) return <nav className={className} aria-label="Journal sections">
    <Link className="mm-bookmark" to="/home" aria-current={pathname === '/home' ? 'page' : undefined}><House size={16} aria-hidden="true" />Home</Link>
    <Link className="mm-bookmark mm-bookmark--mustard" to="/about" aria-current={pathname === '/about' ? 'page' : undefined}><Info size={16} aria-hidden="true" />About</Link>
    <Link className="mm-bookmark mm-bookmark--cream" to="/demo-recipe" aria-current={pathname === '/demo-recipe' ? 'page' : undefined}><BookOpen size={16} aria-hidden="true" />Demo recipe</Link>
  </nav>
  return <nav className={className} aria-label="Journal sections">
    <Link className="mm-bookmark" to="/app/recipes" aria-current={!creating && !editing && !aiWorkflow ? 'page' : undefined}><BookOpen size={16} aria-hidden="true" />My recipes</Link>
    <TalkToMoriBookmark />
    <Link className="mm-bookmark mm-bookmark--mustard" to="/app/recipes/new" aria-current={creating ? 'page' : undefined}><NotebookPen size={16} aria-hidden="true" />New recipe</Link>
  </nav>
}

/** Presentation only: no router, auth, query, snapshot, or animation providers. */
export function JournalShell({ account, children, pageClassName = '', mode = 'journal', publicNavigation = false, ownerName = 'a cook' }: {
  account?: ReactNode; children: ReactNode; pageClassName?: string
  mode?: 'journal' | 'reading' | 'writing' | 'demo'; publicNavigation?: boolean; ownerName?: string
}) {
  const location = useLocation()
  const bookRef = useRef<HTMLDivElement>(null)
  const [facingPage, setFacingPage] = useState<HTMLDivElement | null>(null)
  const [companion, setCompanion] = useState<HTMLDivElement | null>(null)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const singleLayout = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const pageTurn = useJournalPageTurnManager({ bookRef, pathname: location.pathname, search: location.search, singleLayout, reducedMotion })
  const requestPageTurn = pageTurn.contextValue.requestPageTurn
  useLayoutEffect(() => {
    const book = bookRef.current
    if (!book) return
    const handleRequest = (event: Event) => {
      const request = event as CustomEvent<{ direction: JournalTurnDirection; commit: () => void; expectedSearch?: string; handled: boolean; accepted: boolean }>
      request.detail.handled = true
      request.detail.accepted = requestPageTurn(request.detail.direction, request.detail.commit, request.detail.expectedSearch)
    }
    book.addEventListener(JOURNAL_PAGE_TURN_EVENT, handleRequest)
    return () => book.removeEventListener(JOURNAL_PAGE_TURN_EVENT, handleRequest)
  }, [requestPageTurn])
  useLayoutEffect(() => {
    if (!footer || typeof ResizeObserver === 'undefined') return
    const update = () => footer.parentElement?.style.setProperty('--mm-footer-height', `${footer.offsetHeight}px`)
    const observer = new ResizeObserver(update)
    observer.observe(footer)
    update()
    return () => observer.disconnect()
  }, [footer])
  return <JournalPageTurnContext.Provider value={pageTurn.contextValue}>
  <JournalSurface material="wood" className={`mm-desk mm-desk--${mode}`}>
    <DeskStationery />
    <a className="mm-skip-link" href="#journal-content">Skip to journal content</a>
    <header className="mm-desk-toolbar">
      <Link className="mm-desk-brand" to={publicNavigation ? '/home' : '/app/recipes'}><BrandMark /></Link>
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
        <JournalBookmarks publicNavigation={publicNavigation} />
        <main className="mm-journal-spread" id="journal-content" tabIndex={-1}>
          <section className="mm-journal-flyleaf" aria-label="Facing journal page" tabIndex={0}>
            <PaperCard className="mm-bookplate" surface="fresh">
              <MoriEmblem size={46} />
              <span className="mm-bookplate__ex-libris">Ex libris</span>
              <p>This journal belongs to</p>
              <p className="mm-bookplate__title">{ownerName}</p>
              <span className="mm-bookplate__rule" aria-hidden="true" />
              <p>Kept with care · MORI'S MIX</p>
            </PaperCard>
            <div ref={setFacingPage} className="mm-facing-slot" />
          </section>
          <JournalPageContainer role="region" aria-label="Journal entries" tabIndex={0} className={pageClassName}>
            <JournalCompanionContext.Provider value={companion}>
              <JournalFacingPageContext.Provider value={facingPage}>
                <JournalPageFooterContext.Provider value={footer}>{children}</JournalPageFooterContext.Provider>
              </JournalFacingPageContext.Provider>
            </JournalCompanionContext.Provider>
          </JournalPageContainer>
          <div ref={setFooter} className="mm-journal-page-footer" />
        </main>
        <PaperHoles side="left" />
        <PaperHoles side="right" />
        <JournalPageTurnLayer turn={pageTurn.turn} finish={pageTurn.finish} />
        <div className="mm-journal-rings" aria-hidden="true">
          {ringPositions.map((position) => <span key={position} className="mm-journal-ring" style={{ '--mm-ring-y': position } as CSSProperties}><span className="mm-journal-ring__half mm-journal-ring__half--left" /><span className="mm-journal-ring__half mm-journal-ring__half--right" /></span>)}
        </div>
      </div>
    </div>
    <div ref={setCompanion} className="mm-desk-companion" />
    {/* Portalled confirmations stay above the physical leaves and rings. */}
    <div id="journal-overlays" />
  </JournalSurface>
  </JournalPageTurnContext.Provider>
}
