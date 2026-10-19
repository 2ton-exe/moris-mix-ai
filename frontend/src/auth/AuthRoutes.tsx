import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { useAuth } from './context'
import { intendedDestination } from './navigation'

export function AuthReady() {
  const { isLoading, error, retryInitialization } = useAuth()
  if (isLoading) return <main className="page-shell"><LoadingState message="Restoring your session…" /></main>
  if (error) return <main className="page-shell">
    <ErrorState message={error} onRetry={retryInitialization} />
    <Link className="button button-secondary" to="/demo-recipe">View demonstration recipe</Link>
  </main>
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
