import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import App from '../App'

const publicConfig = vi.hoisted(() => ({
  baseUrl: 'https://demo.example.test',
  apiKey: 'sb_publishable_test',
}))

vi.mock('../api/config', async () => {
  const { createHttpClient } = await import('../api/http')
  return {
    apiClient: {
      getJson: (path: string, options: { signal?: AbortSignal }) =>
        createHttpClient({ ...publicConfig, fetchImpl: fetch }).getJson(path, options),
    },
  }
})

afterEach(() => {
  publicConfig.baseUrl = 'https://demo.example.test'
  publicConfig.apiKey = 'sb_publishable_test'
  vi.unstubAllGlobals()
})

function renderRoot() {
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
}

it('opens the live recipe route from the app entry and sends GET to Supabase', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture))
  vi.stubGlobal('fetch', fetchImpl)
  renderRoot()
  expect(await screen.findByRole('heading', { name: fixture.recipe.title })).toBeTruthy()
  expect(fetchImpl).toHaveBeenCalledWith(
    'https://demo.example.test/functions/v1/demo-recipe',
    expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json', apikey: 'sb_publishable_test' },
    }),
  )
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('shows a configuration error at the app entry without sending a request', async () => {
  publicConfig.apiKey = ''
  const fetchImpl = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchImpl)
  renderRoot()
  expect((await screen.findByRole('alert')).textContent).toContain('not configured')
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('shows a safe HTTP error and retry sends another request', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Sensitive detail' } }, { status: 500 }))
    .mockResolvedValueOnce(Response.json(fixture))
  vi.stubGlobal('fetch', fetchImpl)
  renderRoot()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  expect(screen.queryByText('Sensitive detail')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: fixture.recipe.title })).toBeTruthy()
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

it.each([
  ['network failure', () => Promise.reject(new TypeError('Offline'))],
  ['invalid response', () => Promise.resolve(Response.json({ recipe: null }))],
])('shows an error without mock fallback after %s', async (_name, response) => {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(response)
  vi.stubGlobal('fetch', fetchImpl)
  renderRoot()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  expect(screen.queryByRole('heading', { name: fixture.recipe.title })).toBeNull()
  expect(fetchImpl).toHaveBeenCalledOnce()
})
