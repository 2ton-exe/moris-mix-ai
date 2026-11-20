/* The turn manager mounts the actor and advances it on the existing paper clock. */
/* eslint react-refresh/only-export-components: off */
import { Mori } from './Mori'
import type { Point } from './moriMovement'
import { createPaperGrip } from './moriPaperGrip'
import { createMoriPaperPlan, isPaperRest, MORI_ART_SCALE, MORI_DESKTOP_SIZE, MORI_RELEASE_PROGRESS, moriRestFoot } from './moriPaperMotion'
import { loadedMoriSprite, MORI_FOOT, moriSpriteFrame } from './moriSpriteAtlas'
import { smooth, TURN_PERSPECTIVE, turnFrame, type TurnCompanion, type TurnDirection } from './pageTurnMotion'

export function MoriPaperActor() {
  return <div className="mm-mori-paper-actor" data-mori-paper-actor hidden>
    <span data-mori-foot />
    <Mori size={MORI_DESKTOP_SIZE} />
  </div>
}

export function createMoriPaperScene({ book, layer, leaf, direction, companion, settle }: {
  book: HTMLElement
  layer: HTMLElement
  leaf: HTMLElement
  direction: TurnDirection
  companion: TurnCompanion
  settle: () => void
}) {
  const actor = layer.querySelector<HTMLElement>('[data-mori-paper-actor]')
  const art = actor?.querySelector('svg')
  const marker = leaf.querySelector<HTMLElement>('[data-page-corner]')
  const leftPage = book.querySelector<HTMLElement>(':scope > .mm-journal-spread > .mm-journal-flyleaf')
  const rightPage = book.querySelector<HTMLElement>(':scope > .mm-journal-spread > .mm-journal-page')
  if (!actor || !art || !marker || !leftPage || !rightPage) return null

  const layerRect = layer.getBoundingClientRect()
  const layerStyle = getComputedStyle(layer)
  const scaleX = layerRect.width / parseFloat(layerStyle.width)
  const scaleY = layerRect.height / parseFloat(layerStyle.height)
  if (![scaleX, scaleY].every((scale) => Number.isFinite(scale) && scale > 0)) return null
  const toLocal = ({ x, y }: Point) => ({ x: (x - layerRect.left) / scaleX, y: (y - layerRect.top) / scaleY })
  const bounds = (page: HTMLElement) => {
    const rect = page.getBoundingClientRect()
    const start = toLocal({ x: rect.left, y: rect.top })
    const end = toLocal({ x: rect.right, y: rect.bottom })
    return { left: start.x, top: start.y, right: end.x, bottom: end.y }
  }
  const left = bounds(leftPage)
  const right = bounds(rightPage)
  const rings = [...book.querySelectorAll('.mm-journal-ring')].map((ring) => ring.getBoundingClientRect()).sort((a, b) => a.top - b.top)
  let gap = 0
  let laneY = layerRect.top + layerRect.height / 2
  for (const [index, ring] of rings.entries()) {
    const next = rings[index + 1]
    if (next && next.top - ring.bottom > gap) {
      gap = next.top - ring.bottom
      laneY = (next.top + ring.bottom) / 2
    }
  }
  // The cap and tail need clearance above the feet while traversing the ring gap.
  const lane = toLocal({ x: 0, y: laneY }).y + MORI_FOOT.y * MORI_ART_SCALE / 2
  const leafBox = leaf.getBoundingClientRect()
  const hinge = toLocal(leafBox).x + parseFloat(getComputedStyle(leaf).transformOrigin)
  const [perspectiveX, perspectiveY] = layerStyle.perspectiveOrigin.split(' ').map(parseFloat)
  if (![hinge, perspectiveX, perspectiveY].every(Number.isFinite)) return null

  const grip = createPaperGrip(actor, direction)
  if (!grip) return null
  const control = companion.startSpatial()
  if (!control) return null
  marker.dataset.moriPaperGrip = ''
  const markerRect = marker.getBoundingClientRect()
  const corner = toLocal({ x: markerRect.left, y: markerRect.top })
  const foot = toLocal(control.screenFoot)
  const safeFoot = isPaperRest(foot, left, right)
  const start = safeFoot ? foot : moriRestFoot(right)
  const plan = createMoriPaperPlan({ left, right, start, corner, lane, direction })
  const radius = corner.x - hinge
  // Project the measured grip point through the sheet’s rotateY and the parent perspective.
  const cornerAt = (angle: number) => {
    const radians = angle * Math.PI / 180
    const lens = TURN_PERSPECTIVE / (TURN_PERSPECTIVE + radius * Math.sin(radians))
    return {
      x: perspectiveX + (hinge + radius * Math.cos(radians) - perspectiveX) * lens,
      y: perspectiveY + (corner.y - perspectiveY) * lens,
    }
  }
  art.querySelector('[data-mori-hand]')?.removeAttribute('data-mori-hand')
  const feet = Array.from(art.querySelectorAll<SVGEllipseElement>('.mori-foot-l, .mori-foot-r'))
  const flip = (paper: number) => turnFrame(.26 + .56 * paper, direction)
  const releaseGrip = cornerAt(flip(MORI_RELEASE_PROGRESS).angle)
  art.style.transform = `translate(${-MORI_FOOT.x * MORI_ART_SCALE}px, ${-MORI_FOOT.y * MORI_ART_SCALE}px)`
  let sprite: HTMLImageElement | null = null
  let spriteFacing: string | undefined
  actor.hidden = false

  const width = book.clientWidth
  const height = book.clientHeight
  let resizeFrame: number | null = null
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (resizeFrame !== null || (book.clientWidth === width && book.clientHeight === height)) return
    resizeFrame = requestAnimationFrame(settle)
  })
  observer?.observe(book)

  return {
    duration: plan.duration,
    apply(progress: number) {
      const frame = plan.sample(progress)
      actor.dataset.moriMotion = frame.phase
      actor.dataset.moriFacing = frame.facing
      actor.style.transform = `translate(${frame.position.x}px, ${frame.position.y}px)`
      const opacity = safeFoot ? 1 : smooth(progress * plan.duration / 95) * smooth((1 - progress) * plan.duration / 95)
      actor.style.opacity = String(opacity)
      control.setActorOpacity(opacity)

      const paper = flip(frame.paper)
      const reaching = 'reach' in frame && frame.reach > 0
      const walking = 'distance' in frame
      const distance = walking ? frame.distance / MORI_ART_SCALE : undefined
      const image = reaching ? null : moriSpriteFrame(frame.facing, distance)
      const loaded = image && loadedMoriSprite(image.src)
      if (loaded !== sprite && (loaded || spriteFacing !== frame.facing || reaching)) {
        sprite?.remove()
        sprite = loaded
        spriteFacing = frame.facing
        if (sprite && image) {
          // Center on the common ground datum as the planted leg changes sides.
          sprite.style.transform = `translate(${-MORI_FOOT.x * MORI_ART_SCALE}px, ${-image.foot.y * MORI_ART_SCALE}px)`
          actor.appendChild(sprite)
        }
      }
      art.style.visibility = sprite || reaching ? 'hidden' : ''
      if (!sprite && !reaching) {
        const stride = distance === undefined ? 0 : Math.sin(distance * Math.PI / 80) * 6
        feet.forEach((foot, index) => { foot.style.transform = `translateY(${Math.min(0, index ? -stride : stride)}px)` })
      }
      actor.toggleAttribute('data-mori-gripping', 'attached' in frame && frame.attached)
      if ('reach' in frame && reaching) {
        const target = frame.phase === 'release' ? releaseGrip : cornerAt(paper.angle)
        const localX = MORI_FOOT.x + (target.x - frame.position.x) / MORI_ART_SCALE
        const localY = MORI_FOOT.y + (target.y - frame.position.y) / MORI_ART_SCALE
        const restX = direction === 'forward' ? 146 : 54
        grip.show(frame.phase === 'release' ? 'release' : frame.attached ? 'grip' : 'reach', {
          x: restX + (localX - restX) * frame.reach,
          y: 196 + (localY - 196) * frame.reach,
        })
      } else grip.hide()
      return paper
    },
    stop() {
      observer?.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      sprite?.remove()
      grip.hide()
      actor.hidden = true
      delete marker.dataset.moriPaperGrip
      control.stop()
    },
  }
}
