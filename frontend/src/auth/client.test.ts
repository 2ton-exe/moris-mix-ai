import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ createClient: vi.fn(), auth: { getSession: vi.fn(), initialize: vi.fn() } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))

beforeEach(() => {
  vi.resetModules()
  sdk.createClient.mockReset().mockReturnValue({ auth: sdk.auth })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.example.test')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

it('creates one lazy auth client using the existing public environment configuration', async () => {
  const { getAuthClient } = await import('./client')
  expect(sdk.createClient).not.toHaveBeenCalled()
  expect(getAuthClient()).toBe(sdk.auth)
  expect(getAuthClient()).toBe(sdk.auth)
  expect(sdk.createClient).toHaveBeenCalledOnce()
  expect(sdk.createClient).toHaveBeenCalledWith('https://auth.example.test', 'sb_publishable_test', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  })
})

it('falls back to the supported legacy public anon key', async () => {
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-public-test-key')
  const { getAuthClient } = await import('./client')
  getAuthClient()
  expect(sdk.createClient).toHaveBeenCalledWith('https://auth.example.test', 'legacy-public-test-key', expect.any(Object))
})

it.each(['', 'bad url', 'ftp://auth.example.test', 'https://user:password@auth.example.test', 'https://auth.example.test/path', 'https://auth.example.test?key=value'])('rejects missing or invalid configuration before creating the SDK client: %s', async (url) => {
  vi.stubEnv('VITE_SUPABASE_URL', url)
  const { getAuthClient } = await import('./client')
  expect(() => getAuthClient()).toThrow()
  expect(sdk.createClient).not.toHaveBeenCalled()
})

it('rejects a missing public key without creating a client', async () => {
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  const { getAuthClient } = await import('./client')
  expect(() => getAuthClient()).toThrow()
  expect(sdk.createClient).not.toHaveBeenCalled()
})

it('bounds callback processing independently and never promotes its late success after the deadline', async () => {
  vi.useFakeTimers()
  let resolveInitialization!: (value: { error: null }) => void
  sdk.auth.initialize.mockReturnValue(new Promise((resolve) => { resolveInitialization = resolve }))
  window.history.replaceState(null, '', '/auth/callback#access_token=unit-test-access&refresh_token=unit-test-refresh&type=signup')
  const { getVerificationCallbackResult } = await import('./client')
  const result = getVerificationCallbackResult()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toBe(false)
  expect(window.location.hash).toBe('')
  resolveInitialization({ error: null })
  await Promise.resolve()
  expect(await getVerificationCallbackResult()).toBe(false)
  expect(sdk.createClient).toHaveBeenCalledOnce()
})
