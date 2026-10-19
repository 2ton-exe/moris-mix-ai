import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context'

// Protected landing page for FE-04 to extend with recipe UI.
export default function JournalPage() {
  const { user, logout } = useAuth()
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
    <main className="page-shell">
      <div className="eyebrow"><span className="status-dot" /> Mori’s Mix</div>
      <h1>Your cooking journal</h1>
      <p className="intro">You are logged in{user?.email ? ` as ${user.email}` : ''}. Your journal is ready for your recipes.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="actions">
        <Link className="button button-secondary" to="/demo-recipe">Demonstration recipe</Link>
        <button className="button button-primary" type="button" disabled={pending} onClick={() => { void signOut() }}>{pending ? 'Logging out…' : 'Log out'}</button>
      </div>
    </main>
  )
}
