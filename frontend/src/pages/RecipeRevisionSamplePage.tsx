import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { JournalShell } from '../journal/JournalShell'
import { ScrapbookSticker } from '../journal/ScrapbookSticker'
import './recipeRevisionSample.css'

const original = { soySauce: '¼ cup soy sauce', vinegar: '3 tablespoons vinegar' }
const examples = [
  {
    note: 'Too salty with ¼ cup soy sauce. Loved the extra vinegar.',
    soySauce: '2 tablespoons soy sauce',
    vinegar: original.vinegar,
    changed: 'soySauce',
    reason: 'Use less soy sauce to ease the saltiness and keep the vinegar you liked.',
  },
  {
    note: 'Needed more tang.',
    soySauce: original.soySauce,
    vinegar: '4 tablespoons vinegar',
    changed: 'vinegar',
    reason: 'Add a tablespoon of vinegar for more tang and keep the soy sauce amount.',
  },
]

export default function RecipeRevisionSamplePage() {
  const heading = useRef<HTMLHeadingElement>(null)
  const [selected, select] = useState<(typeof examples)[number] | null>(null)
  useEffect(() => { heading.current?.focus() }, [])

  return <JournalShell mode="demo" publicNavigation pageClassName="mm-revision-sample-sheet">
    <JournalFacingPage className="mm-facing-content--revision-sample">
      <section aria-labelledby="sample-original" className="mm-revision-sample">
        <Link className="button button-secondary mm-button--small" to="/demo-recipe">Back to demo recipe</Link>
        <header>
          <p id="sample-original">Original recipe</p>
          <h1 ref={heading} tabIndex={-1}>Chicken Adobo</h1>
        </header>
        <ScrapbookSticker name="garlic" size={88} className="mm-revision-sample__sticker" />
        <ul className="mm-revision-sample__ingredients">
          <li>1 pound chicken thighs</li>
          <li>{original.soySauce}</li>
          <li>{original.vinegar}</li>
          <li>4 cloves garlic</li>
        </ul>
        <p>Simmer the chicken with soy sauce, vinegar, and garlic until tender.</p>
      </section>
    </JournalFacingPage>
    <div className="mm-revision-sample">
      <header>
        <h2>What would you change?</h2>
        <p>Sample walkthrough</p>
      </header>
      <div className="mm-revision-sample__choices" role="group" aria-label="Choose a cooking note">
        {examples.map((example) => <button key={example.note} type="button" className="button button-secondary"
          aria-pressed={selected === example} onClick={() => select(example)}>{example.note}</button>)}
      </div>
      <section className="mm-revision-sample__draft" aria-labelledby="sample-draft" aria-live="polite" aria-atomic="true">
        <h3 id="sample-draft">Sample draft</h3>
        {selected ? <>
          <ul className="mm-revision-sample__ingredients">
            <li>{selected.changed === 'soySauce' ? <strong>{selected.soySauce}</strong> : selected.soySauce}</li>
            <li>{selected.changed === 'vinegar' ? <strong>{selected.vinegar}</strong> : selected.vinegar}</li>
          </ul>
          <p>{selected.reason}</p>
          <p className="mm-revision-sample__evidence">From the cook’s note <q>{selected.note}</q></p>
        </> : <p>Choose a cooking note to reveal the suggested change.</p>}
      </section>
    </div>
  </JournalShell>
}
