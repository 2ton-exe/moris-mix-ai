import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { useAuth } from './context'
import { intendedDestination } from './navigation'
import { JournalAuthCard, JournalAuthScene } from '../journal/JournalAuth'

export function AuthReady() {
  const { isLoading, error, retryInitialization } = useAuth()
  if (isLoading) return <JournalAuthScene><main className="mm-auth-main"><JournalAuthCard eyebrow="Your journal" mood="think"><LoadingState message="Restoring your session…" /></JournalAuthCard></main></JournalAuthScene>
  if (error) return <JournalAuthScene><main className="mm-auth-main"><JournalAuthCard eyebrow="Your journal" mood="worried">
    <ErrorState message={error} onRetry={retryInitialization} />
    <Link className="button button-secondary" to="/demo-recipe">View demonstration recipe</Link>
  </JournalAuthCard></main></JournalAuthScene>
  return <Outlet />
}

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />
}

export function GuestRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  return isAuthenticated ? <Navigate to={intendedDestination(location.state)} replace /> : <Outlet />
}
