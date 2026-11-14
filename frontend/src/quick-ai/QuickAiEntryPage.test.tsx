import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { User } from '@supabase/supabase-js'
import { createMemoryRouter, Link, Outlet, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../api/http'
import { AuthContext } from '../auth/context'
import { ProtectedRoute } from '../auth/AuthRoutes'
import type { AuthState } from '../auth/context'
import { JournalShell } from '../journal/JournalShell'
import { InvalidExtractionResponse } from './extractRecipe'
import type { QuickAiEntryHandoff } from './extractRecipe'
import { readQuickAiEntryDraft, writeQuickAiEntryDraft } from './draft'
import { QuickAiEntryPage } from './QuickAiEntryPage'

const NativeRequest = globalThis.Request
const recipe = {
  title: 'Garlic soy chicken',
  ingredients: [{ name: 'chicken', quantity: null, unit: null, quantityText: 'some', inferred: true }],
  instructions: [{ step: 1, text: 'Boil the chicken with garlic.' }],
}

type Extract = NonNullable<ComponentProps<typeof QuickAiEntryPage>['extract']>

function authState(userId = 'cook-a', logout = vi.fn(async () => {})): AuthState {
  const user = { id: userId, email: `${userId}@example.test` } as User
  return {
    user, session: null, isLoading: false, isAuthenticated: true, error: null, logoutNotice: null,
    dismissLogoutNotice: vi.fn(), retryInitialization: vi.fn(), login: vi.fn(), signup: vi.fn(), logout, resendVerification: vi.fn(),
  }
}

function JournalLayout() {
  return <JournalShell><Outlet /></JournalShell>
}

function JournalIndex() {
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}${location.hash}`
  return <section>
    <h1>Your journal</h1>
    <output data-testid="journal-location">{returnTo}</output>
    <Link to="/app/quick-entry" state={{ journalReturn: returnTo }}>Return to Quick AI Entry</Link>
  </section>
}

function renderEntry({
  extract = vi.fn<Extract>().mockResolvedValue(recipe),
  onExtracted,
  state = authState(),
  initialEntry = '/app/quick-entry',
}: {
  extract?: Extract
  onExtracted?: (handoff: QuickAiEntryHandoff) => void
  state?: AuthState
  initialEntry?: string
} = {}) {
  const router = createMemoryRouter([
    {
      element: <JournalLayout />,
      children: [
        { path: '/app/quick-entry', element: <QuickAiEntryPage extract={extract} onExtracted={onExtracted} /> },
        { path: '/app/recipes', element: <JournalIndex /> },
      ],
    },
    { path: '/login', element: <h1>Sign in</h1> },
  ], { initialEntries: [initialEntry] })
  const view = render(<AuthContext.Provider value={state}><RouterProvider router={router} /></AuthContext.Provider>)
  return { ...view, extract, router }
}

const notesField = () => screen.getByRole('textbox', { name: 'Cooking notes' }) as HTMLTextAreaElement
const enterNotes = (notes: string) => fireEvent.change(notesField(), { target: { value: notes } })

beforeEach(() => {
  vi.stubGlobal('Request', class TestRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init ? { ...init, signal: undefined } : undefined)
    }
  })
  sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  writeQuickAiEntryDraft('cook-a', { notes: '', blockedUntil: null, blockedReason: null, handoff: null })
  sessionStorage.clear()
})

describe('Quick AI Entry', () => {
  it('restores an unsaved draft after session expiry and sign-in when storage fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    const router = createMemoryRouter([
      { element: <ProtectedRoute />, children: [{ path: '/app/quick-entry', element: <QuickAiEntryPage /> }] },
      { path: '/login', element: <h1>Sign in</h1> },
    ], { initialEntries: ['/app/quick-entry'] })
    const state = authState()
    const view = render(<AuthContext.Provider value={state}><RouterProvider router={router} /></AuthContext.Provider>)
    enterNotes('Notes that must survive expiry')

    view.rerender(<AuthContext.Provider value={{ ...state, user: null, isAuthenticated: false }}><RouterProvider router={router} /></AuthContext.Provider>)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    const loginUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(loginUnload)
    expect(loginUnload.defaultPrevented).toBe(true)

    view.rerender(<AuthContext.Provider value={authState('cook-b')}><RouterProvider router={router} /></AuthContext.Provider>)
    await act(() => router.navigate('/app/quick-entry'))
    expect(notesField().value).toBe('')
    view.rerender(<AuthContext.Provider value={state}><RouterProvider router={router} /></AuthContext.Provider>)
    expect(notesField().value).toBe('Notes that must survive expiry')
    expect(screen.getByRole('alert').textContent).toContain("couldn't")
    vi.restoreAllMocks()
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    const savedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(savedUnload)
    expect(savedUnload.defaultPrevented).toBe(false)
  })
  it('validates empty notes accessibly without making a request', async () => {
    const { extract } = renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Add a few cooking notes')
    expect(notesField().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(notesField())
    expect(extract).not.toHaveBeenCalled()
  })

  it('announces unavailable session storage on initial load and keeps new notes editable', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    renderEntry()

    expect(screen.getByRole('alert').textContent).toContain('couldn\'t access session storage')
    expect(screen.getByText(/Your notes stay available in this app while it is open/)).toBeTruthy()
    expect(screen.queryByText(/saved in this browser session as you type/)).toBeNull()

    enterNotes('new notes remain editable in React state')
    expect(notesField().value).toBe('new notes remain editable in React state')
    expect(screen.getByRole('alert').textContent).toContain('reload or closing the tab may erase them')
  })

  it('surfaces storage read failures separately from an empty draft', () => {
    const getItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('blocked', 'SecurityError')
      return getItem.call(this, key)
    })
    renderEntry()

    expect(screen.getByRole('alert').textContent).toContain('couldn\'t access session storage')
    expect(screen.queryByText(/saved in this browser session as you type/)).toBeNull()
    enterNotes('the editor remains usable after a read failure')
    expect(notesField().value).toBe('the editor remains usable after a read failure')
    expect(screen.getByRole('alert').textContent).toContain('reload or closing the tab may erase them')
  })

  it('reproduces Belen\'s failed-write and extraction-error navigation scenario', async () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('network', 'private network detail'))
    renderEntry({ extract })
    const sourceNotes = 'rice, eggs, garlic, and soy sauce; fry the eggs first'
    enterNotes(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByText(/Mori could not reach the kitchen/)).textContent).toContain('Your notes are still here')
    expect(notesField().value).toBe(sourceNotes)
    expect(screen.getByRole('button', { name: 'Copy Notes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try saving again' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Back to journal/ }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving your notes?' })
    expect(dialog.textContent).toContain('Leaving now may lose them')
    expect(screen.getByRole('button', { name: 'Keep Editing' })).toBe(document.activeElement)
    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(notesField().value).toBe(sourceNotes)

    fireEvent.click(screen.getByRole('link', { name: 'My recipes' }))
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving your notes?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Leave Anyway' }))
    expect(await screen.findByRole('heading', { name: 'Your journal' })).toBeTruthy()
  })

  it('protects browser Back while a draft cannot be persisted and preserves notes on cancel', async () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    const { router } = renderEntry({ initialEntry: '/app/recipes' })
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    fireEvent.click(screen.getByRole('button', { name: '1. Help me organize my cooking notes.' }))
    const sourceNotes = 'notes before browser back'
    enterNotes(sourceNotes)

    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving your notes?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(notesField().value).toBe(sourceNotes)
    expect(router.state.location.pathname).toBe('/app/quick-entry')
  })

  it('warns before page reload only while notes are not persisted', () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    renderEntry()
    enterNotes('unsaved notes')
    const blockedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(blockedUnload)
    expect(blockedUnload.defaultPrevented).toBe(true)

    const setItemMock = vi.mocked(Storage.prototype.setItem)
    setItemMock.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    expect(screen.queryByRole('alert')).toBeNull()
    const persisted = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(persisted)
    expect(persisted.defaultPrevented).toBe(false)
  })

  it('clears the warning after recovered storage verifies the latest notes', async () => {
    let refuseWrites = true
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (refuseWrites && key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    const first = renderEntry()
    const sourceNotes = 'the latest notes survive recovery'
    enterNotes(sourceNotes)
    expect(screen.getByRole('alert').textContent).toContain('couldn\'t save these notes')

    refuseWrites = false
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    expect(screen.queryByRole('alert')).toBeNull()
    first.unmount()

    renderEntry()
    expect(notesField().value).toBe(sourceNotes)
  })

  it('copies notes from the storage warning when clipboard access succeeds', async () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderEntry()
    const sourceNotes = 'copy this note before leaving'
    enterNotes(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Notes' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sourceNotes))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Notes copied')
  })

  it('enforces the confirmed 10,000 character limit before submitting', async () => {
    const { extract } = renderEntry()
    expect(notesField().maxLength).toBe(10_000)
    enterNotes('x'.repeat(10_001))
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('10,000 characters or fewer')
    expect(extract).not.toHaveBeenCalled()
  })

  it('submits through the authenticated adapter and exposes a typed unsaved handoff', async () => {
    const onExtracted = vi.fn<(handoff: QuickAiEntryHandoff) => void>()
    const { extract } = renderEntry({ onExtracted })
    const sourceNotes = '  chicken, two garlic cloves\nboil with soy sauce  '
    enterNotes(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect(await screen.findByRole('heading', { name: 'Garlic soy chicken' })).toBeTruthy()
    expect((await screen.findByText(/only a preview/i)).textContent).toContain('Nothing has been saved')
    expect(screen.getByRole('link', { name: 'Review & Edit Recipe' }).getAttribute('href')).toBe('/app/quick-entry/review')
    expect(notesField().value).toBe(sourceNotes)
    expect(document.querySelector('blockquote')?.textContent).toBe(sourceNotes)
    expect(extract).toHaveBeenCalledWith(sourceNotes, expect.objectContaining({ userId: 'cook-a', signal: expect.any(AbortSignal) }))
    expect(onExtracted).toHaveBeenCalledWith({ sourceNotes, recipe, saved: false })
  })

  it('keeps a failed-write extraction available for review from the in-memory fallback', async () => {
    const setItem = Storage.prototype.setItem
    let failWrites = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (failWrites && key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    renderEntry()
    enterNotes('rice, eggs, and garlic')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))
    expect(await screen.findByRole('heading', { name: 'Garlic soy chicken' })).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Review & Edit Recipe' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('preserved in memory for this account')
    expect(readQuickAiEntryDraft('cook-a').handoff?.recipe.title).toBe('Garlic soy chicken')

    failWrites = false
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    expect(await screen.findByRole('link', { name: 'Review & Edit Recipe' })).toHaveProperty('href', expect.stringContaining('/app/quick-entry/review'))
  })

  it('restores the validated unsaved handoff after route navigation and a page remount', async () => {
    const sourceNotes = 'chicken and garlic, simmer until tender'
    const { extract, unmount } = renderEntry()
    enterNotes(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))
    expect(await screen.findByRole('heading', { name: 'Garlic soy chicken' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'Back to journal' }))
    expect(await screen.findByRole('heading', { name: 'Your journal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Return to Quick AI Entry' }))
    expect(await screen.findByText('This recipe is only a preview. Nothing has been saved to your journal.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Cooking notes' })).toHaveProperty('value', sourceNotes)

    unmount()
    const restored = renderEntry()
    expect(await screen.findByRole('heading', { name: 'Garlic soy chicken' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Cooking notes' })).toHaveProperty('value', sourceNotes)
    expect(extract).toHaveBeenCalledOnce()
    restored.unmount()
  })

  it('opens Quick AI Entry from Talk to Mori, returns to the exact journal location, and restores the unsaved preview', async () => {
    const journalLocation = '/app/recipes?q=rice&sort=rating&leaf=2#collection-heading'
    const extract = vi.fn<Extract>().mockResolvedValue(recipe)
    renderEntry({ extract, initialEntry: journalLocation })

    const bookmarks = screen.getByRole('navigation', { name: 'Journal sections' })
    const recipesBookmark = screen.getByRole('link', { name: 'My recipes' })
    const moriBookmark = screen.getByRole('button', { name: 'Talk to Mori' })
    expect(recipesBookmark.getAttribute('aria-current')).toBe('page')
    expect(moriBookmark.getAttribute('aria-expanded')).toBe('false')
    moriBookmark.focus()
    expect(document.activeElement).toBe(moriBookmark)
    fireEvent.click(moriBookmark)
    expect(screen.getByRole('dialog', { name: 'Mori' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1. Help me organize my cooking notes.' }))

    expect(await screen.findByRole('heading', { name: 'Quick AI Entry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Talk to Mori' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'My recipes' }).getAttribute('aria-current')).toBeNull()
    expect(bookmarks).toBeTruthy()

    const sourceNotes = 'rice, egg, soy sauce; fry egg first'
    enterNotes(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))
    expect(await screen.findByText('This recipe is only a preview. Nothing has been saved to your journal.')).toBeTruthy()
    expect(extract).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('link', { name: 'Back to journal' }))
    expect((await screen.findByTestId('journal-location')).textContent).toBe(journalLocation)
    expect(screen.getByRole('link', { name: 'My recipes' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    fireEvent.click(screen.getByRole('button', { name: '1. Help me organize my cooking notes.' }))
    expect(await screen.findByText('This recipe is only a preview. Nothing has been saved to your journal.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Cooking notes' })).toHaveProperty('value', sourceNotes)
    expect(extract).toHaveBeenCalledOnce()
  })

  it('clears a previous preview when notes change and does not restore it after a later failure', async () => {
    const extract = vi.fn<Extract>()
      .mockResolvedValueOnce(recipe)
      .mockRejectedValueOnce(new HttpError('http', 'private quota response', 429, {
        error: { code: 'QUOTA_EXCEEDED', message: 'private quota details' },
      }, '60'))
    renderEntry({ extract })
    enterNotes('first extraction notes')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))
    expect(await screen.findByRole('heading', { name: 'Garlic soy chicken' })).toBeTruthy()

    enterNotes('new notes that need a fresh extraction')
    expect(screen.queryByRole('heading', { name: 'Garlic soy chicken' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))
    expect((await screen.findByRole('alert')).textContent).toContain("You've reached today's AI organizing limit")
    expect(readQuickAiEntryDraft('cook-a').handoff).toBeNull()
    expect(notesField().value).toBe('new notes that need a fresh extraction')
  })

  it('announces loading, prevents duplicate submission, and locks notes while pending', async () => {
    let resolve!: (value: typeof recipe) => void
    const extract = vi.fn<Extract>().mockImplementation(() => new Promise((res) => { resolve = res }))
    renderEntry({ extract })
    enterNotes('rice, eggs, soy sauce')
    const submit = screen.getByRole('button', { name: 'Organize my notes' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(screen.getByRole('status').textContent).toContain('Mori is organizing your notes')
    expect(document.querySelector('.mm-quick-ai__loading .mm-mori')?.getAttribute('data-animated')).toBe('true')
    expect(notesField().disabled).toBe(true)
    expect(extract).toHaveBeenCalledOnce()
    await act(async () => resolve(recipe))
    expect(await screen.findByText('This recipe is only a preview. Nothing has been saved to your journal.')).toBeTruthy()
  })

  it('preserves original notes after a network failure and retries the same text', async () => {
    const sourceNotes = 'rice\neggs\nsoy sauce'
    const extract = vi.fn<Extract>()
      .mockRejectedValueOnce(new HttpError('network', 'private network detail'))
      .mockResolvedValueOnce(recipe)
    renderEntry({ extract })
    enterNotes(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Your notes are still here')
    expect(notesField().value).toBe(sourceNotes)
    fireEvent.click(screen.getByRole('button', { name: 'Retry extraction' }))

    expect(await screen.findByRole('heading', { name: 'Garlic soy chicken' })).toBeTruthy()
    expect(extract.mock.calls.map(([notes]) => notes)).toEqual([sourceNotes, sourceNotes])
  })

  it('maps provider failure safely and allows editing or retrying', async () => {
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('http', 'private provider response', 503, {
      error: { code: 'AI_UNAVAILABLE', message: 'provider internals' },
    }))
    renderEntry({ extract })
    enterNotes('slow-cooked beans')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Mori could not organize those notes just now')
    expect(screen.queryByText('provider internals')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Notes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry extraction' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Notes' }))
    expect(document.activeElement).toBe(notesField())
    expect(notesField().value).toBe('slow-cooked beans')
  })

  it('blocks immediate retries after QUOTA_EXCEEDED and keeps the draft', async () => {
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('http', 'private quota response', 429, {
      error: { code: 'QUOTA_EXCEEDED', message: 'private backend quota details' },
    }, '60'))
    renderEntry({ extract })
    enterNotes('family soup notes')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain("You've reached today's AI organizing limit")
    expect(screen.queryByRole('button', { name: 'Retry extraction' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Please wait to retry' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('AI limit is still in effect')
    expect(notesField().value).toBe('family soup notes')
    expect(extract).toHaveBeenCalledOnce()
  })

  it('honors the provider Retry-After cooldown before enabling another request', async () => {
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('http', 'private provider response', 429, {
      error: { code: 'AI_RATE_LIMITED', message: 'private rate detail' },
    }, '45'))
    renderEntry({ extract })
    enterNotes('notes to retry after cooldown')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('provider cooldown')
    expect(screen.getByRole('button', { name: 'Please wait to retry' }).hasAttribute('disabled')).toBe(true)
    expect(readQuickAiEntryDraft('cook-a').blockedReason).toBe('provider-rate-limit')
    expect(readQuickAiEntryDraft('cook-a').blockedUntil).toBeGreaterThan(Date.now())
    expect(extract).toHaveBeenCalledOnce()
  })

  it('honors the authentication service Retry-After header before retrying', async () => {
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('http', 'private auth service detail', 503, {
      error: { code: 'AUTH_SERVICE_RATE_LIMITED', message: 'private auth detail' },
    }, '60'))
    renderEntry({ extract })
    enterNotes('notes remain safe while auth recovers')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('could not verify your session')
    expect(screen.getByRole('button', { name: 'Please wait to retry' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('wait 60 seconds')
    expect(readQuickAiEntryDraft('cook-a').blockedReason).toBe('auth-service-rate-limit')
    expect(readQuickAiEntryDraft('cook-a').blockedUntil).toBeGreaterThan(Date.now())
    expect(notesField().value).toBe('notes remain safe while auth recovers')
    expect(extract).toHaveBeenCalledOnce()
  })

  it('honors an HTTP-date Retry-After value from the authentication service', async () => {
    const retryAt = new Date(Date.now() + 90_000).toUTCString()
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('http', 'private auth service detail', 503, {
      error: { code: 'AUTH_SERVICE_RATE_LIMITED', message: 'private auth detail' },
    }, retryAt))
    renderEntry({ extract })
    enterNotes('notes while auth is temporarily unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('could not verify your session')
    expect(readQuickAiEntryDraft('cook-a').blockedUntil).toBeGreaterThan(Date.now() + 80_000)
  })

  it('rejects an invalid extraction response and preserves notes for correction', async () => {
    const extract = vi.fn<Extract>().mockRejectedValue(new InvalidExtractionResponse())
    renderEntry({ extract })
    enterNotes('fry eggs, then stir rice')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain("couldn't validate the recipe")
    expect(notesField().value).toBe('fry eggs, then stir rice')
    expect(screen.queryByRole('heading', { name: 'Garlic soy chicken' })).toBeNull()
  })

  it('handles unauthorized sessions without exposing backend details and uses the existing logout action', async () => {
    const logout = vi.fn(async () => {})
    const extract = vi.fn<Extract>().mockRejectedValue(new HttpError('http', 'private auth detail', 401, {
      error: { code: 'UNAUTHORIZED', message: 'token contents' },
    }))
    const view = renderEntry({ extract, state: authState('cook-a', logout) })
    enterNotes('bread dough from yesterday')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Your session could not be verified')
    expect(screen.queryByText('token contents')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Log out and sign in again' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    view.unmount()
    renderEntry({ state: authState('cook-a') })
    expect(notesField().value).toBe('bread dough from yesterday')
  })

  it('preserves notes across route navigation and keeps them separated by account', async () => {
    const stateA = authState('cook-a')
    const first = renderEntry({ state: stateA })
    enterNotes('private notes for cook A')
    fireEvent.click(screen.getByRole('link', { name: 'Back to journal' }))
    expect(await screen.findByRole('heading', { name: 'Your journal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Return to Quick AI Entry' }))
    expect(await screen.findByRole('textbox', { name: 'Cooking notes' })).toHaveProperty('value', 'private notes for cook A')
    first.unmount()

    renderEntry({ state: authState('cook-b') })
    expect(screen.getByRole('textbox', { name: 'Cooking notes' })).toHaveProperty('value', '')
  })

  it('does not block navigation when the latest session draft is verified', async () => {
    renderEntry()
    enterNotes('notes that were persisted successfully')
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'My recipes' }))
    expect(await screen.findByRole('heading', { name: 'Your journal' })).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('keeps newly edited notes in memory instead of replacing them with a stale stored draft', async () => {
    sessionStorage.setItem('moris-mix:quick-ai-entry:v1:cook-a', JSON.stringify({
      notes: 'older saved notes', blockedUntil: null, blockedReason: null, handoff: null,
    }))
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    renderEntry()
    expect(notesField().value).toBe('older saved notes')

    const currentNotes = 'new edits that could not replace the older saved draft'
    enterNotes(currentNotes)
    fireEvent.click(screen.getByRole('link', { name: 'My recipes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Editing' }))
    expect(notesField().value).toBe(currentNotes)
    expect(readQuickAiEntryDraft('cook-a').notes).toBe(currentNotes)
    expect(sessionStorage.getItem('moris-mix:quick-ai-entry:v1:cook-a')).toContain('older saved notes')
  })

  it('does not expose failed-write notes after switching to a different account', () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('moris-mix:quick-ai-entry:')) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    const first = renderEntry({ state: authState('cook-a') })
    enterNotes('private unsaved notes for cook A')
    first.unmount()

    renderEntry({ state: authState('cook-b') })
    expect(notesField().value).toBe('')
    expect(screen.queryByText('private unsaved notes for cook A')).toBeNull()
  })

  it('aborts on navigation and ignores a late response without discarding the source draft', async () => {
    let resolve!: (value: typeof recipe) => void
    const extract = vi.fn<Extract>().mockImplementation(() => new Promise((res) => { resolve = res }))
    const onExtracted = vi.fn<(handoff: QuickAiEntryHandoff) => void>()
    renderEntry({ extract, onExtracted })
    enterNotes('notes survive the trip back')
    fireEvent.click(screen.getByRole('button', { name: 'Organize my notes' }))
    const signal = extract.mock.calls[0][1].signal

    fireEvent.click(screen.getByRole('link', { name: 'Back to journal' }))
    expect(await screen.findByRole('heading', { name: 'Your journal' })).toBeTruthy()
    expect(signal.aborted).toBe(true)
    fireEvent.click(screen.getByRole('link', { name: 'Return to Quick AI Entry' }))
    expect(await screen.findByRole('textbox', { name: 'Cooking notes' })).toHaveProperty('value', 'notes survive the trip back')
    await act(async () => resolve(recipe))

    expect(onExtracted).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Garlic soy chicken' })).toBeNull()
    expect(notesField().value).toBe('notes survive the trip back')
  })

  it('keeps the input and actions keyboard reachable with a visible focus target', () => {
    renderEntry()
    const textarea = notesField()
    expect(textarea.getAttribute('aria-describedby')).toBeTruthy()
    textarea.focus()
    expect(document.activeElement).toBe(textarea)
    expect(screen.getByRole('link', { name: /Back to journal/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Organize my notes' })).toBeTruthy()
  })
})
