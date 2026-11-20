export interface Point {
  x: number
  y: number
}

const directions = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const
export type Direction8 = typeof directions[number]

export function directionFor(from: Point, to: Point, fallback: Direction8 = 'S'): Direction8 {
  const x = to.x - from.x
  const y = to.y - from.y
  if (x === 0 && y === 0) return fallback
  const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4))
  return directions[(sector + directions.length) % directions.length]
}

interface Segment {
  from: Point
  to: Point
  length: number
  end: number
  facing: Direction8
}

/** Precomputes a notebook-local path that can be sampled at any travelled distance. */
export function createMoriPath(start: Point, waypoints: readonly Point[]) {
  const segments: Segment[] = []
  let from = start
  let length = 0
  for (const to of waypoints) {
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y)
    if (segmentLength === 0) continue
    length += segmentLength
    segments.push({ from, to, length: segmentLength, end: length, facing: directionFor(from, to) })
    from = to
  }

  return {
    length,
    sample(travelled: number, fallbackFacing: Direction8 = 'S') {
      const distance = Math.max(0, Math.min(travelled, length))
      const segment = segments.find(({ end }) => distance < end)
      if (!segment) return { position: from, facing: segments.at(-1)?.facing ?? fallbackFacing, distance }
      const progress = (distance - (segment.end - segment.length)) / segment.length
      return {
        position: {
          x: segment.from.x + (segment.to.x - segment.from.x) * progress,
          y: segment.from.y + (segment.to.y - segment.from.y) * progress,
        },
        facing: segment.facing,
        distance,
      }
    },
  }
}
