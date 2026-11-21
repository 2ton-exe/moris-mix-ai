import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { RecipeSourceContext } from '../recipes/source'
import { useJournalDesktopTools } from '../journal/useJournalDesktopTools'
import { CollectionBookplate } from '../recipes/CollectionBookplate'
import { JournalShell } from '../journal/JournalShell'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import type { JournalLogoutGuard } from '../journal/JournalLogoutGuardContext'

// Shared authenticated journal shell, including logout on detail/error screens.
export default function JournalPage() {
  const { pathname } = useLocation()
  const reading = /^\/app\/recipes\/[^/]+\/?$/.test(pathname)
  const { user, logout, isAuthenticated, isLoading } = useAuth()
  const desktopTools = useJournalDesktopTools()
  const collection = /^\/app(?:\/recipes)?\/?$/.test(pathname)
  const ownerName = typeof user?.user_metadata?.name === 'string' ? user.user_metadata.name : user?.email?.split('@')[0] ?? 'a cook'
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
    <JournalShell mode={reading ? 'reading' : 'journal'} ownerName={ownerName} bookplate={desktopTools && collection && user && isAuthenticated && !isLoading && source.mode === 'live'
      ? <CollectionBookplate key={user.id} userId={user.id} ownerName={ownerName} /> : undefined} account={<div className="journal-account"><span>{user?.email}</span><button className="button button-secondary" type="button" disabled={pending} onClick={() => { void signOut() }}>{pending ? 'Logging out…' : 'Log out'}</button></div>}>
      {error && <p className="field-error" role="alert">{error}</p>}
      {source.mode === 'preview' && <p className="recipe-preview-notice" role="note">Sample recipes · Development preview. These recipes are examples, not your saved collection.</p>}
      <Outlet />
    </JournalShell>
  </JournalLogoutGuardContext.Provider>
}
