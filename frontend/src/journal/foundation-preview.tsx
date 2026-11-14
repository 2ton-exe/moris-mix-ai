// Development-only gallery. This HTML entry is not a production build input.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrandMark } from './BrandMark'
import { Mori, MoriEmblem } from './Mori'
import type { MoriMood } from './Mori'
import { JournalSurface, PaperCard, PaperClip, ScrapbookButton, ScrapLabel, Stamp, Tape } from './Scrapbook'
import type { PaperSurface, TapeVariant } from './Scrapbook'
import '../styles.css'
import './foundation.css'
import './foundation-preview.css'

const surfaces: PaperSurface[] = ['parchment', 'fresh', 'kraft', 'ruled']
const tapes: TapeVariant[] = ['masking', 'sage', 'mustard', 'burgundy', 'cream']
const moods: MoriMood[] = ['happy', 'wave', 'cheer', 'stir', 'think', 'worried', 'sleep']

export default function FoundationPreview() {
  const [pressed, setPressed] = useState(0)
  const [animated, setAnimated] = useState(false)
  return <JournalSurface material="wood" className="mm-preview">
    <main className="mm-preview__content">
      <JournalSurface material="leather" className="mm-preview__header">
        <BrandMark />
        <h1>A journal, piece by piece.</h1>
        <p>Paper, ink, and a little company in the kitchen.</p>
        <span className="mm-preview__caption">Phase A · Visual foundation preview</span>
      </JournalSurface>
      <section className="mm-preview__grid" aria-label="Paper surfaces">
        {surfaces.map((surface, index) => <PaperCard key={surface} surface={surface} tape={tapes[index]}>
          <ScrapLabel tone={index % 2 ? 'mustard' : 'sage'}>{surface}</ScrapLabel>
          <h2>A place for small discoveries</h2>
          <p>Keep the details that make a meal your own. Warm paper, a clear heading, and room to write.</p>
          <p className="mm-handwriting">A pinch of this, a little of that.</p>
        </PaperCard>)}
      </section>
      <PaperCard surface="fresh" className="mm-preview__stationery">
        <PaperClip />
        <h2>The finishing touches</h2>
        <div className="mm-preview__tapes" aria-label="Tape samples">
          {tapes.map((variant) => <div key={variant}><Tape variant={variant} /><span>{variant}</span></div>)}
        </div>
        <div className="mm-preview__row">
          <ScrapLabel>Kitchen notes</ScrapLabel>
          <ScrapLabel tone="mustard">Worth keeping</ScrapLabel>
          <ScrapLabel tone="burgundy">Personal favorite</ScrapLabel>
        </div>
        <div className="mm-preview__row">
          <Stamp>Made with care</Stamp><Stamp tone="sage">Tried & loved</Stamp><Stamp tone="ink">From my kitchen</Stamp>
        </div>
        <div className="mm-preview__row">
          <ScrapbookButton onClick={() => setPressed((value) => value + 1)}>Try a button</ScrapbookButton>
          <ScrapbookButton tone="paper" onClick={() => setPressed(0)}>Reset counter</ScrapbookButton>
          <ScrapbookButton tone="sage" aria-pressed={animated} onClick={() => setAnimated((value) => !value)}>
            {animated ? 'Pause Mori' : 'Animate Mori'}
          </ScrapbookButton>
          <ScrapbookButton disabled>Disabled button</ScrapbookButton>
        </div>
        <p role="status">Button presses: {pressed}</p>
      </PaperCard>
      <PaperCard surface="parchment" tape="cream">
        <h2>A little company from Mori</h2>
        <p>Our rat chef, ready for the next page.</p>
        <div className="mm-preview__moods">
          {moods.map((mood) => <figure key={mood}>
            <Mori mood={mood} size={94} label={`Mori, ${mood}`} animated={animated} />
            <figcaption>{mood}</figcaption>
          </figure>)}
          <figure><MoriEmblem size={64} /><figcaption>Emblem</figcaption></figure>
        </div>
      </PaperCard>
    </main>
  </JournalSurface>
}

if (import.meta.env.DEV) {
  const element = document.getElementById('root')
  if (element) createRoot(element).render(<FoundationPreview />)
}
