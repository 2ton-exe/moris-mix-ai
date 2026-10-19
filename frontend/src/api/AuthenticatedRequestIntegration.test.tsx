import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthState } from '../auth/context'
import { AuthContext, useAuth } from '../auth/context'

const sessionProvider = vi.hoisted(() => ({ getSession: vi.fn() }))

let apiClient: typeof import('./config').apiClient
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>
let apiUrl: string
let projectNumber = 0

function authState(): AuthState {
  const user = { id: 'cook-1' } as User
  return {
    user,
    session: { user, access_token: 'react-context-token', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test-refresh' } as Session,
    isLoading: false,
    isAuthenticated: true,
    error: null,
    logoutNotice: null,
    dismissLogoutNotice: vi.fn(),
    retryInitialization: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    resendVerification: vi.fn(),
  }
}

function session(userId = 'cook-1', accessToken = 'fresh-access-token', expiresAt = Date.now() / 1000 + 3600) {
  return { user: { id: userId }, access_token: accessToken, expires_at: expiresAt }
}

function ProtectedRequestPage({ signal }: { signal: AbortSignal }) {
  const { user } = useAuth()
  const [result, setResult] = useState('')
  return <main>
    <button onClick={() => {
      void apiClient.getAuthenticatedJson('/integration-test-resource', { userId: user?.id ?? '', signal })
        .then((value) => setResult(JSON.stringify(value)))
        .catch((error: Error) => setResult(error.message))
    }}>Load protected data</button>
    <output aria-label="Request result">{result}</output>
  </main>
}

beforeEach(async () => {
  vi.resetModules()
  apiUrl = `https://fs02-integration-${++projectNumber}.supabase.co`
  vi.stubEnv('VITE_SUPABASE_URL', apiUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetchImpl)
  sessionProvider.getSession.mockReset().mockResolvedValue({ data: { session: session() }, error: null })
  const { getAuthClient } = await import('../auth/client')
  vi.spyOn(getAuthClient(), 'getSession').mockImplementation(() => sessionProvider.getSession())
  ;({ apiClient } = await import('./config'))
})

afterEach(async () => {
  const { getAuthClient } = await import('../auth/client')
  await getAuthClient().dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fetchImpl.mockReset()
})

function renderRequest(signal = new AbortController().signal) {
  return render(<MemoryRouter initialEntries={['/app']}>
    <AuthContext.Provider value={authState()}>
      <Routes><Route path="/app" element={<ProtectedRequestPage signal={signal} />} /></Routes>
    </AuthContext.Provider>
  </MemoryRouter>)
}

it('uses the SDK session at request time for a protected REST call', async () => {
  const signal = new AbortController().signal
  renderRequest(signal)
  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))

  await waitFor(() => expect(screen.getByLabelText('Request result').textContent).toBe('{"ok":true}'))
  expect(sessionProvider.getSession).toHaveBeenCalledOnce()
  expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/integration-test-resource`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      apikey: 'public-test-key',
      Authorization: 'Bearer fresh-access-token',
    },
    credentials: 'omit',
    signal,
  })
})

it('keeps the public demo request anonymous without reading the session', async () => {
  await apiClient.getJson('/functions/v1/demo-recipe')

  expect(sessionProvider.getSession).not.toHaveBeenCalled()
  expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/functions/v1/demo-recipe`, {
    method: 'GET',
    headers: { Accept: 'application/json', apikey: 'public-test-key' },
    credentials: 'omit',
    signal: undefined,
  })
})

it('uses the SDK-refreshed token on each protected request', async () => {
  sessionProvider.getSession
    .mockResolvedValueOnce({ data: { session: session('cook-1', 'initial-access-token') }, error: null })
    .mockResolvedValueOnce({ data: { session: session('cook-1', 'refreshed-access-token') }, error: null })
  fetchImpl.mockResolvedValueOnce(Response.json({ request: 1 })).mockResolvedValueOnce(Response.json({ request: 2 }))
  renderRequest()

  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))
  await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))
  await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))

  expect(fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'))).toEqual([
    'Bearer initial-access-token', 'Bearer refreshed-access-token',
  ])
  expect(sessionProvider.getSession).toHaveBeenCalledTimes(2)
})

it.each([
  ['missing session', { data: { session: null }, error: null }],
  ['session lookup error', { data: { session: session() }, error: new Error('private auth detail') }],
  ['expired session', { data: { session: session('cook-1', 'expired-access-token', 1) }, error: null }],
  ['different account', { data: { session: session('cook-2', 'other-account-token') }, error: null }],
  ['empty token', { data: { session: session('cook-1', '') }, error: null }],
])('blocks a protected REST call with a %s', async (_name, result) => {
  sessionProvider.getSession.mockResolvedValue(result)
  renderRequest()
  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))

  await waitFor(() => expect(screen.getByLabelText('Request result').textContent).toBe('Authentication required.'))
  expect(document.body.textContent).not.toContain('private auth detail')
  expect(document.body.textContent).not.toContain('other-account-token')
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('blocks the request when session lookup rejects without exposing the provider error', async () => {
  sessionProvider.getSession.mockRejectedValue(new Error('private auth detail'))
  renderRequest()
  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))

  await waitFor(() => expect(screen.getByLabelText('Request result').textContent).toBe('Authentication required.'))
  expect(document.body.textContent).not.toContain('private auth detail')
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('keeps protected REST error details out of the rendered message', async () => {
  fetchImpl.mockResolvedValue(Response.json({ error: { message: 'private backend detail' } }, { status: 401 }))
  renderRequest()
  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))

  await waitFor(() => expect(screen.getByLabelText('Request result').textContent)
    .toBe('The server could not complete the request.'))
  expect(document.body.textContent).not.toContain('private backend detail')
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('does not send a request canceled while the SDK session is being read', async () => {
  let resolveSession!: (result: unknown) => void
  sessionProvider.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))
  const controller = new AbortController()
  renderRequest(controller.signal)
  fireEvent.click(screen.getByRole('button', { name: 'Load protected data' }))
  controller.abort()

  await act(async () => resolveSession({ data: { session: session() }, error: null }))
  expect(fetchImpl).not.toHaveBeenCalled()
})
