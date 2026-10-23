import { StrictMode } from 'react'
import { createContext, useContext, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, createRoutesFromElements, Link, matchRoutes, Outlet, Route, RouterProvider, useNavigate, useParams } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { ProtectedRoute } from '../auth/AuthRoutes'
import { createAppRouteElements } from '../App'
import { HttpError } from '../api/http'
import CreateRecipePage from '../pages/CreateRecipePage'
import EditRecipePage from '../pages/EditRecipePage'
import type { RecipeEditorRecord, SaveRecipeDraft } from './submission'
import { recipeFormFixture } from './testing/fixtures'

const draft = { ...recipeFormFixture, notes: '' }
const NativeRequest = globalThis.Request
beforeEach(() => vi.stubGlobal('Request', class TestRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : undefined)
  }
}))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
type PageOptions = {
  path: string; state: AuthState; save?: SaveRecipeDraft; initial?: RecipeEditorRecord
  isLoading?: boolean; loadError?: Error; loadMatchingRecordOnRouteChange?: boolean
  history?: string[]; initialIndex?: number
}
const PageOptionsContext = createContext<PageOptions | null>(null)

function TestNavigationControls() {
  const navigate = useNavigate()
  return <nav aria-label="Test navigation">
    <Link to="/app">Internal journal link</Link>
    <button type="button" onClick={() => navigate('/app')}>Programmatic journal navigation</button>
    <button type="button" onClick={() => navigate(-1)}>Browser back</button>
    <button type="button" onClick={() => navigate(1)}>Browser forward</button>
    <button type="button" onClick={() => navigate('/app/recipes/recipe-b/edit')}>Navigate to another recipe</button>
  </nav>
}

function PageRoutes() {
  const options = useContext(PageOptionsContext)
  if (!options) return null
  return <AuthContext.Provider value={options.state}><Outlet /><TestNavigationControls /></AuthContext.Provider>
}

function CreatePageFromOptions() {
  const options = useContext(PageOptionsContext)
  return options ? <CreateRecipePage save={options.save} notesSupported /> : null
}

function EditPageFromOptions() {
  const options = useContext(PageOptionsContext)
  const { recipeId = '' } = useParams()
  const recordForRoute = options?.initial
    ? options.initial.id === recipeId ? options.initial
      : options.loadMatchingRecordOnRouteChange ? record(options.initial.userId, recipeId) : undefined
    : undefined
  return options ? <EditRecipePage record={recordForRoute} save={options.save} isLoading={options.isLoading} loadError={options.loadError} notesSupported /> : null
}

const pageRoutes = createRoutesFromElements(
  <Route element={<PageRoutes />}>
    <Route element={<ProtectedRoute />}>
      <Route path="/app/recipes/new" element={<CreatePageFromOptions />} />
      <Route path="/app/recipes/:recipeId/edit" element={<EditPageFromOptions />} />
      <Route path="/app" element={<h1>Journal</h1>} />
      <Route path="/app/other" element={<h1>Another page</h1>} />
    </Route>
    <Route path="/login" element={<h1>Login required</h1>} />
  </Route>,
)

function RoutedTree({ options }: { options: PageOptions }) {
  const [router] = useState(() => createMemoryRouter(pageRoutes, {
    initialEntries: options.history ?? ['/app', options.path],
    initialIndex: options.initialIndex,
  }))
  return <PageOptionsContext.Provider value={options}><RouterProvider router={router} /></PageOptionsContext.Provider>
}

function authState(id: string | null = 'cook-a', expired = false): AuthState {
  const user: User | null = id ? { id, aud: 'authenticated', email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-10-19' } : null
  const session: Session | null = user ? { user, access_token: 'test-only-access', refresh_token: 'test-only-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600) } : null
  return { user, session, isLoading: false, isAuthenticated: !!user, error: null, logoutNotice: null,
    dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn(), resendVerification: vi.fn() }
}
function record(userId = 'cook-a', id = 'recipe-a'): RecipeEditorRecord { return { userId, id, values: draft } }
function tree(options: Partial<PageOptions> = {}) {
  const complete: PageOptions = { path: '/app/recipes/new', state: authState(), ...options }
  return <StrictMode><RoutedTree options={complete} /></StrictMode>
}
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })) }
function title(value: string) { fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value } }) }

it.each([
  ['/app/recipes/new', '/app/recipes/new'],
  ['/app/recipes/recipe-a/edit', '/app/recipes/:recipeId/edit'],
  ['/app/recipes', 'recipes'],
])('keeps the production data-router route tree matching %s', (path, expectedRoute) => {
  const matches = matchRoutes(createRoutesFromElements(createAppRouteElements()), path)
  expect(matches?.at(-1)?.route.path).toBe(expectedRoute)
})

