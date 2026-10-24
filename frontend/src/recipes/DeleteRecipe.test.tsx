import { StrictMode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import JournalPage from '../pages/JournalPage'
import RecipeDashboardPage from '../pages/RecipeDashboardPage'
import RecipeDetailPage from '../pages/RecipeDetailPage'
import { RecipeQueryProvider } from './RecipeQueryProvider'
import { recipeKeys } from './queryOptions'
import type { RecipeRequest, RecipeSource, RecipeSummary } from './types'
import { previewRecipes } from './testing/previewAdapter'

const recipe = previewRecipes[0]
const detailPath = `/app/recipes/${recipe.id}`
let deleteHandler: ReturnType<typeof vi.fn>
let source: RecipeSource
let currentClient: QueryClient
let serverRecipes: RecipeSummary[]

function authState(id: string | null = 'cook-a'): AuthState {
  const user = id ? { id, aud: 'authenticated', email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-10-19' } : null
  const session: Session | null = user ? { user, access_token: `${id}-token`, refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer' } : null
  return { user, session, isLoading: false, isAuthenticated: !!user, error: null, logoutNotice: null,
    dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn(), resendVerification: vi.fn() }
}

function QueryClientProbe() {
  currentClient = useQueryClient()
  return null
}

function tree(path: string, auth: AuthState, recipeSource: RecipeSource) {
  return <StrictMode><MemoryRouter initialEntries={[path]}>
    <AuthContext.Provider value={auth}><RecipeQueryProvider source={recipeSource}>
      <QueryClientProbe />
      <Routes>
        <Route path="/app" element={<JournalPage />}>
          <Route index element={<RecipeDashboardPage />} />
          <Route path="recipes" element={<RecipeDashboardPage />} />
          <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
        </Route>
        <Route path="/login" element={<h1>Sign in</h1>} />
      </Routes>
    </RecipeQueryProvider></AuthContext.Provider>
  </MemoryRouter></StrictMode>
}

function renderDetail(auth = authState(), recipeSource = source) {
  return render(tree(detailPath, auth, recipeSource))
}

async function waitForDetail() {
  await screen.findByRole('heading', { name: recipe.title, level: 1 })
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  return screen.getByRole('alertdialog')
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: 'Delete recipe' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  onlineManager.setOnline(true)
  deleteHandler = vi.fn().mockResolvedValue(undefined)
  serverRecipes = previewRecipes.map(({ id, title, star_rating, cooked_at }) => ({ id, title, star_rating, cooked_at }))
  source = {
    mode: 'live',
    list: vi.fn().mockImplementation(async () => serverRecipes),
    detail: vi.fn().mockResolvedValue(recipe),
    deleteRecipe: async (id: string, request: RecipeRequest) => {
      await deleteHandler(id, request)
      serverRecipes = serverRecipes.filter((item) => item.id !== id)
    },
  }
})
afterEach(() => onlineManager.setOnline(true))

it('opens a labeled warning with the recipe name and makes no request before confirmation', async () => {
  renderDetail()
  await waitForDetail()
  const dialog = openDialog()

  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(within(dialog).getByRole('heading', { name: `Delete “${recipe.title}”?` })).toBeTruthy()
  expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy()
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(deleteHandler).not.toHaveBeenCalled()
})

it('cancels without deleting and returns focus to the Delete action', async () => {
  renderDetail()
  await waitForDetail()
  const trigger = screen.getByRole('button', { name: 'Delete recipe' })
  openDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(deleteHandler).not.toHaveBeenCalled()
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})

it('shows pending feedback, locks both actions, blocks duplicate submits, and navigates only after confirmation', async () => {
  const request = deferred<void>()
  let serverDeleted = false
  deleteHandler.mockImplementation(async () => {
    await request.promise
    serverDeleted = true
    source.list = vi.fn().mockResolvedValue([])
  })
  renderDetail()
  await waitForDetail()
  const dialog = openDialog()
  const deleteButton = confirmButton(dialog)
  act(() => {
    fireEvent.click(deleteButton)
    fireEvent.click(deleteButton)
  })

  const pending = await screen.findByRole('button', { name: 'Deleting…' })
  expect((pending as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain(`Deleting “${recipe.title}”`)
  expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(pending)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(deleteHandler).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()

  await act(async () => request.resolve())
  expect(serverDeleted).toBe(true)
  expect((await screen.findByRole('status')).textContent).toContain('Recipe deleted. Your collection has been updated.')
  expect(screen.queryByRole('heading', { name: recipe.title, level: 1 })).toBeNull()
})

it('removes the confirmed detail cache and refreshes the account-scoped collection', async () => {
  renderDetail()
  await waitForDetail()
  expect(currentClient.getQueryData(recipeKeys.detail('cook-a', recipe.id))).toBeTruthy()
  deleteHandler.mockImplementation(async () => { source.list = vi.fn().mockResolvedValue([]) })

  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  const dialog = screen.getByRole('alertdialog')
  fireEvent.click(confirmButton(dialog))
  await screen.findByText('A fresh page for your next favorite.')

  expect(currentClient.getQueryData(recipeKeys.detail('cook-a', recipe.id))).toBeUndefined()
  await waitFor(() => expect(source.list).toHaveBeenCalled())
  expect(currentClient.getQueryData(recipeKeys.detail('cook-b', recipe.id))).toBeUndefined()
})

it('does not carry a confirmed deletion notice into another account', async () => {
  const view = renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))
  await screen.findByText('Recipe deleted. Your collection has been updated.')

  const previousClient = currentClient
  view.rerender(tree('/app/recipes', authState('cook-b'), source))
  await waitFor(() => expect(currentClient).not.toBe(previousClient))
  expect(screen.queryByText('Recipe deleted. Your collection has been updated.')).toBeNull()
})

it('reconciles an interrupted network outcome and allows a deliberate retry', async () => {
  deleteHandler.mockRejectedValueOnce(new HttpError('network', 'private transport message'))
    .mockResolvedValueOnce(undefined)
  renderDetail()
  await waitForDetail()
  const dialog = openDialog()
  fireEvent.click(confirmButton(dialog))

  expect((await screen.findByRole('alert')).textContent).toMatch(/could not confirm whether this recipe was deleted/i)
  expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false)
  expect(document.body.textContent).not.toContain('private transport message')
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Recipe deleted. Your collection has been updated.')
  expect(deleteHandler).toHaveBeenCalledTimes(2)
})

it.each([
  ['a timeout', Object.assign(new Error('private timeout detail'), { name: 'AbortError' })],
  ['an unexpected adapter error', new Error('private adapter detail')],
])('treats %s as an ambiguous outcome without exposing the error', async (_kind, failure) => {
  deleteHandler.mockRejectedValueOnce(failure)
  renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))

  expect((await screen.findByRole('alert')).textContent).toMatch(/could not confirm whether this recipe was deleted/i)
  expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false)
  expect(document.body.textContent).not.toContain('private timeout detail')
  expect(document.body.textContent).not.toContain('private adapter detail')
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
})

