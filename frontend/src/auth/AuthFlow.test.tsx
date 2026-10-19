import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import App from '../App'
import { getDemoRecipe, parseDemoRecipeResponse } from '../api/demoRecipe'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './context'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithPassword: vi.fn(),
  signUp: vi.fn(), signOut: vi.fn(), resend: vi.fn(),
  getVerificationCallbackResult: vi.fn(), clearAuthCallbackUrl: vi.fn(),
}))
vi.mock('./client', () => ({ getAuthClient: () => auth,
  AUTH_INITIALIZATION_TIMEOUT_MS: 15_000,
  getVerificationCallbackResult: auth.getVerificationCallbackResult, clearAuthCallbackUrl: auth.clearAuthCallbackUrl,
}))
vi.mock('../api/demoRecipe', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/demoRecipe')>()
  return { ...original, getDemoRecipe: vi.fn() }
})

const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>()
const unsubscribe = vi.fn()
function session(expiresAt = Math.floor(Date.now() / 1000) + 3600): Session {
  return {
    access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: expiresAt,
    user: { id: 'user-1', aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: {},
      created_at: '2026-10-19T00:00:00Z', email_confirmed_at: '2026-10-19T00:00:00Z' },
  }
}
function emit(nextSession: Session | null, event: AuthChangeEvent = 'SIGNED_IN') {
  act(() => { listeners.forEach((listener) => listener(event, nextSession)) })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function Location() {
  const location = useLocation()
  return <div role="region" aria-label="Current route">{location.pathname + location.search + location.hash}</div>
}
function open(path: string, state?: unknown) {
  return render(<MemoryRouter initialEntries={[{ pathname: path.split(/[?#]/)[0], search: path.includes('?') ? '?' + path.split('?')[1].split('#')[0] : '', hash: path.includes('#') ? '#' + path.split('#')[1] : '', state }]}>
    <App /><Location />
  </MemoryRouter>)
}
function fill(name: string, value: string) { fireEvent.change(screen.getByLabelText(name), { target: { value } }) }
function submit(name: string) { fireEvent.click(screen.getByRole('button', { name })) }
async function loginForm() { await screen.findByRole('heading', { name: 'Welcome back' }) }

beforeEach(() => {
  vi.resetAllMocks()
  listeners.clear()
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
  auth.onAuthStateChange.mockImplementation((listener) => {
    listeners.add(listener)
    return { data: { subscription: { unsubscribe: () => { unsubscribe(); listeners.delete(listener) } } } }
  })
  auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null })
  auth.signUp.mockResolvedValue({ data: { user: session().user, session: null }, error: null })
  auth.signOut.mockResolvedValue({ error: null })
  auth.resend.mockResolvedValue({ error: null })
  auth.getVerificationCallbackResult.mockResolvedValue(false)
  vi.mocked(getDemoRecipe).mockResolvedValue(parseDemoRecipeResponse(fixture).recipe)
})
afterEach(() => { vi.useRealTimers() })

it('validates required login fields and email format without contacting Supabase', async () => {
  open('/login'); await loginForm()
  submit('Log in')
  expect(screen.getByText('Enter your email address.')).toBeTruthy()
  expect(screen.getByText('Enter your password.')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('Email'))
  fill('Email', 'invalid'); fill('Password', 'password')
  submit('Log in')
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
  expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true')
  expect(auth.signInWithPassword).not.toHaveBeenCalled()
})

it('toggles password visibility with a keyboard-accessible button', async () => {
  open('/login'); await loginForm()
  expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
  submit('Show password')
  expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text')
  expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true')
})

it('validates signup required fields, minimum length, and password mismatch', async () => {
  open('/signup'); await screen.findByRole('heading', { name: 'Create your account' })
  submit('Create account')
  expect(screen.getByText('Confirm your password.')).toBeTruthy()
  fill('Email', 'invalid'); fill('Password', 'short'); fill('Confirm password', 'different')
  submit('Create account')
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
  expect(screen.getByText('Use at least 6 characters.')).toBeTruthy()
  expect(screen.getByText('Passwords do not match.')).toBeTruthy()
  expect(auth.signUp).not.toHaveBeenCalled()
})

it('logs in and preserves a protected destination including search and hash', async () => {
  open('/app/recipes?sort=recent#saved'); await loginForm()
  fill('Email', ' cook@example.test '); fill('Password', 'password')
  submit('Log in')
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  expect(screen.getByLabelText('Current route').textContent).toBe('/app/recipes?sort=recent#saved')
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'cook@example.test', password: 'password' })
})

it('shows a safe invalid-credentials message', async () => {
  auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials', message: 'Sensitive server detail' } })
  open('/login'); await loginForm()
  fill('Email', 'cook@example.test'); fill('Password', 'wrong')
  submit('Log in')
  expect((await screen.findByRole('alert')).textContent).toContain('email or password is incorrect')
  expect(screen.queryByText('Sensitive server detail')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
})

it('prevents duplicate login submissions while pending and handles a network rejection', async () => {
  const request = deferred<never>()
  auth.signInWithPassword.mockReturnValue(request.promise)
  open('/login'); await loginForm()
  fill('Email', 'cook@example.test'); fill('Password', 'password')
  submit('Log in')
  const button = screen.getByRole('button', { name: 'Logging in…' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.submit(button.closest('form')!)
  expect(auth.signInWithPassword).toHaveBeenCalledOnce()
  await act(async () => request.reject(new TypeError('private network detail')))
  expect(screen.getByRole('alert').textContent).toContain('Check your connection')
  expect((screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement).disabled).toBe(false)
})

it('shows verification instructions after signup without assuming a session', async () => {
  open('/signup'); await screen.findByRole('heading', { name: 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password'); fill('Confirm password', 'password')
  submit('Create account')
  await screen.findByRole('heading', { name: 'Check your email' })
  expect(screen.getByRole('status').textContent).toContain('not logged in yet')
  expect(auth.signUp).toHaveBeenCalledWith({ email: 'cook@example.test', password: 'password', options: { emailRedirectTo: 'http://localhost:3000/auth/callback' } })
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
})

it('allows signup to continue when confirmation is disabled and Supabase returns a session', async () => {
  auth.signUp.mockResolvedValue({ data: { session: session() }, error: null })
  open('/signup'); await screen.findByRole('heading', { name: 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password'); fill('Confirm password', 'password')
  submit('Create account')
  await screen.findByRole('heading', { name: 'Your cooking journal' })
})

it('restores a valid session on a fresh mount and allows protected access', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  const view = open('/app')
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  view.unmount()
  open('/app')
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  expect(auth.getSession).toHaveBeenCalledTimes(2)
  expect(screen.getByText(/cook@example.test/)).toBeTruthy()
})

it('redirects missing sessions from protected screens to login', async () => {
  open('/app')
  await loginForm()
  expect(screen.getByLabelText('Current route').textContent).toBe('/login')
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
})

it.each(['/login', '/signup'])('redirects authenticated users away from %s', async (path) => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  open(path, { from: 'https://outside.example.test' })
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  expect(screen.getByLabelText('Current route').textContent).toBe('/app')
})

it('does not render protected content or redirect before initialization completes', async () => {
  const restore = deferred<{ data: { session: Session | null }; error: null }>()
  auth.getSession.mockReturnValue(restore.promise)
  open('/app')
  expect(screen.getByRole('status').textContent).toContain('Restoring your session')
  expect(screen.getByLabelText('Current route').textContent).toBe('/app')
  expect(screen.queryByRole('heading')).toBeNull()
  await act(async () => restore.resolve({ data: { session: session() }, error: null }))
  await screen.findByRole('heading', { name: 'Your cooking journal' })
})

it('handles initialization failures with a safe retry', async () => {
  auth.getSession.mockRejectedValueOnce(new Error('private failure'))
  open('/app')
  expect((await screen.findByRole('alert')).textContent).toContain('Could not restore')
  expect(screen.queryByText('private failure')).toBeNull()
  submit('Try again')
  await loginForm()
  expect(auth.getSession).toHaveBeenCalledTimes(2)
})

it('handles a resolved Supabase initialization error', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'private' } })
  open('/app')
  expect((await screen.findByRole('alert')).textContent).toContain('Could not restore')
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
})

it('rejects expired restored sessions', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session(Math.floor(Date.now() / 1000) - 60) }, error: null })
  open('/app'); await loginForm()
  expect(screen.queryByText(/cook@example.test/)).toBeNull()
})

