import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import { intendedDestination } from '../auth/navigation'
import { LoadingState } from '../components/LoadingState'
import { ErrorState } from '../components/ErrorState'
import { AuthField } from '../components/AuthField'
import { getAuthCallbackResult, updateRecoveredPassword, type AuthCallbackResult } from '../auth/client'
import { JournalAuthCard, JournalAuthScene } from '../journal/JournalAuth'
import { useJournalMedia } from '../journal/useJournalMedia'

export default function EmailVerificationPage({ callback = false }: { callback?: boolean }) {
  const { session, isLoading, error: initializationError, retryInitialization, resendVerification } = useAuth()
  const location = useLocation()
  const desktopRecovery = useJournalMedia('(hover: hover) and (pointer: fine)')
  const [resetHint] = useState(() => {
    const query = new URLSearchParams(location.search)
    return query.get('flow') === 'recovery' || query.get('type') === 'recovery'
      || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery'
  })
  const [callbackResult, setCallbackResult] = useState<AuthCallbackResult | 'checking'>('checking')
  useEffect(() => {
    if (!callback) return
    let active = true
    const finish = (result: AuthCallbackResult) => { if (active) setCallbackResult(result) }
    try { void getAuthCallbackResult().then(finish).catch(() => finish({ kind: 'invalid' })) }
    catch { finish({ kind: 'invalid' }) }
    return () => { active = false }
  }, [callback])
  const verificationState: unknown = location.state
  const suggestedEmail = typeof verificationState === 'object' && verificationState !== null && 'email' in verificationState && typeof verificationState.email === 'string' ? verificationState.email : ''
  const signupEmail = typeof verificationState === 'object' && verificationState !== null && 'afterSignup' in verificationState && verificationState.afterSignup === true ? suggestedEmail : ''
  const [email, setEmail] = useState(suggestedEmail)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const verified = callback && callbackResult !== 'checking' && callbackResult.kind === 'verified' && session?.user.email_confirmed_at

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    setError(null)
    setSent(false)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      event.currentTarget.querySelector('input')?.focus()
      return
    }
    submitting.current = true
    setPending(true)
    try { await resendVerification(email.trim()); setSent(true) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not send a verification link. Please try again later.') }
    finally { submitting.current = false; setPending(false) }
  }

  const checking = isLoading || (callback && callbackResult === 'checking')
  const recovery = callback && callbackResult !== 'checking' && callbackResult.kind === 'recovery' ? callbackResult : null
  const callbackUnavailable = callback && callbackResult !== 'checking' && callbackResult.kind === 'invalid'
  const resetLinkUnavailable = Boolean(recovery) || (desktopRecovery && callbackUnavailable && resetHint)
  if (recovery && !initializationError && !checking && session?.access_token === recovery.accessToken) {
    return <VerifiedPasswordReset accessToken={recovery.accessToken} />
  }
  const inboxGuidance = sent || Boolean(signupEmail)
  const title = initializationError ? 'The kitchen needs a moment.'
    : checking ? 'Checking your link'
      : verified ? 'Email verified' : resetLinkUnavailable ? 'Password reset link unavailable'
        : inboxGuidance ? 'Check your email' : callback ? 'Email link unavailable' : 'Verify your email'
  const description = initializationError || checking ? undefined : verified
    ? 'Your email is confirmed and you are logged in.'
    : resetLinkUnavailable ? 'This link may have expired or already been used. Request a new link and open it in the browser where you requested it.'
    : sent
      ? 'If this address has an unconfirmed account, a new link will arrive shortly. Check spam and open the link in this browser.'
      : inboxGuidance
      ? 'Open the verification link in this browser to finish signing up. You are not logged in yet. Check spam if the message hasn’t arrived.'
      : callbackUnavailable
        ? 'This link may be expired, invalid, or already used. Choose what you were trying to do, then open your new link in this browser.'
      : callback
        ? 'This link may be expired, invalid, or already used. Enter your email to request a new verification link.'
        : 'If this email belongs to an unconfirmed account, we’ll send a link. Check spam and open it in this browser.'

  return <JournalAuthScene>
    <main className="mm-auth-main">
      <JournalAuthCard
        title={title}
        focusHeading
        description={description && <p role="status">{description}</p>}
        mood={initializationError || (callbackResult !== 'checking' && callbackResult.kind === 'invalid') ? 'worried' : verified ? 'cheer' : 'happy'}
      >
        {initializationError ? <>
          <ErrorState message={initializationError} onRetry={retryInitialization} />
        </> : checking ? <LoadingState message="Checking your verification link…" /> : verified
          ? <div className="actions"><Link className="button button-primary mm-button--large" to={intendedDestination(location.state)}>Continue to your journal</Link></div>
          : resetLinkUnavailable ? <div className="actions">
            <Link className="button button-primary" to="/login?flow=recovery" state={location.state}>Request a new reset link</Link>
            <Link className="button button-secondary" to="/login">Back to login</Link>
          </div>
          : callbackUnavailable ? <>
            <div className="actions">
              <Link className="button button-secondary" to="/login?flow=recovery" state={location.state}>Reset my password</Link>
              <Link className="button button-secondary" to="/verify-email" state={location.state}>Confirm my email address</Link>
            </div>
            <p className="auth-links"><Link to="/login" state={location.state}>Back to login</Link></p>
          </>
          : <>
            <form className="auth-form" method="post" noValidate onSubmit={(event) => { void resend(event) }} aria-busy={pending}>
              <div className="auth-field">
                <label htmlFor="verification-email">Email</label>
                <input id="verification-email" name="email" type="email" autoComplete="email" required value={email}
                  onChange={(event) => { setEmail(event.target.value); if (error) setError(null) }} disabled={pending} aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'verification-error' : undefined} />
              </div>
              {error && <p id="verification-error" className="field-error" role="alert">{error}</p>}

              <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send verification link'}</button>
            </form>
            <p className="auth-links"><Link to="/login" state={location.state}>Back to login</Link></p>
            {callback && <p className="auth-links"><Link to="/login?flow=recovery" state={location.state}>Request a password reset link</Link></p>}
            {signupEmail && <p className="auth-links"><Link to="/signup" state={location.state}>Start again with another email</Link></p>}
          </>}
      </JournalAuthCard>
    </main>
  </JournalAuthScene>
}