it('handles a server failure without exposing payload details and keeps the recipe available for retry', async () => {
  deleteHandler.mockRejectedValueOnce(new HttpError('http', 'private server payload', 500))
  renderDetail()
  await waitForDetail()
  const dialog = openDialog()
  fireEvent.click(confirmButton(dialog))

  expect((await screen.findByRole('alert')).textContent).toMatch(/could not confirm whether this recipe was deleted/i)
  expect(document.body.textContent).not.toContain('private server payload')
  expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByRole('heading', { name: recipe.title, level: 1 })).toBeTruthy()
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
})

it.each([
  [401, 'Your session could not be verified'],
  [403, 'You do not have permission'],
])('handles authorization failure %s without offering a blind retry', async (status, message) => {
  deleteHandler.mockRejectedValueOnce(new HttpError('http', 'private authorization payload', status))
  renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))

  expect((await screen.findByRole('alert')).textContent).toContain(message)
  expect((within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }) as HTMLButtonElement).disabled).toBe(true)
  expect(document.body.textContent).not.toContain('private authorization payload')
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
})

it('does not offer a retry for a permanent client rejection', async () => {
  deleteHandler.mockRejectedValueOnce(new HttpError('http', 'private validation payload', 422))
  renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))

  expect((await screen.findByRole('alert')).textContent).toMatch(/request could not be accepted/i)
  expect((within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }) as HTMLButtonElement).disabled).toBe(true)
  expect(document.body.textContent).not.toContain('private validation payload')
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
})

it('handles a missing recipe by reconciling detail and collection queries without claiming success', async () => {
  deleteHandler.mockRejectedValueOnce(new HttpError('http', 'private missing payload', 404))
  renderDetail()
  await waitForDetail()
  source.detail = vi.fn().mockRejectedValue(new HttpError('http', 'private missing payload', 404))
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))

  await screen.findByRole('heading', { name: 'Recipe unavailable' })
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
  expect(document.body.textContent).not.toContain('private missing payload')
})

it('isolates recipe query caches when authenticated accounts switch', async () => {
  const view = renderDetail()
  await waitForDetail()
  const firstClient = currentClient
  expect(firstClient.getQueryData(recipeKeys.detail('cook-a', recipe.id))).toBeTruthy()

  view.rerender(tree(detailPath, authState('cook-b'), source))
  await waitFor(() => expect(currentClient).not.toBe(firstClient))
  await waitForDetail()
  expect(firstClient.getQueryCache().getAll()).toHaveLength(0)
  expect(currentClient.getQueryData(recipeKeys.detail('cook-a', recipe.id))).toBeUndefined()
  expect(currentClient.getQueryData(recipeKeys.detail('cook-b', recipe.id))).toBeTruthy()
})

