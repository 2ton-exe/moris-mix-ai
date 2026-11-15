import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoriAssistant } from './MoriAssistant'

afterEach(() => vi.unstubAllGlobals())

function renderAssistant(initialEntry = '/app/recipes?q=rice#collection') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>
    <nav aria-label="Journal sections"><MoriAssistant /></nav>
    <CurrentLocation />
  </MemoryRouter>)
}

function CurrentLocation() {
  const location = useLocation()
  const journalReturn = typeof location.state === 'object' && location.state !== null && 'journalReturn' in location.state
    ? String(location.state.journalReturn)
    : ''
  return <output data-testid="location">{location.pathname}|{journalReturn}</output>
}

describe('Mori assistant', () => {
  it('opens a nonmodal feature chooser without making a network request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderAssistant()
    const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('region', { name: 'Mori' })
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(within(dialog).getByRole('status').textContent).toBe('What are we cooking today?')
    expect(screen.getByRole('button', { name: 'Organize cooking notes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: "Find something to cook" })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes the first option to Quick AI Entry and preserves the journal return location', () => {
    renderAssistant()
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    fireEvent.click(screen.getByRole('button', { name: 'Organize cooking notes' }))

    expect(screen.getByTestId('location').textContent).toBe('/app/quick-entry|/app/recipes?q=rice#collection')
    expect(screen.getByRole('button', { name: 'Talk to Mori' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
  })

  it('routes the second option to AI Chef without starting a generation request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderAssistant()
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    fireEvent.click(screen.getByRole('button', { name: "Find something to cook" }))

    expect(screen.getByTestId('location').textContent).toBe('/app/chef|')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Escape closes the panel, returns focus, and allows a clean reopen', async () => {
    renderAssistant()
    const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('region', { name: 'Mori' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull())
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    const reopenedDialog = screen.getByRole('region', { name: 'Mori' })
    expect(reopenedDialog).toBeTruthy()
    fireEvent.keyDown(reopenedDialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull())
  })

  it('closes from its close button and restores focus', () => {
    renderAssistant()
    const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Close Mori' }))

    expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
