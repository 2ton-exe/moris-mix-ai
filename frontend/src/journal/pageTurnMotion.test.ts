import { describe, expect, it, vi } from 'vitest'
import { chooseTurnGrab, mittAnchor, projectGrabPoint, turnFrame } from './pageTurnMotion'

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
    expect(projectGrabPoint(geometry, turnFrame(0, direction).angle, 20)).toEqual({ x: 520 + geometry.radius, y: 132 })
    expect(projectGrabPoint(geometry, turnFrame(1, direction).angle, 20).x).toBeCloseTo(520 - geometry.radius)
  })
  it('keeps the single-pane contact continuous at its surface handoff', () => {
    const single = { ...geometry, hinge: 0, radius: 480, single: true }
    const before = projectGrabPoint(single, turnFrame(.54 - .00001, direction, true).angle, 360)
    const after = projectGrabPoint(single, turnFrame(.54 + .00001, direction, true).angle, 360)
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(.001)
    expect(turnFrame(0, direction, true).angle).toBeCloseTo(0)
    expect(turnFrame(1, direction, true).angle).toBeCloseTo(0)
  })
})

it('varies the reachable grab point before repeating and falls back to the corner offscreen', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    const setup = {
      geometry: { left: 0, top: 100, width: 1200, height: 700, hinge: 600, pageTop: 0, radius: 600 },
      direction: 'forward',
      pageHeight: 700,
      viewportTop: 0,
      viewportHeight: 900,
    } as const
    const first = chooseTurnGrab({ ...setup, previous: 'corner' })
    const second = chooseTurnGrab({ ...setup, previous: first.spot })
    expect(first.spot).toBe('upper')
    expect(second.spot).toBe('middle')
    const lower = chooseTurnGrab({ ...setup, previous: second.spot, viewportTop: 500, viewportHeight: 400 })
    expect(lower.spot).toBe('lower')
    expect(lower.y - second.y).toBeGreaterThan(150)
    expect(projectGrabPoint(setup.geometry, -90, lower.y).y).toBeLessThan(900)
    expect(chooseTurnGrab({ ...setup, previous: first.spot, viewportTop: 800 })).toEqual({ spot: 'corner', y: 0 })
  } finally {
    random.mockRestore()
  }
})

it('samples different heights within the safe desktop grip region', () => {
  const setup = {
    geometry: { left: 0, top: 100, width: 1200, height: 700, hinge: 600, pageTop: 0, radius: 600 },
    direction: 'forward',
    pageHeight: 700,
    viewportTop: 0,
    viewportHeight: 900,
    previous: 'corner',
    range: { min: 180, max: 390 },
  } as const
  const random = vi.spyOn(Math, 'random')
  try {
    random.mockReturnValueOnce(0).mockReturnValueOnce(0)
    const high = chooseTurnGrab(setup)
    random.mockReturnValueOnce(0).mockReturnValueOnce(.9)
    const sameArea = chooseTurnGrab(setup)
    random.mockReturnValueOnce(.99).mockReturnValueOnce(.9)
    const low = chooseTurnGrab({ ...setup, previous: high.spot })
    expect(sameArea.spot).toBe(high.spot)
    expect(sameArea.y - high.y).toBeGreaterThan(40)
    expect(low.y - high.y).toBeGreaterThan(140)
    expect(low.y).toBeLessThan(390)
  } finally {
    random.mockRestore()
  }
})
