import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MoriCompanion } from './MoriCompanion'
import { MoriCompanionProvider, useMoriActivity, useMoriGuidance } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'

function Activity({ activity }: { activity: MoriActivity | null }) { useMoriActivity(activity); return null }
function Guidance() { useMoriGuidance({ message: 'Your journal is ready.', action: { label: 'Write a recipe', onClick: () => undefined } }); return null }
function Companion({ children, initialEntries = ['/app/recipes'] }: { children?: React.ReactNode; initialEntries?: string[] }) { return <MemoryRouter initialEntries={initialEntries}><MoriCompanionProvider>{children}<MoriCompanion /></MoriCompanionProvider></MemoryRouter> }
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('opens guidance and restores focus after Escape', () => {
  render(<Companion><Guidance /></Companion>)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  fireEvent.click(trigger)
  expect(screen.getByText('Your journal is ready.')).toBeTruthy()
  expect(document.querySelector('.mori-pet-trigger .mm-mori')?.getAttribute('data-mood')).toBe('talk')
  expect(screen.getByRole('button', { name: 'Write a recipe' })).toBeTruthy()
  expect(screen.getByText('My recipes', { selector: '.mori-pet-context' })).toBeTruthy()
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
  expect(screen.getByText('Your recipe collection is open. Choose a scrap to revisit it.')).toBeTruthy()
})

it('celebrates briefly then returns to idle', () => {
  vi.useFakeTimers()
  render(<Companion><Activity activity={{ kind: 'celebrating', message: 'Recipe saved.' }} /></Companion>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  expect(screen.getByText('Recipe saved.')).toBeTruthy()
  act(() => vi.advanceTimersByTime(2600))
  expect(screen.getByText('Your recipe collection is open. Choose a scrap to revisit it.')).toBeTruthy()
})

it('restores the saved visibility preference and survives unavailable storage', () => {
  localStorage.setItem('moris-mix:mori-companion', '{"hidden":true,"position":{"x":220,"y":120}}')
  render(<Companion />)
  expect(screen.queryByRole('button', { name: 'Talk to Mori' })).toBeNull()
  const show = screen.getByRole('button', { name: 'Show Mori' })
  fireEvent.click(show)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  expect(document.activeElement).toBe(trigger)
  expect(JSON.parse(localStorage.getItem('moris-mix:mori-companion') ?? '{}')).toEqual({ hidden: false, position: { x: 220, y: 120 } })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
  fireEvent.keyDown(trigger, { key: 'ArrowLeft' })
  expect(screen.getByText('Mori moved left.')).toBeTruthy()
})

it('supports keyboard repositioning without reset or hide controls', () => {
  render(<Companion />)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  const character = screen.getByRole('group', { name: 'Mori companion' })
  const defaultX = parseFloat(character.style.left)
  fireEvent.keyDown(trigger, { key: 'ArrowLeft' })
  expect(screen.getByText('Mori moved left.')).toBeTruthy()
  expect(parseFloat(character.style.left)).toBeLessThan(defaultX)
  fireEvent.click(trigger)
  const panel = screen.getByRole('region', { name: 'Mori' })
  expect(panel.querySelector('.mori-pet-message')?.getAttribute('role')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reset position' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Hide Mori' })).toBeNull()
})

it('keeps Mori’s visibility account-local and returns focus when hiding or showing', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: fine) and (hover: hover)',
    addEventListener() {},
    removeEventListener() {},
  }))
  const app = (userId: string) => <MemoryRouter><MoriCompanionProvider>
    <MoriCompanion userId={userId} />
  </MoriCompanionProvider></MemoryRouter>
  const view = render(app('first-cook'))

  const trigger = () => screen.getByRole('button', { name: 'Talk to Mori' })
  fireEvent.click(trigger())
  const preference = () => screen.getByRole('combobox', { name: 'Mori’s movement' })
  fireEvent.change(preference(), { target: { value: 'hidden' } })
  expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
  const show = () => screen.getByRole('button', { name: 'Show Mori' })
  expect(document.activeElement).toBe(show())

  view.rerender(app('second-cook'))
  expect(trigger()).toBeTruthy()
  fireEvent.click(trigger())
  expect(preference()).toHaveProperty('value', 'animated')
  view.rerender(app('first-cook'))
  fireEvent.click(show())
  expect(document.activeElement).toBe(trigger())
  expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
})

it('keeps Still Mori stationary while chat navigates and restores the choice on remount', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: fine) and (hover: hover)',
    addEventListener() {},
    removeEventListener() {},
  }))
  function CurrentLocation() {
    return <output>{useLocation().pathname}</output>
  }
  const app = <MemoryRouter initialEntries={['/app/recipes']}><MoriCompanionProvider>
    <MoriCompanion userId="quiet-cook" /><CurrentLocation />
  </MoriCompanionProvider></MemoryRouter>
  const view = render(app)
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const preference = () => screen.getByRole('combobox', { name: 'Mori’s movement' })

  open()
  fireEvent.change(preference(), { target: { value: 'still' } })
  const mori = screen.getByRole('button', { name: 'Talk to Mori' }).querySelector('svg')
  expect(mori?.hasAttribute('data-animated')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Open cooking notes' }))
  expect(screen.getByText('/app/quick-entry')).toBeTruthy()

  view.unmount()
  render(app)
  open()
  expect(preference()).toHaveProperty('value', 'still')
})

