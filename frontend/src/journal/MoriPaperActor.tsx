/* The turn manager mounts the actor and advances it on the existing paper clock. */
/* eslint react-refresh/only-export-components: off */
import { Mori } from './Mori'
import type { Point } from './moriMovement'
import { createPaperGrip } from './moriPaperGrip'
import { createMoriPaperPlan, isPaperRest, MORI_ART_SCALE, MORI_DESKTOP_SIZE, moriRestFoot } from './moriPaperMotion'
import { loadedMoriSprite, MORI_FOOT, moriSpriteFrame } from './moriSpriteAtlas'
import { chooseTurnGrab, projectGrabPoint, smooth, turnFrame, type GrabSpot, type TurnCompanion, type TurnDirection } from './pageTurnMotion'

export function MoriPaperActor() {
  return <div className="mm-mori-paper-actor" data-mori-paper-actor hidden>
    <span data-mori-foot />
    <Mori size={MORI_DESKTOP_SIZE} />
  </div>
}

export function createMoriPaperScene({ book, layer, leaf, direction, companion, previousGrab, settle }: {
  book: HTMLElement
  layer: HTMLElement
  leaf: HTMLElement
  direction: TurnDirection
  companion: TurnCompanion
  previousGrab: GrabSpot
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

  const grip = createPaperGrip(actor)
  if (!grip) return null
  const control = companion.startSpatial()
  if (!control) return null
  const radius = toLocal({ x: direction === 'forward' ? leafBox.right : leafBox.left, y: leafBox.top }).x - hinge
  const geometry = {
    left: 0, top: 0, width: layerRect.width / scaleX, height: layerRect.height / scaleY,
    hinge, pageTop: toLocal(leafBox).y, radius,
    perspectiveOrigin: { x: perspectiveX, y: perspectiveY },
  }
  const liftedAngle = direction === 'forward' ? -90 : 90
  const pageHeight = leafBox.height / scaleY
  const liftedTop = projectGrabPoint(geometry, liftedAngle, 0).y
  const liftedHeight = projectGrabPoint(geometry, liftedAngle, pageHeight).y - liftedTop
  const preferredY = Math.max(0, Math.min(pageHeight, (lane - 30 - liftedTop) * pageHeight / liftedHeight))
  const viewport = window.visualViewport
  const grab = chooseTurnGrab({
    geometry, direction, pageHeight, previous: previousGrab, preferredY,
    viewportTop: ((viewport?.offsetTop ?? 0) - layerRect.top) / scaleY,
    viewportHeight: (viewport?.height ?? innerHeight) / scaleY,
  })
  leaf.style.setProperty('--mm-grab-y', `${grab.y}px`)
  const foot = toLocal(control.screenFoot)
  const safeFoot = isPaperRest(foot, left, right)
  const start = safeFoot ? foot : moriRestFoot(right)
  const flip = (paper: number) => turnFrame(.26 + .56 * paper, direction)
  const contact = (progress: number) => projectGrabPoint(geometry, flip(progress).angle, grab.y)
  const plan = createMoriPaperPlan({ left, right, start, contact, lane, direction })
  art.querySelector('[data-mori-hand]')?.removeAttribute('data-mori-hand')
  const feet = Array.from(art.querySelectorAll<SVGEllipseElement>('.mori-foot-l, .mori-foot-r'))
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
    grabSpot: grab.spot,
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
      const attached = 'attached' in frame && frame.attached
      actor.toggleAttribute('data-mori-gripping', attached)
      leaf.style.setProperty('--mm-crease-strength', String(attached ? 1 : frame.phase === 'release' ? frame.reach : 0))
      if ('reach' in frame && reaching) {
        const localX = MORI_FOOT.x + (frame.target.x - frame.position.x) / MORI_ART_SCALE
        const localY = MORI_FOOT.y + (frame.target.y - frame.position.y) / MORI_ART_SCALE
        const facing = frame.facing === 'E' ? 'E' : 'W'
        const restX = facing === 'E' ? 146 : 54
        grip.show(facing, frame.phase === 'release' ? 'release' : frame.attached ? 'grip' : 'reach', {
          x: restX + (localX - restX) * frame.reach,
          y: 196 + (localY - 196) * frame.reach,
        }, frame.phase === 'turn' ? frame.step : 0)
      } else grip.hide()
      return paper
    },
    stop() {
      observer?.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      sprite?.remove()
      grip.hide()
      actor.hidden = true
      control.stop()
    },
  }
}
