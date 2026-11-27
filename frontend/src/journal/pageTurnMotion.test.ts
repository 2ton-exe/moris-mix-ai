import { expect, it } from 'vitest'
import { mittAnchor, turnFrame } from './pageTurnMotion'

it('turns immediately, mirrors direction and settles at the opposite leaf', () => {
  expect(turnFrame(.05, 'forward').travel).toBeGreaterThan(0)
  expect(turnFrame(0, 'forward').angle).toBeCloseTo(0)
  expect(turnFrame(1, 'forward').angle).toBe(-180)
  for (let p = .01; p <= 1; p += .01) {
    expect(turnFrame(p, 'forward').angle).toBe(-turnFrame(p, 'backward').angle)
  }
  expect(turnFrame(1, 'forward').stage).toBe('settle')
})

it('keeps single-page face handoff continuous and finishes flat', () => {
  expect(turnFrame(.5, 'forward', true).angle).toBe(-90)
  expect(turnFrame(1, 'forward', true).angle).toBeCloseTo(0)
  expect(turnFrame(.5 - .00001, 'forward', true).angle).toBeCloseTo(turnFrame(.5 + .00001, 'forward', true).angle)
})

it('keeps the navigation tap hand on its arm radius', () => {
  const hand = mittAnchor(-58)
  expect(Math.hypot(hand.x - 128, hand.y - 168)).toBeCloseTo(Math.hypot(20, 22))
})
