import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { RouteLoadBoundary } from './RouteLoadBoundary'

afterEach(() => vi.restoreAllMocks())

function FailedRoute(): ReactNode {
  throw new Error('private chunk failure details')
}

function RouteHarness() {
  const { pathname } = useLocation()

  return (
    <>
      <Link to="/healthy">Open healthy route</Link>
      <RouteLoadBoundary resetKey={pathname}>
        {pathname === '/broken' ? <FailedRoute /> : <p>Healthy route loaded</p>}
      </RouteLoadBoundary>
    </>
  )
}

it('shows a safe retry state and recovers when the pathname changes', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  render(<MemoryRouter initialEntries={['/broken']}><RouteHarness /></MemoryRouter>)

  expect(screen.getByRole('alert').textContent).toContain('Could not load this page. Reload to try again.')
  expect(screen.queryByText('private chunk failure details')).toBeNull()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()

  fireEvent.click(screen.getByRole('link', { name: 'Open healthy route' }))
  expect(screen.getByText('Healthy route loaded')).toBeTruthy()
})
