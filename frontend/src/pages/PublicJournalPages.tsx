import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { JournalShell } from '../journal/JournalShell'
import { Stamp } from '../journal/Scrapbook'

function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [title])
  return <JournalShell publicNavigation pageClassName="mm-public-page">
    <Stamp tone="sage">From Mori’s kitchen</Stamp>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    {children}
    <footer className="journal-footer">MORI'S MIX · A cooking journal</footer>
  </JournalShell>
}

export function HomePage() {
  return <PublicPage title="Good meals deserve a page.">
    <p className="intro">Keep the recipes you return to, the changes you make, and the little notes that make a meal yours.</p>
    {/* shortcut: excerpt mirrors the approved demo fixture, update it when that sample changes. */}
    <section className="mm-public-note mm-public-preview" aria-label="Demonstration recipe excerpt">
      <h2>Classic Tomato Scraps Pasta</h2>
      <p>200 g spaghetti, 2 tbsp tomato paste, 2 cloves garlic, and fresh basil.</p>
      <p><strong>First step:</strong> Boil pasta in salted water.</p>
      <Link to="/demo-recipe">Read the demonstration recipe</Link>
    </section>
    <div className="actions">
      <Link className="button button-primary" to="/app">Your cooking journal</Link>
      <Link className="button button-secondary" to="/demo-recipe">Demonstration recipe</Link>
      <Link className="button button-secondary" to="/about">About Mori’s Mix</Link>
    </div>
  </PublicPage>
}

export function AboutPage() {
  return <PublicPage title="A place for the meals that become yours.">
    <p className="intro">MORI'S MIX is your personal cooking journal. Save ingredients and steps, rate a dish, and leave a note for next time.</p>
    <section className="mm-public-note mm-public-workflow" aria-labelledby="public-workflow-heading">
      <h2 id="public-workflow-heading">Keep the notes that help next time.</h2>
      <ol>
        <li>Save the ingredients and cooking steps.</li>
        <li>Rate the dish and add a note about what you’d change.</li>
        <li>Open the recipe again when you cook it next time.</li>
      </ol>
      <p className="mm-handwriting">Every favorite starts somewhere.</p>
    </section>
    <div className="actions"><Link className="button button-primary" to="/app">Open your journal</Link><Link className="button button-secondary" to="/home">Back home</Link></div>
  </PublicPage>
}

export function NotFoundPage() {
  return <PublicPage title="This page is still unwritten.">
    <p className="mm-recipe-index__eyebrow">404 · Page not found</p>
    <p className="intro">We couldn’t find that page. Your next recipe is a good place to start again.</p>
    <div className="actions"><Link className="button button-primary" to="/home">Return home</Link><Link className="button button-secondary" to="/app/recipes">Open your journal</Link></div>
  </PublicPage>
}