it('aborts an in-flight deletion on account switch and ignores its late response in the new cache', async () => {
  let requestSignal: AbortSignal | undefined
  let resolveRequest!: () => void
  deleteHandler.mockImplementation((_id: string, request: RecipeRequest) => {
    requestSignal = request.signal
    return new Promise<void>((resolve) => { resolveRequest = resolve })
  })
  source.detail = vi.fn(async (_id, request) => request.userId === 'cook-b' ? { ...recipe, title: 'B user recipe' } : recipe)
  const view = renderDetail()
  await waitForDetail()
  const oldClient = currentClient
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))
  await waitFor(() => expect(requestSignal).toBeDefined())

  view.rerender(tree(detailPath, authState('cook-b'), source))
  await screen.findByRole('heading', { name: 'B user recipe', level: 1 })
  expect(requestSignal?.aborted).toBe(true)
  const newClient = currentClient
  await act(async () => resolveRequest())

  expect(newClient).not.toBe(oldClient)
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
  expect(newClient.getQueryData(recipeKeys.detail('cook-a', recipe.id))).toBeUndefined()
  expect(newClient.getQueryData(recipeKeys.detail('cook-b', recipe.id))).toMatchObject({ title: 'B user recipe' })
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
})

it('aborts a pending delete on logout and ignores a late successful response', async () => {
  let requestSignal: AbortSignal | undefined
  let resolveRequest!: () => void
  deleteHandler.mockImplementation((_id: string, request: RecipeRequest) => {
    requestSignal = request.signal
    return new Promise<void>((resolve) => { resolveRequest = resolve })
  })
  const view = renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))
  await waitFor(() => expect(requestSignal).toBeDefined())
  const oldClient = currentClient

  view.rerender(tree(detailPath, authState(null), source))
  await waitFor(() => expect(requestSignal?.aborted).toBe(true))
  await act(async () => resolveRequest())

  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
  expect(screen.queryByText(/Recipe deleted/)).toBeNull()
})

it('aborts work on component unmount and never runs the navigation success callback late', async () => {
  let requestSignal: AbortSignal | undefined
  let resolveRequest!: () => void
  deleteHandler.mockImplementation((_id: string, request: RecipeRequest) => {
    requestSignal = request.signal
    return new Promise<void>((resolve) => { resolveRequest = resolve })
  })
  const view = renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))
  await waitFor(() => expect(requestSignal).toBeDefined())
  const oldClient = currentClient

  view.unmount()
  expect(requestSignal?.aborted).toBe(true)
  await act(async () => resolveRequest())
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0)
})

it('shows an unavailable state and makes no request when a delete adapter is not configured', async () => {
  const unavailableSource: RecipeSource = {
    mode: 'unavailable',
    list: vi.fn().mockResolvedValue([]),
    detail: vi.fn().mockResolvedValue(recipe),
  }
  renderDetail(authState(), unavailableSource)
  await waitForDetail()

  expect((screen.getByRole('button', { name: 'Delete unavailable' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('Recipe deletion is not connected yet.')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(deleteHandler).not.toHaveBeenCalled()
})

it('traps keyboard focus, closes on Escape while idle, and restores focus', async () => {
  renderDetail()
  await waitForDetail()
  const trigger = screen.getByRole('button', { name: 'Delete recipe' })
  const dialog = openDialog()
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
  const confirm = confirmButton(dialog)

  confirm.focus()
  fireEvent.keyDown(confirm, { key: 'Tab' })
  expect(document.activeElement).toBe(cancel)
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(confirm)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(deleteHandler).not.toHaveBeenCalled()
})

it('passes the current account identity and abort signal to the injected adapter', async () => {
  renderDetail()
  await waitForDetail()
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))

  await screen.findByText('Recipe deleted. Your collection has been updated.')
  expect(deleteHandler).toHaveBeenCalledWith(recipe.id, expect.objectContaining({ userId: 'cook-a', signal: expect.any(AbortSignal) }))
})

it('aborts a delete started offline on unmount instead of leaving it queued for reconnect', async () => {
  let requestSignal: AbortSignal | undefined
  deleteHandler.mockImplementation((_id: string, request: RecipeRequest) => {
    requestSignal = request.signal
    return new Promise<void>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  })
  const view = renderDetail()
  await waitForDetail()
  onlineManager.setOnline(false)
  fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }))
  fireEvent.click(confirmButton(screen.getByRole('alertdialog')))
  await waitFor(() => expect(requestSignal).toBeDefined())

  view.unmount()
  expect(requestSignal?.aborted).toBe(true)
  onlineManager.setOnline(true)
  expect(deleteHandler).toHaveBeenCalledOnce()
  expect(serverRecipes.some(({ id }) => id === recipe.id)).toBe(true)
})
