import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiClient } from '../api/config'
import { aiUsageKey, notifyAIUsageChanged } from '../api/aiUsage'
import { useAIUsage } from './useAIUsage'

const usage = {
  observedAt: '2026-11-27T12:00:00Z',
  daily: { limit: 10, used: 3, remaining: 7, resetAt: '2026-11-28T00:00:00Z' },
  shortTerm: { mode: 'fixed', limit: 5, used: 2, remaining: 3, nextChangeAt: null, retryAt: null },
}
let clients: QueryClient[] = []
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    clients.push(value)
    return value
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => { vi.spyOn(apiClient, 'getAuthenticatedJson').mockResolvedValue(usage) })
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients = []; focusManager.setFocused(undefined); vi.useRealTimers(); vi.restoreAllMocks() })

it('waits for the popup, deduplicates its initial read, and refreshes each reopen', async () => {
  const { result, rerender } = renderHook(({ active }) => useAIUsage('owner', active), { initialProps: { active: false }, wrapper: Wrapper })
  expect(apiClient.getAuthenticatedJson).not.toHaveBeenCalled()
  rerender({ active: true })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(1)
  rerender({ active: false })
  rerender({ active: true })
  await waitFor(() => expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(2))
})

it('refreshes after same-account operations and ignores another account notification', async () => {
  const { result } = renderHook(() => useAIUsage('owner', true), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  act(() => notifyAIUsageChanged('other'))
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(1)
  act(() => notifyAIUsageChanged('owner'))
  await waitFor(() => expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(2))
})

it('replaces an initial in-flight snapshot after an AI operation finishes', async () => {
  let finishInitial: ((value: unknown) => void) | undefined
  let initialSignal: AbortSignal | undefined
  vi.mocked(apiClient.getAuthenticatedJson).mockImplementationOnce((_path, { signal }) => {
    initialSignal = signal
    return new Promise(resolve => { finishInitial = resolve })
  }).mockResolvedValue({ ...usage, daily: { ...usage.daily, used: 4, remaining: 6 } })
  const { result } = renderHook(() => useAIUsage('owner', true), { wrapper: Wrapper })
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(1)
  act(() => notifyAIUsageChanged('owner'))
  await waitFor(() => expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(2))
  expect(initialSignal?.aborted).toBe(true)
  await waitFor(() => expect(result.current.data?.daily.remaining).toBe(6))
  await act(async () => finishInitial?.(usage))
  expect(result.current.data?.daily.remaining).toBe(6)
})

it('does not fetch while closed when an operation invalidates its cached usage', async () => {
  const { result, rerender } = renderHook(({ active }) => useAIUsage('owner', active), { initialProps: { active: true }, wrapper: Wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  rerender({ active: false })
  await act(async () => notifyAIUsageChanged('owner'))
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(1)
})

it('refreshes at server reset time without trusting the client clock timezone', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T04:00:00Z'))
  vi.mocked(apiClient.getAuthenticatedJson).mockResolvedValue({ ...usage, shortTerm: { ...usage.shortTerm, nextChangeAt: '2026-11-27T12:00:02Z' } })
  renderHook(() => useAIUsage('owner', true), { wrapper: Wrapper })
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(2)
})

it('refreshes stale usage when the tab becomes active', async () => {
  const { result } = renderHook(() => useAIUsage('owner', true), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  act(() => {
    clients[0].setQueryData(aiUsageKey('owner'), usage, { updatedAt: Date.now() - 31_000 })
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
  await waitFor(() => expect(apiClient.getAuthenticatedJson).toHaveBeenCalledTimes(2))
})

it('uses the account key so an old account response cannot replace the new account', async () => {
  let finishOld: ((value: unknown) => void) | undefined
  vi.mocked(apiClient.getAuthenticatedJson).mockImplementation((_path, { userId }) => userId === 'owner'
    ? new Promise(resolve => { finishOld = resolve })
    : Promise.resolve({ ...usage, daily: { ...usage.daily, used: 8, remaining: 2 } }))
  const { result, rerender } = renderHook(({ userId }) => useAIUsage(userId, true), { initialProps: { userId: 'owner' }, wrapper: Wrapper })
  rerender({ userId: 'other' })
  await waitFor(() => expect(result.current.data?.daily.remaining).toBe(2))
  await act(async () => finishOld?.(usage))
  expect(result.current.data?.daily.remaining).toBe(2)
})
