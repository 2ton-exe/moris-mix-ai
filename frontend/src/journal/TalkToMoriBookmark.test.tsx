import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TalkToMoriBookmark } from './TalkToMoriBookmark'

afterEach(() => vi.unstubAllGlobals())

function renderBookmark(initialEntry = '/app/recipes?q=rice#collection') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>
    <nav aria-label="Journal sections"><TalkToMoriBookmark /></nav>
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

describe('Talk to Mori bookmark', () => {
  it('opens a modal feature chooser with the requested copy and makes no network request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderBookmark()
    const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Mori' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByRole('status').textContent).toBe('Hey, chef! What are we cooking up today?')
    expect(screen.getByRole('button', { name: '1. Help me organize my cooking notes.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: "2. Let's figure out what to cook!" })).toBeTruthy()
    expect(screen.getByRole('button', { name: '3. Maybe later!' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes the first option to Quick AI Entry and preserves the journal return location', () => {
    renderBookmark()
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    fireEvent.click(screen.getByRole('button', { name: '1. Help me organize my cooking notes.' }))

    expect(screen.getByTestId('location').textContent).toBe('/app/quick-entry|/app/recipes?q=rice#collection')
    expect(screen.getByRole('button', { name: 'Talk to Mori' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('routes the second option to AI Chef without starting a generation request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderBookmark()
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
    fireEvent.click(screen.getByRole('button', { name: "2. Let's figure out what to cook!" }))

    expect(screen.getByTestId('location').textContent).toBe('/app/chef|')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Escape closes the modal, returns focus, and allows a clean reopen', async () => {
    renderBookmark()
    const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    const reopenedDialog = screen.getByRole('dialog')
    expect(reopenedDialog).toBeTruthy()
    fireEvent(reopenedDialog, new Event('cancel', { bubbles: false, cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Maybe later closes immediately under reduced motion and restores focus', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    renderBookmark()
    const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '3. Maybe later!' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('location').textContent).toBe('/app/recipes|')
    expect(document.activeElement).toBe(trigger)
  })
})
