import { useContext, useEffect, useRef, useState } from 'react'
import { Link, Outlet } from 'react-router'
import { useAuth } from '../auth/context'
import { RecipeSourceContext } from '../recipes/source'

// Shared authenticated journal shell, including logout on detail/error screens.
export default function JournalPage() {
  const { user, logout } = useAuth()
  const source = useContext(RecipeSourceContext)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function signOut() {
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setError(null)
    // ProtectedRoute handles navigation when the provider's session clears.
    try { await logout() }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not log out. Please try again.') }
    finally { if (mounted.current) { submitting.current = false; setPending(false) } }
  }

  return (
    <main className="page-shell journal-shell" id="journal">
      <header className="journal-header">
        <Link className="eyebrow" to="/app/recipes"><span className="status-dot" /> Mori’s Mix</Link>
        <div className="journal-account"><span>{user?.email}</span><button className="button button-secondary" type="button" disabled={pending} onClick={() => { void signOut() }}>{pending ? 'Logging out…' : 'Log out'}</button></div>
      </header>
      {error && <p className="field-error" role="alert">{error}</p>}
      {source.mode === 'preview' && <p className="recipe-preview-notice" role="note">Sample recipes · Development preview. These recipes are examples, not your saved collection.</p>}
      <Outlet />
      <footer className="journal-footer">A place for the meals that become yours. <Link to="/demo-recipe">Demonstration recipe</Link></footer>
    </main>
  )
}
