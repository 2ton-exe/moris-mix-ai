import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BrandMark } from './BrandMark'
import { KitchenBackground } from './KitchenBackground'
import { Mori, MoriEmblem, type MoriMood } from './Mori'
import { JournalSurface, PaperCard, PaperClip, Tape } from './Scrapbook'

export function JournalAuthScene({ children }: { children: ReactNode }) {
  return <div className="mm-auth-desk">
    <KitchenBackground />
    <header className="mm-auth-toolbar">
      <Link className="mm-auth-brand" to="/demo-recipe" aria-label="MORI'S MIX, view a demonstration recipe">
        <BrandMark />
      </Link>
    </header>
    <div className="mm-auth-stage">
      {children}
      <JournalCover />
    </div>
  </div>
}

function JournalCover() {
  return <JournalSurface material="leather" className="mm-auth-cover" aria-hidden="true">
    <span className="mm-auth-cover__seam" />
    <span className="mm-auth-cover__spine" />
    <span className="mm-auth-cover__corners" />
    <span className="mm-auth-cover__mark"><MoriEmblem size={76} /><span>MORI'S MIX</span><span>A COOKING JOURNAL</span></span>
    <span className="mm-auth-cover__elastic" />
    <span className="mm-auth-cover__bookmark" />
  </JournalSurface>
}

export function JournalAuthCard({
  eyebrow,
  title,
  description,
  mood = 'happy',
  focusHeading = false,
  children,
}: {
  eyebrow?: string
  title?: string
  description?: ReactNode
  mood?: MoriMood
  focusHeading?: boolean
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusHeading) heading.current?.focus()
  }, [focusHeading, title])
  return <PaperCard className="mm-auth-card" surface="parchment">
    <Tape variant="sage" className="mm-auth-card__tape" />
    <PaperClip className="mm-auth-card__clip" />
    <div className="mm-auth-card__heading">
      <div className="mm-auth-card__heading-copy">
        {eyebrow && <p className="mm-auth-card__eyebrow">{eyebrow}</p>}
        {title && <h1 ref={heading} tabIndex={focusHeading ? -1 : undefined}>{title}</h1>}
        {description && <div className="mm-auth-card__description">{description}</div>}
      </div>
      <Mori mood={mood} size={62} label="Mori, the little chef" animated />
    </div>
    <div className="mm-auth-card__content">{children}</div>
  </PaperCard>
}

export function JournalAuthFooter({ children }: { children: ReactNode }) {
  return <div className="mm-auth-card__footer">{children}</div>
}
