import { PaperCard } from '../journal/Scrapbook'
import mixingBowl from '../assets/stickers/mixing-bowl.svg'
import ingredientBasket from '../assets/stickers/ingredient-basket.svg'
import scrapbookHearts from '../assets/stickers/scrapbook-hearts.svg'

export type ChefProgressStage = 'pantry' | 'generating' | 'review' | 'saved'

const steps = ['Pantry', 'Review idea', 'Your journal']

export function ChefProgress({ stage, scrapbook = false }: { stage: ChefProgressStage; scrapbook?: boolean }) {
  const current = stage === 'review' ? 1 : stage === 'saved' ? 2 : 0

  return <PaperCard className={`mm-ai-chef__journey${scrapbook ? ' mm-ai-chef__journey--scrapbook' : ''}`} surface="fresh" tape="sage">
    {scrapbook && <img className="mm-ai-chef__mixing-sticker" src={mixingBowl} alt="" />}
    <h2>From pantry to plate{scrapbook && <img src={scrapbookHearts} alt="" />}</h2>
    <ol aria-label="AI Chef progress">
      {steps.map((label, index) => <li key={label} className={index < current ? 'is-complete' : undefined} aria-current={index === current ? 'step' : undefined}>
        <span className="mm-ai-chef__journey-mark" aria-hidden="true">{index < current ? '✓' : index + 1}</span>
        <span>{index < current && <span className="visually-hidden">Completed: </span>}{stage === 'generating' && index === current ? 'Preparing your recipe…' : label}</span>
      </li>)}
    </ol>
    {scrapbook && <img className="mm-ai-chef__basket-sticker" src={ingredientBasket} alt="" />}
  </PaperCard>
}