it('gates the create page using FE-03 protected routes without invoking the save adapter', () => {
  const save = vi.fn()
  render(tree({ state: authState(null), save }))
  expect(screen.getByRole('heading', { name: 'Login required' })).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
})

it('gates an edit deep link without exposing existing recipe values', () => {
  render(tree({ path: '/app/recipes/recipe-a/edit', state: authState(null), initial: record() }))
  expect(screen.getByRole('heading', { name: 'Login required' })).toBeTruthy()
  expect(screen.queryByDisplayValue(draft.title)).toBeNull()
})

it('sends a normalized create draft with account identity and cancellation to the injected adapter', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const save = vi.fn().mockResolvedValue({ id: 'created' })
  render(tree({ save }))
  title('  A new recipe  ')
  click('Save recipe')
  await screen.findByText('Recipe saved.')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'A new recipe' }), expect.objectContaining({ userId: 'cook-a', signal: expect.any(AbortSignal) }))
  click('Back to journal')
  expect(confirm).not.toHaveBeenCalled()
  expect(await screen.findByRole('heading', { name: 'Journal' })).toBeTruthy()
})

it('blocks internal links and programmatic navigation once per attempt while preserving the draft', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(tree())
  title('Do not lose this draft')

  fireEvent.click(screen.getByRole('link', { name: 'Internal journal link' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByDisplayValue('Do not lose this draft')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Programmatic journal navigation' }))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(screen.getByDisplayValue('Do not lose this draft')).toBeTruthy()
})

it('uses one confirmation for the editor Back button and proceeds when the user leaves', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(tree())
  title('Leave after confirmation')
  click('Back to journal')
  expect(confirm).toHaveBeenCalledOnce()
  expect(await screen.findByRole('heading', { name: 'Journal' })).toBeTruthy()
})

it('blocks browser back navigation and keeps the create form when the user stays', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(tree())
  title('Keep me here')
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByDisplayValue('Keep me here')).toBeTruthy()
})

it('blocks browser forward navigation when it would leave the form', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(tree({
    history: ['/app', '/app/recipes/new', '/app/other'],
    initialIndex: 1,
  }))
  title('Keep this draft on forward')
  fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByDisplayValue('Keep this draft on forward')).toBeTruthy()
})

it('keeps a pending save on Stay and aborts it when confirmed navigation leaves the route', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  let resolve!: (value: { id: string }) => void
  const save = vi.fn().mockImplementation(() => new Promise<{ id: string }>((res) => { resolve = res }))
  render(tree({ save }))
  title('Pending route draft')
  click('Save recipe')
  const signal = save.mock.calls[0][1].signal as AbortSignal

  click('Programmatic journal navigation')
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByDisplayValue('Pending route draft')).toBeTruthy()
  expect(signal.aborted).toBe(false)

  confirm.mockReturnValue(true)
  click('Programmatic journal navigation')
  expect(await screen.findByRole('heading', { name: 'Journal' })).toBeTruthy()
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ id: 'created-after-leave' }))
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('blocks navigation to another recipe without replacing the current edit draft', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(tree({ path: '/app/recipes/recipe-a/edit', initial: record() }))
  title('Current recipe draft')
  fireEvent.click(screen.getByRole('button', { name: 'Navigate to another recipe' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByDisplayValue('Current recipe draft')).toBeTruthy()
})

it('loads the new recipe after confirmed navigation between edit IDs without carrying the old draft', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(tree({ path: '/app/recipes/recipe-a/edit', initial: record(), loadMatchingRecordOnRouteChange: true }))
  title('Unsaved recipe A')

  click('Navigate to another recipe')
  expect((await screen.findByLabelText('Recipe title') as HTMLInputElement).value).toBe(draft.title)
  expect(screen.queryByDisplayValue('Unsaved recipe A')).toBeNull()
})

it('allows the FE-03 protected-route redirect to login without trapping an expired session', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const view = render(tree())
  title('Private unsaved draft')
  view.rerender(tree({ state: authState(null) }))
  expect(screen.getByRole('heading', { name: 'Login required' })).toBeTruthy()
  expect(confirm).not.toHaveBeenCalled()
})

it('clears the old account blocker when a form resets for a different user', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const view = render(tree())
  title('Account A draft')
  view.rerender(tree({ state: authState('cook-b') }))
  expect(screen.queryByDisplayValue('Account A draft')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Programmatic journal navigation' }))
  expect(confirm).not.toHaveBeenCalled()
  expect(await screen.findByRole('heading', { name: 'Journal' })).toBeTruthy()
})

it('does not prompt after a confirmed save when leaving the page', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(tree({ save: vi.fn().mockResolvedValue({ id: 'created' }) }))
  title('Confirmed recipe')
  click('Save recipe')
  await screen.findByText('Recipe saved.')
  fireEvent.click(screen.getByRole('button', { name: 'Programmatic journal navigation' }))
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Journal' })).toBeTruthy()
})

