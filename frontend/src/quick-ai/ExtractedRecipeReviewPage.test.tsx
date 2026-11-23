import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, createRoutesFromElements, Link, Outlet, Route, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { JournalLogoutGuardContext } from '../journal/JournalLogoutGuardContext'
import type { JournalLogoutGuard } from '../journal/JournalLogoutGuardContext'
import type { SaveRecipeDraft } from '../recipe-form/submission'
import { readQuickAiEntryDraft, writeQuickAiEntryDraft } from './draft'
import { ExtractedRecipeReviewPage } from './ExtractedRecipeReviewPage'

const NativeRequest = globalThis.Request
const sourceNotes = 'rice, eggs, garlic and soy sauce; fry the eggs first'
const handoff = {
  sourceNotes,
  recipe: {
    title: 'Garlic soy rice',
    ingredients: [
      { name: 'rice', quantity: 2, unit: 'cups', inferred: false },
      { name: 'soy sauce', quantity: null, unit: null, quantityText: 'a splash', inferred: true },
      { name: 'garlic', quantity: null, unit: null, inferred: true },
    ],
    instructions: [{ step: 1, text: 'Fry the eggs, then fold in the rice and sauce.' }],
    flavor_scores: { sweet: 0, salty: 4, sour: 0, bitter: 0, umami: 3, spicy: 0 },
  },
  saved: false as const,
}

function authState(id = 'cook-a'): AuthState {
  const user = { id, email: `${id}@example.test` } as User
  const session: Session = {
    user, access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  }
  return {
    user, session, isLoading: false, isAuthenticated: true, error: null, logoutNotice: null,
    dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn(), resendVerification: vi.fn(),
  }
}

function seed(userId = 'cook-a') {
  writeQuickAiEntryDraft(userId, {
    notes: sourceNotes, blockedUntil: null, blockedReason: null, handoff, reviewDraft: null,
  })
}

function renderReview({ userId = 'cook-a', save = vi.fn<SaveRecipeDraft>().mockResolvedValue({ id: 'saved-recipe' }), path = '/app/quick-entry/review' }: {
  userId?: string; save?: SaveRecipeDraft; path?: string
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = authState(userId)
  const logoutGuard: { current: JournalLogoutGuard | null } = { current: null }
  const registerLogoutGuard = (guard: JournalLogoutGuard) => {
    logoutGuard.current = guard
    return () => { if (logoutGuard.current === guard) logoutGuard.current = null }
  }
  const routes = createRoutesFromElements(<Route element={<AuthContext.Provider value={auth}><JournalLogoutGuardContext.Provider value={registerLogoutGuard}><Outlet /></JournalLogoutGuardContext.Provider></AuthContext.Provider>}>
    <Route path="/app/quick-entry/review" element={<ExtractedRecipeReviewPage save={save} />} />
    <Route path="/app/quick-entry" element={<><h1>Quick AI Entry</h1><Link to="/app/quick-entry/review">Review again</Link></>} />
  </Route>)
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname: path, state: { journalReturn: '/app/quick-entry', sourceJournalReturn: '/app/recipes' } }] })
  const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { ...view, router, save, queryClient, logoutGuard, auth }
}

function saveRecipe() {
  let next = screen.queryByRole('button', { name: /^Next:/ })
  while (next) {
    fireEvent.click(next)
    next = screen.queryByRole('button', { name: /^Next:/ })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
}

beforeEach(() => {
  vi.stubGlobal('Request', class TestRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init ? { ...init, signal: undefined } : undefined)
    }
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
  sessionStorage.clear()
  seed()
})
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('opens the review workflow with extraction fields and original notes kept separate', () => {
  const { save } = renderReview()

  expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('Garlic soy rice')
  expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('2')
  expect((screen.getByLabelText('Ingredient 1 unit') as HTMLInputElement).value).toBe('cups')
  expect((screen.getByLabelText('Ingredient 2 amount description (optional)') as HTMLInputElement).value).toBe('a splash')
  expect(screen.getByText('2 to review')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Mark as reviewed: ingredient 2' }))
  expect(screen.getByText('1 to review')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 2 name'))
  expect(readQuickAiEntryDraft('cook-a').reviewDraft?.ingredients[1].inferred).toBe(false)
  expect((screen.getByLabelText(/^Rating(?: \(optional\))?$/) as HTMLSelectElement).value).toBe('')
  expect((screen.getByLabelText(/^Cooked date(?: \(optional\))?$/) as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText(/^Notes(?: \(optional\))?$/) as HTMLTextAreaElement).value).toBe('')
  const details = within(screen.getByRole('region', { name: "Mori's extraction notes" }))
  expect(details.getByText(sourceNotes)).toBeTruthy()
  expect(details.getByText(/preview only/)).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Review your recipe' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save recipe' })).toBeNull()
  fireEvent.submit(screen.getByRole('form', { name: 'Create recipe' }))
  expect(within(screen.getByRole('group', { name: 'Ingredient 2' })).queryByText('Quantity and unit not specified.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Next: Ingredients and Instructions$/ }))
  expect(screen.getByText('Quantity and unit not specified.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save recipe' })).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
})

