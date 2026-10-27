import type { Ref } from 'react'

interface ErrorStateProps {
  message: string
  onRetry?: () => void
  retryButtonRef?: Ref<HTMLButtonElement>
}

export function ErrorState({ message, onRetry, retryButtonRef }: ErrorStateProps) {
  return (
    <div className="request-state request-error">
      <p role="alert">{message}</p>
      {onRetry && <button ref={retryButtonRef} className="button button-primary" type="button" onClick={onRetry}>Try again</button>}
    </div>
  )
}
