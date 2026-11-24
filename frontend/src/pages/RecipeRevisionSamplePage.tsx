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
] as const

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
        <h2>Try a revision</h2>
        <p>Sample walkthrough</p>
      </header>
      <p>Pick a note to see Mori’s change.</p>
      <div className="mm-revision-sample__choices" role="group" aria-label="Choose a cooking note">
        {examples.map((example) => <button key={example.note} type="button" className="button button-secondary"
          aria-pressed={selected === example} onClick={() => select(example)}>{example.note}</button>)}
      </div>
      <section className="mm-revision-sample__draft" aria-labelledby="sample-draft" aria-live="polite" aria-atomic="true">
        <h3 id="sample-draft">Sample draft</h3>
        {selected ? <>
          <dl className="mm-revision-sample__comparison">
            <div><dt>Original</dt><dd>{original[selected.changed]}</dd></div>
            <div><dt>Next time</dt><dd><strong>{selected[selected.changed]}</strong></dd></div>
          </dl>
          <p>Keep <strong>{selected.changed === 'soySauce' ? selected.vinegar : selected.soySauce}</strong>.</p>
          <p>{selected.reason}</p>
          <p className="mm-revision-sample__evidence">From the cook’s note <q>{selected.note}</q></p>
        </> : <p>Mori’s change and the note behind it will appear here.</p>}
      </section>
      {selected && <Link className="button button-secondary mm-revision-sample__start" to="/signup">Try this with your own recipes</Link>}
    </div>
  </JournalShell>
}