it('clears protected content when the session expires without a successful refresh', async () => {
  vi.useFakeTimers()
  auth.getSession.mockResolvedValue({ data: { session: session(Math.floor(Date.now() / 1000) + 2) }, error: null })
  open('/app')
  await act(async () => {})
  expect(screen.getByRole('heading', { name: 'Your cooking journal' })).toBeTruthy()
  await act(async () => vi.advanceTimersByTime(2100))
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy()
  expect(screen.queryByText(/cook@example.test/)).toBeNull()
})

it('responds to token refresh and cross-tab signout events', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  open('/app'); await screen.findByRole('heading', { name: 'Your cooking journal' })
  emit(session(), 'TOKEN_REFRESHED')
  expect(screen.getByRole('heading', { name: 'Your cooking journal' })).toBeTruthy()
  emit(null, 'SIGNED_OUT')
  await loginForm()
  expect(screen.queryByText(/cook@example.test/)).toBeNull()
})

it('logs out and removes the session and user content', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  open('/app'); await screen.findByRole('heading', { name: 'Your cooking journal' })
  submit('Log out'); await loginForm()
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  expect(screen.queryByText(/cook@example.test/)).toBeNull()
  expect(screen.getByLabelText('Current route').textContent).toBe('/login')
})

it('keeps logout failures recoverable without claiming success', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  auth.signOut.mockResolvedValueOnce({ error: new Error('private error') })
  open('/app'); await screen.findByRole('heading', { name: 'Your cooking journal' })
  submit('Log out')
  expect((await screen.findByRole('alert')).textContent).toContain('Could not log out')
  expect(screen.getByRole('heading', { name: 'Your cooking journal' })).toBeTruthy()
  submit('Log out'); await loginForm()
})