it('reloads a new Mori handoff when navigation stays on the review route', async () => {
  const userId = 'mori-in-place-review'
  const { router } = renderReview({ userId })
  expect(screen.queryByLabelText('Recipe title')).toBeNull()

  writeQuickAiEntryDraft(userId, {
    notes: sourceNotes,
    blockedUntil: null,
    blockedReason: null,
    handoff,
    reviewDraft: null,
  })
  await act(() => router.navigate('/app/quick-entry/review', {
    state: { moriKeepOpen: true, moriReviewKey: 1, sourceJournalReturn: '/app/recipes' },
  }))

  expect((await screen.findByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('Garlic soy rice')
})

it('keeps the full original notes available after shortening the review excerpt', () => {
  const notes = 'Garlic and rice.\n'.repeat(24) + 'Season after cooking.'
  writeQuickAiEntryDraft('cook-a', {
    notes, blockedUntil: null, blockedReason: null, handoff: { ...handoff, sourceNotes: notes }, reviewDraft: null,
  })
  renderReview()
  const evidence = screen.getByRole('region', { name: "Mori's extraction notes" })
  const [excerpt, fullText] = evidence.querySelectorAll('blockquote')
  expect(excerpt.textContent?.trimEnd().endsWith('…')).toBe(true)
  expect(excerpt.textContent).not.toContain('Season after cooking.')
  expect(fullText.closest('details')?.open).toBe(false)
  expect(fullText.textContent).toBe(notes)
})

it('persists corrected and temporarily invalid fields across remounts without saving', () => {
  const first = renderReview()
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: '  My edited rice  ' } })
  fireEvent.change(screen.getByLabelText('Ingredient 1 quantity'), { target: { value: 'not-a-number' } })
  expect(readQuickAiEntryDraft('cook-a').reviewDraft?.title).toBe('  My edited rice  ')
  expect(readQuickAiEntryDraft('cook-a').reviewDraft?.ingredients[0].quantity).toBe('not-a-number')
  first.unmount()

  renderReview()
  expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('  My edited rice  ')
  expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('not-a-number')
  expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)
})

it('warns when the edited review cannot be persisted and protects sign-out until storage recovers', async () => {
  const setItem = Storage.prototype.setItem
  let failWrites = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (failWrites && key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
    return setItem.call(this, key, value)
  })
  const { logoutGuard } = renderReview()
  failWrites = true
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'My edits are still on this page' } })

  expect(screen.getByRole('alert').textContent).toContain('preserved in memory for this account')
  act(() => { expect(logoutGuard.current?.()).toBe(false) })
  expect(screen.getByRole('alertdialog', { name: 'Leave without saving your review?' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))

  failWrites = false
  fireEvent.click(screen.getByRole('button', { name: 'Try saving the review again' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(readQuickAiEntryDraft('cook-a').reviewDraft?.title).toBe('My edits are still on this page')
  act(() => { expect(logoutGuard.current?.()).toBe(true) })
})

it('keeps successive review edits in account-scoped memory across a remount when storage fails', () => {
  const setItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
    return setItem.call(this, key, value)
  })
  const first = renderReview()
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'The latest corrected rice' } })
  fireEvent.change(screen.getByLabelText('Ingredient 1 quantity'), { target: { value: 'not-a-number' } })

  const memoryDraft = readQuickAiEntryDraft('cook-a').reviewDraft
  expect(memoryDraft?.title).toBe('The latest corrected rice')
  expect(memoryDraft?.ingredients[0].quantity).toBe('not-a-number')
  first.unmount()

  renderReview()
  expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('The latest corrected rice')
  expect((screen.getByLabelText('Ingredient 1 quantity') as HTMLInputElement).value).toBe('not-a-number')
  expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)
})

