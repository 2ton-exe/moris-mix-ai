import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { JournalShell } from '../journal/JournalShell'
import type { GenerateRecipeResponse } from './generateRecipe'
import { generateRecipeApi } from './generateRecipe'
import { AIChefPage } from './AIChefPage'
import { ChefRecipeReviewPage } from './ChefRecipeReviewPage'

const response: GenerateRecipeResponse = {
  recipe: {
    title: 'Tomato egg rice',
    ingredients: [
      { name: 'rice', quantity: null, unit: null, quantityText: 'leftover', inferred: false },
      { name: 'tomatoes', quantity: 2, unit: null, inferred: false },
    ],
    instructions: [{ step: 1, text: 'Warm the rice and fold in the tomatoes.' }],
  },
  substitutions: [{ original: 'tomatoes', replacement: 'bell pepper', reason: 'Use what is available.' }],
  parents: [{ id: '123e4567-e89b-42d3-a456-426614174000', title: 'Garden rice', star_rating: 4 }],
  candidate_token: 'v1.short-lived-test-token',
  context: { status: 'MATCHED', matchedCandidateCount: 1, totalCandidateCount: 3 },
}

function authState(userId = 'chef-cook'): AuthState {
  const user = { id: userId, email: `${userId}@example.test` } as User
  const session = {
    user, access_token: 'chef-test-access', refresh_token: 'chef-test-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  } as AuthState['session']
  return {
    user, session, isLoading: false, isAuthenticated: true, error: null, logoutNotice: null,
    dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn(async () => {}), resendVerification: vi.fn(),
  }
}

function JournalLayout() { return <JournalShell><Outlet /></JournalShell> }

const NativeRequest = globalThis.Request
class RouterTestRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : undefined)
  }
}

function renderChef({ userId = 'chef-cook', save = vi.fn(async () => ({ id: 'saved-chef-recipe' })) } = {}) {
  const state = authState(userId)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/app', element: <JournalLayout />, children: [{ path: 'chef', element: <AIChefPage /> }] },
    { path: '/app/chef/review', element: <ChefRecipeReviewPage save={save} /> },
  ], { initialEntries: ['/app/chef'] })
  const view = render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={state}><RouterProvider router={router} /></AuthContext.Provider></QueryClientProvider>)
  return { ...view, router, save }
}

function addIngredient(value: string) {
  const input = screen.getByRole('textbox', { name: 'Pantry ingredient' })
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('Request', RouterTestRequest)
})
afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('AI Chef pantry and review workflow', () => {
  it('creates and removes pantry tokens, accepts preferences, and shows a validated unsaved review', async () => {
    const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: 'saved-chef-recipe' }))
    renderChef({ save })

    addIngredient(' Rice ')
    addIngredient('rice')
    expect(screen.getByRole('status').textContent).toContain('already in your pantry list')
    addIngredient('tomatoes')
    expect(screen.getByRole('region', { name: 'Pantry list, 2 items' }).textContent).toContain('Rice')
    fireEvent.click(screen.getByRole('button', { name: 'Remove tomatoes' }))
    addIngredient('tomatoes')
    fireEvent.change(screen.getByRole('textbox', { name: /^Cooking preferences/ }), { target: { value: 'quick, no frying' } })

    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    expect(await screen.findByRole('heading', { name: "Review Mori's recipe." })).toBeTruthy()
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]).toEqual([
      ['Rice', 'tomatoes'], 'quick, no frying', expect.objectContaining({ userId: 'chef-cook', signal: expect.any(AbortSignal) }),
    ])
    expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('Tomato egg rice')
    expect((screen.getByLabelText('Ingredient 1 amount description') as HTMLInputElement).value).toBe('leftover')
    expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Ingredient 2 quantity') as HTMLInputElement).value).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: 'Next Pages' }))
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="instructions.0.text"]:not([disabled])')?.value).toBe('Warm the rice and fold in the tomatoes.')
    expect(screen.getByText('bell pepper')).toBeTruthy()
    expect(screen.getByText('Garden rice')).toBeTruthy()
    expect(screen.getByText(/will not create parent links/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects an empty pantry locally and retains inputs after quota failure for retry', async () => {
    const generate = vi.spyOn(generateRecipeApi, 'generate')
      .mockRejectedValueOnce(new HttpError('http', 'private text', 429, { error: { code: 'QUOTA_EXCEEDED' } }, '60'))
      .mockResolvedValueOnce(response)
    renderChef()
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Add at least one pantry ingredient')
    expect(generate).not.toHaveBeenCalled()

    addIngredient('rice')
    fireEvent.change(screen.getByRole('textbox', { name: /^Cooking preferences/ }), { target: { value: 'spicy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    expect((await screen.findByRole('alert')).textContent).toContain('today’s AI Chef limit')
    expect((screen.getByRole('textbox', { name: 'Pantry ingredient' }) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('textbox', { name: /^Cooking preferences/ }) as HTMLTextAreaElement).value).toBe('spicy')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: "Review Mori's recipe." })).toBeTruthy()
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1]?.[0]).toEqual(['rice'])
    expect(generate.mock.calls[1]?.[1]).toBe('spicy')
  })

  it('prevents duplicate in-flight generation requests', async () => {
    let resolveGeneration!: (value: GenerateRecipeResponse) => void
    const generate = vi.spyOn(generateRecipeApi, 'generate').mockReturnValue(new Promise((resolve) => { resolveGeneration = resolve }))
    renderChef()
    addIngredient('rice')
    const form = document.querySelector('.mm-ai-chef__form')
    expect(form).toBeTruthy()
    fireEvent.submit(form!)
    fireEvent.submit(form!)
    expect(generate).toHaveBeenCalledOnce()

    await act(async () => resolveGeneration(response))
    expect(await screen.findByRole('heading', { name: "Review Mori's recipe." })).toBeTruthy()
  })

  it('requires an explicit Save action and preserves edits after a failed save', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('temporary save outage'))
      .mockResolvedValueOnce({ id: 'saved-chef-recipe' })
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'My edited rice bowl' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('My edited rice bowl')
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await waitFor(() => expect(screen.getByText('Recipe saved.')).toBeTruthy())
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ title: 'My edited rice bowl', ingredients: response.recipe.ingredients })
    expect(save.mock.calls[0]?.[1]).toMatchObject({ userId: 'chef-cook', signal: expect.any(AbortSignal) })
  })
})
