import { describe, expect, it } from 'vitest'
import { retryAfterMessage, retryAfterSeconds } from './retryAfter'

const now = Date.UTC(2026, 10, 8, 0, 0, 0)

describe('Retry-After guidance', () => {
  it.each([undefined, '', ' ', '-1', '1.5', 'Infinity', '1e3', '0x10', 'tomorrow', '9999999999999999999999'])('rejects unusable guidance %s', (value) => {
    expect(retryAfterSeconds(value, now)).toBeUndefined()
    expect(retryAfterMessage(value)).toBe('Try again later.')
  })
  it('accepts delta seconds and HTTP dates without promising success', () => {
    expect(retryAfterSeconds(' 60 ', now)).toBe(60)
    expect(retryAfterSeconds('0', now)).toBe(0)
    expect(retryAfterSeconds(new Date(now + 90_000).toUTCString(), now)).toBe(90)
    expect(retryAfterSeconds(new Date(now - 90_000).toUTCString(), now)).toBe(0)
    expect(retryAfterMessage('30')).toBe('Wait at least 30 seconds before retrying.')
  })
})
