import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export const AUTH_INITIALIZATION_TIMEOUT_MS = 15_000

let client: SupabaseClient | undefined
let verificationResult: Promise<boolean> | undefined
let verificationFinished = false
const callbackParams = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'expires_at', 'expires_in', 'token_type', 'type', 'code', 'token', 'token_hash', 'sb_flow_id',
  'error', 'error_code', 'error_description']
const implicitSessionParams = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'expires_at', 'expires_in', 'token_type']

// Only the reserved callback route is cleaned; never navigate or change origins.
export function clearAuthCallbackUrl() {
  const url = new URL(window.location.href)
  if (url.pathname !== '/auth/callback') return
  for (const key of callbackParams) url.searchParams.delete(key)
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
}

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

function getSignupCallbackCode() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasError = ['error', 'error_code', 'error_description', 'token_hash']
    .some((key) => url.searchParams.has(key) || hash.has(key))
  return url.pathname === '/auth/callback' && !hasError ? url.searchParams.get('code') : null
}

// Auth only: domain data continues to use the existing Edge Function REST client.
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
    })
  }
  return client.auth
}

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
  const initialization = auth.initialize().then(async ({ error }) => {
    if (error) return false
    const { data, error: exchangeError } = await auth.exchangeCodeForSession(code)
    return !exchangeError && Boolean(data.session)
  }).catch(() => false)
  let timer: number | undefined
  const deadline = new Promise<boolean>((resolve) => {
    timer = window.setTimeout(() => resolve(false), AUTH_INITIALIZATION_TIMEOUT_MS)
  })
  verificationResult = Promise.race([initialization, deadline]).finally(() => {
    window.clearTimeout(timer)
    verificationFinished = true
    clearAuthCallbackUrl()
  })
  return verificationResult
}
