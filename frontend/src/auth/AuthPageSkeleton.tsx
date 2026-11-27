import { Link, useLocation } from 'react-router'
import { AuthField } from '../components/AuthField'
import { JournalAuthCard, JournalAuthFooter } from '../journal/JournalAuth'
import { intendedDestination } from './navigation'

export function AuthPageSkeleton({ mode, message }: { mode: 'login' | 'signup' | 'recovery'; message: string }) {
  const { state } = useLocation()
  const signup = mode === 'signup'
  const recovery = mode === 'recovery'
  const returnHint = mode === 'login' && intendedDestination(state) !== '/app'
  const description = recovery
    ? 'We’ll email a reset link if there’s an account for this address. Check spam and open it in this browser.'
    : signup ? 'Use an email you can open to finish setting up your cooking journal.'
      : 'Log in to open your private cooking journal.'
  return <>
    <span role="status" className="visually-hidden">{message}</span>
    <JournalAuthCard title={recovery ? 'Reset your password' : signup ? 'Create your account' : 'Welcome back'}
      description={returnHint ? <><p>{description}</p><p>After you log in, we’ll return you to the page you asked to open.</p></> : description}
      mood={signup ? 'wave' : 'happy'} aria-busy="true" aria-hidden="true" inert>
      <form className="auth-form" method="post" noValidate>
        <fieldset disabled>
          <legend className="visually-hidden">{recovery ? 'Password reset details' : signup ? 'Signup details' : 'Login details'}</legend>
          <AuthField name="email" label="Email" type="email" autoComplete="username" inputClassName="mm-skeleton-line" />
          {!recovery && <AuthField name="password" label="Password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} hint={signup ? 'At least 6 characters.' : undefined} inputClassName="mm-skeleton-line" />}
          {signup && <AuthField name="confirm-password" label="Confirm password" type="password" autoComplete="new-password" inputClassName="mm-skeleton-line" />}
          <button className="button button-primary mm-button--large" type="submit" disabled>{recovery ? 'Send password reset link' : signup ? 'Create account' : 'Log in'}</button>
        </fieldset>
      </form>
      {recovery ? <p className="auth-links"><Link to="/login">Back to login</Link></p> : signup ? <JournalAuthFooter>
        <p>Already have an account? <Link to="/login">Log in</Link></p>
        <p>Already signed up? <Link to="/verify-email">Request a verification link</Link></p>
      </JournalAuthFooter> : <>
        <p className="auth-links">Having trouble signing in? <Link to="/login?flow=recovery">Reset your password</Link> or <Link to="/verify-email">request a verification link</Link>.</p>
        <JournalAuthFooter><p>New to MORI'S MIX? <Link to="/signup">Sign up</Link></p></JournalAuthFooter>
      </>}
    </JournalAuthCard>
  </>
}
