import { createMoriPath, type Direction8, type Point } from './moriMovement'
import { MORI_FOOT, MORI_SPRITE_WIDTH } from './moriSpriteAtlas'
import { smooth, type TurnDirection } from './pageTurnMotion'

export type PaperBounds = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>

export const MORI_DESKTOP_SIZE = 96
export const MORI_ART_SCALE = MORI_DESKTOP_SIZE / MORI_SPRITE_WIDTH
const OUTER_INSET = 28
const SPINE_CLEARANCE = 48
const WALK_SPEED = 580 // Notebook pixels per second.
const WALK_TIME_BUDGET = 2350
const ALIGN_TIME = 65
const GRAB_TIME = 120
const FLIP_TIME = 460
export const MORI_RELEASE_PROGRESS = .27

export function moriRestFoot(right: PaperBounds): Point {
  return { x: right.right - OUTER_INSET - 2, y: right.bottom - 112 }
}

export function isPaperRest(point: Point, left: PaperBounds, right: PaperBounds) {
  const inside = (page: PaperBounds, xMin: number, xMax: number) =>
    point.x >= xMin && point.x <= xMax && point.y >= page.top + MORI_FOOT.y * MORI_ART_SCALE && point.y <= page.bottom - 6
  return inside(left, left.left + OUTER_INSET, left.right - SPINE_CLEARANCE) ||
    inside(right, right.left + SPINE_CLEARANCE, right.right - OUTER_INSET)
}

interface PaperPlanInput {
  left: PaperBounds
  right: PaperBounds
  start: Point
  corner: Point
  lane: number
  direction: TurnDirection
}

function pathOnPaper(start: Point, end: Point, left: PaperBounds, right: PaperBounds, lane: number) {
  const onLeft = start.x <= left.right
  const endsOnLeft = end.x <= left.right
  if (onLeft === endsOnLeft) return createMoriPath(start, [end])
  const fromLeft = { x: left.right - SPINE_CLEARANCE, y: lane }
  const fromRight = { x: right.left + SPINE_CLEARANCE, y: lane }
  return createMoriPath(start, onLeft ? [fromLeft, fromRight, end] : [fromRight, fromLeft, end])
}

function walkDistance(progress: number, length: number) {
  const brakeAt = .85
  const t = Math.max(0, Math.min(progress, 1))
  if (t <= brakeAt) return length * t / .925
  const remaining = (1 - t) / (1 - brakeAt)
  return length * (1 - (1 - brakeAt) * remaining ** 2 / (2 * .925))
}

type WalkPhase = 'approach' | 'recover'
type ReachPhase = 'grab' | 'turn' | 'release'
type StoppedPhase = 'align' | 'idle'

type PaperFrame = { position: Point; facing: Direction8; paper: number } & (
  | { phase: WalkPhase; distance: number }
  | { phase: ReachPhase; reach: number; attached: boolean }
  | { phase: StoppedPhase }
)

export function createMoriPaperPlan({ left, right, start, corner, lane, direction }: PaperPlanInput) {
  const forward = direction === 'forward'
  const facing = forward ? 'E' : 'W'
  const stand = { x: corner.x + (forward ? -27 : 27), y: corner.y + 30 }
  const approach = pathOnPaper(start, stand, left, right, lane)
  const recovery = pathOnPaper(stand, start, left, right, lane + 16)
  const walkingSpeed = Math.max(WALK_SPEED, (approach.length + recovery.length) * 1000 / WALK_TIME_BUDGET)
  const approachTime = approach.length / walkingSpeed * 1000
  const flipStart = approachTime + ALIGN_TIME + GRAB_TIME
  const recoveryStart = flipStart + FLIP_TIME
  const recoveryTime = recovery.length / walkingSpeed * 1000
  const duration = recoveryStart + recoveryTime

  return {
    duration,
    sample(progress: number): PaperFrame {
      const elapsed = progress * duration
      const standing = { position: stand, facing } satisfies Pick<PaperFrame, 'position' | 'facing'>
      if (elapsed < approachTime) {
        return { ...approach.sample(walkDistance(elapsed / approachTime, approach.length)), phase: 'approach', paper: 0 }
      }
      if (elapsed < approachTime + ALIGN_TIME) return { ...standing, phase: 'align', paper: 0 }
      if (elapsed < flipStart) {
        const grab = (elapsed - approachTime - ALIGN_TIME) / GRAB_TIME
        return { ...standing, phase: 'grab', paper: 0, reach: smooth(grab * 1.4), attached: grab >= .72 }
      }
      if (elapsed < recoveryStart) {
        const paper = (elapsed - flipStart) / FLIP_TIME
        if (paper < MORI_RELEASE_PROGRESS) return { ...standing, phase: 'turn', paper, reach: 1, attached: true }
        const release = (paper - MORI_RELEASE_PROGRESS) / .3
        return { ...standing, phase: 'release', paper, reach: 1 - smooth(release), attached: false }
      }
      if (progress < 1) {
        return { ...recovery.sample(walkDistance((elapsed - recoveryStart) / recoveryTime, recovery.length)), phase: 'recover', paper: 1 }
      }
      return { position: start, facing: 'S', phase: 'idle', paper: 1 }
    },
  }
}
