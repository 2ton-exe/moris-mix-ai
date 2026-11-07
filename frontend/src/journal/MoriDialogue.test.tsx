import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MoriDialogue, MoriDialogueLauncher } from './MoriDialogue'
import type { MoriDialogueLine } from './MoriDialogue'

const lines: readonly MoriDialogueLine[] = [{
  id: 'welcome', speaker: 'Mori', expression: 'wave', text: 'A small note for your journal.',
  choices: [
    { id: 'next', label: 'Tell me more', nextLineId: 'more' },
    { id: 'start-recipe', label: 'Write a recipe' },
  ],
}, { id: 'more', speaker: 'Mori', expression: 'happy', text: 'Your recipe cards are just below.' }]

afterEach(() => vi.unstubAllGlobals())

function renderLauncher(onChoice = vi.fn()) {
  return render(<MemoryRouter initialEntries={['/app/recipes']}>
    <Routes>
      <Route path="/app/recipes" element={<>
        <MoriDialogueLauncher lines={lines} completionText="The note is finished." onChoice={onChoice} />
        <h1>Recipe collection</h1>
      </>} />
      <Route path="/app/recipes/new" element={<h1>A recipe of your own.</h1>} />
    </Routes>
  </MemoryRouter>)
}

it('opens as a non-modal note, focuses its heading, and restores trigger focus on dismissal', async () => {
  renderLauncher()
  const trigger = screen.getByRole('button', { name: 'Open a note from Mori' })
  fireEvent.click(trigger)

  const region = screen.getByRole('region', { name: 'Mori' })
  expect(region.getAttribute('aria-modal')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Mori' }))
  fireEvent.keyDown(region, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull())
  expect(document.activeElement).toBe(trigger)
})

it('renders choices, invokes the supplied callback, advances, reveals text, and completes', () => {
  const onChoice = vi.fn()
  renderLauncher(onChoice)
  fireEvent.click(screen.getByRole('button', { name: 'Open a note from Mori' }))

  fireEvent.click(screen.getByRole('button', { name: 'Tell me more' }))
  expect(onChoice).toHaveBeenCalledWith(lines[0].choices?.[0], lines[0])
  const visibleText = document.querySelector('.mm-mori-dialogue__text')
  expect(visibleText?.textContent).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Show full message' }))
  expect(visibleText?.textContent).toBe('Your recipe cards are just below.')
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('status').textContent).toBe('The note is finished.')
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
})

it('notifies continue callbacks while retaining the supplied-line progression', () => {
  const onContinue = vi.fn()
  const onComplete = vi.fn()
  render(<MoriDialogue lines={lines} typewriter={false} onContinue={onContinue} onComplete={onComplete} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onContinue).toHaveBeenCalledOnce()
  expect(document.querySelector('.mm-mori-dialogue__text')?.textContent).toBe(lines[1].text)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onContinue).toHaveBeenCalledTimes(2)
  expect(onComplete).toHaveBeenCalledOnce()
  expect(screen.getByRole('status').textContent).toBe('That is all for now.')
})

it('shows loading and recoverable error states without hiding the close action', () => {
  const onRetry = vi.fn()
  const onClose = vi.fn()
  const { rerender } = render(<MoriDialogue lines={lines} status="pending" onClose={onClose} />)
  expect(screen.getByRole('status').textContent).toContain('getting the next note')
  fireEvent.click(screen.getByRole('button', { name: "Close Mori's note" }))
  expect(onClose).toHaveBeenCalledOnce()

  rerender(<MoriDialogue lines={lines} status="error" errorText="Please try again." onRetry={onRetry} onClose={onClose} />)
  expect(screen.getByRole('alert').textContent).toContain('Please try again.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledOnce()
})

it('respects reduced motion and shows the complete line immediately', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  renderLauncher()
  fireEvent.click(screen.getByRole('button', { name: 'Open a note from Mori' }))
  expect(document.querySelector('.mm-mori-dialogue__text')?.textContent).toBe(lines[0].text)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
})

it('wraps long text, supports a typewriter skip, and completes without timed input', () => {
  const longText = 'A very long journal note. '.repeat(80)
  render(<MoriDialogue
    lines={[{ id: 'long-note', speaker: 'Mori', text: longText }]}
    typewriterSpeedMs={10_000}
    onClose={vi.fn()}
  />)
  expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Show full message' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show full message' }))
  expect(document.querySelector('.mm-mori-dialogue__text')?.textContent).toBe(longText)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('status').textContent).toBe('That is all for now.')
})

it('navigates through the existing recipe route and makes no network or recipe writes', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  renderLauncher()
  fireEvent.click(screen.getByRole('button', { name: 'Open a note from Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Write a recipe' }))
  await screen.findByRole('heading', { name: 'A recipe of your own.' })
  expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})
