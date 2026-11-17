import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/context'
import type { AuthState } from '../auth/context'
import { MoriCompanion } from './MoriCompanion'
import { MoriCompanionProvider, useMoriActivity } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'

const { sendMoriChat } = vi.hoisted(() => ({ sendMoriChat: vi.fn() }))
vi.mock('./chatApi', () => ({ sendMoriChat }))

function Activity({ activity }: { activity: MoriActivity | null }) { useMoriActivity(activity); return null }
function GoToRecipe() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate('/app/recipes/new')}>Open a new recipe page</button> }
function auth(id = 'cook-a') { return { user: { id }, isAuthenticated: true } as AuthState }
function Companion({ children, id = 'cook-a', path = '/app/recipes' }: { children?: ReactNode; id?: string; path?: string }) {
  return <AuthContext.Provider value={auth(id)}><MemoryRouter initialEntries={[path]}><MoriCompanionProvider key={id}>{children}<MoriCompanion /></MoriCompanionProvider></MemoryRouter></AuthContext.Provider>
}

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  })
  sendMoriChat.mockReset()
})
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('opens a non-modal chat, focuses the composer and returns focus on close', () => {
  render(<Companion />)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog', { name: 'Mori' })
  expect(panel.getAttribute('aria-modal')).toBe('false')
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message Mori' }))
  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Mori' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('opens with a concise greeting and no repeated dashboard banner', () => {
  render(<Companion />)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const panel = screen.getByRole('dialog', { name: 'Mori' })
  expect(within(panel).getByText('What are we cooking today?')).toBeTruthy()
  expect(within(panel).queryByText(/Your saved recipes live in the collection/)).toBeNull()
  expect(within(panel).queryByRole('button', { name: /write another recipe/i })).toBeNull()
  expect(panel.querySelector('.mori-chat-message--assistant .mori-chat-message-speaker')).toBeNull()
  expect(within(panel).getByRole('button', { name: 'Send message to Mori' }).querySelector('svg')).toBeTruthy()
  expect((within(panel).getByRole('button', { name: 'Send message to Mori' }) as HTMLButtonElement).disabled).toBe(true)
})

it('uses Enter to send, keeps Shift+Enter for a newline, and displays the server reply', async () => {
  sendMoriChat.mockResolvedValueOnce('Cook the rice gently until tender.')
  render(<Companion />)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const composer = screen.getByRole('textbox', { name: 'Message Mori' })
  fireEvent.change(composer, { target: { value: 'How do I cook rice?' } })
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
  expect(sendMoriChat).not.toHaveBeenCalled()
  fireEvent.keyDown(composer, { key: 'Enter' })
  expect(await screen.findByText('Cook the rice gently until tender.')).toBeTruthy()
  expect(sendMoriChat).toHaveBeenCalledWith(expect.objectContaining({
    messages: [{ role: 'user', content: 'How do I cook rice?' }], page: 'recipes', userId: 'cook-a', signal: expect.any(AbortSignal),
  }))
})

