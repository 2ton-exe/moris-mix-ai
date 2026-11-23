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
      <Link className="button button-primary" to="/demo-recipe">Read the demonstration recipe</Link>
    </section>
    <div className="actions">
      <Link className="button button-secondary" to="/login">Log in to your journal</Link>
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
      <h3>From a rough note to a recipe draft</h3>
      <p><strong>Your note:</strong> “Fried two eggs with garlic, then added leftover rice and soy sauce.”</p>
      <p><strong>Mori’s draft:</strong> Garlic egg fried rice · 2 eggs, garlic, cooked rice, soy sauce. Fry the eggs with garlic, then stir in the rice and soy sauce. Check the amounts and edit the draft before saving.</p>
    </section>
    <div className="actions"><Link className="button button-primary" to="/app">Open your journal</Link><Link className="button button-secondary" to="/home">Back home</Link></div>
  </PublicPage>
}

export function NotFoundPage({ journal = false }: { journal?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (journal) heading.current?.focus() }, [journal])
  const recovery = <>
    <p className="intro">We couldn’t find that page.</p>
    <div className="actions">
      <Link className="button button-primary" to={journal ? '/app/recipes' : '/home'}>{journal ? 'My recipes' : 'Return home'}</Link>
      {!journal && <Link className="button button-secondary" to="/demo-recipe">View demo recipe</Link>}
    </div>
  </>
  if (journal) return <section className="mm-public-page" aria-labelledby="missing-journal-page">
    <h1 ref={heading} tabIndex={-1} id="missing-journal-page">Page not found</h1>
    {recovery}
  </section>
  return <PublicPage title="Page not found">
    {recovery}
  </PublicPage>
}
