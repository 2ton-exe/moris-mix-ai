import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let App: typeof import('../App')['default']
let getAuthClient: typeof import('./client')['getAuthClient']
let projectNumber = 0
let authUrl: string
let storageKey: string

const user = { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'cook@example.test',
  app_metadata: {}, user_metadata: {}, created_at: '2026-10-19T00:00:00Z', email_confirmed_at: '2026-10-19T00:00:00Z' }

beforeEach(async () => {
  vi.resetModules()
  // Each test models a new document. Distinct project keys also isolate the
  // SDK's process-wide instance registry; every previous client is disposed.
  projectNumber++
  authUrl = `https://auth-review-${projectNumber}.example.test`
  storageKey = `sb-auth-review-${projectNumber}-auth-token`
  vi.stubEnv('VITE_SUPABASE_URL', authUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  window.localStorage.clear()
  ;({ getAuthClient } = await import('./client'))
  App = (await import('../App')).default
})

function seedExistingSession() {
  window.localStorage.setItem(storageKey, JSON.stringify({ access_token: 'existing-test-access',
    refresh_token: 'existing-test-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
}

function mount() { return render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>) }

afterEach(async () => {
  cleanup()
  await getAuthClient().dispose()
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('lets the real SDK consume a signup redirect, clean the URL, and sign out using mocked HTTP only', async () => {
  window.history.replaceState(null, '', '/auth/callback#access_token=callback-test-token&refresh_token=callback-test-refresh&expires_in=3600&token_type=bearer&type=signup')
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input)
    if (url === `${authUrl}/auth/v1/user`) return Response.json(user)
    if (url === `${authUrl}/auth/v1/logout?scope=local`) return new Response(null, { status: 204 })
    throw new Error('Unexpected auth request in test')
  })
  vi.stubGlobal('fetch', fetchImpl)
  mount()
  await screen.findByRole('heading', { name: 'Email verified' })
  await waitFor(() => expect(window.location.hash).toBe(''))
  expect(document.body.textContent).not.toContain('callback-test-token')
  expect(document.body.textContent).not.toContain('callback-test-refresh')
  expect(fetchImpl).toHaveBeenCalledWith(`${authUrl}/auth/v1/user`, expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer callback-test-token' }),
  }))
  fireEvent.click(screen.getByRole('link', { name: 'Continue to your journal' }))
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
  await screen.findByRole('heading', { name: 'Welcome back' })
  expect(document.body.textContent).not.toContain('cook@example.test')
  expect(await getAuthClient().getSession()).toMatchObject({ data: { session: null }, error: null })
})

it('does not report verification success for rejected callback credentials when a confirmed session already exists', async () => {
  seedExistingSession()
  window.history.replaceState(null, '', '/auth/callback?lang=en#access_token=rejected-test-access&refresh_token=rejected-test-refresh&expires_in=3600&token_type=bearer&type=signup')
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 'bad_jwt', message: 'private callback failure' }, { status: 401 }))
  vi.stubGlobal('fetch', fetchImpl)
  mount()
  await screen.findByRole('heading', { name: 'Check your verification link' })
  expect(screen.queryByRole('heading', { name: 'Email verified' })).toBeNull()
  expect(window.location.hash).toBe('')
  expect(window.location.search).toBe('?lang=en')
  expect(document.body.textContent).not.toContain('rejected-test-')
  expect(document.body.textContent).not.toContain('private callback failure')
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect((await getAuthClient().getSession()).data.session?.access_token).toBe('existing-test-access')
})

it.each([
  ['expired link', '/auth/callback#error=access_denied&error_code=otp_expired&error_description=private-details'],
  ['malformed fragment', '/auth/callback#access_token=malformed-test-access&refresh_token=malformed-test-refresh&type=signup'],
  ['empty access token', '/auth/callback#access_token=&refresh_token=malformed-test-refresh&expires_in=3600&token_type=bearer&type=signup'],
  ['conflicting query credentials', '/auth/callback?access_token=&lang=en#access_token=malformed-test-access&refresh_token=malformed-test-refresh&expires_in=3600&token_type=bearer&type=signup'],
  ['unsupported code', '/auth/callback?code=private-code&token_hash=private-hash&lang=en'],
])('cleans callback parameters and provides recovery for %s with an existing session', async (_name, url) => {
  seedExistingSession()
  window.history.replaceState(null, '', url)
  const fetchImpl = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchImpl)
  mount()
  await screen.findByRole('heading', { name: 'Check your verification link' })
  expect(screen.queryByRole('heading', { name: 'Email verified' })).toBeNull()
  expect(window.location.hash).toBe('')
  expect(window.location.search).not.toMatch(/code=|token_hash=/)
  expect([...new URLSearchParams(window.location.search).keys()].every((key) => key === 'lang')).toBe(true)
  expect(document.body.textContent).not.toMatch(/private-|malformed-test-/)
  expect(fetchImpl).not.toHaveBeenCalled()
  expect((await getAuthClient().getSession()).data.session?.user.id).toBe('user-1')
})

it('preserves a safe revocation warning when real SDK logout returns HTTP 500 after clearing the local session', async () => {
  seedExistingSession()
  window.history.replaceState(null, '', '/app')
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'private logout failure' }, { status: 500 }))
  vi.stubGlobal('fetch', fetchImpl)
  mount()
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
  await screen.findByRole('heading', { name: 'Welcome back' })
  expect((await screen.findByRole('alert')).textContent).toContain('server could not confirm')
  expect(document.body.textContent).not.toContain('private logout failure')
  expect(document.body.textContent).not.toContain('cook@example.test')
  expect((await getAuthClient().getSession()).data.session).toBeNull()
  expect(window.localStorage.getItem(storageKey)).toBeNull()
  expect(fetchImpl).toHaveBeenCalledWith(`${authUrl}/auth/v1/logout?scope=local`, expect.any(Object))
})

it('does not reuse an old successful callback result when returning to the callback route later', async () => {
  window.history.replaceState(null, '', '/auth/callback#access_token=callback-test-token&refresh_token=callback-test-refresh&expires_in=3600&token_type=bearer&type=signup')
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(user)))
  const view = mount()
  await screen.findByRole('heading', { name: 'Email verified' })
  view.unmount()
  window.history.replaceState(null, '', '/auth/callback#access_token=unprocessed-token&refresh_token=unprocessed-refresh&expires_in=3600&token_type=bearer&type=signup')
  mount()
  await screen.findByRole('heading', { name: 'Check your verification link' })
  expect(screen.queryByRole('heading', { name: 'Email verified' })).toBeNull()
  expect(window.location.hash).toBe('')
})

it('removes callback credentials and offers retry if real SDK initialization never settles', async () => {
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/auth/callback#access_token=pending-test-access&refresh_token=pending-test-refresh&expires_in=3600&token_type=bearer&type=signup')
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})))
  mount()
  await act(async () => vi.advanceTimersByTime(15_000))
  expect(screen.getByRole('alert').textContent).toContain('taking too long')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Email verified' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
  expect(window.location.hash).toBe('')
  expect(document.body.textContent).not.toMatch(/pending-test-/)
})
