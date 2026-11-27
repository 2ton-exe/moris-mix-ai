export const JOURNAL_SINGLE_LAYOUT_QUERY = '(max-width: 1099.98px), (max-height: 639.98px)'

export type TurnDirection = 'forward' | 'backward'
export type TurnStage = 'turn' | 'settle'
export const TURN_DURATION = 520
export const SINGLE_TURN_DURATION = 780
export const TURN_PERSPECTIVE = 1800
const clamp = (n: number) => Math.max(0, Math.min(1, n))
export const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }

export function turnFrame(progress: number, direction: TurnDirection, single = false) {
  const p = clamp(progress)
  const stage: TurnStage = p < 1 ? 'turn' : 'settle'
  const travel = smooth(p)
  const sign = direction === 'forward' ? -1 : 1
  const angle = single ? sign * 90 * (travel < .5 ? travel * 2 : (1 - travel) * 2) : sign * 180 * travel
  return { progress: p, stage, travel, angle, shade: Math.sin(Math.PI * travel) * .32 }
}

export function mittAnchor(angle: number) {
  const radians = angle * Math.PI / 180
  return { x: 128 + 20 * Math.cos(radians) - 22 * Math.sin(radians), y: 168 + 20 * Math.sin(radians) + 22 * Math.cos(radians) }
}
