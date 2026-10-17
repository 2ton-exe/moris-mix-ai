import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('connects the client with the Vite Supabase URL and publishable key', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://configured.example.test')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ transportTest: true }))
  vi.stubGlobal('fetch', fetchImpl)
  const { apiClient } = await import('./config')
  await apiClient.getJson('/functions/v1/demo-recipe')
  expect(fetchImpl.mock.calls[0][0]).toBe('https://configured.example.test/functions/v1/demo-recipe')
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    credentials: 'omit',
  })
  expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json', apikey: 'sb_publishable_test' })
})

it('accepts a legacy public anon key when no publishable key is configured', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://configured.example.test')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-public-test-key')
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ transportTest: true }))
  vi.stubGlobal('fetch', fetchImpl)
  const { apiClient } = await import('./config')
  await apiClient.getJson('/functions/v1/demo-recipe')
  expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json', apikey: 'legacy-public-test-key' })
})

it.each([
  ['', 'public-test-key'],
  ['https://configured.example.test', ''],
])('does not request data when public configuration is missing', async (url, key) => {
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', key)
  const fetchImpl = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchImpl)
  const { apiClient } = await import('./config')
  await expect(apiClient.getJson('/functions/v1/demo-recipe')).rejects.toMatchObject({ kind: 'configuration' })
  expect(fetchImpl).not.toHaveBeenCalled()
})
