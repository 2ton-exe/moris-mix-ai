import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authErrorMessage } from './errors'

export const AUTH_INITIALIZATION_TIMEOUT_MS = 15_000

let client: SupabaseClient | undefined
export type AuthCallbackResult = { kind: 'invalid' } | { kind: 'verified' } | { kind: 'recovery'; accessToken: string }

const invalidCallback: AuthCallbackResult = { kind: 'invalid' }
let verificationResult: Promise<AuthCallbackResult> | undefined
let verificationFinished = false
let verificationAttempt: { controller: AbortController; expiresAt: number } | undefined
let passwordUpdateAccessToken: string | undefined
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
function getCallbackCode() {
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
          if (passwordUpdateAccessToken && init?.method === 'PUT' && String(input) === `${origin.origin}/auth/v1/user`
            && new Headers(init.headers).get('authorization') !== `Bearer ${passwordUpdateAccessToken}`) {
            throw new Error('The recovery session changed before the password update.')
          }
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
export function getAuthCallbackResult(): Promise<AuthCallbackResult> {
  const auth = getAuthClient()
  if (verificationFinished) {
    clearAuthCallbackUrl()
    return Promise.resolve(invalidCallback)
  }
  if (verificationResult) return verificationResult
  const code = getCallbackCode()
  if (!code) {
    clearAuthCallbackUrl()
    return Promise.resolve(invalidCallback)
  }
  const attempt = { controller: new AbortController(), expiresAt: Date.now() + AUTH_INITIALIZATION_TIMEOUT_MS }
  verificationAttempt = attempt
  const initialization = auth.initialize().then(async ({ error }): Promise<AuthCallbackResult> => {
    if (error || attempt.controller.signal.aborted || Date.now() >= attempt.expiresAt) return invalidCallback
    const { data, error: exchangeError } = await auth.exchangeCodeForSession(code)
    if (exchangeError || !data.session) return invalidCallback
    // The SDK reads redirectType from the browser's PKCE verifier, never from the callback URL.
    return 'redirectType' in data && data.redirectType === 'recovery'
      ? { kind: 'recovery', accessToken: data.session.access_token }
      : { kind: 'verified' }
  }).catch(() => invalidCallback)
  let timer: number | undefined
  const deadline = new Promise<AuthCallbackResult>((resolve) => {
    timer = window.setTimeout(() => {
      attempt.controller.abort()
      resolve(invalidCallback)
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

export async function requestPasswordReset(email: string) {
  try {
    const redirectTo = new URL('/auth/callback', window.location.origin).href
    const { error } = await getAuthClient().resetPasswordForEmail(email, { redirectTo })
    if (error && error.code !== 'user_not_found') throw error
  } catch (error) {
    throw new Error(authErrorMessage(error, 'Could not send a password reset link. Check your connection and try again.'))
  }
}

export async function updateRecoveredPassword(password: string, accessToken: string) {
  if (passwordUpdateAccessToken) throw new Error('A password update is already in progress.')
  const auth = getAuthClient()
  passwordUpdateAccessToken = accessToken
  try {
    const { data } = await auth.getSession()
    if (data.session?.access_token !== accessToken) throw new Error('Your reset session ended. Request a new password reset link.')
    const { error } = await auth.updateUser({ password })
    if (error) throw new Error(authErrorMessage(error, 'Could not update your password. Check your connection and try again.'))
  } finally {
    passwordUpdateAccessToken = undefined
  }
}
