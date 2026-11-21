import { describe, expect, it } from 'vitest'
import { createMoriPaperPlan, moriRestFoot, nearestPaperFoot, pathOnPaper } from './moriPaperMotion'
import { smooth, type TurnDirection } from './pageTurnMotion'

const left = { left: 10, right: 310, top: 10, bottom: 510 }
const right = { left: 330, right: 630, top: 10, bottom: 510 }
const lane = 270

function turnContact(leftEdge: number, rightEdge: number, direction: TurnDirection) {
  const from = direction === 'forward' ? rightEdge : leftEdge
  const to = direction === 'forward' ? leftEdge : rightEdge
  return (progress: number) => ({
    x: from + (to - from) * smooth(progress),
    y: 205 + 35 * Math.sin(Math.PI * smooth(progress)),
  })
}

describe.each(['forward', 'backward'] as const)('%s', (direction) => {
  it('holds the edge across the spine and takes steps before releasing above the other page', () => {
    const rest = moriRestFoot(right)
    const contact = turnContact(left.left, right.right, direction)
    const plan = createMoriPaperPlan({ left, right, start: rest, contact, lane, openings: [{ top: lane - 18, bottom: lane + 18 }], direction })
    const frames = Array.from({ length: 601 }, (_, index) => plan.sample(index / 600))
    const crossings = frames.filter(({ position }) => position.x > left.right && position.x < right.left)
    expect(crossings.every(({ position }) => Math.abs(position.y - lane) <= 18)).toBe(true)
    expect(crossings.some(({ phase }) => phase === 'turn')).toBe(true)

    const turn = frames.filter((frame) => frame.phase === 'turn')
    const arrival = turn.at(-1)
    expect(frames.find(({ phase }) => phase === 'grab')?.facing).toBe(direction === 'forward' ? 'E' : 'W')
    expect(turn.every((frame) => frame.attached)).toBe(true)
    expect(arrival?.paper).toBeGreaterThan(.8)
    expect(arrival?.position.x).toBeGreaterThan(direction === 'forward' ? left.left : right.left)
    expect(arrival?.position.x).toBeLessThan(direction === 'forward' ? left.right : right.right)
    expect(turn.every(({ paper, position }) => Math.hypot(position.x - contact(paper).x, position.y - contact(paper).y) <= 54)).toBe(true)
    expect(frames.at(-1)).toMatchObject({ phase: 'idle', position: rest, paper: 1 })
  })
})

it('fits the return across a wide spread inside the interaction budget', () => {
  const left = { left: 20, right: 620, top: 15, bottom: 815 }
  const right = { left: 650, right: 1250, top: 15, bottom: 815 }
  const start = moriRestFoot(right)
  const plan = createMoriPaperPlan({ left, right, start, contact: turnContact(left.left, right.right, 'backward'), lane: 467, openings: [{ top: 410, bottom: 520 }], direction: 'backward' })

  expect(plan.duration).toBeLessThan(3500)
  expect(plan.sample(1)).toMatchObject({ position: start, phase: 'idle', paper: 1 })
})

it('crosses directly when a clear path follows the starting position and uses the closest clear opening otherwise', () => {
  const openings = [{ top: 140, bottom: 220 }, { top: 330, bottom: 385 }]
  const start = { x: 90, y: 355 }
  const end = { x: 530, y: 365 }
  const direct = pathOnPaper(start, end, left, right, openings)
  expect(direct.length).toBeCloseTo(Math.hypot(end.x - start.x, end.y - start.y))
  const constrained = pathOnPaper(start, { x: 530, y: 290 }, left, right, openings)
  expect(constrained.sample(constrained.length / 2).position.y).toBeGreaterThanOrEqual(330)
  expect(constrained.length).toBeLessThan(pathOnPaper(start, { x: 530, y: 290 }, left, right, openings.slice(0, 1)).length)
})

it('starts on the nearest paper when Mori was resting just outside the spread', () => {
  expect(nearestPaperFoot({ x: 3, y: 420 }, left, right)).toEqual({ x: 38, y: 420 })
  expect(nearestPaperFoot({ x: 120, y: 190 }, left, right)).toEqual({ x: 120, y: 190 })
})
