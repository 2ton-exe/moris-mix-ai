import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { RecipeSourceContext } from '../recipes/source'
import { useJournalMedia } from '../journal/useJournalMedia'
import { JournalShell } from '../journal/JournalShell'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import type { JournalLogoutGuard } from '../journal/JournalLogoutGuardContext'

// Shared authenticated journal shell, including logout on detail/error screens.
export default function JournalPage() {
  const { pathname } = useLocation()
  const writing = /\/recipes\/(?:new|[^/]+\/edit)\/?$/.test(pathname) || pathname.endsWith('/review')
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const reviewing = pathname.endsWith('/review')
  const editing = /\/recipes\/[^/]+\/edit\/?$/.test(pathname)
  const reading = /^\/app\/recipes\/[^/]+\/?$/.test(pathname)
  const { user, logout } = useAuth()
  const source = useContext(RecipeSourceContext)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const logoutGuard = useRef<JournalLogoutGuard | null>(null)
  const registerLogoutGuard = useCallback((guard: JournalLogoutGuard) => {
    logoutGuard.current = guard
    return () => { if (logoutGuard.current === guard) logoutGuard.current = null }
  }, [])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function signOut() {
    if (submitting.current) return
    if (logoutGuard.current?.() === false) return
    submitting.current = true
    setPending(true)
    setError(null)
    // ProtectedRoute handles navigation when the provider's session clears.
    try { await logout() }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not log out. Please try again.') }
    finally { if (mounted.current) { submitting.current = false; setPending(false) } }
  }

  return <JournalLogoutGuardContext.Provider value={registerLogoutGuard}>
    <div className={writing ? reviewing ? `mm-recipe-review${single ? '' : ' mm-chef-review'}` : `mm-recipe-form-editor${!single && editing ? ' mm-edit-recipe' : !single && pathname.endsWith('/recipes/new') ? ' mm-new-recipe' : ''}` : undefined}>
    <JournalShell pageClassName={writing ? 'mm-journal-editor' : undefined} mode={writing ? 'writing' : reading ? 'reading' : 'journal'} ownerName={typeof user?.user_metadata?.name === 'string' ? user.user_metadata.name : user?.email?.split('@')[0] ?? 'a cook'} account={<div className="journal-account"><span>{user?.email}</span><button className="button button-secondary" type="button" disabled={pending} onClick={() => { void signOut() }}>{pending ? 'Logging out…' : 'Log out'}</button></div>}>
      {error && <p className="field-error" role="alert">{error}</p>}
      {source.mode === 'preview' && <p className="recipe-preview-notice" role="note">Sample recipes · Development preview. These recipes are examples, not your saved collection.</p>}
      <Outlet />
    </JournalShell></div>
  </JournalLogoutGuardContext.Provider>
}
