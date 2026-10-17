import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('connects the client to the Vite API base URL', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://configured.example.test')
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ transportTest: true }))
  vi.stubGlobal('fetch', fetchImpl)
  const { apiClient } = await import('./config')
  await apiClient.getJson('/functions/v1/demo-recipe')
  expect(fetchImpl.mock.calls[0][0]).toBe('https://configured.example.test/functions/v1/demo-recipe')
})

it('does not request data when the Vite API base URL is unset', async () => {
  vi.stubEnv('VITE_API_BASE_URL', '')
  const fetchImpl = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchImpl)
  const { apiClient } = await import('./config')
  await expect(apiClient.getJson('/functions/v1/demo-recipe')).rejects.toMatchObject({ kind: 'configuration' })
  expect(fetchImpl).not.toHaveBeenCalled()
})
