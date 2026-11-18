import { describe, expect, it } from 'vitest'
import { mittAnchor, projectCorner, turnFrame } from './pageTurnMotion'

it('uses normalized stages, mirrored hinge rotation, continuous reach and grip', () => {
  const stages = [[0, 'approach'], [.18, 'grab'], [.26, 'pull'], [.38, 'turn'], [.82, 'release'], [.9, 'settle']] as const
  for (const [p, stage] of stages) expect(turnFrame(p, 'forward').stage).toBe(stage)
  for (let p = 0; p <= 1; p += .01) {
    const next = turnFrame(p, 'forward')
    expect(next.angle).toBe(-turnFrame(p, 'backward').angle)
    if (p >= .26 && p <= .82) expect(next.grip).toBe(1)
    expect(Math.hypot(mittAnchor(next.armAngle).x - 128, mittAnchor(next.armAngle).y - 168)).toBeCloseTo(Math.hypot(20, 22))
  }
})

describe.each(['forward', 'backward'] as const)('%s projection', (direction) => {
  const geometry = { left: 20, top: 100, width: 1000, height: 700, hinge: 500, pageTop: 12, radius: direction === 'forward' ? 480 : -480 }
  it('ends on the opposite side of a stationary spine', () => {
    expect(projectCorner(geometry, turnFrame(0, direction).angle).x).toBe(520 + geometry.radius)
    expect(projectCorner(geometry, turnFrame(1, direction).angle).x).toBeCloseTo(520 - geometry.radius)
  })
  it('keeps the single-pane contact continuous at its surface handoff', () => {
    const single = { ...geometry, hinge: 0, radius: 480, single: true }
    const before = projectCorner(single, turnFrame(.54 - .00001, direction, true).angle)
    const after = projectCorner(single, turnFrame(.54 + .00001, direction, true).angle)
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(.001)
    expect(turnFrame(0, direction, true).angle).toBeCloseTo(0)
    expect(turnFrame(1, direction, true).angle).toBeCloseTo(0)
  })
})
