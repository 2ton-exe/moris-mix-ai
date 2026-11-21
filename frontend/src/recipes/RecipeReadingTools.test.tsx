import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/context'
import RecipeDetailPage from '../pages/RecipeDetailPage'
import { RecipeSourceContext } from './source'
import type { RecipeSource } from './types'
import { previewRecipes } from './testing/previewAdapter'

const { patch, get } = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn() }))
vi.mock('../api/config', () => ({ apiClient: { patchAuthenticatedJson: patch, getAuthenticatedJson: get } }))

const user = { id: 'cook-a', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01' }
const auth: AuthState = {
  user, isAuthenticated: true, isLoading: false, error: null, logoutNotice: null, session: null,
  dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn(), resendVerification: vi.fn(),
}
const recipe = { ...previewRecipes[0], id: '11111111-1111-4111-8111-111111111111', cooked_at: null, notes: 'Keep the lid on.' }
let source: RecipeSource
let client: QueryClient

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('pointer: fine'), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })))
  patch.mockReset()
  get.mockReset()
  source = { mode: 'live', list: async () => [recipe], detail: vi.fn().mockResolvedValue(recipe) }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { client.clear(); vi.unstubAllGlobals() })

function renderReading() {
  const router = createMemoryRouter([{ path: '/app/recipes/:recipeId', element: <RecipeDetailPage /> }], {
    initialEntries: [`/app/recipes/${recipe.id}`],
  })
  render(<AuthContext.Provider value={auth}><QueryClientProvider client={client}>
    <RecipeSourceContext.Provider value={source}><RouterProvider router={router} /></RecipeSourceContext.Provider>
  </QueryClientProvider></AuthContext.Provider>)
}

async function openTool(name: string) {
  fireEvent.click(await screen.findByText('Journal tools', { selector: 'summary' }))
  fireEvent.click(screen.getByRole('button', { name }))
}

it('records the cooking date only after explicit confirmation', async () => {
  renderReading()
  await openTool('Record cooking')
  const date = screen.getByLabelText('Cooking date')
  fireEvent.change(date, { target: { value: '2024-11-05' } })
  expect(patch).not.toHaveBeenCalled()

  patch.mockResolvedValue({ recipe: { ...recipe, user_id: user.id, cooked_at: '2024-11-05' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save imprint' }))

  expect(patch).toHaveBeenCalledWith(`/functions/v1/recipes/${recipe.id}`, { cooked_at: '2024-11-05' }, expect.objectContaining({ userId: user.id }))
  await waitFor(() => expect(screen.getByText('Cooking date saved.')).toBeTruthy())
  expect(screen.getByText('Nov 5, 2024', { selector: 'time' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update cooking record' }))
})
