import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import App from '../App'

it('links to the pending demonstration page without issuing API requests', () => {
  const fetchImpl = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchImpl)
  try {
    render(<MemoryRouter><App /></MemoryRouter>)
    fireEvent.click(screen.getByRole('link', { name: 'Demonstration recipe' }))
    expect(screen.getByRole('heading', { name: 'Demonstration recipe' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('once the shared API contract and demo data are ready')
    expect(fetchImpl).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Back home' }))
    expect(screen.getByRole('link', { name: 'Demonstration recipe' })).toBeTruthy()
  } finally {
    vi.unstubAllGlobals()
  }
})
