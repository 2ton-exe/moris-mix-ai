import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MoriCompanion } from './MoriCompanion'
import { MoriCompanionProvider, useMoriActivity, useMoriGuidance } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'

function Activity({ activity }: { activity: MoriActivity | null }) { useMoriActivity(activity); return null }
function Guidance() { useMoriGuidance({ message: 'Your journal is ready.', action: { label: 'Write a recipe', onClick: () => undefined } }); return null }
function Companion({ children }: { children?: React.ReactNode }) { return <MemoryRouter><MoriCompanionProvider>{children}<MoriCompanion /></MoriCompanionProvider></MemoryRouter> }
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks() })

it('opens guidance and restores focus after Escape', () => {
  render(<Companion><Guidance /></Companion>)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  fireEvent.click(trigger)
  expect(screen.getByText('Your journal is ready.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Write a recipe' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Mori' }))
  fireEvent.keyDown(screen.getByRole('region', { name: 'Mori' }), { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('prioritizes problems, clears owners and never replays stale celebrations', () => {
  const app = (problem: boolean) => <Companion><Activity activity={{ kind: 'curious', message: 'Uploading photo.' }} />{problem && <Activity activity={{ kind: 'confused', message: 'Photo needs another try.' }} />}<Activity activity={{ kind: 'celebrating', message: 'Recipe saved.' }} /></Companion>
  const view = render(app(true))
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  expect(screen.getByText('Photo needs another try.')).toBeTruthy()
  view.rerender(app(false))
  expect(screen.getByText('Uploading photo.')).toBeTruthy()
  view.rerender(<Companion />)
  expect(screen.getByText('A little inspiration, whenever you need it.')).toBeTruthy()
})

it('celebrates briefly then returns to idle', () => {
  vi.useFakeTimers()
  render(<Companion><Activity activity={{ kind: 'celebrating', message: 'Recipe saved.' }} /></Companion>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  expect(screen.getByText('Recipe saved.')).toBeTruthy()
  act(() => vi.advanceTimersByTime(2600))
  expect(screen.getByText('A little inspiration, whenever you need it.')).toBeTruthy()
})

it('persists visibility and survives unavailable storage', () => {
  const view = render(<Companion />)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide Mori' }))
  expect(screen.getByRole('button', { name: 'Show Mori' })).toBeTruthy()
  view.unmount()
  render(<Companion />)
  expect(screen.getByRole('button', { name: 'Show Mori' })).toBeTruthy()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
  fireEvent.click(screen.getByRole('button', { name: 'Show Mori' }))
  expect(screen.getByRole('button', { name: 'Talk to Mori' })).toBeTruthy()
})

it('supports keyboard repositioning and reset', () => {
  render(<Companion />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Mori. Use arrow keys to reposition.' }), { key: 'ArrowLeft' })
  expect(screen.getByText('Mori moved left.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reset position' }))
  expect(screen.getByText('Mori returned to the starting position.')).toBeTruthy()
})

it('recovers from malformed preferences and keeps optional producers independent', () => {
  localStorage.setItem('moris-mix:mori-companion', '{"position":{"x":"broken"}}')
  render(<Companion />)
  expect(screen.getByRole('button', { name: 'Talk to Mori' })).toBeTruthy()
  expect(() => render(<><Activity activity={{ kind: 'working', message: 'Working.' }} /><Guidance /></>)).not.toThrow()
})
