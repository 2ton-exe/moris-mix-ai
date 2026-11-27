import { scrapbookRegistry } from '../journal/scrapbookRegistry'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { MoriCompanion } from '../mori/MoriCompanion'
import { MoriCompanionProvider } from '../mori/MoriCompanionContext'
import { JournalShell } from '../journal/JournalShell'
import { editorState } from '../recipe-form/draft'
import { mapAiRecipeToDraft } from '../recipe-form/aiRecipeDraft'
import { JournalLogoutGuardContext, type RegisterJournalLogoutGuard } from '../journal/JournalLogoutGuardContext'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { recipeFormApi } from '../recipe-form/api'
import { lineageApi, LineageApiError } from './lineage'
import type { GenerateRecipeResponse } from './generateRecipe'
import { generateRecipeApi } from './generateRecipe'
import { writeChefDraft } from './draft'
import { AIChefPage } from './AIChefPage'
import { ChefRecipeReviewPage } from './ChefRecipeReviewPage'
import RecipeDetailPage from '../pages/RecipeDetailPage'
import EditRecipePage from '../pages/EditRecipePage'
import { defaultRecipeSource, RecipeSourceContext } from '../recipes/source'
import type { RecipeSource } from '../recipes/types'

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

function WorkspaceLayout({ userId }: { userId?: string }) { return <MoriCompanionProvider><Outlet /><MoriCompanion userId={userId} /></MoriCompanionProvider> }
function JournalLayout() { return <JournalShell><Outlet /></JournalShell> }
function ManualRecipeRoute() {
  const location = useLocation()
  return <output data-testid="manual-recipe-state">{JSON.stringify(location.state)}</output>
}

const NativeRequest = globalThis.Request
class RouterTestRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : undefined)
  }
}

let matchMediaDescriptor: PropertyDescriptor | undefined

function renderChef({ userId = 'chef-cook', signedCompanion = false, save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId })), source = defaultRecipeSource }: { userId?: string; signedCompanion?: boolean; save?: SaveRecipeDraft; source?: RecipeSource } = {}) {
  const state = authState(userId)
  const registerLogoutGuard = vi.fn<RegisterJournalLogoutGuard>(() => () => {})
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/app', element: <WorkspaceLayout userId={signedCompanion ? userId : undefined} />, children: [
      { element: <JournalLayout />, children: [{ path: 'chef', element: <AIChefPage /> }, { path: 'recipes/:recipeId', element: <RecipeDetailPage /> }] },
      { path: 'chef/review', element: <ChefRecipeReviewPage save={save} /> },
      { path: 'recipes/new', element: <ManualRecipeRoute /> },
      { path: 'recipes/:recipeId/edit', element: <EditRecipePage /> },
    ] },
  ], { initialEntries: ['/app/chef'] })
  const view = render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={state}><RecipeSourceContext.Provider value={source}><JournalLogoutGuardContext.Provider value={registerLogoutGuard}><RouterProvider router={router} /></JournalLogoutGuardContext.Provider></RecipeSourceContext.Provider></AuthContext.Provider></QueryClientProvider>)
  return { ...view, router, save, registerLogoutGuard }
}