function VerifiedPasswordReset({ accessToken }: { accessToken: string }) {
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; request?: string }>({})
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const submitting = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('reset-password') ?? '')
    const confirm = String(data.get('reset-password-confirm') ?? '')
    if (password.length < 6) {
      setErrors({ password: 'Use at least 6 characters.' })
      form.querySelector<HTMLInputElement>('#reset-password')?.focus()
      return
    }
    if (password !== confirm) {
      setErrors({ confirm: 'Passwords do not match.' })
      form.querySelector<HTMLInputElement>('#reset-password-confirm')?.focus()
      return
    }
    setErrors({})
    submitting.current = true
    setPending(true)
    try {
      await updateRecoveredPassword(password, accessToken)
      setSaved(true)
    } catch (error) {
      setErrors({ request: error instanceof Error ? error.message : 'Could not update your password. Try again.' })
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return <JournalAuthScene><main className="mm-auth-main"><JournalAuthCard
    title={saved ? 'Password updated' : 'Choose a new password'}
    description={saved ? 'You can now use your new password to log in.' : 'Use at least 6 characters. Choose a password you don’t use anywhere else.'}
    mood={saved ? 'cheer' : 'think'} focusHeading>
    {saved ? <Link className="button button-primary mm-button--large" to="/app">Continue to your journal</Link>
      : <form className="auth-form" method="post" noValidate aria-busy={pending} onSubmit={(event) => { void submit(event) }}>
        <fieldset disabled={pending}>
          <legend className="visually-hidden">New password details</legend>
          <AuthField name="reset-password" label="New password" type="password" autoComplete="new-password" error={errors.password} />
          <AuthField name="reset-password-confirm" label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm} />
          {errors.request && <p className="field-error" role="alert">{errors.request}</p>}
          <button type="submit" className="button button-primary">{pending ? 'Updating password…' : 'Update password'}</button>
        </fieldset>
      </form>}
  </JournalAuthCard></main></JournalAuthScene>
}
