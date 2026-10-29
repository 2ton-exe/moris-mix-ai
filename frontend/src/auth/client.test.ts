import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ createClient: vi.fn(), auth: {
  getSession: vi.fn(), initialize: vi.fn(), exchangeCodeForSession: vi.fn(),
} }))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))

beforeEach(() => {
  vi.resetModules()
  sdk.auth.getSession.mockReset()
  sdk.auth.initialize.mockReset()
  sdk.auth.exchangeCodeForSession.mockReset()
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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    global: { fetch: expect.any(Function) },
  })
})

it('removes unbound URL credentials before SDK construction on any route', async () => {
  let urlAtConstruction = ''
  sdk.createClient.mockImplementationOnce(() => {
    urlAtConstruction = window.location.pathname + window.location.search + window.location.hash
    return { auth: sdk.auth }
  })
  window.history.replaceState({ state: 'preserve' }, '', '/app/recipes?lang=en&access_token=query-access&refresh_token=query-refresh#access_token=hash-access&keep=1')
  const { getAuthClient } = await import('./client')

  getAuthClient()

  expect(urlAtConstruction).toBe('/app/recipes?lang=en#keep=1')
  expect(window.history.state).toEqual({ state: 'preserve' })
})

it('preserves unrelated callback fragments while removing callback parameters', async () => {
  window.history.replaceState({ state: 'preserve' }, '', '/auth/callback?lang=en&code=unit-test-code#section')
  const { clearAuthCallbackUrl } = await import('./client')

  clearAuthCallbackUrl()

  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/auth/callback?lang=en#section')
  expect(window.history.state).toEqual({ state: 'preserve' })
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
  let resolveExchange!: (value: { data: { session: object }; error: null }) => void
  sdk.auth.initialize.mockResolvedValue({ error: null })
  sdk.auth.exchangeCodeForSession.mockReturnValue(new Promise((resolve) => { resolveExchange = resolve }))
  window.history.replaceState(null, '', '/auth/callback?code=unit-test-code')
  const { getVerificationCallbackResult } = await import('./client')
  const result = getVerificationCallbackResult()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toBe(false)
  expect(window.location.search).toBe('')
  resolveExchange({ data: { session: {} }, error: null })
  await Promise.resolve()
  expect(await getVerificationCallbackResult()).toBe(false)
  expect(sdk.createClient).toHaveBeenCalledOnce()
})

it('does not apply an expired callback deadline to later PKCE requests', async () => {
  vi.useFakeTimers()
  sdk.auth.initialize.mockResolvedValue({ error: null })
  sdk.auth.exchangeCodeForSession.mockReturnValue(new Promise(() => {}))
  window.history.replaceState(null, '', '/auth/callback?code=unit-test-code')
  const { getVerificationCallbackResult } = await import('./client')
  const result = getVerificationCallbackResult()

  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toBe(false)

  const clientOptions = sdk.createClient.mock.calls[0]?.[2] as { global?: { fetch?: typeof fetch } } | undefined
  const fetchWithGuard = clientOptions?.global?.fetch
  const response = Response.json({ ok: true })
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchImpl)

  await expect(fetchWithGuard?.('https://auth.example.test/auth/v1/token?grant_type=pkce')).resolves.toBe(response)
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('does not start a callback exchange when initialization finishes after the deadline', async () => {
  vi.useFakeTimers()
  let resolveInitialization!: (value: { error: null }) => void
  sdk.auth.initialize.mockReturnValue(new Promise((resolve) => { resolveInitialization = resolve }))
  window.history.replaceState(null, '', '/auth/callback?lang=en&code=unit-test-code')
  const { getVerificationCallbackResult } = await import('./client')
  const result = getVerificationCallbackResult()

  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toBe(false)
  resolveInitialization({ error: null })
  await vi.advanceTimersByTimeAsync(0)

  expect(sdk.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  expect(window.location.search).toBe('?lang=en')
})