it('balances subscriptions under Strict Mode and ignores abandoned initialization', async () => {
  const first = deferred<{ data: { session: Session | null }; error: null }>()
  auth.getSession.mockReturnValueOnce(first.promise)
  const view = render(<StrictMode><MemoryRouter initialEntries={['/app']}><App /></MemoryRouter></StrictMode>)
  await loginForm()
  expect(listeners.size).toBe(1)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  await act(async () => first.resolve({ data: { session: session() }, error: null }))
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
  view.unmount()
  expect(listeners.size).toBe(0)
  expect(unsubscribe).toHaveBeenCalledTimes(2)
})

it.each(['resolve', 'reject'])('ignores a late initialization %s after a newer auth event', async (outcome) => {
  const restore = deferred<{ data: { session: Session | null }; error: null }>()
  auth.getSession.mockReturnValue(restore.promise)
  open('/app')
  emit(session())
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  await act(async () => {
    if (outcome === 'resolve') restore.resolve({ data: { session: null }, error: null })
    else restore.reject(new Error('late error'))
  })
  expect(screen.getByRole('heading', { name: 'Your cooking journal' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reports a successful verification callback once Supabase restores a confirmed session', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  auth.getVerificationCallbackResult.mockResolvedValue(true)
  open('/auth/callback#access_token=not-displayed&refresh_token=test-refresh&type=signup')
  await screen.findByRole('heading', { name: 'Email verified' })
  expect(screen.getByRole('status').textContent).toContain('confirmed')
  fireEvent.click(screen.getByRole('link', { name: 'Continue to your journal' }))
  await screen.findByRole('heading', { name: 'Your cooking journal' })
})

it('surfaces restoration errors after INITIAL_SESSION(null) instead of treating the event as a newer login', async () => {
  const restore = deferred<{ data: { session: Session | null }; error: unknown }>()
  auth.getSession.mockReturnValue(restore.promise)
  open('/app')
  emit(null, 'INITIAL_SESSION')
  expect(screen.getByRole('status').textContent).toContain('Restoring your session')
  await act(async () => restore.resolve({ data: { session: null }, error: { message: 'private connection details' } }))
  expect(screen.getByRole('alert').textContent).toContain('Could not restore')
  expect(screen.queryByText('private connection details')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
})

it('bounds a request that never settles, allows retry, and ignores late events from the failed attempt', async () => {
  vi.useFakeTimers()
  const restore = deferred<{ data: { session: Session | null }; error: null }>()
  auth.getSession.mockReturnValueOnce(restore.promise)
  open('/app')
  emit(null, 'INITIAL_SESSION')
  await act(async () => vi.advanceTimersByTime(15_000))
  expect(screen.getByRole('alert').textContent).toContain('taking too long')
  expect(screen.queryByRole('heading')).toBeNull()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'View demonstration recipe' }).getAttribute('href')).toBe('/demo-recipe')
  const abandonedListener = [...listeners][0]
  // A late SDK event cannot reopen the timed-out attempt.
  emit(session())
  expect(screen.getByRole('alert').textContent).toContain('taking too long')
  submit('Try again')
  await act(async () => {})
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy()
  await act(async () => {
    abandonedListener('SIGNED_IN', session())
    restore.resolve({ data: { session: session() }, error: null })
  })
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Your cooking journal' })).toBeNull()
  expect(auth.getSession).toHaveBeenCalledTimes(2)
  expect(listeners.size).toBe(1)
})

it.each(['login', 'signup'] as const)('does not redirect after leaving a pending %s form', async (mode) => {
  const request = deferred<{ data: { session: Session | null }; error: null }>()
  const method = mode === 'login' ? auth.signInWithPassword : auth.signUp
  method.mockReturnValueOnce(request.promise)
  open(mode === 'login' ? '/login' : '/signup')
  await screen.findByRole('heading', { name: mode === 'login' ? 'Welcome back' : 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password')
  if (mode === 'signup') fill('Confirm password', 'password')
  submit(mode === 'login' ? 'Log in' : 'Create account')
  fireEvent.click(screen.getByRole('link', { name: 'View demonstration recipe' }))
  await screen.findByRole('heading', { name: 'Demonstration recipe' })
  await act(async () => request.resolve({ data: { session: session() }, error: null }))
  expect(screen.getByLabelText('Current route').textContent).toBe('/demo-recipe')
  // Supabase's valid session remains available when the user chooses to return.
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  fireEvent.click(screen.getByRole('link', { name: 'Back home' }))
  fireEvent.click(screen.getByRole('link', { name: 'Your cooking journal' }))
  await screen.findByRole('heading', { name: 'Your cooking journal' })
})

it('does not redirect to verification instructions after abandoning a pending signup without a session', async () => {
  const request = deferred<{ data: { session: null }; error: null }>()
  auth.signUp.mockReturnValueOnce(request.promise)
  open('/signup'); await screen.findByRole('heading', { name: 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password'); fill('Confirm password', 'password')
  submit('Create account')
  fireEvent.click(screen.getByRole('link', { name: 'View demonstration recipe' }))
  await screen.findByRole('heading', { name: 'Demonstration recipe' })
  await act(async () => request.resolve({ data: { session: null }, error: null }))
  expect(screen.getByLabelText('Current route').textContent).toBe('/demo-recipe')
})

it.each(['login', 'signup'] as const)('ignores a failed %s request after leaving its form', async (mode) => {
  const request = deferred<never>()
  const method = mode === 'login' ? auth.signInWithPassword : auth.signUp
  method.mockReturnValueOnce(request.promise)
  open(mode === 'login' ? '/login' : '/signup')
  await screen.findByRole('heading', { name: mode === 'login' ? 'Welcome back' : 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password')
  if (mode === 'signup') fill('Confirm password', 'password')
  submit(mode === 'login' ? 'Log in' : 'Create account')
  fireEvent.click(screen.getByRole('link', { name: 'View demonstration recipe' }))
  await screen.findByRole('heading', { name: fixture.recipe.title })
  await act(async () => request.reject(new Error('private request failure')))
  expect(screen.getByLabelText('Current route').textContent).toBe('/demo-recipe')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText('private request failure')).toBeNull()
})

it.each(['login', 'signup'] as const)('preserves a newer SDK session when an abandoned %s request completes', async (mode) => {
  const request = deferred<{ data: { session: Session | null }; error: null }>()
  const method = mode === 'login' ? auth.signInWithPassword : auth.signUp
  method.mockReturnValueOnce(request.promise)
  open(mode === 'login' ? '/login' : '/signup')
  await screen.findByRole('heading', { name: mode === 'login' ? 'Welcome back' : 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password')
  if (mode === 'signup') fill('Confirm password', 'password')
  submit(mode === 'login' ? 'Log in' : 'Create account')
  const newer = { ...session(), user: { ...session().user, email: 'newer@example.test' } }
  emit(newer, 'SIGNED_IN')
  await screen.findByRole('heading', { name: 'Your cooking journal' })
  await act(async () => request.resolve({ data: { session: mode === 'login' ? session() : null }, error: null }))
  expect(screen.getByRole('heading', { name: 'Your cooking journal' })).toBeTruthy()
  expect(screen.getByText(/newer@example.test/)).toBeTruthy()
})

it('keeps a remote logout warning after the SDK signs out locally and after switching guest routes', async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session: session() }, error: null })
  auth.signOut.mockImplementationOnce(async () => {
    listeners.forEach((listener) => listener('SIGNED_OUT', null))
    return { error: new Error('private server failure') }
  })
  open('/app'); await screen.findByRole('heading', { name: 'Your cooking journal' })
  submit('Log out'); await loginForm()
  expect(screen.getByRole('alert').textContent).toContain('server could not confirm')
  expect(screen.queryByText(/cook@example.test/)).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Sign up' }))
  await screen.findByRole('heading', { name: 'Create your account' })
  expect(screen.getByRole('alert').textContent).toContain('server could not confirm')
  submit('Dismiss notice')
  expect(screen.queryByRole('alert')).toBeNull()
})

it.each(['/auth/callback', '/auth/callback#error=access_denied&error_code=otp_expired&error_description=private-detail', '/auth/callback?code=unsupported-code'])('provides recovery for a missing, expired or unsupported callback: %s', async (path) => {
  open(path)
  await screen.findByRole('heading', { name: 'Check your verification link' })
  expect(screen.getByRole('status').textContent).toContain('expired, invalid, or already used')
  expect(screen.queryByText('private-detail')).toBeNull()
  expect(screen.getByRole('link', { name: 'Back to login' })).toBeTruthy()
})

it('resends a verification link and displays safe rate-limit feedback', async () => {
  open('/verify-email'); await screen.findByRole('heading', { name: 'Check your email' })
  submit('Send verification link')
  expect(screen.getByRole('alert').textContent).toContain('valid email')
  fill('Email', 'cook@example.test')
  submit('Send verification link')
  await screen.findByText(/If this address has an unconfirmed account/)
  expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'cook@example.test', options: { emailRedirectTo: 'http://localhost:3000/auth/callback' } })
  auth.resend.mockResolvedValueOnce({ error: { code: 'over_email_send_rate_limit', message: 'private' } })
  submit('Send verification link')
  expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts')
})

it('does not claim a missing callback verified an already signed-in user', async () => {
  auth.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  open('/auth/callback')
  await screen.findByRole('heading', { name: 'Check your verification link' })
  expect(screen.queryByRole('heading', { name: 'Email verified' })).toBeNull()
})

it('reports unconfirmed login accounts with verification recovery guidance', async () => {
  auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'email_not_confirmed' } })
  open('/login'); await loginForm()
  fill('Email', 'cook@example.test'); fill('Password', 'password')
  submit('Log in')
  expect((await screen.findByRole('alert')).textContent).toContain('verify your email')
  fireEvent.click(screen.getByRole('link', { name: 'Need a verification link?' }))
  await screen.findByRole('heading', { name: 'Check your email' })
})