it('warns if a confirmed save cannot clear its old handoff and retries the cleanup', async () => {
  const setItem = Storage.prototype.setItem
  let failClear = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (failClear && key.startsWith('moris-mix:quick-ai-entry:') && JSON.parse(value).handoff === null) {
      throw new DOMException('full', 'QuotaExceededError')
    }
    return setItem.call(this, key, value)
  })
  const save = vi.fn<SaveRecipeDraft>().mockResolvedValue({ id: 'saved-recipe' })
  renderReview({ save })
  failClear = true
  saveRecipe()
  await screen.findByText('Recipe saved.')

  expect(screen.getByRole('alert').textContent).toContain('recipe was saved, but this browser could not clear the old extraction')
  expect(readQuickAiEntryDraft('cook-a').handoff).toBeNull()
  expect(readQuickAiEntryDraft('cook-a').reviewDraft).toBeNull()
  expect(JSON.parse(sessionStorage.getItem('moris-mix:quick-ai-entry:v1:cook-a')!).handoff).toEqual(handoff)
  expect(save).toHaveBeenCalledOnce()

  failClear = false
  fireEvent.click(screen.getByRole('button', { name: 'Try clearing the old preview again' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(readQuickAiEntryDraft('cook-a').handoff).toBeNull()
})

it('shows accessible validation feedback and keeps corrections after failed save', async () => {
  const save = vi.fn<SaveRecipeDraft>().mockRejectedValue(new Error('private save detail'))
  renderReview({ save })
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: '' } })
  saveRecipe()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByLabelText('Recipe title').getAttribute('aria-invalid')).toBe('true')
  expect(save).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'Corrected recipe' } })
  saveRecipe()
  expect((await screen.findByRole('alert')).textContent).toContain('Could not confirm whether your recipe was saved')
  fireEvent.click(screen.getByRole('button', { name: 'Previous: Recipe details and Ingredients' }))
  expect(screen.getByDisplayValue('Corrected recipe')).toBeTruthy()
  expect(document.body.textContent).not.toContain('private save detail')
  expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)
  expect(readQuickAiEntryDraft('cook-a').reviewDraft?.title).toBe('Corrected recipe')
})

it('uses the authenticated existing save hook only on explicit Save and consumes the handoff after confirmation', async () => {
  const save = vi.fn<SaveRecipeDraft>().mockResolvedValue({ id: 'saved-recipe' })
  renderReview({ save })
  expect(save).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'Saved garlic rice' } })
  expect(save).not.toHaveBeenCalled()
  saveRecipe()
  await screen.findByText('Recipe saved.')

  expect(save).toHaveBeenCalledOnce()
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Saved garlic rice', star_rating: null, cooked_at: null, notes: '',
    ingredients: expect.arrayContaining([expect.objectContaining({ quantityText: 'a splash', inferred: true })]),
  }), expect.objectContaining({ userId: 'cook-a', signal: expect.any(AbortSignal) }))
  expect(readQuickAiEntryDraft('cook-a').handoff).toBeNull()
  expect(readQuickAiEntryDraft('cook-a').reviewDraft).toBeUndefined()
  expect(readQuickAiEntryDraft('cook-a').notes).toBe(sourceNotes)
})

it('confirms logout when the saved recipe has newer unsaved edits', async () => {
  const { logoutGuard } = renderReview()
  saveRecipe()
  await screen.findByText('Recipe saved.')

  fireEvent.click(screen.getByRole('button', { name: 'Previous: Recipe details and Ingredients' }))
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'A newer title' } })
  act(() => { expect(logoutGuard.current?.()).toBe(false) })
  expect(screen.getByRole('alertdialog', { name: 'Leave without saving your changes?' }).textContent)
    .toContain('Signing out now will discard them')
  fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
  expect(screen.getByDisplayValue('A newer title')).toBeTruthy()
})

it('blocks leaving even before the user edits AI-prefilled values and keeps notes on return', async () => {
  renderReview()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Mori notes' }))
  expect(screen.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
  expect(screen.getByDisplayValue('Garlic soy rice')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Back to Mori notes' }))
  fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))
  expect(await screen.findByRole('heading', { name: 'Quick AI Entry' })).toBeTruthy()
  expect(readQuickAiEntryDraft('cook-a').notes).toBe(sourceNotes)
  expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)
})

it('shows a recoverable state for a missing handoff and never renders an empty recipe form', () => {
  sessionStorage.clear()
  renderReview()
  expect(screen.getByRole('heading', { name: 'No recipe draft to review' })).toBeTruthy()
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
  expect(screen.getByRole('link', { name: 'Open Quick AI Entry' })).toBeTruthy()
})

it('gives desktop missing-draft recovery one action beside its heading', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1100px) and (min-height: 640px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  sessionStorage.clear()
  renderReview()

  const recovery = screen.getByRole('heading', { name: 'No recipe draft to review' }).closest('header')
  expect(recovery).not.toBeNull()
  expect(within(recovery!).getAllByRole('link').map((link) => link.textContent)).toEqual(['Open Quick AI Entry'])
})

it('explains when storage read failure prevents restoring the extraction', () => {
  const getItem = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('blocked', 'SecurityError')
    return getItem.call(this, key)
  })
  renderReview()
  expect(screen.getByRole('alert').textContent).toContain('could not restore the saved draft')
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
  expect(screen.getByRole('link', { name: 'Open Quick AI Entry' })).toBeTruthy()
})

it('does not expose another account’s extraction after an account change', () => {
  renderReview({ userId: 'cook-b' })
  expect(screen.getByRole('heading', { name: 'No recipe draft to review' })).toBeTruthy()
  expect(screen.queryByText(sourceNotes)).toBeNull()
  expect(screen.queryByDisplayValue('Garlic soy rice')).toBeNull()
})
