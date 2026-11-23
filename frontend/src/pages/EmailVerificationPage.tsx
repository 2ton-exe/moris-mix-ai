import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { intendedDestination } from '../auth/navigation'
import { LoadingState } from '../components/LoadingState'
import { ErrorState } from '../components/ErrorState'
import { getVerificationCallbackResult } from '../auth/client'
import { JournalAuthCard, JournalAuthScene } from '../journal/JournalAuth'

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
  const verificationState: unknown = location.state
  const signupEmail = typeof verificationState === 'object' && verificationState !== null && 'email' in verificationState && typeof verificationState.email === 'string' ? verificationState.email : ''
  const [email, setEmail] = useState(signupEmail)
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

  const checking = isLoading || (callback && callbackResult === 'checking')
  const inboxGuidance = sent || Boolean(signupEmail)
  const title = initializationError ? 'The kitchen needs a moment.'
    : checking ? 'Setting the table'
      : verified ? 'Email verified' : inboxGuidance ? 'Check your email' : callback ? 'Verification link unavailable' : 'Verify your email'
  const description = initializationError || checking ? undefined : verified
    ? 'Your email is confirmed and you are logged in.'
    : sent
      ? 'If this address has an unconfirmed account, a new link will arrive shortly. Check your inbox and spam folder.'
      : inboxGuidance
      ? 'If this address has an unconfirmed account, open the verification link in your inbox to finish signing up. You are not logged in yet. Check your spam folder if it hasn’t arrived.'
      : callback
        ? 'This link may be expired, invalid, or already used. Enter your email to request a new verification link.'
        : 'Enter your email address to request a verification link.'

  return <JournalAuthScene>
    <main className="mm-auth-main">
      <JournalAuthCard
        eyebrow={callback ? 'A note from the post' : 'Almost there'}
        title={title}
        description={description && <p role="status">{description}</p>}
        mood={initializationError || callbackResult === 'invalid' ? 'worried' : verified ? 'cheer' : 'happy'}
      >
        {initializationError ? <>
          <ErrorState message={initializationError} onRetry={retryInitialization} />
          <Link className="button button-secondary" to="/demo-recipe">View demonstration recipe</Link>
        </> : checking ? <LoadingState message="Checking your verification link…" /> : verified
          ? <div className="actions"><Link className="button button-primary mm-button--large" to={intendedDestination(location.state)}>Continue to your journal</Link></div>
          : <>
            <form className="auth-form" noValidate onSubmit={(event) => { void resend(event) }} aria-busy={pending}>
              <div className="auth-field">
                <label htmlFor="verification-email">Email</label>
                <input id="verification-email" name="email" type="email" autoComplete="email" required value={email}
                  onChange={(event) => setEmail(event.target.value)} disabled={pending} aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'verification-error' : undefined} />
              </div>
              {error && <p id="verification-error" className="field-error" role="alert">{error}</p>}

              <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send verification link'}</button>
            </form>
            <p className="auth-links"><Link to="/login" state={location.state}>Back to login</Link></p>
            <p className="auth-links"><Link to="/signup" state={location.state}>Use another email</Link></p>
          </>}
      </JournalAuthCard>
    </main>
  </JournalAuthScene>
}
