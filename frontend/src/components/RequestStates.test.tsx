import { useEffect, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createHttpClient, HttpError } from '../api/http'
import { LoadingState } from './LoadingState'
import { ErrorState } from './ErrorState'

it('announces a custom loading message', () => {
  render(<LoadingState message="Loading demonstration data…" />)
  expect(screen.getByRole('status').textContent).toBe('Loading demonstration data…')
})

it('announces an error and calls retry when selected', () => {
  const onRetry = vi.fn()
  render(<ErrorState message="Please check your connection." onRetry={onRetry} />)
  expect(screen.getByRole('alert').textContent).toBe('Please check your connection.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledOnce()
})

it('omits retry when no recovery action is provided', () => {
  render(<ErrorState message="Configuration is required." />)
  expect(screen.queryByRole('button')).toBeNull()
})

// Test-only composition: exercises transport + request states without recipe fields.
function RequestHarness({ client }: { client: ReturnType<typeof createHttpClient> }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<'loading' | 'error' | 'done'>('loading')
  const [error, setError] = useState<HttpError>()
  useEffect(() => {
    const controller = new AbortController()
    client.getJson('/functions/v1/demo-recipe', { signal: controller.signal }).then(
      () => { if (!controller.signal.aborted) setState('done') },
      (failure: unknown) => {
        if (!controller.signal.aborted && failure instanceof HttpError) {
          setError(failure)
          setState('error')
        }
      },
    )
    return () => controller.abort()
  }, [client, attempt])
  if (state === 'loading') return <LoadingState />
  if (state === 'error' && error) {
    return <ErrorState message={error.message} onRetry={error.retryable ? () => {
      setState('loading')
      setAttempt((value) => value + 1)
    } : undefined} />
  }
  return <p>Request finished.</p>
}

it('shows loading until settlement, then allows retry to complete a request', async () => {
  let failRequest!: (reason: unknown) => void
  let finishRetry!: (response: Response) => void
  const fetchImpl = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { failRequest = reject }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve }))
  const client = createHttpClient({ baseUrl: 'https://demo.example.test', fetchImpl })
  render(<RequestHarness client={client} />)
  expect(screen.getByRole('status').textContent).toBe('Loading…')
  failRequest(new TypeError('Offline'))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(screen.getByRole('status').textContent).toBe('Loading…')
  finishRetry(Response.json({ transportTest: true }))
  await screen.findByText('Request finished.')
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})
