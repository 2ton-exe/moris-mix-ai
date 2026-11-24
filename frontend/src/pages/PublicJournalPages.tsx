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
    <p className="intro">Keep recipes and notes in one private journal. Quick AI Entry turns rough notes into editable drafts. <Link to="/about">See how the journal works</Link>.</p>
    <div className="actions">
      <Link className="button button-primary" to="/signup">Start a private journal</Link>
      <Link className="button button-secondary" to="/login">Log in to your journal</Link>
    </div>
    {/* shortcut: excerpt mirrors the approved demo fixture, update it when that sample changes. */}
    <section className="mm-public-note mm-public-preview" aria-label="Demonstration recipe excerpt">
      <h2>Classic Tomato Scraps Pasta</h2>
      <p>200 g spaghetti, 2 tbsp tomato paste, 2 cloves garlic, and fresh basil.</p>
      <p><strong>First step:</strong> Boil pasta in salted water.</p>
      <Link className="button button-secondary" to="/demo-recipe">Read the full sample recipe</Link>
    </section>
  </PublicPage>
}

export function AboutPage() {
  return <PublicPage title="Keep your recipes close.">
    <p className="intro">Your recipes stay private in your account.</p>
    <section className="mm-public-note mm-public-workflow" aria-labelledby="public-workflow-heading">
      <h2 id="public-workflow-heading">From note to recipe</h2>
      <div className="mm-public-example">
        <p><strong>Rough note</strong><br />“Eggs, garlic, leftover rice, soy sauce.”</p>
        <p><strong>Mori’s draft</strong><br />Garlic egg fried rice: fry the eggs, then stir in rice.</p>
      </div>
      <p className="mm-public-workflow__hint">Review the draft, then choose <strong>Save recipe</strong> to add it to <strong>My recipes</strong>. <Link to="/demo-recipe">Read a sample recipe</Link>.</p>
      <p className="mm-public-workflow__steps">After signup: <strong>New recipe</strong> to write, <strong>Quick AI Entry</strong> for notes, or <strong>AI Chef</strong> for pantry ideas.</p>
    </section>
    <div className="actions"><Link className="button button-primary" to="/signup">Start a private journal</Link><Link className="button button-secondary" to="/login">Log in to your journal</Link></div>
  </PublicPage>
}

export function NotFoundPage({ journal = false }: { journal?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (journal) heading.current?.focus() }, [journal])
  const recovery = <>
    <p className="intro">{journal ? 'If you followed an old recipe link, search saved recipes by title.' : 'Start at Home, or read a sample recipe without an account.'}</p>
    <div className="actions">
      <Link className="button button-primary" to={journal ? '/app/recipes' : '/home'}>{journal ? 'Browse saved recipes' : 'Go to home page'}</Link>
      {journal ? <Link className="button button-secondary" to="/app/recipes?view=index">Search saved recipes</Link>
        : <Link className="button button-secondary" to="/demo-recipe">View sample recipe</Link>}
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
