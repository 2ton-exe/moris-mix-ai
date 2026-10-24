import { StrictMode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { HttpError } from '../api/http'
import JournalPage from '../pages/JournalPage'
import RecipeDashboardPage from '../pages/RecipeDashboardPage'
import RecipeDetailPage from '../pages/RecipeDetailPage'
import { RecipeQueryProvider } from './RecipeQueryProvider'
import { useRecipes } from './queries'
import { recipeKeys } from './queryOptions'
import { defaultRecipeSource, RecipeIntegrationUnavailable } from './source'
import { previewRecipes, previewRecipeSource } from './testing/previewAdapter'
import type { RecipeDetail, RecipeSource, RecipeSummary } from './types'

function authState(id: string | null = 'cook-a', token = 'current-token'): AuthState {
  const user = id ? { id, aud: 'authenticated', email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-10-19' } : null
  const session: Session | null = user ? { user, access_token: token, refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer' } : null
  return { user, session, isLoading: false, isAuthenticated: !!user, error: null, logoutNotice: null,
    dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn(), resendVerification: vi.fn() }
}

let currentClient: QueryClient
function ObserveClient() {
  currentClient = useQueryClient()
  return null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

let source: RecipeSource
beforeEach(() => {
  source = { mode: 'live', list: vi.fn().mockResolvedValue(previewRecipes), detail: vi.fn().mockResolvedValue(previewRecipes[0]) }
})

function tree(path: string, state = authState(), duplicateConsumer = false) {
  return <StrictMode><MemoryRouter initialEntries={[path]}>
    <AuthContext.Provider value={state}><RecipeQueryProvider source={source}>
      <ObserveClient />
      {duplicateConsumer && <SecondListConsumer />}
      <Routes><Route path="/app" element={<JournalPage />}>
        <Route index element={<RecipeDashboardPage />} />
        <Route path="recipes" element={<RecipeDashboardPage />} />
        <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
      </Route><Route path="/demo-recipe" element={<h1>Public demo</h1>} /></Routes>
    </RecipeQueryProvider></AuthContext.Provider>
  </MemoryRouter></StrictMode>
}

function SecondListConsumer() { useRecipes(); return null }

it('reserves a card grid while loading, then renders collection metadata and detail links', async () => {
  const request = deferred<RecipeSummary[]>()
  vi.mocked(source.list).mockReturnValue(request.promise)
  render(tree('/app'))
  expect(screen.getByRole('status').textContent).toContain('Loading your recipes')
  expect(screen.queryByText(/fresh page/)).toBeNull()
  await act(async () => request.resolve(previewRecipes))
  const link = await screen.findByRole('link', { name: /Ginger and garlic rice/ })
  expect(link.getAttribute('href')).toBe(`/app/recipes/${previewRecipes[0].id}`)
  expect(within(link).getByText('4 / 5')).toBeTruthy()
  expect(within(link).getByText('2026-10-18')).toBeTruthy()
  const other = screen.getByRole('link', { name: /Lemon chickpea salad/ })
  expect(within(other).queryByText('Rating')).toBeNull()
})

it('shows an empty journal with creation guidance and a working demo link', async () => {
  vi.mocked(source.list).mockResolvedValue([])
  render(tree('/app/recipes'))
  await screen.findByRole('heading', { name: 'A fresh page for your next favorite.' })
  fireEvent.click(screen.getByText('Plan your first recipe'))
  expect(screen.getByText(/Recipe creation is coming soon/)).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: 'Explore a demonstration recipe' }))
  await screen.findByRole('heading', { name: 'Public demo' })
})

it('keeps loaded cards visible during refresh and replaces them with fresh server results', async () => {
  render(tree('/app/recipes'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  const refresh = deferred<RecipeSummary[]>()
  vi.mocked(source.list).mockReturnValue(refresh.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh recipes' }))
  expect(screen.getByRole('heading', { name: previewRecipes[0].title })).toBeTruthy()
  expect((await screen.findByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => refresh.resolve([{ id: 'new', title: 'A newly saved recipe' }]))
  await screen.findByRole('heading', { name: 'A newly saved recipe' })
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
})

it('shows safe errors and recovers through manual retry', async () => {
  vi.mocked(source.list).mockRejectedValue(new Error('private backend detail'))
  render(tree('/app'))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load your recipes')
  expect(document.body.textContent).not.toContain('private backend detail')
  vi.mocked(source.list).mockResolvedValue(previewRecipes)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
})

it.each([
  ['non-array collection', null],
  ['object title', [{ id: 'broken', title: { private: 'backend detail' } }]],
  ['malformed ID encoding', [{ id: '\uD800', title: 'Broken recipe' }]],
  ['object rating', [{ id: 'broken', title: 'Broken recipe', star_rating: {} }]],
  ['impossible cooked date', [{ id: 'broken', title: 'Broken recipe', cooked_at: '2026-02-30' }]],
  ['object cooked date', [{ id: 'broken', title: 'Broken recipe', cooked_at: {} }]],
])('rejects malformed list data (%s) before rendering', async (_name, data) => {
  vi.mocked(source.list).mockResolvedValue(data as unknown as RecipeSummary[])
  render(tree('/app'))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load your recipes')
  expect(document.body.textContent).not.toContain('backend detail')
})

it.each([
  ['null detail', null],
  ['missing ingredients', { ...previewRecipes[0], ingredients: null }],
  ['object ingredient name', { ...previewRecipes[0], ingredients: [{ ...previewRecipes[0].ingredients[0], name: {} }] }],
  ['object ingredient unit', { ...previewRecipes[0], ingredients: [{ ...previewRecipes[0].ingredients[0], unit: {} }] }],
  ['missing instructions', { ...previewRecipes[0], instructions: null }],
  ['non-finite step', { ...previewRecipes[0], instructions: [{ step: NaN, text: 'Broken step' }] }],
  ['object step text', { ...previewRecipes[0], instructions: [{ step: 1, text: {} }] }],
  ['object flavor score', { ...previewRecipes[0], flavor_scores: { ...previewRecipes[0].flavor_scores, sweet: {} } }],
  ['malformed extra flavor', { ...previewRecipes[0], flavor_scores: { ...previewRecipes[0].flavor_scores, extra: {} } }],
  ['mismatched detail ID', { ...previewRecipes[0], id: 'different-recipe' }],
])('rejects malformed detail data (%s) before rendering', async (_name, data) => {
  vi.mocked(source.detail).mockResolvedValue(data as unknown as RecipeDetail)
  render(tree(`/app/recipes/${previewRecipes[0].id}`))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load this recipe')
  expect(screen.getByRole('link', { name: /Back to recipes/ })).toBeTruthy()
})

it.each([401, 403])('does not retry a collection HTTP %s or show cached recipes after access is denied', async (status) => {
  render(tree('/app'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  const calls = vi.mocked(source.list).mock.calls.length
  expect(vi.mocked(source.list).mock.calls.filter(([request]) => !request.signal.aborted)).toHaveLength(1)
  vi.mocked(source.list).mockRejectedValue(new HttpError('http', 'private detail', status))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh recipes' }))
  expect((await screen.findByRole('alert')).textContent).toContain(status === 401 ? 'session could not be verified' : 'permission')
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  expect(vi.mocked(source.list).mock.calls.length).toBe(calls + 1)
  expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
})

it('labels stale data when a background refresh fails', async () => {
  render(tree('/app'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  vi.mocked(source.list).mockRejectedValue(new Error('private error'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh recipes' }))
  await screen.findByRole('alert')
  expect(screen.getByText(/Showing your last loaded collection/)).toBeTruthy()
  expect(screen.getByRole('heading', { name: previewRecipes[0].title })).toBeTruthy()
})

it('loads a detail by route ID, orders steps without mutating data, and navigates back', async () => {
  const recipe = { ...previewRecipes[0], instructions: [{ step: 2, text: 'Serve it.' }, { step: 1, text: 'Prepare it.' }] }
  vi.mocked(source.detail).mockResolvedValue(recipe)
  render(tree(`/app/recipes/${recipe.id}`))
  await screen.findByRole('heading', { name: recipe.title, level: 1 })
  expect(source.detail).toHaveBeenCalledWith(recipe.id, expect.objectContaining({ userId: 'cook-a', signal: expect.any(AbortSignal) }))
  const steps = within(screen.getByRole('region', { name: 'In the kitchen' })).getAllByRole('listitem')
  expect(steps.map((step) => step.textContent)).toEqual(['Prepare it.', 'Serve it.'])
  expect(steps.map((step) => step.getAttribute('value'))).toEqual(['1', '2'])
  expect(recipe.instructions[0].step).toBe(2)
  expect(screen.getByText('To taste salt')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Flavor notes' })).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: /Back to recipes/ }))
  await screen.findByRole('heading', { name: 'Your cooking journal' })
})

it('shows a detail loading state and handles missing metadata and empty content', async () => {
  const request = deferred<RecipeDetail>()
  vi.mocked(source.detail).mockReturnValue(request.promise)
  render(tree('/app/recipes/minimal'))
  expect(screen.getByRole('status').textContent).toContain('Loading recipe')
  await act(async () => request.resolve({ id: 'minimal', title: 'A recipe to finish later', ingredients: [], instructions: [] }))
  await screen.findByRole('heading', { name: 'A recipe to finish later' })
  expect(screen.getByText('No ingredients listed.')).toBeTruthy()
  expect(screen.getByText('No cooking steps listed.')).toBeTruthy()
  expect(screen.queryByText('Rating')).toBeNull()
  expect(screen.queryByText('Cooked')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Flavor notes' })).toBeNull()
})

it.each([
  [401, 'session could not be verified'], [403, 'permission to view this recipe'], [404, 'could not be found'],
])('handles detail HTTP %s safely without retrying', async (status, message) => {
  vi.mocked(source.detail).mockRejectedValue(new HttpError('http', 'private detail', status as number))
  render(tree('/app/recipes/missing'))
  expect((await screen.findByRole('alert')).textContent).toContain(message)
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  expect(document.body.textContent).not.toContain('private detail')
  expect(screen.getByRole('link', { name: /Back to recipes/ })).toBeTruthy()
})

it('recovers a failed detail request with retry', async () => {
  vi.mocked(source.detail).mockRejectedValue(new HttpError('invalid-json', 'private parse detail', 200))
  render(tree(`/app/recipes/${previewRecipes[0].id}`))
  await screen.findByRole('alert')
  vi.mocked(source.detail).mockResolvedValue(previewRecipes[0])
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
})

it('retries a server failure twice, then shows a safe error with manual recovery', async () => {
  vi.mocked(source.list).mockRejectedValue(new HttpError('http', 'private upstream detail', 503))
  render(tree('/app'))
  await screen.findByRole('alert', {}, { timeout: 5000 })
  const activeRequests = vi.mocked(source.list).mock.calls.filter(([request]) => !request.signal.aborted)
  expect(activeRequests).toHaveLength(3)
  expect(document.body.textContent).not.toContain('private upstream detail')
  vi.mocked(source.list).mockResolvedValue(previewRecipes)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
})

it('removes a cached detail after the server reports that it is no longer available', async () => {
  render(tree(`/app/recipes/${previewRecipes[0].id}`))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  vi.mocked(source.detail).mockRejectedValue(new HttpError('http', 'private error', 404))
  await act(async () => currentClient.invalidateQueries({ queryKey: recipeKeys.detail('cook-a', previewRecipes[0].id) }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Ingredients' })).toBeNull()
})

it('uses the authenticated production source when configured and never falls back to preview data', async () => {
  source = defaultRecipeSource
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  render(tree('/app'))
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  const configured = !!import.meta.env.VITE_SUPABASE_URL?.trim() &&
    !!(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim())
  expect(defaultRecipeSource.mode).toBe(configured ? 'live' : 'unavailable')
  if (configured) {
    expect((await screen.findByRole('alert')).textContent).toMatch(/session/i)
  } else {
    expect((await screen.findByText(/Your recipe journal is not connected yet/)).textContent).toBeTruthy()
    await expect(defaultRecipeSource.list({ userId: 'cook-a', signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(RecipeIntegrationUnavailable)
  }
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})

it('clearly labels the opt-in preview on both screens', async () => {
  source = previewRecipeSource
  render(tree('/app'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  expect(screen.getByRole('note').textContent).toContain('not your saved collection')
  fireEvent.click(screen.getByRole('link', { name: /Ginger and garlic rice/ }))
  await screen.findByRole('heading', { name: previewRecipes[0].title, level: 1 })
  expect(screen.getByRole('note')).toBeTruthy()
})

it('deduplicates simultaneous list consumers and reuses fresh cache when returning from detail', async () => {
  render(tree('/app', authState(), true))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  // Strict Mode may abort an initial mount; both active consumers share one key.
  const calls = vi.mocked(source.list).mock.calls.length
  expect(vi.mocked(source.list).mock.calls.filter(([request]) => !request.signal.aborted)).toHaveLength(1)
  fireEvent.click(screen.getByRole('link', { name: /Ginger and garlic rice/ }))
  await screen.findByRole('heading', { name: previewRecipes[0].title, level: 1 })
  fireEvent.click(screen.getByRole('link', { name: /Back to recipes/ }))
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  expect(vi.mocked(source.list).mock.calls.length).toBe(calls)
  expect(currentClient.getQueryCache().findAll({ queryKey: recipeKeys.lists('cook-a') })).toHaveLength(1)
})

it('isolates users immediately, aborts old requests, clears the old cache, and rejects late results', async () => {
  const late = deferred<RecipeSummary[]>()
  vi.mocked(source.list).mockImplementation(({ userId }) => userId === 'cook-a' ? late.promise : Promise.resolve([{ id: 'b', title: 'Account B recipe' }]))
  const view = render(tree('/app'))
  const oldClient = currentClient
  const signal = vi.mocked(source.list).mock.calls.at(-1)![0].signal
  // Seed both kinds of cached private data before switching accounts.
  act(() => oldClient.setQueryData(recipeKeys.detail('cook-a', 'private'), previewRecipes[0]))
  view.rerender(tree('/app', authState('cook-b')))
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  await screen.findByRole('heading', { name: 'Account B recipe' })
  expect(currentClient).not.toBe(oldClient)
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
  expect(signal.aborted).toBe(true)
  await act(async () => late.resolve(previewRecipes))
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  expect(currentClient.getQueryData(recipeKeys.lists('cook-a'))).toBeUndefined()
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
})

it('clears list and detail data on logout and fetches again even for the same user', async () => {
  const view = render(tree('/app'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  const oldClient = currentClient
  act(() => oldClient.setQueryData(recipeKeys.detail('cook-a', 'private'), previewRecipes[0]))
  view.rerender(tree('/app', authState(null)))
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
  const calls = vi.mocked(source.list).mock.calls.length
  view.rerender(tree('/app', authState()))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  expect(vi.mocked(source.list).mock.calls.length).toBeGreaterThan(calls)
})

it('ignores a late detail response after switching accounts on the same recipe route', async () => {
  const late = deferred<RecipeDetail>()
  vi.mocked(source.detail).mockImplementation((_id, { userId }) => userId === 'cook-a'
    ? late.promise
    : Promise.resolve({ ...previewRecipes[0], title: 'Account B detail' }))
  const path = `/app/recipes/${previewRecipes[0].id}`
  const view = render(tree(path))
  const oldClient = currentClient
  const signal = vi.mocked(source.detail).mock.calls.at(-1)![1].signal
  view.rerender(tree(path, authState('cook-b')))
  await screen.findByRole('heading', { name: 'Account B detail' })
  await act(async () => late.resolve(previewRecipes[0]))
  expect(signal.aborted).toBe(true)
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
  expect(screen.queryByRole('heading', { name: previewRecipes[0].title })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Account B detail' })).toBeTruthy()
})

it('preserves the account cache when the same user refreshes their token', async () => {
  const view = render(tree('/app'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  const client = currentClient
  const calls = vi.mocked(source.list).mock.calls.length
  view.rerender(tree('/app', authState('cook-a', 'refreshed-token')))
  expect(currentClient).toBe(client)
  expect(vi.mocked(source.list).mock.calls.length).toBe(calls)
})

it('supports future mutation invalidation through the account prefix', async () => {
  render(tree('/app'))
  await screen.findByRole('heading', { name: previewRecipes[0].title })
  vi.mocked(source.list).mockResolvedValue([{ id: 'new', title: 'After invalidation' }])
  await act(async () => currentClient.invalidateQueries({ queryKey: recipeKeys.all('cook-a') }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'After invalidation' })).toBeTruthy())
})
