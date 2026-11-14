import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { JournalShell } from '../journal/JournalShell'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { lineageApi, LineageApiError } from './lineage'
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
const savedRecipeId = '55555555-5555-4555-8555-555555555555'
const secondParent = { id: '223e4567-e89b-42d3-a456-426614174000', title: 'Mori’s tomato rice', star_rating: null }
const twoParentResponse = { ...response, parents: [...response.parents, secondParent] }

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

function renderChef({ userId = 'chef-cook', save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId })) } = {}) {
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
    expect(screen.getByText(/Only selected recipes will be linked when you save/)).toBeTruthy()
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
      .mockResolvedValueOnce({ id: savedRecipeId })
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

  it('clears the handoff after the first save and leaves the editor available', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save')
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect(await screen.findByRole('heading', { name: 'Your recipe is saved.' })).toBeTruthy()
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull())
    expect(screen.getByLabelText('Recipe title')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).not.toHaveBeenCalled()
  })

  it('updates the same recipe after the cleared handoff instead of reporting a conflict', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('heading', { name: 'Your recipe is saved.' })

    fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'Updated tomato egg rice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[0]?.[1].recipeId).toBeUndefined()
    expect(save.mock.calls[1]?.[1].recipeId).toBe(savedRecipeId)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ title: 'Updated tomato egg rice' })
    expect(screen.queryByText(/changed elsewhere/)).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull()
  })

  it('retries cleared-handoff storage after a confirmed two-stage save', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save').mockResolvedValue({ lineage: [{
      id: '66666666-6666-4666-8666-666666666666',
      parent_recipe_id: response.parents[0].id,
      child_recipe_id: savedRecipeId,
      created_at: '2026-11-07T00:00:00.000Z',
    }] })
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))

    let failClear = true
    let clearWrites = 0
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'moris-mix:ai-chef:v1:chef-cook' && JSON.parse(value).handoff === null) {
        clearWrites += 1
        if (failClear) throw new Error('session storage unavailable')
      }
      return originalSetItem.call(this, key, value)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('could not clear the saved preview')
    const storedProgress = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(storedProgress).toMatchObject({
      savedRecipeId,
      selectedParentIds: [response.parents[0].id],
      lineageStatus: 'confirmed',
    })
    expect(storedProgress.response.candidate_token).toBe(response.candidate_token)
    const failedWriteCount = clearWrites
    expect(failedWriteCount).toBeGreaterThan(0)
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()

    failClear = false
    fireEvent.click(screen.getByRole('button', { name: 'Try clearing the saved preview' }))

    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(clearWrites).toBeGreaterThan(failedWriteCount)
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()
  })

  it('keeps a different newer handoff and reports the existing conflict warning', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    const storageKey = 'moris-mix:ai-chef:v1:chef-cook'
    const newerDraft = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
    newerDraft.handoff.response.recipe.title = 'A newer recipe from another tab'
    sessionStorage.setItem(storageKey, JSON.stringify(newerDraft))

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('changed elsewhere')
    await screen.findByRole('heading', { name: 'Your recipe is saved.' })
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null').handoff.response.recipe.title).toBe('A newer recipe from another tab')
    expect(screen.queryByRole('button', { name: 'Try saving the review again' })).toBeNull()
    expect(save).toHaveBeenCalledOnce()
  })

  it('keeps the cleared handoff absent during repeated edits to the existing recipe', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('heading', { name: 'Your recipe is saved.' })

    for (const [index, title] of ['Second saved title', 'Third saved title'].entries()) {
      fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: title } })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(save).toHaveBeenCalledTimes(index + 2))
      expect(screen.queryByText(/changed elsewhere/)).toBeNull()
      expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull()
    }

    expect(save.mock.calls.map(([, context]) => context.recipeId)).toEqual([undefined, savedRecipeId, savedRecipeId])
    expect(save.mock.calls.map(([draft]) => draft.title)).toEqual([
      'Tomato egg rice', 'Second saved title', 'Third saved title',
    ])
  })

  it('starts with no parents selected and persists only the explicit selection after Save', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(twoParentResponse)
    const operations: string[] = []
    const save = vi.fn(async () => {
      operations.push('recipe')
      return { id: savedRecipeId }
    })
    const saveLineage = vi.spyOn(lineageApi, 'save').mockImplementation(async (childId, candidates, selected, token) => {
      operations.push('lineage')
      expect(childId).toBe(savedRecipeId)
      expect(candidates).toEqual(response.parents.concat(secondParent).map((parent) => parent.id))
      expect(selected).toEqual([secondParent.id])
      expect(token).toBe(twoParentResponse.candidate_token)
      return { lineage: [{
        id: '66666666-6666-4666-8666-666666666666',
        parent_recipe_id: secondParent.id,
        child_recipe_id: savedRecipeId,
        created_at: '2026-11-07T00:00:00.000Z',
      }] }
    })
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })

    const garden = screen.getByRole('checkbox', { name: /Garden rice/ }) as HTMLInputElement
    const tomato = screen.getByRole('checkbox', { name: /Mori’s tomato rice/ }) as HTMLInputElement
    expect(garden.checked).toBe(false)
    expect(tomato.checked).toBe(false)
    fireEvent.click(garden)
    expect((screen.getByRole('checkbox', { name: /Garden rice/ }) as HTMLInputElement).checked).toBe(true)
    expect(save).not.toHaveBeenCalled()
    expect(saveLineage).not.toHaveBeenCalled()
    const selectedDraft = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null')
    expect(selectedDraft.handoff.selectedParentIds).toEqual([response.parents[0].id])

    fireEvent.click(garden)
    fireEvent.click(tomato)
    fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'My tomato rice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    await screen.findByText('Recipe and selected parent links saved.')
    expect(operations).toEqual(['recipe', 'lineage'])
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull()
  })

  it('saves a recipe with no selected parents and skips lineage persistence', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save')
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    expect(screen.getByRole('checkbox', { name: /Garden rice/ })).toHaveProperty('checked', false)

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    await screen.findByText('Recipe saved.')
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).not.toHaveBeenCalled()
  })

  it('announces the lineage write as in progress until its response is confirmed', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    let finishLineage!: (value: Awaited<ReturnType<typeof lineageApi.save>>) => void
    const pendingLineage = new Promise<Awaited<ReturnType<typeof lineageApi.save>>>((resolve) => { finishLineage = resolve })
    const saveLineage = vi.spyOn(lineageApi, 'save').mockReturnValue(pendingLineage)
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    await screen.findByText('Your recipe is saved. Mori is saving the selected parent links now.')
    expect(screen.getByRole('button', { name: 'Working on parent links…' }).matches(':disabled')).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
    const pendingProgress = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(pendingProgress.savedRecipeId).toBe(savedRecipeId)
    expect(pendingProgress.lineageStatus).toBe('pending')
    expect(saveLineage).toHaveBeenCalledOnce()

    finishLineage({ lineage: [{
      id: '66666666-6666-4666-8666-666666666666',
      parent_recipe_id: response.parents[0].id,
      child_recipe_id: savedRecipeId,
      created_at: '2026-11-07T00:00:00.000Z',
    }] })
    await screen.findByText('Recipe and selected parent links saved.')
  })

  it('recovers a partial save by reconciling first and retrying lineage without another recipe write', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save')
      .mockRejectedValueOnce(new LineageApiError('unavailable', true))
      .mockResolvedValueOnce({ lineage: [{
        id: '66666666-6666-4666-8666-666666666666',
        parent_recipe_id: response.parents[0].id,
        child_recipe_id: savedRecipeId,
        created_at: '2026-11-07T00:00:00.000Z',
      }] })
    const getLineage = vi.spyOn(lineageApi, 'get')
      .mockResolvedValueOnce({ lineage: [] })
      .mockResolvedValueOnce({ lineage: [] })
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Your recipe was saved, but Mori could not confirm its parent links.')
    const progress = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(progress.savedRecipeId).toBe(savedRecipeId)
    expect(progress.selectedParentIds).toEqual([response.parents[0].id])
    expect(progress.lineageStatus).toBe('pending')
    expect(save).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Check and retry parent links' }))

    await screen.findByText('Recipe and selected parent links saved.')
    expect(getLineage).toHaveBeenCalledTimes(2)
    expect(saveLineage).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledOnce()
  })

  it('keeps the saved recipe and selected parents when the candidate token has expired', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save').mockRejectedValue(new LineageApiError('expired-token'))
    const getLineage = vi.spyOn(lineageApi, 'get')
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('authorization for its parent links expired')
    expect(screen.getByText('Recipe saved. Parent links still need attention.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check and retry parent links' })).toBeNull()
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()
    expect(getLineage).not.toHaveBeenCalled()
    const progress = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(progress.savedRecipeId).toBe(savedRecipeId)
    expect(progress.selectedParentIds).toEqual([response.parents[0].id])
    expect(progress.lineageStatus).toBe('expired')
  })

  it('explains that forgetting saved recovery does not undo parent links already persisted', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save').mockRejectedValue(new LineageApiError('unavailable', true))
    vi.spyOn(lineageApi, 'get').mockResolvedValue({ lineage: [] })
    const { router } = renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('button', { name: 'Check and retry parent links' })

    await act(async () => router.navigate('/app/chef'))
    fireEvent.click(await screen.findByRole('button', { name: 'Forget saved recovery' }))
    expect(screen.getByText(/removes the selected parent IDs and candidate authorization from this browser/)).toBeTruthy()
    expect(screen.getByText(/does not delete the recipe or undo any parent links already saved/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Forget recovery details' }))

    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull())
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()
  })

  it('restores blocked lineage recovery with cause-neutral copy', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    vi.spyOn(lineageApi, 'save').mockRejectedValue(new LineageApiError('not-candidate'))
    const { router } = renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('could not verify one of the selected parents')
    expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff.lineageStatus).toBe('blocked')
    await act(async () => router.navigate('/app/chef'))
    fireEvent.click(await screen.findByRole('link', { name: 'Return to recipe review' }))

    expect(await screen.findByText('Your recipe is safe, but Mori could not confirm the selected parent links. The links remain unchanged.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check and retry parent links' })).toBeNull()
  })

  it('reconciles a lost lineage response with GET and does not post twice', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save').mockRejectedValue(new LineageApiError('unavailable', true))
    const persisted = { lineage: [{
      id: '66666666-6666-4666-8666-666666666666',
      parent_recipe_id: response.parents[0].id,
      child_recipe_id: savedRecipeId,
      created_at: '2026-11-07T00:00:00.000Z',
    }] }
    const getLineage = vi.spyOn(lineageApi, 'get').mockResolvedValue(persisted)
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    await screen.findByText('Recipe and selected parent links saved.')
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()
    expect(getLineage).toHaveBeenCalledOnce()
    expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull()
  })

  it('shows an empty candidate state without controls and saves without requiring a token', async () => {
    const noCandidates: GenerateRecipeResponse = {
      ...response,
      parents: [],
      candidate_token: null,
      context: { status: 'NO_SAVED_RECIPES', matchedCandidateCount: 0, totalCandidateCount: 0 },
    }
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(noCandidates)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save')
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })

    expect(screen.getByText('There are no saved recipes to suggest yet.')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByText('Recipe saved.')
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).not.toHaveBeenCalled()
  })

  it('limits explicit parent approval to ten candidates', async () => {
    const parents = Array.from({ length: 11 }, (_, index) => ({
      id: '40000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
      title: 'Parent ' + (index + 1),
      star_rating: null,
    }))
    const manyCandidates: GenerateRecipeResponse = {
      ...response,
      parents,
      context: { status: 'MATCHED', matchedCandidateCount: 11, totalCandidateCount: 11 },
    }
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(manyCandidates)
    renderChef()
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    expect(screen.getAllByRole('checkbox')).toHaveLength(11)
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getAllByRole('checkbox')[index])
    }
    expect(screen.getByText('10 of 10 parent recipes selected.')).toBeTruthy()
    expect(screen.getAllByRole('checkbox')[10]).toHaveProperty('disabled', true)
  })
})
