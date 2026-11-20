import { expect, it } from 'vitest'
import { createMoriPath, directionFor } from './moriMovement'
import type { Direction8, Point } from './moriMovement'
import { createMoriSpriteLookup, MORI_FOOT, moriSpriteFrame } from './moriSpriteAtlas'

const origin = { x: 0, y: 0 }
const directions: [Direction8, Point][] = [
  ['N', { x: 0, y: -1 }],
  ['NE', { x: 1, y: -1 }],
  ['E', { x: 1, y: 0 }],
  ['SE', { x: 1, y: 1 }],
  ['S', { x: 0, y: 1 }],
  ['SW', { x: -1, y: 1 }],
  ['W', { x: -1, y: 0 }],
  ['NW', { x: -1, y: -1 }],
]

it.each(directions)('faces %s and advances the same distance per step', (facing, vector) => {
  const target = { x: vector.x * 100, y: vector.y * 100 }
  const path = createMoriPath(origin, [target])
  const step = path.sample(20)

  expect(directionFor(origin, target)).toBe(facing)
  expect(step.facing).toBe(facing)
  expect(Math.hypot(step.position.x, step.position.y)).toBeCloseTo(20)
})

it('follows ordered waypoints and stops exactly at the destination', () => {
  const bridgeStart = { x: 10, y: 0 }
  const bridgeEnd = { x: 10, y: 10 }
  const destination = { x: 20, y: 10 }
  const path = createMoriPath(origin, [origin, bridgeStart, bridgeStart, bridgeEnd, destination])

  expect(path.length).toBe(30)
  expect(path.sample(10).position).toEqual(bridgeStart)
  expect(path.sample(15)).toEqual({ position: { x: 10, y: 5 }, facing: 'S', distance: 15 })
  expect(path.sample(20).position).toEqual(bridgeEnd)
  expect(path.sample(50)).toEqual({ position: destination, facing: 'E', distance: 30 })
  expect(path.sample(-10)).toEqual({ position: origin, facing: 'E', distance: 0 })
})

it('keeps the previous facing if there is no movement', () => {
  expect(createMoriPath(origin, [origin]).sample(20, 'NW')).toEqual({
    position: origin, facing: 'NW', distance: 0,
  })
})

it.each(directions)('falls back to official art for %s while frames are missing', (facing) => {
  expect(moriSpriteFrame(facing)).toBeNull()
  expect(moriSpriteFrame(facing, 20)).toBeNull()
})

it('loops the matching walk frames by travelled distance and retains their foot anchors', () => {
  const idle = { src: 'idle.svg', foot: MORI_FOOT }
  const walk = [0, 1, 2, 3].map((step) => ({
    src: `walk-${step}.svg`, foot: { x: 100 + step, y: 230 },
  }))
  const frame = createMoriSpriteLookup({
    NE: { idle, walk, stride: 80 },
    SW: { idle, walk: [], stride: 80 },
  })

  expect(frame('NE')).toBe(idle)
  expect([0, 20, 40, 60, 80].map((distance) => frame('NE', distance))).toEqual([...walk, walk[0]])
  expect(frame('SW', 20)).toBe(idle)
  expect(frame('E', 20)).toBeNull()
})