it('ignores other pointers while a primary pointer is dragging Mori', () => {
  render(<Companion />)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  const character = screen.getByRole('group', { name: 'Mori companion' })
  const captured = new Set<number>()
  Object.assign(trigger, {
    setPointerCapture: (pointerId: number) => captured.add(pointerId),
    hasPointerCapture: (pointerId: number) => captured.has(pointerId),
    releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
  })
  const sendPointer = (type: string, pointerId: number, values: Record<string, unknown> = {}) => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { pointerId, isPrimary: pointerId === 1, button: 0, clientX: 900, clientY: 600, ...values })
    fireEvent(trigger, event)
  }
  const originalX = parseFloat(character.style.left)
  sendPointer('pointerdown', 1)
  sendPointer('pointerup', 2)
  sendPointer('pointercancel', 2)
  sendPointer('lostpointercapture', 2)
  sendPointer('pointermove', 1, { clientX: 850, clientY: 560 })
  expect(parseFloat(character.style.left)).toBeLessThan(originalX)
  expect(document.querySelector('.mori-pet-sr')?.textContent).toBe('')
  sendPointer('pointerup', 1)
  expect(document.querySelector('.mori-pet-sr')?.textContent).toBe('Mori moved to a new spot.')
  fireEvent.click(trigger, { detail: 1 })
  expect(screen.queryByRole('region', { name: 'Mori' })).toBeNull()
})

it('recovers from malformed preferences and keeps optional producers independent', () => {
  localStorage.setItem('moris-mix:mori-companion', '{"position":{"x":"broken"}}')
  render(<Companion />)
  expect(screen.getByRole('button', { name: 'Talk to Mori' })).toBeTruthy()
  expect(() => render(<><Activity activity={{ kind: 'working', message: 'Working.' }} /><Guidance /></>)).not.toThrow()
})

it('keeps the companion and guidance within a shrunken, panned visual viewport', () => {
  const visualViewport = Object.assign(new EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0 })
  vi.stubGlobal('visualViewport', visualViewport)
  render(<Companion />)
  const character = screen.getByRole('group', { name: 'Mori companion' })
  Object.assign(visualViewport, { width: 320, height: 360, offsetLeft: 140, offsetTop: 200 })
  act(() => visualViewport.dispatchEvent(new Event('resize')))
  expect(parseFloat(character.style.left)).toBeGreaterThanOrEqual(148)
  expect(parseFloat(character.style.left) + 116).toBeLessThanOrEqual(452)
  expect(parseFloat(character.style.top) + 179.2).toBeLessThanOrEqual(552)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const panel = screen.getByRole('region', { name: 'Mori' })
  const bubble = panel.parentElement as HTMLElement
  expect(parseFloat(bubble.style.left)).toBeGreaterThanOrEqual(148)
  expect(parseFloat(bubble.style.left) + parseFloat(bubble.style.width)).toBeLessThanOrEqual(452)
  expect(parseFloat(bubble.style.top) + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(552)
  Object.assign(visualViewport, { offsetLeft: 280, offsetTop: 400 })
  act(() => visualViewport.dispatchEvent(new Event('scroll')))
  expect(parseFloat(character.style.left)).toBeGreaterThanOrEqual(288)
  expect(parseFloat(character.style.top)).toBeGreaterThanOrEqual(408)
})

it('keeps guidance open after a same-route action', () => {
  render(<Companion><Guidance /></Companion>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  fireEvent.click(screen.getByRole('button', { name: 'Write a recipe' }))
  expect(screen.getByRole('region', { name: 'Mori' })).toBeTruthy()
})

it.each([
  ['/app', 'My recipes'],
  ['/app/recipes', 'My recipes'],
  ['/app/recipes/new', 'New recipe'],
  ['/app/recipes/private-recipe-id', 'Recipe details'],
  ['/app/recipes/private-recipe-id/edit', 'Recipe editor'],
  ['/app/quick-entry', 'Cooking notes'],
  ['/app/quick-entry/review', 'Recipe review'],
  ['/app/chef', 'AI Chef'],
  ['/app/chef/', 'AI Chef'],
  ['/app/chef/review', 'Recipe review'],
  ['/app/chef/review/', 'Recipe review'],
])('uses one safe, page-aware companion on %s', (pathname, label) => {
  render(<Companion initialEntries={[pathname]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const panel = screen.getByRole('region', { name: 'Mori' })
  expect(within(panel).getByText(label, { selector: '.mori-pet-context' })).toBeTruthy()
  expect(panel.querySelector('nav')).toBeNull()
  expect(document.querySelector('.mori-pet-caption')).toBeNull()
  expect(panel.textContent).not.toContain('private-recipe-id')
  expect(screen.queryByText('Organize cooking notes')).toBeNull()
  expect(screen.queryByText('Find something to cook')).toBeNull()
})
