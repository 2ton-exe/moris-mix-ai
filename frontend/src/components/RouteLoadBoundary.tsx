import { Component, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { ErrorState } from './ErrorState'

class RouteLoadErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorState message="Could not load this page. Reload to try again." onRetry={() => window.location.reload()} />
    }
    return this.props.children
  }
}

export function RouteLoadBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <RouteLoadErrorBoundary key={pathname}>{children}</RouteLoadErrorBoundary>
}
