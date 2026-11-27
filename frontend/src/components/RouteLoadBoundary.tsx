import { Component, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

interface Props {
  children: ReactNode
  resetKey: unknown
  wrapError?: (error: ReactNode) => ReactNode
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
      const error = <ErrorState message="Could not load this page. Reload to try again." onRetry={() => window.location.reload()} />
      return this.props.wrapError ? this.props.wrapError(error) : error
    }
    return this.props.children
  }
}
