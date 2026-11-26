import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { JournalShell } from '../journal/JournalShell'
import { useJournalMedia } from '../journal/useJournalMedia'

function PublicPage({ title, children, facing }: { title: string; children: ReactNode; facing?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [title])
  const introduction = <><h1 ref={heading} tabIndex={-1}>{title}</h1>{children}</>
  return <JournalShell publicNavigation pageClassName="mm-public-page">
    {facing ? <><JournalFacingPage className="mm-facing-content--public mm-public-page">{introduction}</JournalFacingPage>{facing}</> : introduction}
  </JournalShell>
}

export function HomePage() {
  const desktop = useJournalMedia('(min-width: 1100px) and (min-height: 640px)')
  // shortcut: excerpt mirrors the approved demo fixture; update it when that sample changes.
  const preview = <>
    <section className="mm-public-note mm-public-preview" aria-label="Demonstration recipe excerpt">
      <h2>Classic Tomato Scraps Pasta</h2>
      <p>200 g spaghetti, 2 tbsp tomato paste, 2 cloves garlic, and fresh basil.</p>
      <p><strong>First step:</strong> Boil pasta in salted water.</p>
      <Link className="button button-secondary" to="/demo-recipe">Read the full sample recipe</Link>
      {desktop && <p><Link to="/demo-recipe/try-a-revision">Try a Chicken Adobo revision with Mori</Link></p>}
    </section>
  </>
  return <PublicPage title="Good meals deserve a page." facing={desktop ? preview : undefined}>
    <p className="intro">Keep recipes and notes in one private journal. Quick AI Entry turns rough notes into editable drafts. <Link to="/about">See how the journal works</Link>.</p>
    <div className="actions">
      <Link className="button button-primary" to="/signup">Start a private journal</Link>
      <Link className="button button-secondary" to="/login">Log in to your journal</Link>
    </div>
    {!desktop && preview}
  </PublicPage>
}

export function AboutPage() {
  const desktop = useJournalMedia('(min-width: 1100px) and (min-height: 640px) and (hover: hover) and (pointer: fine)')
  const workflow = <>
    <section className="mm-public-note mm-public-workflow" aria-labelledby="public-workflow-heading">
      <h2 id="public-workflow-heading">From note to recipe</h2>
      <div className="mm-public-example">
        <p><strong>Rough note</strong><br />“Eggs, garlic, leftover rice, soy sauce.”</p>
        <p><strong>Mori’s draft</strong><br />Garlic egg fried rice: fry the eggs, then stir in rice.</p>
      </div>
      <p className="mm-public-workflow__hint">Review the draft, then choose <strong>Save recipe</strong> to add it to <strong>My recipes</strong>. <Link to="/demo-recipe">Read a sample recipe</Link>.</p>
      <p className="mm-public-workflow__steps">After signup: <strong>New recipe</strong> to write, <strong>Quick AI Entry</strong> for notes, or <strong>AI Chef</strong> for pantry ideas.</p>
    </section>
  </>
  return <PublicPage title="Keep your recipes close." facing={desktop ? workflow : undefined}>
    <p className="intro">Your recipes stay private in your account.</p>
    {!desktop && workflow}
    {desktop && <section className="mm-public-note mm-public-workflow">
      <h2>Cook it better next time</h2>
      <p>Open a saved recipe and choose <strong>Record cooking</strong> to add what worked or what you’d change. Then select a note in <strong>Revise with Mori</strong>. You can edit the suggested change and save it as a linked version.</p>
      <p><Link to="/demo-recipe/try-a-revision">See a cooking note turn into a revision</Link>.</p>
    </section>}
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
