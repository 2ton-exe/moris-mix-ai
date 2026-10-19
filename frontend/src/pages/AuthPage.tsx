import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { intendedDestination } from '../auth/navigation'
import { AuthField } from '../components/AuthField'

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup'
  const { login, signup, logoutNotice, dismissLogoutNotice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const lifetime = useRef(0)
  useEffect(() => () => { lifetime.current++ }, [])

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
    if (!password) nextErrors.password = 'Enter your password.'
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
      if (isSignup) {
        const result = await signup(email, password)
        if (lifetime.current !== requestLifetime) return
        if (result === 'verification-required') {
          navigate('/verify-email', { replace: true, state: { email, from: intendedDestination(location.state) } })
          return
        }
      } else await login(email, password)
      if (lifetime.current !== requestLifetime) return
      navigate(intendedDestination(location.state), { replace: true })
    } catch (error) {
      if (lifetime.current === requestLifetime) setMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    } finally {
      if (lifetime.current === requestLifetime) {
        submitting.current = false
        setPending(false)
      }
    }
  }

  return (
    <main className="page-shell auth-shell">
      <div className="eyebrow"><span className="status-dot" /> Mori’s Mix</div>
      <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
      <p className="intro">{isSignup ? 'Start your cooking journal. We may ask you to verify your email before logging in.' : 'Log in to your cooking journal.'}</p>
      {logoutNotice && <div className="request-state request-error">
        <p role="alert">{logoutNotice}</p>
        <button className="button button-secondary" type="button" onClick={dismissLogoutNotice}>Dismiss notice</button>
      </div>}
      <form className="auth-form" noValidate onSubmit={(event) => { void submit(event) }} aria-busy={pending}>
        <fieldset disabled={pending}>
          <legend className="visually-hidden">{isSignup ? 'Signup details' : 'Login details'}</legend>
          <AuthField name="email" label="Email" type="email" autoComplete="email" error={errors.email} />
          <AuthField name="password" label="Password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'}
            error={errors.password} hint={isSignup ? 'Use at least 6 characters. Additional account password requirements may apply.' : undefined} />
          {isSignup && <AuthField name="confirm-password" label="Confirm password" type="password" autoComplete="new-password" error={errors['confirm-password']} />}
          {Object.keys(errors).length > 0 && <p role="alert" className="field-error">Please check the highlighted fields.</p>}
          {message && <p role="alert" className="field-error">{message}</p>}
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? (isSignup ? 'Creating account…' : 'Logging in…') : (isSignup ? 'Create account' : 'Log in')}
          </button>
        </fieldset>
      </form>
      <p className="auth-links">{isSignup ? 'Already have an account? ' : 'New to Mori’s Mix? '}
        <Link to={isSignup ? '/login' : '/signup'} state={location.state}>{isSignup ? 'Log in' : 'Sign up'}</Link>
      </p>
      {!isSignup && <p className="auth-links"><Link to="/verify-email" state={location.state}>Need a verification link?</Link></p>}
      <div className="actions"><Link className="button button-secondary" to="/demo-recipe">View demonstration recipe</Link></div>
    </main>
  )
}
