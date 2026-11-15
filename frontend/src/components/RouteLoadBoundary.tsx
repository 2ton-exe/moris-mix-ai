import { Component, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

interface Props {
  children: ReactNode
  resetKey: unknown
}

interface State {
  hasError: boolean
  resetKey: unknown
}

export class RouteLoadBoundary extends Component<Props, State> {
  state = { hasError: false, resetKey: this.props.resetKey }

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey === state.resetKey ? null : { hasError: false, resetKey: props.resetKey }
  }

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
