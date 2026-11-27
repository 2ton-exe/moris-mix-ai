import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiClient } from '../api/config'
import { notifyAIUsageChanged } from '../api/aiUsage'
import { AIUsageIndicator } from './AIUsageIndicator'

const usage = {
  observedAt: '2026-11-27T12:00:00Z',
  daily: { limit: 10, used: 3, remaining: 7, resetAt: '2026-11-28T00:00:00Z' },
  shortTerm: { mode: 'fixed', limit: 5, used: 2, remaining: 3, nextChangeAt: null, retryAt: null },
}
let clients: QueryClient[] = []
function renderIndicator(active = true, onKeyDown = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><div className="mori-chat" onKeyDown={onKeyDown}><div className="mori-chat-composer" /><AIUsageIndicator userId="owner" active={active} /></div></QueryClientProvider>)
}
beforeEach(() => { vi.spyOn(apiClient, 'getAuthenticatedJson').mockResolvedValue(usage) })
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients = []; vi.useRealTimers(); vi.restoreAllMocks() })

it('keeps only a discreet ring visible and reveals accurate values on hover', async () => {
  renderIndicator()
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  await waitFor(() => expect(button.closest('[data-state]')?.getAttribute('data-state')).toBe('normal'))
  expect(screen.queryByText('7 of 10 left')).toBeNull()
  expect(Number(document.querySelector('.mori-ai-usage-remaining')?.getAttribute('stroke-dashoffset'))).toBeCloseTo(.3)
  fireEvent.mouseEnter(button)
  expect(screen.getByRole('tooltip', { name: "Mori's AI usage" })).toBeTruthy()
  expect(screen.getByText('7 of 10 left')).toBeTruthy()
  expect(screen.getByText('3 of 5 left')).toBeTruthy()
  expect(screen.getByText('Daily reset: 8:00 AM PHT')).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
  expect(button.getAttribute('aria-expanded')).toBe('true')
})

it('opens on keyboard focus and click, and Escape dismisses without closing the chat', () => {
  const onKeyDown = vi.fn()
  renderIndicator(true, onKeyDown)
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.keyDown(button, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(onKeyDown).not.toHaveBeenCalled()
  fireEvent.mouseEnter(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(button)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it.each([
  [2, 'low', false],
  [0, 'exhausted', true],
])('distinguishes %i daily operations left with the proper ring state', async (remaining, state, exhausted) => {
  vi.mocked(apiClient.getAuthenticatedJson).mockResolvedValue({ ...usage, daily: { ...usage.daily, used: 10 - remaining, remaining } })
  renderIndicator()
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  await waitFor(() => expect(button.closest('[data-state]')?.getAttribute('data-state')).toBe(state))
  fireEvent.click(button)
  expect(Boolean(screen.queryByText(/You've used today's AI allowance/))).toBe(exhausted)
  expect(screen.queryByText('Mori needs a moment. Try again shortly.')).toBeNull()
})

it('keeps temporary throttling separate from daily exhaustion', async () => {
  vi.mocked(apiClient.getAuthenticatedJson).mockResolvedValue({ ...usage, shortTerm: { ...usage.shortTerm, used: 5, remaining: 0, retryAt: '2026-11-27T12:00:30Z' } })
  renderIndicator()
  fireEvent.click(screen.getByRole('button', { name: "Mori's AI usage" }))
  expect(await screen.findByText('Mori needs a moment. Try again shortly.')).toBeTruthy()
  expect(screen.getByText('7 of 10 left')).toBeTruthy()
  expect(screen.queryByText(/You've used today's AI allowance/)).toBeNull()
})

it('removes cached numerical claims when refreshing usage fails', async () => {
  renderIndicator()
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  fireEvent.click(button)
  expect(await screen.findByText('7 of 10 left')).toBeTruthy()
  vi.mocked(apiClient.getAuthenticatedJson).mockRejectedValue(new Error('unavailable'))
  act(() => notifyAIUsageChanged('owner'))
  expect(await screen.findByText('AI usage is temporarily unavailable.')).toBeTruthy()
  expect(screen.queryByText('7 of 10 left')).toBeNull()
  expect(button.closest('[data-state]')?.getAttribute('data-state')).toBe('unavailable')
})

it.each(['mouseEnter', 'focus', 'click'] as const)('recovers from unavailable usage when details reopen via %s', async (event) => {
  vi.mocked(apiClient.getAuthenticatedJson).mockRejectedValue(new Error('unavailable'))
  renderIndicator()
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  fireEvent[event](button)
  expect(await screen.findByText('AI usage is temporarily unavailable.')).toBeTruthy()
  fireEvent.keyDown(button, { key: 'Escape' })
  fireEvent.blur(button)
  expect(screen.queryByRole('tooltip')).toBeNull()

  vi.mocked(apiClient.getAuthenticatedJson).mockResolvedValue(usage)
  fireEvent[event](button)
  expect(await screen.findByText('7 of 10 left')).toBeTruthy()
  expect(screen.queryByText('AI usage is temporarily unavailable.')).toBeNull()
  expect(button.closest('[data-state]')?.getAttribute('data-state')).toBe('normal')
})

it('refreshes cached usage when details open without reopening chat', async () => {
  renderIndicator()
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  await waitFor(() => expect(button.closest('[data-state]')?.getAttribute('data-state')).toBe('normal'))
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(1)
  vi.mocked(apiClient.getAuthenticatedJson).mockResolvedValue({ ...usage, daily: { ...usage.daily, used: 4, remaining: 6 } })

  fireEvent.click(button)
  expect(await screen.findByText('6 of 10 left')).toBeTruthy()
})

it('keeps the hover card open while the pointer moves over it', async () => {
  renderIndicator()
  const button = screen.getByRole('button', { name: "Mori's AI usage" })
  fireEvent.mouseEnter(button)
  const card = screen.getByRole('tooltip')
  fireEvent.mouseLeave(button)
  fireEvent.mouseEnter(card)
  await new Promise(resolve => window.setTimeout(resolve, 150))
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.mouseLeave(card)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
})

it('places the card above the composer when there is room and stays within the viewport', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('mori-chat-composer') ? new DOMRect(100, 400, 200, 60) : new DOMRect(268, 472, 32, 32)
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(180)
  renderIndicator()
  fireEvent.click(screen.getByRole('button', { name: "Mori's AI usage" }))
  const card = screen.getByRole('tooltip')
  expect(parseFloat(card.style.top) + 180).toBeLessThanOrEqual(392)
  expect(parseFloat(card.style.left)).toBeGreaterThanOrEqual(8)
})
