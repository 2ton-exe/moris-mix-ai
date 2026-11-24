import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { JournalShell } from '../journal/JournalShell'

function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [title])
  return <JournalShell publicNavigation pageClassName="mm-public-page">
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    {children}
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
      <Link className="button button-secondary" to="/demo-recipe">Read the sample recipe</Link>
    </section>
    <div className="actions">
      <Link className="button button-primary" to="/signup">Start a private journal</Link>
      <Link className="button button-secondary" to="/login">Log in to your journal</Link>
    </div>
  </PublicPage>
}

export function AboutPage() {
  return <PublicPage title="Keep your recipes close.">
    <p className="intro">Your recipes stay private in your account.</p>
    <section className="mm-public-note mm-public-workflow" aria-labelledby="public-workflow-heading">
      <h2 id="public-workflow-heading">From note to recipe</h2>
      <p className="mm-public-workflow__steps">Save ingredients and steps, then rate and note each dish.</p>
      <div className="mm-public-example">
        <p><strong>Rough note</strong><br />“Eggs, garlic, leftover rice, soy sauce.”</p>
        <p><strong>Mori’s draft</strong><br />Garlic egg fried rice: 2 eggs, garlic, rice, soy sauce. Fry eggs, then stir in rice.</p>
      </div>
      <p className="mm-public-workflow__hint">Review and edit before saving.</p>
    </section>
    <div className="actions"><Link className="button button-primary" to="/signup">Start a private journal</Link><Link className="button button-secondary" to="/login">Log in to your journal</Link></div>
  </PublicPage>
}

export function NotFoundPage({ journal = false }: { journal?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (journal) heading.current?.focus() }, [journal])
  const recovery = <>
    <p className="intro">{journal ? 'That address doesn’t match a recipe page. Browse or search your saved recipes from My recipes.' : 'Try the home page or sample recipe.'}</p>
    <div className="actions">
      <Link className="button button-primary" to={journal ? '/app/recipes' : '/home'}>{journal ? 'My recipes' : 'Go to home page'}</Link>
      {!journal && <Link className="button button-secondary" to="/demo-recipe">View sample recipe</Link>}
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
