import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import App from '../App'
import { getDemoRecipe, parseDemoRecipeResponse } from '../api/demoRecipe'
import { HttpError } from '../api/http'

const readingPages = vi.hoisted(() => [[
  ...Array.from({ length: 20 }, (_, index) => `ingredient-${index}`),
  ...Array.from({ length: 20 }, (_, index) => `instruction-${index}`),
  ...Array.from({ length: 20 }, (_, index) => `note-${index}`),
  'ingredients-empty', 'instructions-empty', 'flavors',
]])

vi.mock('../recipes/useReadingPagination', () => ({
  useReadingPagination: () => ({
    bodyRef: { current: null }, leftRef: { current: null }, bankRef: { current: null },
    measurable: false, ready: true, textChunkSize: 10_000,
    layout: { pages: readingPages, capacity: 1_000, width: 400 },
  }),
}))

vi.mock('../api/demoRecipe', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/demoRecipe')>()
  return { ...original, getDemoRecipe: vi.fn() }
})

const mockedGetDemoRecipe = vi.mocked(getDemoRecipe)

afterEach(() => {
  mockedGetDemoRecipe.mockReset()
  vi.unstubAllGlobals()
})

function renderPage() {
  render(<MemoryRouter initialEntries={['/demo-recipe']}><App /></MemoryRouter>)
}

it('shows loading then renders the validated recipe from the API', async () => {
  let resolveRequest!: (recipe: ReturnType<typeof parseDemoRecipeResponse>['recipe']) => void
  mockedGetDemoRecipe.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
  renderPage()
  expect(screen.getByRole('status').textContent).toContain('Loading demonstration recipe')
  await waitFor(() => expect(mockedGetDemoRecipe).toHaveBeenCalledOnce())
  resolveRequest(parseDemoRecipeResponse(fixture).recipe)
  await screen.findByRole('heading', { name: fixture.recipe.title, level: 1 })
  expect(screen.getByText('Sample recipe')).toBeTruthy()
  expect(screen.getByText('200 g spaghetti')).toBeTruthy()
  expect(screen.getByText('Boil pasta in salted water.')).toBeTruthy()
  expect(screen.queryByText('No personal notes are included in this demonstration.')).toBeNull()
  const identity = screen.getByRole('region', { name: 'Recipe identity and details' })
  expect(within(identity).getByText('4 / 5')).toBeTruthy()
  expect(within(identity).getByRole('img', { name: '4 out of 5 stars' })).toBeTruthy()
  expect(identity.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-13')
  expect(within(screen.getByRole('region', { name: 'Flavor scores' })).getByText('4 / 5')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back home' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back home' }).getAttribute('href')).toBe('/home')
  expect(screen.getByRole('link', { name: 'Start a private journal' }).getAttribute('href')).toBe('/signup')
  const pages = screen.getByRole('navigation', { name: 'Recipe reading pages' })
  expect(pages.closest('.mm-pagination-band')?.closest('.mm-journal-page-footer')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Recipe actions' })).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'Home' })).toHaveLength(1)
  expect(screen.queryByRole('link', { name: 'Home →' })).toBeNull()
  expect(mockedGetDemoRecipe).toHaveBeenCalledOnce()
  expect(screen.queryByRole('link', { name: 'Try a recipe revision' })).toBeNull()
})

it('offers the separate revision walkthrough from the desktop demo', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(min-width: 1100px) and (min-height: 640px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  mockedGetDemoRecipe.mockResolvedValueOnce(parseDemoRecipeResponse(fixture).recipe)
  renderPage()

  const link = await screen.findByRole('link', { name: 'Try a recipe revision' })
  fireEvent.click(link)
  await screen.findByRole('heading', { name: 'Chicken Adobo' })
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
