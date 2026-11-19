import { expect, it } from 'vitest'
import { moriReviewKeyFromState } from './routeState'

it('accepts only numeric Mori review keys from route state', () => {
  expect(moriReviewKeyFromState({ moriReviewKey: 17 })).toBe(17)
  expect(moriReviewKeyFromState({ moriReviewKey: '17' })).toBe('initial')
  expect(moriReviewKeyFromState(null)).toBe('initial')
})
