import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import App from '../App'
import { getDemoRecipe, parseDemoRecipeResponse } from '../api/demoRecipe'
import { HttpError } from '../api/http'

vi.mock('../api/demoRecipe', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/demoRecipe')>()
  return { ...original, getDemoRecipe: vi.fn() }
})

const mockedGetDemoRecipe = vi.mocked(getDemoRecipe)

afterEach(() => mockedGetDemoRecipe.mockReset())

function renderPage() {
  render(<MemoryRouter initialEntries={['/demo-recipe']}><App /></MemoryRouter>)
}

it('shows loading then renders the validated recipe from the API', async () => {
  let resolveRequest!: (recipe: ReturnType<typeof parseDemoRecipeResponse>['recipe']) => void
  mockedGetDemoRecipe.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
  renderPage()
  expect(screen.getByRole('status').textContent).toContain('Loading demonstration recipe')
  resolveRequest(parseDemoRecipeResponse(fixture).recipe)
  await screen.findByRole('heading', { name: fixture.recipe.title })
  expect(screen.getByText('200 g spaghetti')).toBeTruthy()
  expect(screen.getByText('Boil pasta in salted water.')).toBeTruthy()
  expect(screen.getByText('4 / 5')).toBeTruthy()
  expect(screen.getByText(/Rating: 4 \/ 5/)).toBeTruthy()
  expect(screen.getByText('2026-10-13')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back home' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back home' }).getAttribute('href')).toBe('/home')
  expect(mockedGetDemoRecipe).toHaveBeenCalledOnce()
})

it('shows a safe error and retries after a request failure', async () => {
  mockedGetDemoRecipe
    .mockRejectedValueOnce(new HttpError('http', 'Sensitive server details', 500, { secret: 'private' }))
    .mockResolvedValueOnce(parseDemoRecipeResponse(fixture).recipe)
  renderPage()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  expect(screen.queryByText('Sensitive server details')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: fixture.recipe.title })
  expect(mockedGetDemoRecipe).toHaveBeenCalledTimes(2)
})

it('shows a retryable error for a malformed response', async () => {
  mockedGetDemoRecipe.mockRejectedValue(new Error('Invalid payload details'))
  renderPage()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.queryByText('Invalid payload details')).toBeNull()
})

it('does not offer retry when public configuration is missing', async () => {
  mockedGetDemoRecipe.mockRejectedValue(new HttpError('configuration', 'Missing key'))
  renderPage()
  expect((await screen.findByRole('alert')).textContent).toContain('not configured')
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
})

it('aborts the request when leaving the route', () => {
  mockedGetDemoRecipe.mockImplementation(() => new Promise(() => {}))
  const { unmount } = render(<MemoryRouter initialEntries={['/demo-recipe']}><App /></MemoryRouter>)
  const signal = mockedGetDemoRecipe.mock.calls[0][0]?.signal
  expect(signal?.aborted).toBe(false)
  unmount()
  expect(signal?.aborted).toBe(true)
})
