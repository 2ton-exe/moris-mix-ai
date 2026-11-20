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

export function chooseTurnGrab({ pageTop, pageHeight, viewportTop, viewportHeight, previous }: {
  pageTop: number
  pageHeight: number
  viewportTop: number
  viewportHeight: number
  previous: number
}) {
  const reachable = [.025, .48, .92].filter((fraction) => {
    const y = pageTop + pageHeight * fraction
    return y >= viewportTop && y <= viewportTop + viewportHeight
  })
  const choices = reachable.length > 1 ? reachable.filter((fraction) => fraction !== previous) : reachable
  return choices[Math.floor(Math.random() * choices.length)] ?? 0
}

/** CSS rotateY around the spine followed by the layer's perspective projection. */
export function projectGrabPoint(geometry: TurnGeometry, angle: number, grabY: number) {
  const radians = angle * Math.PI / 180
  const x = geometry.hinge + geometry.radius * Math.cos(radians)
  const z = -geometry.radius * Math.sin(radians)
  const scale = TURN_PERSPECTIVE / (TURN_PERSPECTIVE - z)
  const perspectiveX = geometry.single ? geometry.hinge : geometry.width / 2
  return { x: geometry.left + perspectiveX + (x - perspectiveX) * scale, y: geometry.top + geometry.pageTop + grabY * scale }
}

export function mittAnchor(angle: number) {
  const radians = angle * Math.PI / 180
  return { x: 128 + 20 * Math.cos(radians) - 22 * Math.sin(radians), y: 168 + 20 * Math.sin(radians) + 22 * Math.cos(radians) }
}

export interface TurnCompanion {
  start: (direction: TurnDirection, single: boolean) => ((frame: ReturnType<typeof turnFrame>, contact: { x: number; y: number }) => void) | undefined
  stop: () => void
}
// Explicit registration keeps the persistent companion outside the route/form tree.
let companion: TurnCompanion | null = null
export function registerTurnCompanion(value: TurnCompanion) {
  companion = value
  return () => { if (companion === value) { value.stop(); companion = null } }
}
export function getTurnCompanion() { return companion }
