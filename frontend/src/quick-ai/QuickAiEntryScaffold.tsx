import type { ReactNode } from 'react'
import { PaperCard } from '../journal/Scrapbook'
import './quickAiEntry.css'

export const quickAiNotesHelp = 'Notes stay in this tab.'

export function QuickAiEntryGuide({ recovery }: { recovery?: ReactNode }) {
  return <section className="mm-quick-ai__support" aria-labelledby="quick-ai-support-title">
    {recovery ? <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__journey mm-quick-ai__recovery">
      <h2 id="quick-ai-support-title">Before you try again</h2>
      {recovery}
    </PaperCard> : <>
      <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__journey">
        <h2 id="quick-ai-support-title">From notes to recipe</h2>
        <ol className="mm-quick-ai__steps">
          <li><span><strong>Write</strong> the ingredients and steps you remember.</span></li>
          <li><span><strong>Review</strong> the draft and make any changes.</span></li>
          <li><span><strong>Choose</strong> when to save it to your journal.</span></li>
        </ol>
      </PaperCard>
      <PaperCard surface="fresh" tape="sage" className="mm-quick-ai__example">
        <h2>Example cooking notes</h2>
        <p>Fried two eggs with garlic, then tossed them with leftover rice and a splash of soy sauce.</p>
      </PaperCard>
    </>}
  </section>
}

export function QuickAiEntryHeading() {
  return <header className="mm-quick-ai-intro mm-quick-ai-intro--task">
    <h1 tabIndex={-1}>Quick AI Entry</h1>
    <p className="mm-quick-ai-intro__copy">Write what you cooked, including amounts and steps you remember. You can review and edit the draft before saving it.</p>
  </header>
}
