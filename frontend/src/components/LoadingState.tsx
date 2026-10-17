export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return <p className="request-state" role="status" aria-live="polite">{message}</p>
}
