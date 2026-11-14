import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { JournalCompanionContext, JournalFacingPageContext, JournalPageFooterContext } from './JournalLayoutContext'

/** One live copy of the route's facing-page content, also used in single-page flow. */
export function JournalFacingPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  const destination = useContext(JournalFacingPageContext)
  const contentRef = useRef<HTMLDivElement>(null)
  // The facing slot is attached after the shell's first commit. Moving its
  // content into the portal can detach a route's newly focused heading.
  useLayoutEffect(() => {
    if (destination && document.activeElement === document.body) {
      contentRef.current?.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus()
    }
  }, [destination])
  const content = <div ref={contentRef} className={`mm-facing-content ${className}`}>{children}</div>
  return destination ? createPortal(content, destination) : content
}

export function JournalCompanion({ children }: { children: ReactNode }) {
  const destination = useContext(JournalCompanionContext)
  return destination ? createPortal(children, destination) : children
}

/** One footer, outside desktop body scroll regions and sticky in single-page flow. */
export function JournalPageFooter({ children }: { children: ReactNode }) {
  const destination = useContext(JournalPageFooterContext)
  return destination ? createPortal(children, destination) : <div className="mm-page-footer">{children}</div>
}
