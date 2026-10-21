import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { intendedDestination } from '../auth/navigation'
import { LoadingState } from '../components/LoadingState'
import { ErrorState } from '../components/ErrorState'
import { getVerificationCallbackResult } from '../auth/client'

export default function EmailVerificationPage({ callback = false }: { callback?: boolean }) {
  const { session, isLoading, error: initializationError, retryInitialization, resendVerification } = useAuth()
  const location = useLocation()
  const [callbackResult, setCallbackResult] = useState<'checking' | 'verified' | 'invalid'>('checking')
  useEffect(() => {
    if (!callback) return
    let active = true
    const finish = (success: boolean) => { if (active) setCallbackResult(success ? 'verified' : 'invalid') }
    try { void getVerificationCallbackResult().then(finish).catch(() => finish(false)) }
    catch { finish(false) }
    return () => { active = false }
  }, [callback])
  const [email, setEmail] = useState(() => {
    const state: unknown = location.state
    return typeof state === 'object' && state !== null && 'email' in state && typeof state.email === 'string' ? state.email : ''
  })
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const verified = callback && callbackResult === 'verified' && session?.user.email_confirmed_at

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    setError(null)
    setSent(false)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    submitting.current = true
    setPending(true)
    try { await resendVerification(email.trim()); setSent(true) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not send a verification link. Please try again later.') }
    finally { submitting.current = false; setPending(false) }
  }

  return (
    <main className="page-shell auth-shell">
      <div className="eyebrow"><span className="status-dot" /> Mori’s Mix</div>
      {initializationError ? <>
        <ErrorState message={initializationError} onRetry={retryInitialization} />
        <Link className="button button-secondary" to="/demo-recipe">View demonstration recipe</Link>
      </>
        : isLoading || (callback && callbackResult === 'checking') ? <LoadingState message="Checking your verification link…" /> : <>
        <h1>{verified ? 'Email verified' : callback ? 'Check your verification link' : 'Check your email'}</h1>
        <p className="intro" role="status">{verified ? 'Your email is confirmed and you are logged in.' : callback
          ? 'We could not confirm this link. It may be expired, invalid, or already used. Try logging in, or request a new verification email below.'
          : 'If your account needs confirmation, open the verification link in your email to finish signing up. You are not logged in yet. Check your spam folder if it has not arrived.'}</p>
        {verified ? <div className="actions"><Link className="button button-primary" to={intendedDestination(location.state)}>Continue to your journal</Link></div> : <>
          <form className="auth-form" noValidate onSubmit={(event) => { void resend(event) }} aria-busy={pending}>
            <div className="auth-field">
              <label htmlFor="verification-email">Email</label>
              <input id="verification-email" name="email" type="email" autoComplete="email" required value={email}
                onChange={(event) => setEmail(event.target.value)} disabled={pending} aria-invalid={Boolean(error)}
                aria-describedby={error ? 'verification-error' : undefined} />
            </div>
            {error && <p id="verification-error" className="field-error" role="alert">{error}</p>}
            {sent && <p role="status">If this address has an unconfirmed account, a new link will arrive shortly. Please check your inbox.</p>}
            <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send verification link'}</button>
          </form>
          <p className="auth-links"><Link to="/login" state={location.state}>Back to login</Link></p>
          <p className="auth-links"><Link to="/signup" state={location.state}>Use another email</Link></p>
        </>}
      </>}
    </main>
  )
}
