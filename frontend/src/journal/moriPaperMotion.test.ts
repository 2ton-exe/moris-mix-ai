import { expect, it } from 'vitest'
import { createMoriPaperPlan, moriRestFoot } from './moriPaperMotion'

const left = { left: 10, right: 310, top: 10, bottom: 510 }
const right = { left: 330, right: 630, top: 10, bottom: 510 }
const lane = 270

it('walks through the clear lane before reaching for the left sheet and ends on paper', () => {
  const rest = moriRestFoot(right)
  const plan = createMoriPaperPlan({ left, right, start: rest, corner: { x: left.left, y: 140 }, lane, direction: 'backward' })
  const frames = Array.from({ length: 601 }, (_, index) => plan.sample(index / 600))
  const crossing = frames.filter(({ position }) => position.x > left.right && position.x < right.left)
  expect(crossing.map(({ position }) => position.y)).toEqual(expect.arrayContaining([expect.closeTo(lane)]))
  expect(crossing.every(({ position }) => Math.abs(position.y - lane) <= 18)).toBe(true)

  const approach = frames.filter(({ phase }) => phase === 'approach')
  expect(approach.length).toBeGreaterThan(0)
  expect(approach.every(({ paper }) => paper === 0)).toBe(true)
  expect(frames.find(({ phase }) => phase === 'grab')?.facing).toBe('W')
  expect(frames.filter(({ phase }) => phase === 'turn').at(-1)?.paper).toBeGreaterThan(0)
  expect(frames.filter(({ phase }) => phase === 'release').at(-1)?.paper).toBeGreaterThan(.9)
  expect(frames.at(-1)).toMatchObject({ phase: 'idle', position: rest, paper: 1 })
})

it('takes a shorter direct path from the same resting spot to the right sheet', () => {
  const start = moriRestFoot(right)
  const geometry = { left, right, lane, start }
  const next = createMoriPaperPlan({ ...geometry, corner: { x: right.right, y: 140 }, direction: 'forward' })
  const previous = createMoriPaperPlan({ ...geometry, corner: { x: left.left, y: 140 }, direction: 'backward' })
  expect(next.duration).toBeLessThan(previous.duration)
  expect(Array.from({ length: 100 }, (_, index) => next.sample(index / 99).position.x).every((x) => x >= right.left)).toBe(true)
})
