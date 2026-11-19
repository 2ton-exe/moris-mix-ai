import { PaperCard } from '../journal/Scrapbook'

export type ChefProgressStage = 'pantry' | 'generating' | 'review' | 'saved'

const steps = ['Pantry', 'Review idea', 'Your journal']

export function ChefProgress({ stage }: { stage: ChefProgressStage }) {
  const current = stage === 'review' ? 1 : stage === 'saved' ? 2 : 0

  return <PaperCard className="mm-ai-chef__journey" surface="fresh" tape="sage">
    <h2>From pantry to plate</h2>
    <ol aria-label="AI Chef progress">
      {steps.map((label, index) => <li key={label} className={index < current ? 'is-complete' : undefined} aria-current={index === current ? 'step' : undefined}>
        <span className="mm-ai-chef__journey-mark" aria-hidden="true">{index < current ? '✓' : index + 1}</span>
        <span>{index < current && <span className="visually-hidden">Completed: </span>}{stage === 'generating' && index === current ? 'Preparing your recipe…' : label}</span>
      </li>)}
    </ol>
  </PaperCard>
}
