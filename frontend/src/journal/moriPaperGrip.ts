import type { Point } from './moriMovement'
import { MORI_FOOT } from './moriSpriteAtlas'
import { MORI_ART_SCALE, MORI_DESKTOP_SIZE } from './moriPaperMotion'

const artwork = import.meta.glob<string>('../assets/journal/mori/{E,W}/{reach,grip,release}.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
})

type GripPose = 'reach' | 'grip' | 'release'

function createPose(markup?: string) {
  if (!markup) return null
  // The parser only receives build-time SVGs authored for this interaction.
  const art = new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('svg')
  const arm = art?.querySelector('[data-mori-arm]')
  const mitt = arm?.querySelector('[data-mori-mitt]')
  const hand = mitt?.querySelector('circle')
  if (!art || !arm || !mitt || !hand) return null

  const [sx, sy] = (arm.getAttribute('data-shoulder') ?? '').split(' ').map(Number)
  const [wx, wy] = (arm.getAttribute('data-wrist') ?? '').split(' ').map(Number)
  const contact = { x: Number.parseFloat(hand.getAttribute('cx') ?? ''), y: Number.parseFloat(hand.getAttribute('cy') ?? '') }
  const lines = [...arm.querySelectorAll('[data-mori-forearm]')]
  const feet = [...art.querySelectorAll('[data-mori-pull-foot]')]
  if (!lines.length || ![sx, sy, wx, wy, contact.x, contact.y].every(Number.isFinite)) return null
  art.setAttribute('width', String(MORI_DESKTOP_SIZE))
  art.setAttribute('height', String(MORI_DESKTOP_SIZE * 1.2))
  art.style.transform = `translate(${-MORI_FOOT.x * MORI_ART_SCALE}px, ${-MORI_FOOT.y * MORI_ART_SCALE}px)`
  return {
    art,
    move(target: Point, progress: number) {
      const dx = target.x - contact.x
      const dy = target.y - contact.y
      const x = wx + dx
      const y = wy + dy
      const path = `M${sx} ${sy} Q${(sx + x) / 2} ${(sy + y) / 2 - 3} ${x} ${y}`
      for (const line of lines) line.setAttribute('d', path)
      mitt.setAttribute('transform', `translate(${dx} ${dy})`)
      const stride = Math.sin(progress * Math.PI * 12)
      for (const [index, foot] of feet.entries()) {
        const swing = index === 0 ? stride : -stride
        foot.setAttribute('transform', `translate(${swing * 10} ${-Math.max(0, swing) * 7})`)
      }
    },
  }
}

export function createPaperGrip(actor: HTMLElement) {
  const loadPoses = (facing: 'E' | 'W') => {
    const load = (pose: GripPose) => createPose(artwork[`../assets/journal/mori/${facing}/${pose}.svg`])
    const reach = load('reach')
    const grip = load('grip')
    const release = load('release')
    return reach && grip && release ? { reach, grip, release } : null
  }
  const east = loadPoses('E')
  const west = loadPoses('W')
  if (!east || !west) return null
  const poses = { E: east, W: west }
  let current: SVGSVGElement | null = null

  return {
    show(facing: 'E' | 'W', pose: GripPose, target: Point, progress: number) {
      const next = poses[facing][pose]
      if (current !== next.art) {
        current?.remove()
        actor.appendChild(next.art)
        current = next.art
      }
      next.move(target, progress)
    },
    hide() {
      current?.remove()
      current = null
    },
  }
}