it('shows a recoverable error and retries the same user turn once', async () => {
  sendMoriChat.mockRejectedValueOnce(new Error('private provider details')).mockResolvedValueOnce('Try a splash of water and cover the pan.')
  render(<Companion />)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const composer = screen.getByRole('textbox', { name: 'Message Mori' })
  fireEvent.change(composer, { target: { value: 'My rice is dry' } })
  fireEvent.keyDown(composer, { key: 'Enter' })
  expect((await screen.findByRole('alert')).textContent).toContain("I couldn't get a reply just now.")
  expect(screen.queryByText('private provider details')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Try a splash of water and cover the pan.')).toBeTruthy()
  expect(sendMoriChat).toHaveBeenCalledTimes(2)
  expect(sendMoriChat.mock.calls[0][0].messages).toEqual(sendMoriChat.mock.calls[1][0].messages)
})

it('closes on route change and preserves conversation when the bubble reopens', async () => {
  sendMoriChat.mockResolvedValueOnce('Use medium-low heat and cover it.')
  render(<Companion><GoToRecipe /></Companion>)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  fireEvent.click(trigger)
  const composer = screen.getByRole('textbox', { name: 'Message Mori' })
  fireEvent.change(composer, { target: { value: 'How should I cook beans?' } })
  fireEvent.keyDown(composer, { key: 'Enter' })
  await screen.findByText('Use medium-low heat and cover it.')
  fireEvent.click(screen.getByRole('button', { name: 'Open a new recipe page' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mori' })).toBeNull())
  fireEvent.click(trigger)
  expect(screen.getByText('How should I cook beans?')).toBeTruthy()
  expect(screen.getByText('Use medium-low heat and cover it.')).toBeTruthy()
})

it('drags the character itself without opening chat, then opens on click', () => {
  render(<Companion />)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  const character = screen.getByRole('group', { name: 'Mori companion' })
  const captured = new Set<number>()
  Object.assign(trigger, {
    setPointerCapture: (pointerId: number) => captured.add(pointerId),
    hasPointerCapture: (pointerId: number) => captured.has(pointerId),
    releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
  })
  const sendPointer = (type: string, values: Record<string, unknown> = {}) => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: 900, clientY: 600, ...values })
    fireEvent(trigger, event)
  }
  const originalX = parseFloat(character.style.left)
  sendPointer('pointerdown')
  sendPointer('pointermove', { clientX: 800, clientY: 500 })
  sendPointer('pointerup', { clientX: 800, clientY: 500 })
  fireEvent.click(trigger)
  expect(parseFloat(character.style.left)).toBeLessThan(originalX)
  expect(screen.queryByRole('dialog', { name: 'Mori' })).toBeNull()
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Mori' })).toBeTruthy()
})

it('supports keyboard repositioning and a separate hide and restore setting', () => {
  render(<Companion />)
  const trigger = screen.getByRole('button', { name: 'Talk to Mori' })
  const character = screen.getByRole('group', { name: 'Mori companion' })
  const originalX = parseFloat(character.style.left)
  fireEvent.keyDown(trigger, { key: 'ArrowLeft' })
  expect(parseFloat(character.style.left)).toBeLessThan(originalX)
  expect(screen.getByText('Mori moved left.')).toBeTruthy()
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog', { name: 'Mori' })
  fireEvent.click(within(panel).getByRole('button', { name: 'Mori settings' }))
  expect(within(panel).getByRole('button', { name: 'Hide Mori' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Mori' }))
  expect(screen.getByRole('button', { name: 'Show Mori' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show Mori' }))
  expect(screen.getByRole('button', { name: 'Talk to Mori' })).toBeTruthy()
  expect(JSON.parse(localStorage.getItem('moris-mix:mori-companion:cook-a') ?? '{}')).toMatchObject({ hidden: false })
})

it('reflects actual workflow activity and returns to idle after a brief celebration', () => {
  vi.useFakeTimers()
  render(<Companion><Activity activity={{ kind: 'celebrating', message: 'Recipe saved.' }} /></Companion>)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  expect(screen.getByText('Recipe saved.')).toBeTruthy()
  act(() => vi.advanceTimersByTime(2600))
  expect(screen.getByText('Ready when you are')).toBeTruthy()
})

it('bounds the companion and chat within a resized visual viewport', async () => {
  const visualViewport = Object.assign(new EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0 })
  vi.stubGlobal('visualViewport', visualViewport)
  render(<Companion />)
  Object.assign(visualViewport, { width: 320, height: 360, offsetLeft: 140, offsetTop: 200 })
  act(() => visualViewport.dispatchEvent(new Event('resize')))
  const character = screen.getByRole('group', { name: 'Mori companion' })
  expect(parseFloat(character.style.left)).toBeGreaterThanOrEqual(148)
  expect(parseFloat(character.style.left) + 116).toBeLessThanOrEqual(452)
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Mori' }))
  const panel = screen.getByRole('dialog', { name: 'Mori' })
  await waitFor(() => expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(148))
  expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBeLessThanOrEqual(452)
  expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(0)
  expect(parseFloat(panel.style.top) + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(552)
})
