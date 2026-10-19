import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export const AUTH_INITIALIZATION_TIMEOUT_MS = 15_000

let client: SupabaseClient | undefined
let verificationResult: Promise<boolean> | undefined
let verificationFinished = false

// Only the reserved callback route is cleaned; never navigate or change origins.
export function clearAuthCallbackUrl() {
  const url = new URL(window.location.href)
  if (url.pathname !== '/auth/callback') return
  for (const key of ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
    'expires_at', 'expires_in', 'token_type', 'type', 'code', 'token', 'token_hash', 'sb_flow_id',
    'error', 'error_code', 'error_description']) url.searchParams.delete(key)
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
}

function isSignupCallback() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasError = ['error', 'error_code', 'error_description', 'code', 'token_hash']
    .some((key) => url.searchParams.has(key) || hash.has(key))
  const conflictingQuery = ['access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'type']
    .some((key) => url.searchParams.has(key))
  return url.pathname === '/auth/callback' && !hasError && !conflictingQuery &&
    Boolean(hash.get('access_token') && hash.get('refresh_token')) && hash.get('type') === 'signup'
}

// Auth only: domain data continues to use the existing Edge Function REST client.
export function getAuthClient() {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()
    if (!url || !key) throw new Error('Authentication is not configured.')
    const origin = new URL(url)
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('Authentication is not configured.')
    }
    // Capture only a boolean, before automatic SDK initialization consumes the URL.
    const signupCallback = isSignupCallback()
    const onCallbackRoute = window.location.pathname === '/auth/callback'
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    })
    if (onCallbackRoute) {
      // initialize() awaits the SDK's existing initialization promise; it does not
      // start a second exchange. getSession() alone discards URL processing errors.
      const initialization = client.auth.initialize()
        .then(({ error }) => signupCallback && !error)
        .catch(() => false)
      let timer: number | undefined
      const deadline = new Promise<boolean>((resolve) => {
        timer = window.setTimeout(() => resolve(false), AUTH_INITIALIZATION_TIMEOUT_MS)
      })
      // A cross-tab auth event may finish provider loading while URL processing
      // still stalls. Bound callback feedback independently and ignore late success.
      verificationResult = Promise.race([initialization, deadline]).finally(() => {
        window.clearTimeout(timer)
        verificationFinished = true
        clearAuthCallbackUrl()
      })
    }
  }
  return client.auth
}

export function getVerificationCallbackResult() {
  getAuthClient()
  // An already initialized ordinary session cannot prove a new callback succeeded.
  if (!verificationFinished && verificationResult) return verificationResult
  clearAuthCallbackUrl()
  return Promise.resolve(false)
}
