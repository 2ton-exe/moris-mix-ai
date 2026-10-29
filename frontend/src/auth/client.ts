import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export const AUTH_INITIALIZATION_TIMEOUT_MS = 15_000

let client: SupabaseClient | undefined
let verificationResult: Promise<boolean> | undefined
let verificationFinished = false
let verificationAttempt: { controller: AbortController; expiresAt: number } | undefined
const callbackParams = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'expires_at', 'expires_in', 'token_type', 'type', 'code', 'token', 'token_hash', 'sb_flow_id',
  'error', 'error_code', 'error_description']
const implicitSessionParams = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'expires_at', 'expires_in', 'token_type']

/** Removes callback credentials only on the reserved route, preserving unrelated query parameters and history state. */
export function clearAuthCallbackUrl() {
  const url = new URL(window.location.href)
  if (url.pathname !== '/auth/callback') return
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasHashCredentials = callbackParams.some((key) => hash.has(key))
  for (const key of callbackParams) {
    url.searchParams.delete(key)
    hash.delete(key)
  }
  const fragment = hasHashCredentials ? (hash.size ? `#${hash}` : '') : url.hash
  window.history.replaceState(window.history.state, '', url.pathname + url.search + fragment)
}

/** Strips implicit session credentials before the SDK can see them on any route. */
function clearUnboundAuthUrlCredentials() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  if (!implicitSessionParams.some((key) => url.searchParams.has(key) || hash.has(key))) return
  for (const key of callbackParams) {
    url.searchParams.delete(key)
    hash.delete(key)
  }
  url.hash = hash.toString() ? `#${hash}` : ''
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

/** Reads a code only from the callback route and rejects error or token-hash links. */
function getSignupCallbackCode() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasError = ['error', 'error_code', 'error_description', 'token_hash']
    .some((key) => url.searchParams.has(key) || hash.has(key))
  return url.pathname === '/auth/callback' && !hasError ? url.searchParams.get('code') : null
}

/** Returns the single persistent PKCE auth client; domain data uses the existing REST client. */
export function getAuthClient() {
  clearUnboundAuthUrlCredentials()
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()
    if (!url || !key) throw new Error('Authentication is not configured.')
    const origin = new URL(url)
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('Authentication is not configured.')
    }
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
      global: {
        /** Rejects expired callback responses before the SDK can persist a session or emit auth events. */
        fetch: async (input, init) => {
          const attempt = verificationAttempt
          if (!attempt || String(input) !== `${origin.origin}/auth/v1/token?grant_type=pkce`) return fetch(input, init)
          /** Enforces the deadline even when the browser has delayed the timeout task. */
          const assertActive = () => {
            if (Date.now() >= attempt.expiresAt) attempt.controller.abort()
            attempt.controller.signal.throwIfAborted()
          }
          assertActive()
          const response = await fetch(input, { ...init, signal: attempt.controller.signal })
          // Headers can arrive before the deadline while the body is still pending.
          const body = await response.arrayBuffer()
          assertActive()
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
        },
      },
    })
  }
  return client.auth
}

/** Shares one bounded code exchange per document and rejects reuse or completion after its deadline. */
export function getVerificationCallbackResult() {
  const auth = getAuthClient()
  if (verificationFinished) {
    clearAuthCallbackUrl()
    return Promise.resolve(false)
  }
  if (verificationResult) return verificationResult
  const code = getSignupCallbackCode()
  if (!code) {
    clearAuthCallbackUrl()
    return Promise.resolve(false)
  }
  const attempt = { controller: new AbortController(), expiresAt: Date.now() + AUTH_INITIALIZATION_TIMEOUT_MS }
  verificationAttempt = attempt
  const initialization = auth.initialize().then(async ({ error }) => {
    if (error || attempt.controller.signal.aborted || Date.now() >= attempt.expiresAt) return false
    const { data, error: exchangeError } = await auth.exchangeCodeForSession(code)
    return !exchangeError && Boolean(data.session)
  }).catch(() => false)
  let timer: number | undefined
  const deadline = new Promise<boolean>((resolve) => {
    timer = window.setTimeout(() => {
      attempt.controller.abort()
      resolve(false)
    }, AUTH_INITIALIZATION_TIMEOUT_MS)
  })
  verificationResult = Promise.race([initialization, deadline]).finally(() => {
    window.clearTimeout(timer)
    verificationFinished = true
    if (verificationAttempt === attempt) verificationAttempt = undefined
    clearAuthCallbackUrl()
  })
  return verificationResult
}
