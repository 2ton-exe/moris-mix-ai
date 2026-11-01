import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { HttpError } from '../api/http'
import RecipeDashboardPage from '../pages/RecipeDashboardPage'
import { RecipeQueryProvider } from './RecipeQueryProvider'
import { recipeKeys } from './queryOptions'
import { initialDiscoveryCriteria } from './discoveryTypes'
import type { RecipeDiscoveryPage, RecipeDiscoverySource } from './discoveryTypes'
import type { RecipeSource } from './types'
import { createRecipeSource } from './apiSource'

const rice = { id: 'rice', title: 'Garlic rice' }
const salad = { id: 'salad', title: 'Lemon salad' }
let source: RecipeSource
let page: ReturnType<typeof vi.fn<RecipeDiscoverySource['page']>>
let currentClient: QueryClient
function Probe() { currentClient = useQueryClient(); return null }
function auth(id: string | null = 'cook-a'): AuthState {
  return { user: id ? { id } : null, isAuthenticated: !!id, isLoading: false } as AuthState
}
function tree(id: string | null = 'cook-a') {
  return <StrictMode><MemoryRouter><AuthContext.Provider value={auth(id)}>
    <RecipeQueryProvider source={source}><Probe /><RecipeDashboardPage /></RecipeQueryProvider>
  </AuthContext.Provider></MemoryRouter></StrictMode>
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const card = (title = rice.title) => screen.queryByRole('heading', { name: title })
const clickMore = () => fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
async function ready() { await screen.findByRole('heading', { name: rice.title }) }
async function enterSearch(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search recipes' }), { target: { value } })
  await waitFor(() => expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ criteria: expect.objectContaining({ search: value }) })))
}

beforeEach(() => {
  // These capabilities and continuations exist only in this test adapter.
  // They deliberately do not assert any unimplemented BE-08 URL or response.
  page = vi.fn<RecipeDiscoverySource['page']>().mockResolvedValue({ recipes: [rice], nextPage: null })
  source = { mode: 'live', list: vi.fn(), detail: vi.fn(), discovery: {
    searchModes: ['title', 'ingredients', 'both'], sorts: ['newest', 'rating'],
    filters: [{ id: 'test-filter', label: 'Test filter', options: [{ value: 'test-value', label: 'Test option' }] }], page,
  } }
})
afterEach(() => vi.useRealTimers())

it('labels search, scope, filter and sort controls and advertises no production-only claims', async () => {
  render(tree())
  await ready()
  expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Search in' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Test filter' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Sort recipes' })).toBeTruthy()
  expect(source.list).not.toHaveBeenCalled()
  expect(page.mock.calls.filter(([request]) => !request.signal.aborted)).toHaveLength(1)
})

