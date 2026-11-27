export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return <p className="request-state mm-loading-inline" role="status" aria-live="polite">{message}<span className="mm-skeleton-line" aria-hidden="true" /></p>
}
