import { createMoriPath, type Direction8, type Point } from './moriMovement'
import { MORI_FOOT, MORI_SPRITE_WIDTH } from './moriSpriteAtlas'
import { smooth, type TurnDirection } from './pageTurnMotion'

export type PaperBounds = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>
export interface SpineOpening { top: number; bottom: number }

export const MORI_DESKTOP_SIZE = 96
export const MORI_ART_SCALE = MORI_DESKTOP_SIZE / MORI_SPRITE_WIDTH
const OUTER_INSET = 28
const SPINE_CLEARANCE = 48
const WALK_SPEED = 580 // Notebook pixels per second.
const WALK_TIME_BUDGET = 2050
const ALIGN_TIME = 65
const GRAB_TIME = 120
const FLIP_TIME = 880
const RELEASE_PROGRESS = .84

export function moriRestFoot(right: PaperBounds): Point {
  return { x: right.right - OUTER_INSET - 2, y: right.bottom - 112 }
}

export function nearestPaperFoot(point: Point, left: PaperBounds, right: PaperBounds) {
  const fit = (page: PaperBounds, leftInset: number, rightInset: number) => ({
    x: Math.max(page.left + leftInset, Math.min(page.right - rightInset, point.x)),
    y: Math.max(page.top + MORI_FOOT.y * MORI_ART_SCALE, Math.min(page.bottom - 6, point.y)),
  })
  const leftFoot = fit(left, OUTER_INSET, SPINE_CLEARANCE)
  const rightFoot = fit(right, SPINE_CLEARANCE, OUTER_INSET)
  return Math.hypot(leftFoot.x - point.x, leftFoot.y - point.y) <= Math.hypot(rightFoot.x - point.x, rightFoot.y - point.y)
    ? leftFoot : rightFoot
}

interface PaperPlanInput {
  left: PaperBounds
  right: PaperBounds
  start: Point
  contact: (progress: number) => Point
  lane: number
  openings: readonly SpineOpening[]
  direction: TurnDirection
}

export function pathOnPaper(start: Point, end: Point, left: PaperBounds, right: PaperBounds, openings: readonly SpineOpening[]) {
  const onLeft = start.x <= left.right
  if (onLeft === (end.x <= left.right)) return createMoriPath(start, [end])

  const near = onLeft ? left.right - SPINE_CLEARANCE : right.left + SPINE_CLEARANCE
  const far = onLeft ? right.left + SPINE_CLEARANCE : left.right - SPINE_CLEARANCE
  const yAt = (x: number) => start.y + (end.y - start.y) * (x - start.x) / (end.x - start.x)
  const nearY = yAt(near)
  const farY = yAt(far)
  if (openings.some(({ top, bottom }) => Math.min(nearY, farY) >= top && Math.max(nearY, farY) <= bottom)) {
    return createMoriPath(start, [end])
  }

  let shortest: ReturnType<typeof createMoriPath> | undefined
  for (const { top, bottom } of openings) {
    const fit = (y: number) => Math.max(top, Math.min(bottom, y))
    const entry = { x: near, y: fit(nearY) }
    const exit = { x: far, y: fit(farY) }
    const path = createMoriPath(start, [entry, exit, end])
    if (!shortest || path.length < shortest.length) shortest = path
  }
  return shortest ?? createMoriPath(start, [end])
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

export function createMoriPaperPlan({ left, right, start, contact, lane, openings, direction }: PaperPlanInput) {
  const forward = direction === 'forward'
  const facing = forward ? 'E' : 'W'
  const stance = (target: Point) => {
    const x = Math.max(left.left + 13, Math.min(right.right - 13, target.x + (forward ? -27 : 27)))
    // Only steer through the clear gap while passing the rings.
    const fromGutter = Math.max(left.right - x, x - right.left, 0)
    const throughGap = 1 - smooth(fromGutter / SPINE_CLEARANCE)
    const y = Math.min(target.y + 30, Math.min(left.bottom, right.bottom) - 10)
    return { x, y: y + (lane - y) * throughGap }
  }
  const uncovered = contact(0)
  const stand = stance(uncovered)
  const releaseTarget = contact(RELEASE_PROGRESS)
  const releaseStand = stance(releaseTarget)
  // Mori backs up first, then turns toward the edge when it reaches the outer margin.
  const faceGrip = (position: Point, target: Point) => target.x >= position.x ? 'E' : 'W'
  const approach = pathOnPaper(start, stand, left, right, openings)
  const recovery = pathOnPaper(releaseStand, start, left, right, openings)
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
