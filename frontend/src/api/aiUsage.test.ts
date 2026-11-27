import { describe, expect, it, vi } from 'vitest'
import { aiUsageSchema, getAIUsage, notifyAIUsageChanged, subscribeAIUsageChanged } from './aiUsage'

const usage = {
  observedAt: '2026-11-27T12:00:00Z',
  daily: { limit: 10, used: 3, remaining: 7, resetAt: '2026-11-28T00:00:00Z' },
  shortTerm: { mode: 'fixed', limit: 5, used: 2, remaining: 3, nextChangeAt: '2026-11-27T12:00:30Z', retryAt: null },
}

describe('AI usage API', () => {
  it('fetches only the signed-in account summary without consuming an operation', async () => {
    const client = { getAuthenticatedJson: vi.fn().mockResolvedValue(usage) }
    const controller = new AbortController()
    await expect(getAIUsage({ userId: 'owner', signal: controller.signal, client })).resolves.toEqual(usage)
    expect(client.getAuthenticatedJson).toHaveBeenCalledExactlyOnceWith('/functions/v1/recipes/ai-usage', { userId: 'owner', signal: controller.signal })
  })

  it('accepts fallback and rolling limits from the server', () => {
    expect(aiUsageSchema.parse({ ...usage, daily: { ...usage.daily, limit: 20, remaining: 17 }, shortTerm: { ...usage.shortTerm, mode: 'rolling', limit: 3, remaining: 1 } })).toMatchObject({ daily: { limit: 20 }, shortTerm: { mode: 'rolling', limit: 3 } })
  })

  it.each([
    { ...usage, daily: { ...usage.daily, remaining: 9 } },
    { ...usage, daily: { ...usage.daily, used: -1 } },
    { ...usage, shortTerm: { ...usage.shortTerm, mode: 'unknown' } },
    { ...usage, observedAt: 'yesterday' },
  ])('rejects malformed or inconsistent usage instead of inventing values', (response) => {
    expect(aiUsageSchema.safeParse(response).success).toBe(false)
  })

  it('propagates unavailable usage without fallback data', async () => {
    const error = new Error('unavailable')
    await expect(getAIUsage({ userId: 'owner', client: { getAuthenticatedJson: vi.fn().mockRejectedValue(error) } })).rejects.toBe(error)
  })

  it('notifies subscribers by account and removes a subscription cleanly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAIUsageChanged(listener)
    notifyAIUsageChanged('owner')
    expect(listener).toHaveBeenCalledExactlyOnceWith('owner')
    unsubscribe()
    notifyAIUsageChanged('other')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
