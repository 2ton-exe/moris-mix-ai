interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="request-state request-error">
      <p role="alert">{message}</p>
      {onRetry && <button className="button button-primary" type="button" onClick={onRetry}>Try again</button>}
    </div>
  )
}