function addIngredient(value: string) {
  const input = screen.getByRole('textbox', { name: 'Pantry ingredient' })
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

async function finishJournalTurn(target: () => boolean) {
  await waitFor(() => {
    const turn = document.querySelector<HTMLElement>('[data-journal-page-turn]')
    if (turn) expect(turn.getAttribute('data-phase')).toBe('animating')
    else {
      expect(document.querySelector('.mm-journal-book')?.hasAttribute('data-page-turning')).toBe(false)
      expect(target()).toBe(true)
    }
  })
  const turn = document.querySelector<HTMLElement>('[data-journal-page-turn]')
  if (turn) {
    fireEvent(turn, new CustomEvent('mm-journal-turn-sample', { detail: 1 }))
    await waitFor(() => expect(document.querySelector('.mm-journal-book')?.hasAttribute('data-page-turning')).toBe(false))
  }
}

async function nextChefPage() {
  const current = screen.getByRole('region', { name: /AI Chef page (\d+)/ }).getAttribute('aria-label')!
  const nextPage = Number(/AI Chef page (\d+)/.exec(current)?.[1]) + 1
  fireEvent.click(screen.getByRole('button', { name: /^Next page/ }))
  await finishJournalTurn(() => Boolean(screen.queryByRole('region', { name: new RegExp(`AI Chef page ${nextPage}`) })))
}

async function nextChefReviewPage() {
  const progress = document.querySelector<HTMLElement>('.mm-review-progress')
  if (!progress) throw new Error('AI Chef review progress is missing')
  const current = progress.textContent
  const next = screen.getByRole('button', { name: /^Next:/ })
  fireEvent.click(next)
  await finishJournalTurn(() => document.querySelector<HTMLElement>('.mm-review-progress')?.textContent !== current)
}

async function advanceChefReviewToSave(saveLabel = 'Save recipe') {
  await waitFor(() => expect(screen.queryByRole('heading', { name: /Review Mori's recipe|Your recipe is saved\./ })).toBeTruthy())
  for (let index = 0; index < 20; index += 1) {
    if (screen.queryByRole('button', { name: saveLabel }) || screen.queryByRole('button', { name: 'Save changes' })) return
    await nextChefReviewPage()
  }
  throw new Error('AI Chef review never reached its final save spread')
}

async function returnChefReviewToStart() {
  for (let index = 0; index < 20; index += 1) {
    const progress = document.querySelector<HTMLElement>('.mm-review-progress')
    if (!progress || /Step 1 of/.test(progress.textContent ?? '')) return
    const current = progress.textContent
    fireEvent.click(screen.getByRole('button', { name: /^Previous:/ }))
    await finishJournalTurn(() => document.querySelector<HTMLElement>('.mm-review-progress')?.textContent !== current)
  }
  throw new Error('AI Chef review did not return to its first spread')
}

async function openPreferences() {
  while (!screen.queryByRole('textbox', { name: /^Cooking preferences/ })) await nextChefPage()
}

function openReviewDetail(action: string, name: string) {
  if (action === 'Full request') {
    const optionalDetails = screen.queryByText('Optional details from Mori')
    if (optionalDetails instanceof HTMLElement) fireEvent.click(optionalDetails)
  }
  const trigger = screen.getByRole('button', { name: action })
  const dialog = trigger.nextElementSibling
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('Review detail dialog is missing')
  dialog.showModal = () => { dialog.open = true }
  dialog.close = () => {
    dialog.open = false
    fireEvent(dialog, new Event('close'))
  }
  fireEvent.click(trigger)
  return within(screen.getByRole('dialog', { name }))
}

beforeEach(() => {
  vi.spyOn(lineageApi, 'renew').mockImplementation(async (token) => token)
  localStorage.clear()
  sessionStorage.clear()
  matchMediaDescriptor ??= Object.getOwnPropertyDescriptor(window, 'matchMedia')
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (query: string) => ({
    matches: query.includes('prefers-reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) })
  vi.stubGlobal('Request', RouterTestRequest)
})
afterEach(() => {
  vi.restoreAllMocks()
  if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
  else Reflect.deleteProperty(window, 'matchMedia')
  matchMediaDescriptor = undefined
  localStorage.clear()
  sessionStorage.clear()
})

describe('AI Chef pantry and review workflow', () => {
  function desktopPantry() {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') || query.includes('min-width: 1024px') || query.includes('min-width: 1100px'),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) })
  }

  it('highlights normalized manual and pasted duplicates, keeps entry focus, and uses Mori dialogue', () => {
    desktopPantry()
    renderChef({ signedCompanion: true })
    const input = screen.getByRole('textbox', { name: 'Pantry ingredient' })
    fireEvent.change(input, { target: { value: 'composing' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(screen.getByRole('region', { name: 'Pantry list, 0 items' })).toBeTruthy()
    addIngredient(' Green   Onions ')
    fireEvent.change(input, { target: { value: 'scallion' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }))
    expect(document.activeElement).toBe(input)
    const pantry = screen.getByRole('region', { name: 'Pantry list, 1 item' })
    expect(pantry.querySelector('[data-duplicate]')?.textContent).toContain('Green Onions')
    expect(pantry.querySelector('[data-duplicate]')?.textContent).toContain('Already in your pantry')
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    expect(within(screen.getByRole('region', { name: 'Mori' })).getByText(/one spot in the pantry, twice the enthusiasm/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Mori' }))

    fireEvent.paste(input, { clipboardData: { getData: () => 'EGGS, egg\nscallions\nchicken breast, chicken thighs' } })
    expect(document.activeElement).toBe(input)
    const updated = screen.getByRole('region', { name: 'Pantry list, 4 items' })
    expect(updated.querySelectorAll('li')).toHaveLength(4)
    expect(updated.querySelectorAll('[data-duplicate]')).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps off-leaf duplicates discoverable on short desktops without moving entry focus', async () => {
    renderChef()
    addIngredient('rice, beans, tomatoes')
    addIngredient('TOMATO')
    const input = screen.getByRole('textbox', { name: 'Pantry ingredient' })
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: 'Remove tomatoes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show existing ingredient' }))
    await finishJournalTurn(() => Boolean(screen.queryByRole('button', { name: 'Remove tomatoes' })))
    expect(screen.getByRole('button', { name: 'Remove tomatoes' }).closest('li')?.getAttribute('data-duplicate')).toBe('true')
    expect(screen.getByRole('region', { name: 'Pantry list, 3 items' })).toBeTruthy()
  })

  it('reflects normalized quick-add membership and allows adding again after removal', () => {
    desktopPantry()
    renderChef()
    addIngredient('Egg')
    expect(screen.getByRole('button', { name: 'eggs' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Egg' }))
    const quickAdd = screen.getByRole('button', { name: 'eggs' })
    expect(quickAdd.hasAttribute('disabled')).toBe(false)
    fireEvent.click(quickAdd)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Pantry ingredient' }))
    expect(screen.getByRole('region', { name: 'Pantry list, 1 item' }).textContent).toContain('eggs')
    expect(quickAdd.hasAttribute('disabled')).toBe(true)
  })

  it('deduplicates restored pantry identities and the eventual generation payload without merging varieties', async () => {
    desktopPantry()
    const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    sessionStorage.setItem('moris-mix:ai-chef:v1:chef-cook', JSON.stringify({
      input: {
        pantryItems: ['  Tomatoes ', 'tomato', 'Green Onions', 'scallions', 'chicken breast', 'chicken thighs', 'cooked chicken'],
        pantryInput: '', preferences: 'Quick dinner',
      },
      handoff: null,
    }))
    renderChef()
    expect(screen.getByRole('region', { name: 'Pantry list, 5 items' }).querySelectorAll('li')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'tomatoes' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(generate.mock.calls[0]?.[0]).toEqual(['Tomatoes', 'Green Onions', 'chicken breast', 'chicken thighs', 'cooked chicken'])
    expect(generate.mock.calls[0]?.[1]).toBe('Quick dinner')
  })

  it('shares only the selected note and keeps Mori’s advice distinct from an edited revision', async () => {
    const currentMatchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = currentMatchMedia(query)
      Object.defineProperty(media, 'matches', { value: media.matches || query.includes('min-width: 1100px') || query.includes('pointer: fine') })
      return media
    })
    const original = response.parents[0]
    const excerpt = 'Too salty this time.'
    const proposed = { ...response, recipe: { ...response.recipe, ingredients: response.recipe.ingredients.map(ingredient => ({ ...ingredient, name: 'tomatoes' })) } }
    const recipe = {
      ...proposed.recipe, id: original.id, title: original.title, notes: excerpt + '\nKeep this other note private.',
      ingredients: proposed.recipe.ingredients.map((ingredient, index) => index === 1 ? { ...ingredient, quantity: 4 } : ingredient),
    }
    const revise = vi.spyOn(generateRecipeApi, 'revise').mockResolvedValue({
      ...proposed,
      revision: {
        noteExcerpt: excerpt, ingredient: 'tomatoes', ingredientIndex: 1, reason: 'Use fewer salted tomatoes.',
        before: { quantity: 4, unit: null }, after: { quantity: 2, unit: null },
      },
    })
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save').mockResolvedValue({ lineage: [{
      id: '66666666-6666-4666-8666-666666666666',
      parent_recipe_id: original.id, child_recipe_id: savedRecipeId, created_at: '2026-11-07T00:00:00.000Z',
    }] })
    const { router, registerLogoutGuard } = renderChef({
      save, source: { mode: 'live', list: async () => [recipe], detail: async () => recipe },
    })
    await act(() => router.navigate('/app/recipes/' + original.id))
    await screen.findByRole('button', { name: 'Revise with Mori' })
    const dialog = openReviewDetail('Revise with Mori', 'Make a version for next time')
    expect(dialog.getByRole('button', { name: 'Ask Mori for a revision' })).toHaveProperty('disabled', true)
    fireEvent.click(dialog.getByRole('radio', { name: 'Keep this other note private.' }))
    expect(dialog.getByRole('radio', { name: 'Keep this other note private.' })).toHaveProperty('checked', true)
    expect(dialog.queryByRole('region', { name: 'Excerpt to share with Mori' })).toBeNull()
    fireEvent.click(dialog.getByText('Share part of a note'))
    const notes = dialog.getByRole('textbox', { name: 'Select text from your Personal Notes' })
    if (!(notes instanceof HTMLTextAreaElement)) throw new Error('Personal Notes textarea is missing')
    notes.setSelectionRange(0, excerpt.length)
    fireEvent.select(notes)
    expect(dialog.getByRole('region', { name: 'Excerpt to share with Mori' }).querySelector('blockquote')?.textContent).toBe(excerpt)
    fireEvent.click(dialog.getByRole('button', { name: 'Ask Mori for a revision' }))

    await screen.findByRole('heading', { name: 'Original recipe' })
    expect(revise).toHaveBeenCalledWith(original.id, excerpt, expect.objectContaining({ userId: 'chef-cook' }))
    expect(await screen.findByRole('link', { name: 'Open original in a new tab' })).toBeTruthy()
    const proposal = screen.getByRole('region', { name: 'Mori’s proposed change' })
    expect(within(proposal).getByText('Original amount').nextElementSibling?.textContent).toBe('4')
    expect(within(proposal).getByText('Mori’s suggestion').nextElementSibling?.textContent).toBe('2')
    expect(proposal.textContent).toContain(excerpt)
    expect(proposal.textContent).not.toContain('Keep this other note private.')
    expect(proposal.textContent).not.toContain('Your edited amount')

    fireEvent.click(within(proposal).getByRole('button', { name: 'Edit proposed amount' }))
    await finishJournalTurn(() => Boolean(screen.queryByRole('textbox', { name: 'Ingredient 2 quantity' })))
    fireEvent.change(screen.getByRole('textbox', { name: 'Ingredient 2 quantity' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to ingredients' }))
    await returnChefReviewToStart()
    expect(screen.getByRole('region', { name: 'Mori’s proposed change' }).textContent).toContain('Your edited amount · 3')
    expect(screen.getByText('This draft saves as a new version linked to the original.')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()

    await advanceChefReviewToSave('Save new version')
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
    await waitFor(() => expect(saveLineage).toHaveBeenCalledOnce())
    expect(saveLineage).toHaveBeenCalledWith(savedRecipeId, response.parents.map((parent) => parent.id), [original.id], response.candidate_token, expect.objectContaining({ userId: 'chef-cook' }))
    expect(save.mock.calls[0]?.[0].ingredients[1]?.quantity).toBe(3)
    expect(save).toHaveBeenCalledOnce()
    expect((await screen.findByRole('link', { name: 'Open saved version' })).getAttribute('href')).toBe('/app/recipes/' + savedRecipeId)

    fireEvent.click(screen.getByRole('button', { name: 'Edit saved recipe' }))
    const title = screen.getByRole('textbox', { name: /^Recipe title$/ })
    expect(document.activeElement).toBe(title)
    fireEvent.change(title, { target: { value: 'A better next cook' } })
    const logout = vi.fn()
    const guard = registerLogoutGuard.mock.calls.at(-1)?.[0]
    if (!guard) throw new Error('AI Chef review did not register its logout guard')
    act(() => expect(guard(logout)).toBe(false))
    const unsaved = screen.getByRole('alertdialog')
    expect(logout).not.toHaveBeenCalled()
    fireEvent.click(within(unsaved).getByRole('button', { name: 'Keep Editing' }))
    expect(title).toHaveProperty('value', 'A better next cook')
    expect(screen.getByRole('button', { name: /^Next:/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('heading', { name: 'A better next cook' })
    expect(save.mock.calls[1]?.[1]).toMatchObject({ recipeId: savedRecipeId })
    expect(saveLineage).toHaveBeenCalledOnce()
    expect(guard(logout)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved recipe' }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Recipe title$/ }), { target: { value: 'An unsaved later edit' } })
    act(() => expect(guard(logout)).toBe(false))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard Changes' }))
    expect(logout).toHaveBeenCalledOnce()
  })

  it.each([
    { desktop: true, retryLinks: true },
    { desktop: true, retryLinks: false },
    { desktop: false, retryLinks: false },
  ])('edits a recovered saved copy through the versioned editor (desktop=$desktop, retryLinks=$retryLinks)', async ({ desktop, retryLinks }) => {
    const currentMatchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = currentMatchMedia(query)
      Object.defineProperty(media, 'matches', { value: media.matches || (desktop && query.includes('pointer: fine')) })
      return media
    })
    writeChefDraft('chef-cook', {
      input: { pantryItems: ['rice'], pantryInput: '', preferences: '' },
      handoff: {
        request: { pantryItems: ['rice'] }, response, selectedParentIds: [response.parents[0].id],
        savedRecipeId, lineageStatus: 'pending', saved: false,
      },
    })
    const recipe = { ...response.recipe, id: savedRecipeId, notes: 'Added after saving in another tab.',
      cooked_at: '2026-11-27', updated_at: '2026-11-27T07:00:00Z' }
    vi.spyOn(lineageApi, 'get').mockResolvedValue({ lineage: [] })
    vi.spyOn(lineageApi, 'save').mockResolvedValue({ lineage: [{
      id: '66666666-6666-4666-8666-666666666666', parent_recipe_id: response.parents[0].id,
      child_recipe_id: savedRecipeId, created_at: '2026-11-27T07:01:00Z',
    }] })
    const save = vi.spyOn(recipeFormApi, 'save').mockImplementation(async (draft) => ({
      id: savedRecipeId, record: { id: savedRecipeId, userId: 'chef-cook', values: draft, updatedAt: recipe.updated_at },
    }))
    const view = renderChef({ source: { mode: 'live', list: async () => [recipe], detail: async () => recipe } })
    await act(() => view.router.navigate('/app/chef/review'))
    await screen.findByRole('button', { name: 'Retry recipe links' })
    expect(screen.queryByRole('textbox', { name: /^Recipe title$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(save).not.toHaveBeenCalled()
    if (retryLinks) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry recipe links' }))
      await screen.findByText('Recipe and selected parent links saved.')
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Edit saved recipe' }))
    await waitFor(() => expect(view.router.state.location.pathname).toBe(`/app/recipes/${savedRecipeId}/edit`))
    const title = await screen.findByRole('textbox', { name: /^Recipe title$/ })
    fireEvent.change(title, { target: { value: 'A better next cook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0]?.[0]).toMatchObject({ notes: recipe.notes, cooked_at: recipe.cooked_at })
    expect(save.mock.calls[0]?.[3]).toMatchObject({ id: savedRecipeId, updatedAt: recipe.updated_at,
      values: { notes: recipe.notes, cooked_at: recipe.cooked_at } })
  })

  it('keeps a cooking observation through a conflicting notes edit and asks to review again', async () => {
    const currentMatchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = currentMatchMedia(query)
      Object.defineProperty(media, 'matches', { value: media.matches || query.includes('pointer: fine') })
      return media
    })
    const recipe = { ...response.recipe, id: response.parents[0].id, notes: 'First cook.',
      updated_at: '2026-11-01T00:00:00.000Z', cooked_at: '2026-11-01' }
    const concurrent = { ...recipe, notes: 'First cook. Another note.', updated_at: '2026-11-02T00:00:00.000Z' }
    const saved = { ...concurrent, notes: concurrent.notes + '\n\nAdd more garlic.', updated_at: '2026-11-03T00:00:00.000Z' }
    let current = recipe
    const update = vi.spyOn(recipeFormApi, 'updateCookingDetails')
      .mockImplementationOnce(async () => {
        current = concurrent
        throw new HttpError('http', 'Expected version conflict.', 409)
      })
      .mockImplementationOnce(async () => { current = saved; return saved })
    const { router } = renderChef({ source: { mode: 'live', list: async () => [current], detail: async () => current } })
    await act(() => router.navigate('/app/recipes/' + recipe.id))
    await screen.findByRole('button', { name: 'Record cooking' })
    const dialog = openReviewDetail('Record cooking', 'Record this cook')
    fireEvent.click(dialog.getByRole('button', { name: 'Keep recorded date and add a note' }))
    fireEvent.change(dialog.getByRole('textbox', { name: 'A note for next time' }), { target: { value: 'Add more garlic.' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Review cooking note' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Back to recipe' }))
    expect(dialog.getByText(/this cooking note is still unsaved/i)).toBeTruthy()
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Keep editing note' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Keep editing note' }))
    expect(dialog.getByText('Add more garlic.')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: 'Save cooking note' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('Personal Notes changed')
    expect(dialog.getByRole('textbox', { name: 'A note for next time' })).toHaveProperty('value', 'Add more garlic.')
    expect(update).toHaveBeenCalledOnce()
    fireEvent.click(dialog.getByRole('button', { name: 'Review cooking note' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Save cooking note' }))
    expect(await dialog.findByText('Saved to Personal Notes.')).toBeTruthy()
    expect(update.mock.calls.map((call) => call[1])).toEqual([
      { notes: 'First cook.\n\nAdd more garlic.', expected_updated_at: recipe.updated_at },
      { notes: saved.notes, expected_updated_at: concurrent.updated_at },
    ])
  })

  it('focuses and highlights the pantry field when Mori sends the cook there', async () => {
    const { router } = renderChef()
    await act(() => router.navigate('/app/chef', { state: { moriFocus: 'pantry' } }))
    await waitFor(() => {
      const pantry = screen.getByRole('textbox', { name: 'Pantry ingredient' })
      expect(document.activeElement).toBe(pantry)
      expect(pantry.className).toContain('mori-guided-focus')
    })
  })

  it('keeps Mori open and loads a new handoff on an in-place AI Chef review navigation', async () => {
    const { router } = renderChef()
    await act(() => router.navigate('/app/chef/review', { state: { moriKeepOpen: true, moriReviewKey: 0 } }))
    expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()

    writeChefDraft('chef-cook', {
      input: { pantryItems: ['rice'], pantryInput: '', preferences: '' },
      handoff: { request: { pantryItems: ['rice'] }, response, selectedParentIds: [], saved: false },
    })
    await act(() => router.navigate('/app/chef/review', {
      state: { moriKeepOpen: true, chefGenerationSucceeded: true, moriReviewKey: 1 },
    }))

    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    await waitFor(() => expect(router.state.location.state).toEqual({ moriKeepOpen: true, moriReviewKey: 1 }))
    expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
  })

  it('uses both desktop leaves for pantry entry and review, while keeping view controls operable', () => {
    const currentMatchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = currentMatchMedia(query)
      Object.defineProperty(media, 'matches', {
        configurable: true,
        value: query.includes('(min-width: 1024px)') || query.includes('(min-width: 1100px)') || query.includes('prefers-reduced-motion'),
      })
      return media
    })
    renderChef()

    const leftLeaf = document.querySelector('.mm-facing-content--ai-chef-task')
    expect(leftLeaf).toBeTruthy()
    expect(within(leftLeaf as HTMLElement).getByRole('form', { name: 'Pantry ingredients' })).toBeTruthy()
    const pantryInput = within(leftLeaf as HTMLElement).getByRole('textbox', { name: 'Pantry ingredient' })
    const rightLeaf = screen.getByRole('region', { name: /AI Chef page 1/ })
    expect(within(rightLeaf).getByRole('region', { name: 'Pantry list, 0 items' })).toBeTruthy()
    expect(within(rightLeaf).queryByRole('textbox', { name: 'Pantry ingredient' })).toBeNull()
    const pantryHelp = within(leftLeaf as HTMLElement).getByText(/Add up to 100 ingredients\./)
    expect(pantryHelp.textContent).toBe('Add up to 100 ingredients. Press Enter to add one or paste a list separated by commas or line breaks. Cooking preferences are optional.')
    expect(within(leftLeaf as HTMLElement).getByRole('button', { name: 'Add ingredient' }).className).toContain('button-secondary')
    expect(within(leftLeaf as HTMLElement).getByRole('button', { name: 'Add ingredient' }).className).not.toContain('button-primary')
    expect(screen.getByRole('button', { name: 'Ask Mori for a recipe' }).className).toContain('button-primary')
    const quickAdd = within(leftLeaf as HTMLElement).getByText('Quick add common ingredients').closest('details')
    expect(quickAdd?.open).toBe(false)
    expect(within(rightLeaf).queryByRole('combobox', { name: 'Sort pantry ingredients' })).toBeNull()
    expect(within(rightLeaf).queryByRole('group', { name: 'Pantry view' })).toBeNull()
    expect(within(rightLeaf).queryByText(/unlock sorting|Views appear/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Next page: Cooking preferences' }).textContent).toContain('Cooking preferences')

    fireEvent.change(pantryInput, { target: { value: 'rice' } })
    fireEvent.keyDown(pantryInput, { key: 'Enter' })
    expect(within(rightLeaf).getByRole('region', { name: 'Pantry list, 1 item' }).textContent).toContain('rice')
    addIngredient('eggs')
    expect(within(rightLeaf).getByRole('combobox', { name: 'Sort pantry ingredients' })).toBeTruthy()
    expect(within(rightLeaf).queryByRole('group', { name: 'Pantry view' })).toBeNull()
    addIngredient('tomatoes')
    expect(within(rightLeaf).getByRole('group', { name: 'Pantry view' })).toBeTruthy()
    fireEvent.click(within(rightLeaf).getByRole('button', { name: 'List view' }))
    expect(within(rightLeaf).getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('gives an empty chef review clear return routes', async () => {
    const { router } = renderChef()
    await act(() => router.navigate('/app/chef/review'))

    expect(await screen.findByRole('heading', { name: 'No AI Chef recipe idea to review' })).toBeTruthy()
    const actions = screen.getByRole('navigation', { name: 'AI Chef recovery' })
    expect(within(actions).getByRole('link', { name: 'Back to AI Chef' }).getAttribute('href')).toBe('/app/chef')
    expect(within(actions).getByRole('link', { name: 'My recipes' }).getAttribute('href')).toBe('/app/recipes')
  })

  it('uses the shared page-aware companion and keeps recipe generation structured', () => {
    renderChef()

    expect(document.querySelectorAll('.mori-pet-character')).toHaveLength(1)
    expect(document.querySelector('.mm-journal-book .mm-mori')).toBeNull()
    expect(document.querySelector('.mori-pet-caption')).toBeNull()
    expect(document.querySelector('.mm-facing-content--ai-chef')).toBeTruthy()
    expect(document.querySelector('.mm-ai-chef__journey li[aria-current="step"]')?.textContent).toContain('Pantry')
    expect(screen.getByRole('region', { name: 'Pantry list, 0 items' }).textContent).toContain('No ingredients yet.')
    expect(screen.getByRole('button', { name: 'Ask Mori for a recipe' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    const panel = screen.getByRole('region', { name: 'Mori' })
    expect(within(panel).getByText('AI Chef', { selector: '.mori-pet-context' })).toBeTruthy()
    expect(within(panel).getByText('Tell me what you have, and I’ll make an idea for you to review.')).toBeTruthy()
    expect(panel.querySelector('nav')).toBeNull()

    fireEvent.click(within(panel).getByRole('button', { name: 'Add ingredients' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Pantry ingredient' }))
    expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
  })

  it('continues pantry entries and preferences onto physical pages without changing the request text', async () => {
    const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    renderChef()
    const input = screen.getByRole('textbox', { name: 'Pantry ingredient' })
    fireEvent.change(input, { target: { value: 'rice, beans, eggs, tomatoes, onion, garlic, salt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const firstPantryPage = screen.getByRole('region', { name: 'Pantry list, 7 items' })
    expect(firstPantryPage.querySelectorAll('li')).toHaveLength(2)
    expect(firstPantryPage.querySelector('img[src="' + scrapbookRegistry['rice-bowl'].src + '"]')?.getAttribute('alt')).toBe('')

    await nextChefPage()
    expect(screen.getByRole('region', { name: /AI Chef page 2/ }).textContent).toContain('eggs')
    expect(screen.getByRole('region', { name: 'Pantry list, 7 items' }).querySelector('img[src="' + scrapbookRegistry.egg.src + '"]')?.getAttribute('alt')).toBe('')
    expect(screen.getByRole('region', { name: /AI Chef page 2/ }).textContent).toContain('garlic')
    await nextChefPage()
    expect(screen.getByRole('region', { name: /AI Chef page 3/ }).textContent).toContain('salt')
    await nextChefPage()

    const preferences = 'a'.repeat(400) + 'b'.repeat(400) + 'c'.repeat(150)
    fireEvent.change(screen.getByRole('textbox', { name: /^Cooking preferences/ }), { target: { value: preferences } })
    expect(screen.getByText('This request only · 950 / 1000 characters')).toBeTruthy()
    const preferenceParts = [(screen.getByRole('textbox', { name: /^Cooking preferences/ }) as HTMLTextAreaElement).value]
    while (screen.queryByRole('button', { name: /^Next page/ })) {
      await nextChefPage()
      const nextPart = screen.queryByRole('textbox', { name: /^Cooking preferences/ }) as HTMLTextAreaElement | null
      if (!nextPart) break
      preferenceParts.push(nextPart.value)
    }
    expect(preferenceParts.join('')).toBe(preferences)

    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    expect(generate.mock.calls[0]?.[0]).toEqual(['rice', 'beans', 'eggs', 'tomatoes', 'onion', 'garlic', 'salt'])
    expect(generate.mock.calls[0]?.[1]).toBe(preferences)
  })

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
    await openPreferences()
    fireEvent.change(screen.getByRole('textbox', { name: /^Cooking preferences/ }), { target: { value: 'quick, no frying' } })

    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    expect(await screen.findByRole('heading', { name: "Review Mori's recipe." })).toBeTruthy()
    const saveContext = screen.getByRole('region', { name: 'Before you save' })
    expect(saveContext.textContent).toContain('Save recipe adds this draft to My recipes.')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('celebrating'))
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    expect(document.querySelector('.mori-pet-message')?.textContent).toBe('Your recipe idea is ready for review.')
    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0]).toEqual([
      ['Rice', 'tomatoes'], 'quick, no frying', expect.objectContaining({ userId: 'chef-cook', signal: expect.any(AbortSignal) }),
    ])
    expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('Tomato egg rice')
    expect(screen.queryByRole('button', { name: 'Save recipe' })).toBeNull()
    const form = document.querySelector('.recipe-form')
    expect(form).toBeTruthy()
    fireEvent.submit(form!)
    expect(save).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Ingredient 1 amount description (optional)') as HTMLInputElement).value).toBe('leftover')
    expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Ingredient 2 quantity') as HTMLInputElement).value).toBe('2')
    expect(save).not.toHaveBeenCalled()
    await nextChefReviewPage()
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="instructions.0.text"]:not([disabled])')?.value).toBe('Warm the rice and fold in the tomatoes.')
    const details = within(screen.getByRole('region', { name: 'AI Chef generation details' }))
    fireEvent.click(screen.getByText('Optional details from Mori'))
    expect(details.getByText('bell pepper')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save recipe' })).toBeTruthy()
    const saveHelp = within(screen.getByRole('region', { name: 'Before you save' }))
    const linksHelp = saveHelp.getByText('What are recipe links?').closest('details')!
    expect(linksHelp.open).toBe(false)
    expect(linksHelp.textContent).toContain('link as inspiration')
    expect(linksHelp.textContent).toContain('You can save without links.')
  })

  it('distinguishes the generated ingredients from the request and describes flavor estimates accessibly', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue({
      ...response,
      recipe: { ...response.recipe, flavor_scores: { sweet: 0, salty: 3.5, sour: 0, bitter: 0, umami: 5, spicy: 0 } },
    })
    renderChef()
    const pantryEntry = 'the leftover ingredients in my pantry'
    addIngredient(pantryEntry)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))

    await advanceChefReviewToSave()
    const review = within(await screen.findByRole('region', { name: 'AI Chef generation details' }))
    const ingredients = within(review.getByRole('region', { name: 'Ingredients in this suggestion' }))
    expect(ingredients.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['rice', 'tomatoes'])
    fireEvent.click(screen.getByText('Optional details from Mori'))
    expect(review.getByRole('heading', { name: 'Your request' })).toBeTruthy()
    expect(review.getByRole('heading', { name: 'Mori’s optional flavor estimates' })).toBeTruthy()
    expect(review.getByText(pantryEntry)).toBeTruthy()
    expect(review.getByText('3.5 out of 5').className).toBe('visually-hidden')
    expect(review.getByText('5 out of 5').className).toBe('visually-hidden')
  })

  it('gives long journal titles and pantry requests room in a smaller spread', async () => {
    const matchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const result = matchMedia(query)
      return { ...result, matches: result.matches || query.includes('max-width: 1279.98px') }
    })
    const parent = { ...response.parents[0], title: 'Weeknight stir-fried rice with tomatoes' }
    const pantryItems = ['yellow bell pepper', 'Worcestershire', 'spring onions', 'polenta', 'sweet red chili', 'cherry tomatoes']
    writeChefDraft('chef-cook', {
      input: { pantryItems, pantryInput: '', preferences: '' },
      handoff: { request: { pantryItems }, response: { ...response, parents: [parent] }, selectedParentIds: [], saved: false },
    })
    const { router } = renderChef()
    await act(() => router.navigate('/app/chef/review'))

    await advanceChefReviewToSave()
    const journal = openReviewDetail('Choose journal recipes (1)', 'From your journal')
    fireEvent.click(journal.getByRole('checkbox', { name: new RegExp(parent.title) }))
    fireEvent.click(journal.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('1 selected · up to 10 recipes.')).toBeTruthy()

    fireEvent.click(screen.getByText('Optional details from Mori'))
    const request = screen.getByRole('region', { name: 'Your request' })
    const shownItems = within(request).getAllByRole('listitem').map((item) => item.textContent)
    expect(shownItems).toEqual(pantryItems)
  })

  it('rejects an empty pantry locally and retains inputs after quota failure for retry', async () => {
    const generate = vi.spyOn(generateRecipeApi, 'generate')
      .mockRejectedValueOnce(new HttpError('http', 'private text', 429, { error: { code: 'QUOTA_EXCEEDED' } }, '60'))
      .mockResolvedValueOnce(response)
    renderChef()
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('attention')
    expect(screen.getByRole('alert').textContent).toContain('Add at least one pantry ingredient')
    const pantryInput = screen.getByRole('textbox', { name: 'Pantry ingredient' })
    expect(document.activeElement).toBe(pantryInput)
    expect(screen.getByRole('textbox', {
      name: 'Pantry ingredient', description: /Add at least one pantry ingredient/,
    })).toBe(pantryInput)
    expect(generate).not.toHaveBeenCalled()

    addIngredient('rice')
    await openPreferences()
    fireEvent.change(screen.getByRole('textbox', { name: /^Cooking preferences/ }), { target: { value: 'spicy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    expect((await screen.findByRole('alert')).textContent).toContain('today’s AI Chef limit')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('confused'))
    expect((screen.getByRole('textbox', { name: /^Cooking preferences/ }) as HTMLTextAreaElement).value).toBe('spicy')
    fireEvent.click(screen.getByRole('button', { name: /^Previous page/ }))
    expect((screen.getByRole('textbox', { name: 'Pantry ingredient' }) as HTMLInputElement).value).toBe('')

    expect(screen.getByRole('button', { name: 'Please wait to retry' }).hasAttribute('disabled')).toBe(true)
    fireEvent.submit(document.querySelector('.mm-ai-chef__form')!)
    expect(generate).toHaveBeenCalledOnce()
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry recipe suggestion' }).hasAttribute('disabled')).toBe(false), { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Retry recipe suggestion' }))
    expect(await screen.findByRole('heading', { name: "Review Mori's recipe." }, { timeout: 5000 })).toBeTruthy()
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1]?.[0]).toEqual(['rice'])
    expect(generate.mock.calls[1]?.[1]).toBe('spicy')
  })

  it('shows a shared-capacity cooldown and keeps the pantry available', async () => {
    const generate = vi.spyOn(generateRecipeApi, 'generate').mockRejectedValue(
      new HttpError('http', 'private rate detail', 429, { error: { code: 'AI_CAPACITY_EXCEEDED' } }, '90000'),
    )
    renderChef()
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('shared AI capacity')
    expect(alert.textContent).toContain('25 hours')
    expect(screen.getByRole('button', { name: 'Please wait to retry' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('region', { name: 'Pantry list, 1 item' }).textContent).toContain('rice')
    expect(generate).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('thinking')

    await act(async () => resolveGeneration(response))
    expect(await screen.findByRole('heading', { name: "Review Mori's recipe." })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('celebrating'))
  })

  it('carries pantry ingredients into a manual recipe when AI Chef is disabled', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockRejectedValue(new HttpError('http', 'private service response', 503, {
      error: { code: 'AI_DISABLED' },
    }))
    const { router } = renderChef()
    addIngredient('rice')
    addIngredient('eggs')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('temporarily unavailable')
    fireEvent.click(screen.getByRole('link', { name: 'Write recipe manually' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/recipes/new'))
    expect(JSON.parse(screen.getByTestId('manual-recipe-state').textContent ?? 'null')).toEqual({
      manualRecipe: { userId: 'chef-cook', source: 'chef', ingredients: ['rice', 'eggs'] },
    })
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
    expect(screen.queryByRole('button', { name: 'Save recipe' })).toBeNull()
    fireEvent.submit(document.querySelector('.recipe-form')!)
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'My edited rice bowl' } })

    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('alert')
    await returnChefReviewToStart()
    expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('My edited rice bowl')
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await waitFor(() => expect(screen.getByText('Recipe saved.')).toBeTruthy())
    expect(screen.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('celebrating')
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ title: 'My edited rice bowl', ingredients: response.recipe.ingredients })
    expect(save.mock.calls[0]?.[1]).toMatchObject({ userId: 'chef-cook', signal: expect.any(AbortSignal) })
  })

  it('keeps inspiration beside longer notes and saves all expanded edits', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })

    const notes = Array.from({ length: 22 }, (_, index) => 'Cooking note ' + (index + 1)).join('\n')
    const expanded = openReviewDetail('Expand notes', 'Notes')
    fireEvent.change(expanded.getByRole('textbox', { name: 'Full notes' }), { target: { value: notes } })
    fireEvent.click(expanded.getByRole('button', { name: 'Done' }))
    expect(screen.getByLabelText(/^Notes(?: \(optional\))?$/)).toHaveProperty('value', notes)
    await advanceChefReviewToSave()
    expect(screen.getByRole('heading', { name: 'Recipe inspiration' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByText('Recipe saved.')
    expect(save.mock.calls[0]?.[0].notes).toBe(notes)
  })

  it('clears the handoff after the first save and leaves the editor available', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save')
    renderChef({ save })
    addIngredient('rice')
    await openPreferences()
    fireEvent.change(screen.getByRole('textbox', { name: /^Cooking preferences/ }), { target: { value: 'weekday lunch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })

    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect(await screen.findByRole('heading', { name: 'Your recipe is saved.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use this pantry again' })).toBeTruthy()
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull())
    await returnChefReviewToStart()
    expect(screen.getByLabelText('Recipe title')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    await advanceChefReviewToSave()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use this pantry again' }))
    expect(await screen.findByRole('textbox', { name: 'Pantry ingredient' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Pantry list, 1 item' }).textContent).toContain('rice')
    await openPreferences()
    expect((screen.getByRole('textbox', { name: /^Cooking preferences/ }) as HTMLTextAreaElement).value).toBe('weekday lunch')
  })

  it('updates the same recipe after the cleared handoff instead of reporting a conflict', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn<SaveRecipeDraft>(async () => ({ id: savedRecipeId }))
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    await advanceChefReviewToSave()
    expect(screen.getByText('Unsaved preview')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('heading', { name: 'Your recipe is saved.' })

    await returnChefReviewToStart()
    fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'Updated tomato egg rice' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull())
    expect(save).toHaveBeenCalledTimes(2)
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
    await advanceChefReviewToSave()
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

    await advanceChefReviewToSave()
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
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('heading', { name: 'Your recipe is saved.' })

    await returnChefReviewToStart()
    for (const [index, title] of ['Second saved title', 'Third saved title'].entries()) {
      fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: title } })
      await advanceChefReviewToSave()
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(save).toHaveBeenCalledTimes(index + 2))
      expect(screen.queryByText(/changed elsewhere/)).toBeNull()
      expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull()
      if (index === 0) await returnChefReviewToStart()
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

    await advanceChefReviewToSave()
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
    await returnChefReviewToStart()
    fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'My tomato rice' } })
    await advanceChefReviewToSave()
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
    await advanceChefReviewToSave()
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
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    await advanceChefReviewToSave()
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
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Your recipe was saved, but Mori could not confirm its parent links.')
    const progress = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(progress.savedRecipeId).toBe(savedRecipeId)
    expect(progress.selectedParentIds).toEqual([response.parents[0].id])
    expect(progress.lineageStatus).toBe('pending')
    expect(save).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Retry recipe links' }))

    await screen.findByText('Recipe and selected parent links saved.')
    expect(getLineage).toHaveBeenCalledTimes(2)
    expect(saveLineage).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledOnce()
  })

  it('keeps the draft unsaved if parent authorization cannot renew, then retries without regenerating', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    vi.mocked(lineageApi.renew).mockRejectedValueOnce(new LineageApiError('unavailable'))
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    vi.spyOn(lineageApi, 'save').mockResolvedValue({ lineage: [{ id: '44444444-4444-4444-8444-444444444444', parent_recipe_id: response.parents[0].id, child_recipe_id: savedRecipeId, created_at: '2026-11-27T00:00:00Z' }] })
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    expect((await screen.findByRole('alert')).textContent).toContain('nothing has been saved')
    expect(save).not.toHaveBeenCalled()
    const stored = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(stored.savedRecipeId).toBeUndefined()
    expect(stored.selectedParentIds).toEqual([response.parents[0].id])
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByText('Recipe and selected parent links saved.')
    expect(save).toHaveBeenCalledOnce()
    expect(generateRecipeApi.generate).toHaveBeenCalledOnce()
    expect(lineageApi.renew).toHaveBeenCalledTimes(2)
    expect(vi.mocked(lineageApi.renew).mock.invocationCallOrder[1]).toBeLessThan(save.mock.invocationCallOrder[0])
  })

  it('keeps the saved recipe and selected parents when the candidate token has expired', async () => {
    vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    const save = vi.fn(async () => ({ id: savedRecipeId }))
    const saveLineage = vi.spyOn(lineageApi, 'save').mockRejectedValueOnce(new LineageApiError('expired-token')).mockResolvedValueOnce({ lineage: [{ id: '44444444-4444-4444-8444-444444444444', parent_recipe_id: response.parents[0].id, child_recipe_id: savedRecipeId, created_at: '2026-11-27T00:00:00Z' }] })
    const getLineage = vi.spyOn(lineageApi, 'get').mockResolvedValue({ lineage: [] })
    renderChef({ save })
    addIngredient('rice')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
    await screen.findByRole('heading', { name: "Review Mori's recipe." })
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('authorization for its parent links expired')
    expect(screen.getByText('Recipe saved. Parent links still need attention.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry recipe links' })).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(saveLineage).toHaveBeenCalledOnce()
    expect(getLineage).not.toHaveBeenCalled()
    const progress = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
    expect(progress.savedRecipeId).toBe(savedRecipeId)
    expect(progress.selectedParentIds).toEqual([response.parents[0].id])
    expect(progress.lineageStatus).toBe('expired')
    vi.mocked(lineageApi.renew).mockResolvedValueOnce('v1.renewed-for-same-copy')
    fireEvent.click(screen.getByRole('button', { name: 'Retry recipe links' }))
    await waitFor(() => expect(saveLineage).toHaveBeenCalledTimes(2))
    expect(saveLineage.mock.calls[1][0]).toBe(savedRecipeId)
    expect(saveLineage.mock.calls[1][3]).toBe('v1.renewed-for-same-copy')
    expect(save).toHaveBeenCalledOnce()
    expect(generateRecipeApi.generate).toHaveBeenCalledOnce()

  })

  it('collapses repeated ingredients recovered from a preview and removes the remaining ingredient', () => {
    const userId = 'chef-duplicate-recovery'
    const pantryItems = ['rice', 'rice']
    writeChefDraft(userId, {
      input: { pantryItems, pantryInput: '', preferences: '' },
      handoff: { request: { pantryItems }, response, selectedParentIds: [], saved: false },
    })
    renderChef({ userId })
    fireEvent.click(screen.getByRole('button', { name: 'Discard preview' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard preview' }))
    const removeControls = screen.getAllByRole('button', { name: 'Remove rice' })
    expect(removeControls).toHaveLength(1)
    fireEvent.click(removeControls[0])
    expect(screen.queryByRole('button', { name: 'Remove rice' })).toBeNull()
  })

  it('shows draft actions on return to the pantry and restores pantry input after discard', async () => {
    const generate = vi.spyOn(generateRecipeApi, 'generate').mockResolvedValue(response)
    writeChefDraft('chef-cook', {
      input: { pantryItems: ['rice', 'eggs'], pantryInput: 'garlic', preferences: 'quick' },
      handoff: { request: { pantryItems: ['rice', 'eggs'], preferences: 'quick' }, response, selectedParentIds: [], saved: false },
    })
    renderChef()

    expect(screen.getByRole('link', { name: 'Return to recipe review' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Pantry ingredient' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ask Mori for a recipe' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Discard preview' }))
    const confirmation = screen.getByRole('alertdialog', { name: 'Discard Mori’s recipe preview?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard preview' }))

    const pantry = screen.getByRole<HTMLInputElement>('textbox', { name: 'Pantry ingredient' })
    expect(pantry.value).toBe('garlic')
    expect(document.activeElement).toBe(pantry)
    expect(screen.getByRole('region', { name: 'Pantry list, 2 items' }).textContent).toContain('eggs')
    await openPreferences()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /^Cooking preferences/ }).value).toBe('quick')
    expect(generate).not.toHaveBeenCalled()
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
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
    await screen.findByRole('button', { name: 'Retry recipe links' })

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
    await advanceChefReviewToSave()
    fireEvent.click(screen.getByRole('checkbox', { name: /Garden rice/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))

    expect((await screen.findByRole('alert')).textContent).toContain('could not verify one of the selected parents')
    expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff.lineageStatus).toBe('blocked')
    await act(async () => router.navigate('/app/chef'))
    fireEvent.click(await screen.findByRole('link', { name: 'Return to recipe review' }))

    expect(await screen.findByText('Your recipe is safe, but Mori could not confirm the selected parent links. The links remain unchanged.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry recipe links' })).toBeNull()
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
    await advanceChefReviewToSave()
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
    await advanceChefReviewToSave()

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
    await advanceChefReviewToSave()
    const choices = openReviewDetail('Choose journal recipes (11)', 'From your journal')
    for (let index = 1; index <= 10; index += 1) {
      fireEvent.click(choices.getByRole('checkbox', { name: 'Parent ' + index }))
    }
    expect(choices.getByRole('checkbox', { name: 'Parent 11' })).toHaveProperty('disabled', true)
    fireEvent.click(choices.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('10 selected · up to 10 recipes.')).toBeTruthy()
    const reopened = openReviewDetail('Choose journal recipes (11)', 'From your journal')
    expect(reopened.getByRole('checkbox', { name: 'Parent 4' })).toHaveProperty('checked', true)
  })
})


it('ignores a generation completion after the session page unmounts', async () => {
  let resolve!: (value: GenerateRecipeResponse) => void
  const generate = vi.spyOn(generateRecipeApi, 'generate').mockReturnValue(new Promise((done) => { resolve = done }))
  const view = renderChef()
  addIngredient('rice')
  fireEvent.click(screen.getByRole('button', { name: 'Ask Mori for a recipe' }))
  view.unmount()
  expect(generate.mock.calls[0][2].signal.aborted).toBe(true)
  await act(async () => resolve(response))
  expect(JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff).toBeNull()
  expect(view.router.state.location.pathname).toBe('/app/chef')
})


it('retries a real storage write for a resumed preview without losing saved-child or parent recovery', async () => {
  const userId = 'chef-storage-retry'
  const draft = {
    input: { pantryItems: ['rice'], pantryInput: '', preferences: 'quick' },
    handoff: { request: { pantryItems: ['rice'] }, response, selectedParentIds: [response.parents[0].id], savedRecipeId, lineageStatus: 'pending' as const, saved: false as const },
  }
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  expect(writeChefDraft(userId, draft).persisted).toBe(false)
  storage.mockRestore()
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  const generate = vi.spyOn(generateRecipeApi, 'generate')
  renderChef({ userId })
  fireEvent.click(screen.getByRole('button', { name: 'Try saving this request again' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(writes).toHaveBeenCalled()
  const recovered = JSON.parse(sessionStorage.getItem(`moris-mix:ai-chef:v1:${userId}`) ?? 'null')
  expect(recovered.handoff).toMatchObject({ savedRecipeId, selectedParentIds: [response.parents[0].id], lineageStatus: 'pending' })
  expect(generate).not.toHaveBeenCalled()
  writeChefDraft(userId, { ...draft, handoff: null })
})


it('does not overwrite a newer preview while retrying failed storage', async () => {
  const userId = 'chef-storage-conflict'
  const draft = {
    input: { pantryItems: ['rice'], pantryInput: '', preferences: '' },
    handoff: { request: { pantryItems: ['rice'] }, response, selectedParentIds: [], saved: false as const },
  }
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  writeChefDraft(userId, draft)
  storage.mockRestore()
  renderChef({ userId })
  const newer = { ...draft, handoff: { ...draft.handoff, response: { ...response, recipe: { ...response.recipe, title: 'Newer preview' } } } }
  expect(writeChefDraft(userId, newer).persisted).toBe(true)
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  fireEvent.click(screen.getByRole('button', { name: 'Try saving this request again' }))
  expect((await screen.findByRole('alert')).textContent).toContain('changed elsewhere')
  expect(writes).not.toHaveBeenCalled()
  expect(JSON.parse(sessionStorage.getItem(`moris-mix:ai-chef:v1:${userId}`) ?? 'null').handoff.response.recipe.title).toBe('Newer preview')
  expect(screen.getByRole('link', { name: 'Open current recipe review' })).toBeTruthy()
})


it('restores a legacy AI Chef preview with edits and requires a positive amount to save', async () => {
  const recipe = { ...response.recipe, ingredients: [{ name: 'tomatoes', quantity: 0, unit: null, inferred: false }] }
  const initial = mapAiRecipeToDraft(recipe)
  if (!initial) throw new Error('Legacy recipe must initialize')
  const reviewDraft = { ...editorState(initial), title: 'My edited legacy tomatoes' }
  sessionStorage.setItem('moris-mix:ai-chef:v1:chef-cook', JSON.stringify({
    input: { pantryItems: ['tomatoes'], pantryInput: '', preferences: '' },
    handoff: { request: { pantryItems: ['tomatoes'] }, response: { ...response, recipe },
      reviewDraft, selectedParentIds: [], saved: false },
  }))
  const { router, save } = renderChef()
  await act(() => router.navigate('/app/chef/review'))
  expect(screen.getByLabelText('Recipe title')).toHaveProperty('value', reviewDraft.title)
  await advanceChefReviewToSave()
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Ingredient 1 quantity')).toHaveProperty('value', '0')
  fireEvent.change(screen.getByLabelText('Ingredient 1 quantity'), { target: { value: '2' } })
  await advanceChefReviewToSave()
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
})

it('recovers legacy saved previews and parent links without creating another recipe', async () => {
  const recipe = { ...response.recipe, ingredients: [{ name: 'tomatoes', quantity: 0, unit: null, inferred: false }] }
  const initial = mapAiRecipeToDraft(recipe)
  if (!initial) throw new Error('Legacy recipe must initialize')
  const reviewDraft = { ...editorState(initial), title: 'Edited before the partial save' }
  sessionStorage.setItem('moris-mix:ai-chef:v1:chef-cook', JSON.stringify({
    input: { pantryItems: ['tomatoes'], pantryInput: '', preferences: '' },
    handoff: { request: { pantryItems: ['tomatoes'] }, response: { ...response, recipe }, reviewDraft,
      selectedParentIds: [response.parents[0].id], savedRecipeId, lineageStatus: 'pending', saved: false },
  }))
  vi.spyOn(lineageApi, 'get').mockResolvedValue({ lineage: [] })
  const saveLineage = vi.spyOn(lineageApi, 'save').mockResolvedValue({ lineage: [{
    id: '66666666-6666-4666-8666-666666666666', parent_recipe_id: response.parents[0].id,
    child_recipe_id: savedRecipeId, created_at: '2026-11-07T00:00:00.000Z',
  }] })
  const { router, save } = renderChef()
  await act(() => router.navigate('/app/chef/review'))
  const restored = JSON.parse(sessionStorage.getItem('moris-mix:ai-chef:v1:chef-cook') ?? 'null').handoff
  expect(restored).toMatchObject({ savedRecipeId, lineageStatus: 'pending',
    selectedParentIds: [response.parents[0].id], reviewDraft: { title: reviewDraft.title } })
  for (let index = 0; index < 20 && !screen.queryByRole('button', { name: 'Retry recipe links' }); index += 1) await nextChefReviewPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Retry recipe links' }))
  await screen.findByText('Recipe and selected parent links saved.')
  expect(saveLineage).toHaveBeenCalledWith(savedRecipeId, [response.parents[0].id], [response.parents[0].id], response.candidate_token, expect.anything())
  expect(save).not.toHaveBeenCalled()
})
