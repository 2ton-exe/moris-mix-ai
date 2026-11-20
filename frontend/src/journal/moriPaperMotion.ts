import { createMoriPath, type Direction8, type Point } from './moriMovement'
import { MORI_FOOT, MORI_SPRITE_WIDTH } from './moriSpriteAtlas'
import { smooth, type TurnDirection } from './pageTurnMotion'

export type PaperBounds = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>

export const MORI_DESKTOP_SIZE = 96
export const MORI_ART_SCALE = MORI_DESKTOP_SIZE / MORI_SPRITE_WIDTH
const OUTER_INSET = 28
const SPINE_CLEARANCE = 48
const WALK_SPEED = 580 // Notebook pixels per second.
const WALK_TIME_BUDGET = 2050
const ALIGN_TIME = 65
const GRAB_TIME = 120
const FLIP_TIME = 1120
const RELEASE_PROGRESS = .84

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
  contact: (progress: number) => Point
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
type StoppedPhase = 'align' | 'idle'

type PaperFrame = { position: Point; facing: Direction8; paper: number } & (
  | { phase: WalkPhase; distance: number }
  | { phase: 'grab' | 'release'; reach: number; attached: boolean; target: Point }
  | { phase: 'turn'; reach: 1; attached: true; target: Point; step: number }
  | { phase: StoppedPhase }
)

export function createMoriPaperPlan({ left, right, start, contact, lane, direction }: PaperPlanInput) {
  const forward = direction === 'forward'
  const facing = forward ? 'E' : 'W'
  const stance = (target: Point) => {
    const x = Math.max(left.left + 13, Math.min(right.right - 13, target.x + (forward ? -27 : 27)))
    // Only steer through the clear gap while passing the rings.
    const fromGutter = Math.max(left.right - x, x - right.left, 0)
    const throughGap = 1 - smooth(fromGutter / SPINE_CLEARANCE)
    const y = target.y + 30
    return { x, y: y + (lane - y) * throughGap }
  }
  const uncovered = contact(0)
  const stand = stance(uncovered)
  const releaseTarget = contact(RELEASE_PROGRESS)
  const releaseStand = stance(releaseTarget)
  // Mori backs up first, then turns toward the edge when it reaches the outer margin.
  const faceGrip = (position: Point, target: Point) => target.x >= position.x ? 'E' : 'W'
  const approach = pathOnPaper(start, stand, left, right, lane)
  const recovery = pathOnPaper(releaseStand, start, left, right, lane + 16)
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
        return { ...standing, phase: 'grab', paper: 0, reach: smooth(grab * 1.4), attached: grab >= .72, target: uncovered }
      }
      if (elapsed < recoveryStart) {
        const paper = (elapsed - flipStart) / FLIP_TIME
        if (paper < RELEASE_PROGRESS) {
          const target = contact(paper)
          const position = stance(target)
          return { position, facing: faceGrip(position, target), phase: 'turn', paper, reach: 1, attached: true, target, step: paper / RELEASE_PROGRESS }
        }
        const release = (paper - RELEASE_PROGRESS) / (1 - RELEASE_PROGRESS)
        return { position: releaseStand, facing: faceGrip(releaseStand, releaseTarget), phase: 'release', paper, reach: 1 - smooth(release), attached: false, target: releaseTarget }
      }
      if (progress < 1) {
        return { ...recovery.sample(walkDistance((elapsed - recoveryStart) / recoveryTime, recovery.length)), phase: 'recover', paper: 1 }
      }
      return { position: start, facing: 'S', phase: 'idle', paper: 1 }
    },
  }
}
