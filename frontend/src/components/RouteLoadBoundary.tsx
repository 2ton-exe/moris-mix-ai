import { Component, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

export class RouteLoadBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
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