it('debounces search, hides stale cards immediately, aborts old requests and preserves pending input', async () => {
  vi.useFakeTimers()
  const old = deferred<RecipeDiscoveryPage>()
  const fresh = deferred<RecipeDiscoveryPage>()
  page.mockImplementation(({ criteria }) => criteria.search === 'salad' ? old.promise : criteria.search === 'lemon' ? fresh.promise : Promise.resolve({ recipes: [rice], nextPage: null }))
  render(tree())
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(card()).toBeTruthy()
  const input = screen.getByRole('searchbox', { name: 'Search recipes' }) as HTMLInputElement
  const initialCalls = page.mock.calls.length
  fireEvent.change(input, { target: { value: 'sa' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  fireEvent.change(input, { target: { value: 'salad' } })
  expect(card()).toBeNull()
  expect((screen.getByRole('button', { name: 'Refresh recipes' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(299) })
  expect(page).toHaveBeenCalledTimes(initialCalls)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const oldRequest = page.mock.calls.at(-1)![0]
  expect(oldRequest.criteria.search).toBe('salad')
  expect(input.value).toBe('salad')
  fireEvent.change(input, { target: { value: 'lemon' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(310) })
  expect(oldRequest.signal.aborted).toBe(true)
  await act(async () => { old.resolve({ recipes: [{ id: 'stale', title: 'Stale salad' }], nextPage: null }); await vi.advanceTimersByTimeAsync(10) })
  expect(card('Stale salad')).toBeNull()
  expect(input.value).toBe('lemon')
  await act(async () => { fresh.resolve({ recipes: [salad], nextPage: null }); await vi.advanceTimersByTimeAsync(10) })
  expect(card(salad.title)).toBeTruthy()
  expect(input.value).toBe('lemon')
})

it('shows initial loading without flashing an empty collection', async () => {
  const pending = deferred<RecipeDiscoveryPage>()
  page.mockReturnValue(pending.promise)
  render(tree())
  expect(screen.getByRole('status').textContent).toContain('Loading your recipes')
  expect(screen.queryByText(/fresh page/)).toBeNull()
  await act(async () => pending.resolve({ recipes: [rice], nextPage: null }))
  await ready()
})

it('distinguishes an empty journal from no search matches and clears the search', async () => {
  page.mockResolvedValue({ recipes: [], nextPage: null })
  render(tree())
  await screen.findByRole('heading', { name: 'A fresh page for your next favorite.' })
  await enterSearch('missing')
  await screen.findByRole('heading', { name: 'No recipes match your search.' })
  expect(screen.queryByText(/fresh page/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show all recipes' }))
  await screen.findByRole('heading', { name: 'A fresh page for your next favorite.' })
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
})

it('renders a safe first-page failure with retry', async () => {
  page.mockRejectedValue(new Error('private failure'))
  render(tree())
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load your recipes')
  expect(document.body.textContent).not.toContain('private failure')
  page.mockResolvedValue({ recipes: [rice], nextPage: null })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await ready()
})

it('moves focus from a successful first-page retry to the loaded collection', async () => {
  page.mockRejectedValue(new Error('temporary initial failure'))
  render(tree())
  const retry = await screen.findByRole('button', { name: 'Try again' })
  retry.focus()
  page.mockResolvedValue({ recipes: [rice], nextPage: null })
  fireEvent.click(retry)
  const heading = await screen.findByRole('heading', { name: 'Saved recipes (1)' })
  expect(document.activeElement).toBe(heading)
})

it('retains loaded results after a next-page failure and retries the same continuation', async () => {
  page.mockImplementation(({ continuation }) => continuation === null ? Promise.resolve({ recipes: [rice], nextPage: 'test-next' }) : Promise.reject(new Error('private page failure')))
  render(tree())
  await ready()
  clickMore()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load more')
  expect(card()).toBeTruthy()
  expect(screen.queryByText('End of results.')).toBeNull()
  page.mockResolvedValue({ recipes: [salad], nextPage: null })
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading more' }))
  await screen.findByRole('heading', { name: salad.title })
  expect(page.mock.calls.at(-1)![0].continuation).toBe('test-next')
  expect(card()).toBeTruthy()
  expect(screen.getByText('End of results.')).toBeTruthy()
})

it('blocks duplicate page requests and deduplicates overlapping cards without reordering them', async () => {
  const next = deferred<RecipeDiscoveryPage>()
  page.mockImplementation(({ continuation }) => continuation === null ? Promise.resolve({ recipes: [rice], nextPage: 24 }) : next.promise)
  render(tree())
  await ready()
  const calls = page.mock.calls.length
  const button = screen.getByRole('button', { name: 'Load more' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect((await screen.findByRole('button', { name: 'Loading more…' }) as HTMLButtonElement).disabled).toBe(true)
  expect(card()).toBeTruthy()
  await waitFor(() => expect(page).toHaveBeenCalledTimes(calls + 1))
  await act(async () => next.resolve({ recipes: [rice, salad, salad], nextPage: null }))
  await screen.findByRole('heading', { name: salad.title })
  expect(screen.getAllByRole('link', { name: /Garlic rice/ })).toHaveLength(1)
  expect(screen.getAllByRole('link', { name: /Lemon salad/ })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  expect(screen.getByText('End of results.')).toBeTruthy()
})

it.each(['sort', 'filter', 'scope', 'search'])('starts at the first page after a %s change and discards previous cards', async (control) => {
  page.mockImplementation(({ criteria, continuation }) => continuation !== null
    ? Promise.resolve({ recipes: [salad], nextPage: null })
    : Promise.resolve({ recipes: criteria.sort === 'rating' || criteria.searchMode !== 'title' || criteria.search || Object.keys(criteria.filters).length ? [{ id: 'changed', title: 'Changed results' }] : [rice], nextPage: 'test-next' }))
  render(tree())
  await ready()
  clickMore()
  await screen.findByRole('heading', { name: salad.title })
  if (control === 'search') await enterSearch('lemon')
  else fireEvent.change(screen.getByRole('combobox', { name: control === 'sort' ? 'Sort recipes' : control === 'scope' ? 'Search in' : 'Test filter' }), { target: { value: control === 'sort' ? 'rating' : control === 'scope' ? 'ingredients' : 'test-value' } })
  await screen.findByRole('heading', { name: 'Changed results' })
  expect(page.mock.calls.at(-1)![0].continuation).toBeNull()
  expect(card(salad.title)).toBeNull()
  if (control === 'filter') expect(screen.getByText(/1 active filter/)).toBeTruthy()
})

it('resets filters and sort, and starts a previously visited query at page one', async () => {
  page.mockImplementation(({ continuation }) => Promise.resolve({ recipes: continuation === null ? [rice] : [salad], nextPage: continuation === null ? 'next' : null }))
  render(tree())
  await ready()
  clickMore()
  await screen.findByRole('heading', { name: salad.title })
  fireEvent.change(screen.getByRole('combobox', { name: 'Test filter' }), { target: { value: 'test-value' } })
  await waitFor(() => expect(page.mock.calls.at(-1)![0].criteria.filters).toEqual({ 'test-filter': 'test-value' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort recipes' }), { target: { value: 'rating' } })
  await waitFor(() => expect(page.mock.calls.at(-1)![0].criteria.sort).toBe('rating'))
  fireEvent.click(screen.getByRole('button', { name: 'Reset search and filters' }))
  await waitFor(() => expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ continuation: null, criteria: initialDiscoveryCriteria })))
  expect(card(salad.title)).toBeNull()
})

it('keeps cards visible during a same-query refresh', async () => {
  render(tree())
  await ready()
  const refresh = deferred<RecipeDiscoveryPage>()
  page.mockReturnValue(refresh.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh recipes' }))
  expect(card()).toBeTruthy()
  expect(await screen.findByText('Updating your collection…')).toBeTruthy()
  await act(async () => refresh.resolve({ recipes: [salad], nextPage: null }))
  await screen.findByRole('heading', { name: salad.title })
  expect(card()).toBeNull()
})

it.each([401, 403])('hides all pages when loading more loses access (%s)', async (status) => {
  page.mockImplementation(({ continuation }) => continuation === null ? Promise.resolve({ recipes: [rice], nextPage: 'next' }) : Promise.reject(new HttpError('http', 'private details', status)))
  render(tree())
  await ready()
  clickMore()
  await screen.findByRole('alert')
  expect(card()).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry loading more' })).toBeNull()
})

it('isolates pages, input, filters and late responses after account switching and logout', async () => {
  const pending = deferred<RecipeDiscoveryPage>()
  page.mockImplementation(({ userId, continuation }) => userId === 'cook-b' ? Promise.resolve({ recipes: [salad], nextPage: null }) : continuation === null ? Promise.resolve({ recipes: [rice], nextPage: 'next' }) : pending.promise)
  const view = render(tree())
  await ready()
  const previousClient = currentClient
  clickMore()
  const request = page.mock.calls.at(-1)![0]
  view.rerender(tree('cook-b'))
  expect(card()).toBeNull()
  await screen.findByRole('heading', { name: salad.title })
  expect(request.signal.aborted).toBe(true)
  await act(async () => pending.resolve({ recipes: [{ id: 'secret', title: 'Previous account secret' }], nextPage: null }))
  expect(card('Previous account secret')).toBeNull()
  expect(previousClient.getQueryCache().getAll()).toHaveLength(0)
  const calls = page.mock.calls.length
  view.rerender(tree(null))
  expect(card(salad.title)).toBeNull()
  expect(page).toHaveBeenCalledTimes(calls)
  view.rerender(tree('cook-a'))
  await ready()
  expect(page.mock.calls.at(-1)![0].continuation).toBeNull()
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
})

it('invalidates all discovery variants through the established account list prefix', async () => {
  render(tree())
  await ready()
  const first = recipeKeys.discovery('cook-a', initialDiscoveryCriteria)
  const second = recipeKeys.discovery('cook-a', { ...initialDiscoveryCriteria, sort: 'rating' })
  const other = recipeKeys.discovery('cook-b', initialDiscoveryCriteria)
  currentClient.setQueryData(second, { pages: [], pageParams: [] })
  currentClient.setQueryData(other, { pages: [], pageParams: [] })
  await act(async () => { await currentClient.invalidateQueries({ queryKey: recipeKeys.lists('cook-a'), refetchType: 'none' }) })
  expect(currentClient.getQueryState(first)?.isInvalidated).toBe(true)
  expect(currentClient.getQueryState(second)?.isInvalidated).toBe(true)
  expect(currentClient.getQueryState(other)?.isInvalidated).toBe(false)
})

it('clears private search and filter controls when the authenticated account changes', async () => {
  const view = render(tree())
  await ready()
  await enterSearch('private search')
  fireEvent.change(screen.getByRole('combobox', { name: 'Test filter' }), { target: { value: 'test-value' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort recipes' }), { target: { value: 'rating' } })
  await waitFor(() => expect(page.mock.calls.at(-1)![0].criteria.sort).toBe('rating'))
  view.rerender(tree('cook-b'))
  await ready()
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
  expect((screen.getByRole('combobox', { name: 'Test filter' }) as HTMLSelectElement).value).toBe('')
  expect((screen.getByRole('combobox', { name: 'Sort recipes' }) as HTMLSelectElement).value).toBe('newest')
  expect(page.mock.calls.at(-1)![0]).toMatchObject({ userId: 'cook-b', continuation: null, criteria: initialDiscoveryCriteria })
})

it('can load a new query while an abandoned page request has not settled', async () => {
  const abandoned = deferred<RecipeDiscoveryPage>()
  page.mockImplementation(({ criteria, continuation }) => continuation === null
    ? Promise.resolve({ recipes: [rice], nextPage: 'next' })
    : criteria.sort === 'newest' ? abandoned.promise : Promise.resolve({ recipes: [salad], nextPage: null }))
  render(tree())
  await ready()
  clickMore()
  await screen.findByRole('button', { name: 'Loading more…' })
  const oldRequest = page.mock.calls.at(-1)![0]
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort recipes' }), { target: { value: 'rating' } })
  await screen.findByRole('button', { name: 'Load more' })
  clickMore()
  await screen.findByRole('heading', { name: salad.title })
  expect(oldRequest.signal.aborted).toBe(true)
  await act(async () => abandoned.resolve({ recipes: [{ id: 'old', title: 'Old query card' }], nextPage: null }))
  expect(card('Old query card')).toBeNull()
})

it('reports a non-progressing continuation without losing the first page', async () => {
  page.mockImplementation(({ continuation }) => Promise.resolve({ recipes: [rice], nextPage: continuation ?? 'next' }))
  render(tree())
  await ready()
  clickMore()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load more')
  expect(card()).toBeTruthy()
  expect(screen.queryByText('End of results.')).toBeNull()
})

it('returns keyboard focus to the next pagination action or end state after a page settles', async () => {
  page.mockImplementation(({ continuation }) => continuation === null
    ? Promise.resolve({ recipes: [rice], nextPage: 'next' })
    : Promise.reject(new Error('temporary page failure')))
  render(tree())
  await ready()
  const load = screen.getByRole('button', { name: 'Load more' })
  load.focus()
  fireEvent.click(load)
  const retry = await screen.findByRole('button', { name: 'Retry loading more' })
  expect(document.activeElement).toBe(retry)
  page.mockResolvedValue({ recipes: [salad], nextPage: null })
  retry.focus()
  fireEvent.click(retry)
  const end = await screen.findByText('End of results.')
  expect(document.activeElement).toBe(end)
})

it('enables confirmed live search and sorting while keeping unsupported filters disabled', async () => {
  const live = createRecipeSource()
  source.discovery = { ...live.discovery!, page }
  render(tree())
  await ready()
  expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(false)
  expect((screen.getByRole('combobox', { name: 'Search in' }) as HTMLSelectElement).disabled).toBe(false)
  expect((screen.getByRole('option', { name: 'Rating' }) as HTMLOptionElement).disabled).toBe(false)
  expect((screen.getByRole('combobox', { name: 'Filters' }) as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByText(/No recipe filters are connected/)).toBeTruthy()
})

it.each([
  { recipes: null, nextPage: null },
  { recipes: [rice], nextPage: {} },
  { recipes: [rice] },
])('rejects a malformed adapter page before rendering', async (result) => {
  page.mockResolvedValue(result as unknown as RecipeDiscoveryPage)
  render(tree())
  await screen.findByRole('alert')
  expect(card()).toBeNull()
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
})

it.each([
  ['title', 'Garlick Rice', 'Garlic Rice'],
  ['ingredients', 'shalots', 'Shallot Fried Rice'],
  ['both', 'buter pasta', 'Butter Pasta'],
] as const)('renders matching card when searching misspelled query in %s mode', async (mode, query, title) => {
  const matchingRecipe = { id: `recipe-${mode}`, title }
  page.mockImplementation(({ criteria }) => {
    if (criteria.search === query && criteria.searchMode === mode) {
      return Promise.resolve({ recipes: [matchingRecipe], nextPage: null })
    }
    return Promise.resolve({ recipes: [], nextPage: null })
  })
  render(tree())
  fireEvent.change(screen.getByRole('combobox', { name: 'Search in' }), { target: { value: mode } })
  await enterSearch(query)
  expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
})
