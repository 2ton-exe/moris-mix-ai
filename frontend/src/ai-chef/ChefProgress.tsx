import { ScrapbookSticker } from '../journal/ScrapbookSticker'
import { PaperCard } from '../journal/Scrapbook'

export type ChefProgressStage = 'pantry' | 'generating' | 'review' | 'saved'

const steps = ['Pantry', 'Review idea', 'Your journal']

export function ChefProgress({ stage, scrapbook = false }: { stage: ChefProgressStage; scrapbook?: boolean }) {
  const current = stage === 'review' ? 1 : stage === 'saved' ? 2 : 0

  return <PaperCard className={`mm-ai-chef__journey${scrapbook ? ' mm-ai-chef__journey--scrapbook' : ''}`} surface="fresh" tape="sage">
    {scrapbook && <ScrapbookSticker decorative className="mm-ai-chef__mixing-sticker" name="mixing-bowl" />}
    <h2>From pantry to plate{scrapbook && <ScrapbookSticker decorative name="scrapbook-hearts" />}</h2>
    <ol aria-label="AI Chef progress">
      {steps.map((label, index) => <li key={label} className={index < current ? 'is-complete' : undefined} aria-current={index === current ? 'step' : undefined}>
        <span className="mm-ai-chef__journey-mark" aria-hidden="true">{index < current ? '✓' : index + 1}</span>
        <span>{index < current && <span className="visually-hidden">Completed: </span>}{stage === 'generating' && index === current ? 'Preparing your recipe…' : label}</span>
      </li>)}
    </ol>
    {scrapbook && <ScrapbookSticker decorative className="mm-ai-chef__basket-sticker" name="ingredient-basket" />}
  </PaperCard>
}
