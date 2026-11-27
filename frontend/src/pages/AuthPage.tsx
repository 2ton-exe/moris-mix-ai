import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { requestPasswordReset } from '../auth/client'
import { intendedDestination } from '../auth/navigation'
import { AuthField } from '../components/AuthField'
import { JournalAuthCard, JournalAuthFooter, JournalAuthScene } from '../journal/JournalAuth'

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { search } = useLocation()
  const flow = mode === 'login' && new URLSearchParams(search).get('flow') === 'recovery' ? 'recovery' : mode
  return <AuthFormPage key={flow} mode={flow} />
}

function AuthFormPage({ mode }: { mode: 'login' | 'signup' | 'recovery' }) {
  const isSignup = mode === 'signup'
  const isRecovery = mode === 'recovery'
  const { login, signup, logoutNotice, dismissLogoutNotice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state: unknown = location.state
  const destination = intendedDestination(state)
  const [emailAddress, setEmailAddress] = useState(typeof state === 'object' && state !== null && 'email' in state && typeof state.email === 'string' ? state.email : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [sentEmail, setSentEmail] = useState('')
  const [pending, setPending] = useState(false)
  const linkState = { from: destination, email: emailAddress.trim() }
  const submitting = useRef(false)
  const lifetime = useRef(0)
  useEffect(() => () => { lifetime.current++ }, [])

  function clearFieldFeedback(event: FormEvent<HTMLFormElement>) {
    if (!(event.target instanceof HTMLInputElement)) return
    const field = event.target.name
    if (errors[field]) setErrors((current) => {
      const remaining = { ...current }
      delete remaining[field]
      return remaining
    })
    if (message) setMessage(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const confirm = String(data.get('confirm-password') ?? '')
    const nextErrors: Record<string, string> = {}
    if (!email) nextErrors.email = 'Enter your email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (!isRecovery && !password) nextErrors.password = 'Enter your password.'
    else if (isSignup && password.length < 6) nextErrors.password = 'Use at least 6 characters.'
    if (isSignup && !confirm) nextErrors['confirm-password'] = 'Confirm your password.'
    else if (isSignup && password !== confirm) nextErrors['confirm-password'] = 'Passwords do not match.'
    setErrors(nextErrors)
    setMessage(null)
    if (Object.keys(nextErrors).length) {
      form.querySelector<HTMLInputElement>(`[name="${Object.keys(nextErrors)[0]}"]`)?.focus()
      return
    }
    submitting.current = true
    const requestLifetime = lifetime.current
    setPending(true)
    try {
      if (isRecovery) {
        setEmailAddress(email)
        await requestPasswordReset(email)
        if (lifetime.current === requestLifetime) setSentEmail(email)
        return
      } else if (isSignup) {
        const result = await signup(email, password)
        if (lifetime.current !== requestLifetime) return
        if (result === 'verification-required') {
          navigate('/verify-email', { replace: true, state: { email, afterSignup: true, from: destination } })
          return
        }
      } else await login(email, password)
      if (lifetime.current !== requestLifetime) return
      navigate(destination, { replace: true })
    } catch (error) {
      if (lifetime.current === requestLifetime) setMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    } finally {
      if (lifetime.current === requestLifetime) {
        submitting.current = false
        setPending(false)
      }
    }
  }

  const title = isRecovery ? sentEmail ? 'Check your email' : 'Reset your password' : isSignup ? 'Create your account' : 'Welcome back'
  const pendingLabel = isRecovery ? 'Sending reset link…' : isSignup ? 'Creating account…' : 'Logging in…'
  const submitLabel = isRecovery ? 'Send password reset link' : isSignup ? 'Create account' : 'Log in'
  const description = isRecovery
    ? sentEmail ? <p role="status">If there’s an account for <strong>{sentEmail}</strong>, a reset link will arrive soon. Check spam and open the link in this browser.</p>
      : 'We’ll email a reset link if there’s an account for this address. Check spam and open it in this browser.'
    : isSignup ? 'Use an email you can open to finish setting up your cooking journal.'
      : 'Log in to open your private cooking journal.'
  const returnHint = !isRecovery && !isSignup && destination !== '/app'
    ? 'After you log in, we’ll return you to the page you asked to open.'
    : null
  const pageDescription = returnHint
    ? <>{typeof description === 'string' ? <p>{description}</p> : description}<p>{returnHint}</p></>
    : description

  return <JournalAuthScene>
    <main className="mm-auth-main">
      <JournalAuthCard
        title={title}
        description={pageDescription}
        focusHeading={isRecovery}
        mood={isSignup ? 'wave' : 'happy'}
      >
        {!isRecovery && logoutNotice && <div className="request-state request-warning">
          <p role="alert">{logoutNotice}</p>
          <button className="button button-secondary" type="button" onClick={dismissLogoutNotice}>Dismiss notice</button>
        </div>}
        {sentEmail ? <div className="actions">
          <Link className="button button-primary" to="/login" state={linkState}>Back to login</Link>
          <button className="button button-secondary" type="button" onClick={() => setSentEmail('')}>Request another link</button>
        </div> : <form className="auth-form" method="post" noValidate onInput={clearFieldFeedback}
          onSubmit={(event) => { void submit(event) }} aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend className="visually-hidden">{isRecovery ? 'Password reset details' : isSignup ? 'Signup details' : 'Login details'}</legend>
            <AuthField name="email" label="Email" type="email" autoComplete="username" defaultValue={emailAddress}
              onValueChange={setEmailAddress} error={errors.email} />
            {!isRecovery && <AuthField name="password" label="Password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'}
              error={errors.password} hint={isSignup ? 'At least 6 characters.' : undefined} />}
            {isSignup && <AuthField name="confirm-password" label="Confirm password" type="password" autoComplete="new-password" error={errors['confirm-password']} />}
            {Object.keys(errors).length > 0 && <p role="alert" className="field-error">Please check the highlighted fields.</p>}
            {message && <p role="alert" className="field-error">{message}</p>}
            <button className="button button-primary mm-button--large" type="submit" disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </button>
          </fieldset>
        </form>}
        {pending && <span className="visually-hidden" role="status">{pendingLabel}</span>}
        {isRecovery ? !sentEmail && <p className="auth-links"><Link to="/login" state={linkState}>Back to login</Link></p> : isSignup ? <JournalAuthFooter>
          <p>Already have an account? <Link to="/login" state={linkState}>Log in</Link></p>
          <p>Already signed up? <Link to="/verify-email" state={linkState}>Request a verification link</Link></p>
        </JournalAuthFooter> : <>
          <p className="auth-links">Having trouble signing in? <Link to="/login?flow=recovery" state={linkState}>Reset your password</Link> or <Link to="/verify-email" state={linkState}>request a verification link</Link>.</p>
          <JournalAuthFooter>
            <p>New to MORI'S MIX? <Link to="/signup" state={linkState}>Sign up</Link></p>
          </JournalAuthFooter>
        </>}
      </JournalAuthCard>
    </main>
  </JournalAuthScene>
}
