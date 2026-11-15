import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RouteLoadBoundary } from './RouteLoadBoundary'

afterEach(() => vi.restoreAllMocks())

function FailedRoute(): ReactNode {
  throw new Error('private chunk failure details')
}

it('shows a safe retry state when a route page fails to load', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  render(<RouteLoadBoundary><FailedRoute /></RouteLoadBoundary>)

  expect(screen.getByRole('alert').textContent).toContain('Could not load this page. Reload to try again.')
  expect(screen.queryByText('private chunk failure details')).toBeNull()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})