it('submits edited values and a nullable rating only after the adapter confirms the same recipe', async () => {
  const save = vi.fn().mockResolvedValue({ id: 'recipe-a' })
  render(tree({ path: '/app/recipes/recipe-a/edit', initial: record(), save }))
  title('Updated rice')
  fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '' } })
  click('Save changes')
  await screen.findByText('Recipe saved.')
  expect(save.mock.calls[0][0]).toMatchObject({ title: 'Updated rice', star_rating: null })
})

it('rejects a mismatched edit confirmation without a success claim', async () => {
  render(tree({ path: '/app/recipes/recipe-a/edit', initial: record(), save: vi.fn().mockResolvedValue({ id: 'wrong' }) }))
  click('Save changes')
  await screen.findByRole('alert')
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('does not attempt saving with an expired context session and preserves the draft', async () => {
  const save = vi.fn()
  render(tree({ state: authState('cook-a', true), save }))
  title('Still here')
  click('Save recipe')
  expect((await screen.findByRole('alert')).textContent).toContain('session could not be verified')
  expect(screen.getByDisplayValue('Still here')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
})

it.each([401, 403, 404, 422, 500])('handles HTTP %s from a save without exposing technical errors or erasing values', async (status) => {
  const save = vi.fn().mockRejectedValue(new HttpError('http', 'private backend payload', status))
  render(tree({ save }))
  title('Keep this draft')
  click('Save recipe')
  await screen.findByRole('alert')
  expect(screen.getByDisplayValue('Keep this draft')).toBeTruthy()
  expect(document.body.textContent).not.toContain('private backend payload')
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('preserves the production unavailable boundary with no mock persistence or network calls', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  render(tree())
  expect(screen.getByRole('note').textContent).toContain('Nothing on this page is saved')
  title('Local draft')
  click('Save recipe')
  expect((await screen.findByRole('alert')).textContent).toContain('not connected yet')
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockRestore()
})

it('does not show a blank edit form when the existing recipe loader is unavailable', () => {
  render(tree({ path: '/app/recipes/recipe-a/edit' }))
  expect(screen.getByRole('status').textContent).toContain('not available for editing yet')
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
})

it('supports host-provided edit loading and missing-recipe error states', () => {
  const view = render(tree({ path: '/app/recipes/recipe-a/edit', isLoading: true }))
  expect(screen.getByRole('status').textContent).toContain('Loading recipe')
  view.rerender(tree({ path: '/app/recipes/recipe-a/edit', loadError: new HttpError('http', 'private details', 404) }))
  expect(screen.getByRole('alert').textContent).toContain('could not be found')
  expect(document.body.textContent).not.toContain('private details')
})

it('does not initialize edit fields from another account or another route ID', () => {
  const view = render(tree({ path: '/app/recipes/recipe-a/edit', initial: record('cook-b') }))
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
  view.rerender(tree({ path: '/app/recipes/recipe-a/edit', initial: record('cook-a', 'recipe-b') }))
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
})

it('keeps dirty edit values when the host reports a recoverable refresh failure', () => {
  const view = render(tree({ path: '/app/recipes/recipe-a/edit', initial: record() }))
  title('Do not overwrite this')
  view.rerender(tree({ path: '/app/recipes/recipe-a/edit', initial: record(), loadError: new HttpError('network', 'private network detail') }))
  expect(screen.getByDisplayValue('Do not overwrite this')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('Could not load')
})

it('hides a loaded edit form if a later request denies access', () => {
  const view = render(tree({ path: '/app/recipes/recipe-a/edit', initial: record() }))
  view.rerender(tree({ path: '/app/recipes/recipe-a/edit', initial: record(), loadError: new HttpError('http', 'private detail', 403) }))
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('permission')
})

it('resets create drafts on account changes and ignores late confirmations from the old account', async () => {
  let resolve!: (value: { id: string }) => void
  const save = vi.fn().mockImplementation(() => new Promise<{ id: string }>((res) => { resolve = res }))
  const view = render(tree({ save }))
  title('Account A private draft')
  click('Save recipe')
  const signal = save.mock.calls[0][1].signal as AbortSignal
  view.rerender(tree({ save, state: authState('cook-b') }))
  expect(screen.queryByDisplayValue('Account A private draft')).toBeNull()
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ id: 'created-for-a' }))
  expect(screen.queryByText('Recipe saved.')).toBeNull()
})

it('drops an old-account edit record immediately when the account changes', () => {
  const view = render(tree({ path: '/app/recipes/recipe-a/edit', initial: record() }))
  expect(screen.getByDisplayValue(draft.title)).toBeTruthy()
  view.rerender(tree({ path: '/app/recipes/recipe-a/edit', initial: record(), state: authState('cook-b') }))
  expect(screen.queryByDisplayValue(draft.title)).toBeNull()
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
})