it('keeps signup failures safe and allows retry', async () => {
  auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { code: 'weak_password', message: 'private password policy details' } })
  open('/signup'); await screen.findByRole('heading', { name: 'Create your account' })
  fill('Email', 'cook@example.test'); fill('Password', 'password'); fill('Confirm password', 'password')
  submit('Create account')
  expect((await screen.findByRole('alert')).textContent).toContain('stronger password')
  expect(screen.queryByText('private password policy details')).toBeNull()
  submit('Create account')
  await screen.findByRole('heading', { name: 'Check your email' })
})

it('exposes the updated session and user for FS-02 without another token store', async () => {
  function Probe() {
    const { session, user, isAuthenticated } = useAuth()
    return <output aria-label="Auth state">{JSON.stringify({ id: user?.id, token: session?.access_token, isAuthenticated })}</output>
  }
  render(<AuthProvider><Probe /></AuthProvider>)
  await waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce())
  const next = { ...session(), access_token: 'refreshed-test-token' }
  emit(next, 'TOKEN_REFRESHED')
  expect(JSON.parse(screen.getByLabelText('Auth state').textContent!)).toEqual({ id: 'user-1', token: 'refreshed-test-token', isAuthenticated: true })
  emit(null, 'SIGNED_OUT')
  expect(JSON.parse(screen.getByLabelText('Auth state').textContent!)).toEqual({ isAuthenticated: false })
})
