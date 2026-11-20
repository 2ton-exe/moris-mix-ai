import type { Point } from './moriMovement'

export const JOURNAL_SINGLE_LAYOUT_QUERY = '(max-width: 1099.98px), (max-height: 639.98px)'

export type TurnDirection = 'forward' | 'backward'
export type TurnStage = 'approach' | 'grab' | 'pull' | 'turn' | 'release' | 'settle'
export const TURN_DURATION = 780
export const TURN_PERSPECTIVE = 1800
const clamp = (n: number) => Math.max(0, Math.min(1, n))
export const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }

export function turnFrame(progress: number, direction: TurnDirection, single = false) {
  const p = clamp(progress)
  const stage: TurnStage = p < .18 ? 'approach' : p < .26 ? 'grab' : p < .38 ? 'pull' : p < .82 ? 'turn' : p < .9 ? 'release' : 'settle'
  const travel = smooth((p - .26) / .56)
  const sign = direction === 'forward' ? -1 : 1
  const angle = single ? sign * 90 * (travel < .5 ? travel * 2 : (1 - travel) * 2) : sign * 180 * travel
  const reach = smooth((p - .18) / .08) * (1 - smooth((p - .9) / .1))
  return { progress: p, stage, travel, angle, armAngle: -100 * reach, grip: smooth((p - .21) / .05) * (1 - smooth((p - .82) / .08)), attached: p >= .26 && p <= .82, shade: Math.sin(Math.PI * travel) * .32 }
}

export interface TurnGeometry {
  left: number; top: number; width: number; height: number
  hinge: number; pageTop: number; radius: number; single?: boolean
}

/** CSS rotateY around the spine followed by the layer's perspective projection. */
export function projectCorner(geometry: TurnGeometry, angle: number) {
  const radians = angle * Math.PI / 180
  const x = geometry.hinge + geometry.radius * Math.cos(radians)
  const z = -geometry.radius * Math.sin(radians)
  const scale = TURN_PERSPECTIVE / (TURN_PERSPECTIVE - z)
  const perspectiveX = geometry.single ? geometry.hinge : geometry.width / 2
  return { x: geometry.left + perspectiveX + (x - perspectiveX) * scale, y: geometry.top + geometry.pageTop }
}

export function mittAnchor(angle: number) {
  const radians = angle * Math.PI / 180
  return { x: 128 + 20 * Math.cos(radians) - 22 * Math.sin(radians), y: 168 + 20 * Math.sin(radians) + 22 * Math.cos(radians) }
}

export interface SpatialCompanion {
  screenFoot: Point
  setActorOpacity: (opacity: number) => void
  stop: () => void
}

export interface TurnCompanion {
  startSpatial: () => SpatialCompanion | null
  start: (direction: TurnDirection, single: boolean) => ((frame: ReturnType<typeof turnFrame>, corner: { x: number; y: number }) => void)
  stop: () => void
}
// Explicit registration keeps the persistent companion outside the route/form tree.
let companion: TurnCompanion | null = null
export function registerTurnCompanion(value: TurnCompanion) {
  companion = value
  return () => { if (companion === value) { value.stop(); companion = null } }
}
export function getTurnCompanion() { return companion }
