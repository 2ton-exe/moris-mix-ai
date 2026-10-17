import { Link } from 'react-router'

export default function DemoRecipePage() {
  return (
    <main className="page-shell">
      <div className="eyebrow"><span className="status-dot" /> Mori’s Mix</div>
      <h1>Demonstration recipe</h1>
      <p className="intro" role="status">
        The demonstration recipe will be available once the shared API contract and demo data are ready.
      </p>
      <div className="actions"><Link className="button button-secondary" to="/">Back home</Link></div>
    </main>
  )
}
