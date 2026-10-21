import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AUTH_INITIALIZATION_TIMEOUT_MS, clearAuthCallbackUrl, getAuthClient } from './client'
import { AuthContext } from './context'
import { authErrorMessage } from './errors'

function validSession(session: Session | null) {
  return session?.expires_at && session.expires_at * 1000 > Date.now() ? session : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const revision = useRef(0)
  const currentSession = useRef<Session | null>(null)
  const updateSession = useCallback((nextSession: Session | null) => {
    const next = validSession(nextSession)
    currentSession.current = next
    setSession(next)
  }, [])

  useEffect(() => {
    let active = true
    let failed = false
    let unsubscribe: (() => void) | undefined
    let timer: number | undefined
    const fail = (message = 'Could not restore your session. Check your connection and authentication configuration, then try again.') => {
      if (!active || failed) return
      failed = true
      window.clearTimeout(timer)
      updateSession(null)
      clearAuthCallbackUrl()
      setError(message)
      setLoading(false)
    }
    try {
      const auth = getAuthClient()
      const startedAt = revision.current
      timer = window.setTimeout(() => {
        fail('Restoring your session is taking too long. Check your connection and try again.')
      }, AUTH_INITIALIZATION_TIMEOUT_MS)
      const { data } = auth.onAuthStateChange((event, nextSession) => {
        // getSession is authoritative for initialization, including its errors.
        if (!active || failed || event === 'INITIAL_SESSION') return
        revision.current++
        window.clearTimeout(timer)
        updateSession(nextSession)
        setError(null)
        setLoading(false)
      })
      unsubscribe = () => data.subscription.unsubscribe()
      void auth.getSession().then(({ data, error }) => {
        if (!active || failed || revision.current !== startedAt) return
        if (error) { fail(); return }
        window.clearTimeout(timer)
        updateSession(data.session)
        setError(null)
        setLoading(false)
      }).catch(() => { if (revision.current === startedAt) fail() })
    } catch {
      fail()
    }
    return () => { active = false; window.clearTimeout(timer); unsubscribe?.() }
  }, [attempt, updateSession])

  // The SDK normally refreshes before expiry. Fail closed if refresh cannot run.
  useEffect(() => {
    if (!session?.expires_at) return
    const timer = window.setTimeout(() => {
      revision.current++
      updateSession(null)
    }, Math.min(Math.max(0, session.expires_at * 1000 - Date.now()), 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [session, updateSession])

  const acceptSession = (nextSession: Session | null) => {
    revision.current++
    updateSession(nextSession)
    setError(null)
  }
  const callbackUrl = () => new URL('/auth/callback', window.location.origin).href

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, isLoading, isAuthenticated: session !== null, error,
      logoutNotice, dismissLogoutNotice: () => setLogoutNotice(null),
      retryInitialization: () => { setLoading(true); setError(null); setAttempt((value) => value + 1) },
      login: async (email, password) => {
        const startedAt = revision.current
        try {
          const { data, error } = await getAuthClient().signInWithPassword({ email, password })
          if (error) throw error
          if (!validSession(data.session)) throw new Error('Missing session')
          if (revision.current === startedAt) acceptSession(data.session)
        } catch (error) {
          throw new Error(authErrorMessage(error, 'Could not log in. Check your connection and try again.'))
        }
      },
      signup: async (email, password) => {
        const startedAt = revision.current
        try {
          const { data, error } = await getAuthClient().signUp({ email, password, options: { emailRedirectTo: callbackUrl() } })
          if (error) throw error
          if (revision.current === startedAt) acceptSession(data.session)
          return validSession(data.session) ? 'authenticated' : 'verification-required'
        } catch (error) {
          throw new Error(authErrorMessage(error, 'Could not create your account. Check your connection and try again.'))
        }
      },
      logout: async () => {
        const startedAt = revision.current
        setLogoutNotice(null)
        try {
          const { error } = await getAuthClient().signOut({ scope: 'local' })
          if (error) throw error
          if (revision.current === startedAt) acceptSession(null)
        } catch {
          // The installed SDK can emit SIGNED_OUT and clear storage before
          // returning a revocation error. Never recreate that cleared session.
          if (!currentSession.current) {
            setLogoutNotice('You are logged out of this browser, but the server could not confirm the logout request.')
            return
          }
          throw new Error('Could not log out. Check your connection and try again.')
        }
      },
      resendVerification: async (email) => {
        try {
          const { error } = await getAuthClient().resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl() } })
          if (error) throw error
        } catch (error) {
          throw new Error(authErrorMessage(error, 'Could not send a verification link. Please try again later.'))
        }
      },
    }}>
      {children}
    </AuthContext.Provider>
  )
}
