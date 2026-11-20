import reachEast from '../assets/journal/mori/E/reach.svg?raw'
import reachWest from '../assets/journal/mori/W/reach.svg?raw'
import { directionFor, type Direction8, type Point } from '../journal/moriMovement'
import { loadedMoriSprite, MORI_FOOT, MORI_SPRITE_WIDTH, moriSpriteFrame, preloadMoriSprites } from '../journal/moriSpriteAtlas'
import { smooth } from '../journal/pageTurnMotion'

const arrivalMs = 120
const reduceMotion = '(prefers-reduced-motion: reduce)'

function reachPose(facing: 'E' | 'W') {
  const svg = new DOMParser().parseFromString(facing === 'E' ? reachEast : reachWest, 'image/svg+xml').querySelector('svg')
  const hand = svg?.querySelector('circle[data-mori-hand]')
  if (!svg || !hand) return null
  const x = Number.parseFloat(hand.getAttribute('cx') ?? '')
  const y = Number.parseFloat(hand.getAttribute('cy') ?? '')
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  svg.classList.add('mori-navigation-reach')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  return { svg, hand: { x, y } }
}

function visibleCenter(element: HTMLElement | null) {
  if (!element?.isConnected || getComputedStyle(element).visibility !== 'visible') return null
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  return target.x >= left && target.x <= left + (viewport?.width ?? innerWidth) &&
    target.y >= top && target.y <= top + (viewport?.height ?? innerHeight) ? target : null
}

export function travelToJournalTab({ character, trigger, findTab, signal, onSettled }: {
  character: HTMLElement
  trigger: HTMLElement
  findTab: () => HTMLElement | null
  signal: AbortSignal
  onSettled: () => void
}) {
  const preference = window.matchMedia?.(reduceMotion)
  const sprite = new Image()
  sprite.alt = ''
  sprite.className = 'mori-navigation-sprite'
  sprite.setAttribute('aria-hidden', 'true')
  let arrive: (continueNavigation: boolean) => void = () => {}
  const arrived = new Promise<boolean>((resolve) => { arrive = resolve })
  let frame = 0
  let stopped = false
  let position: Point | undefined
  let translation: Point = { x: 0, y: 0 }
  let spriteFacing: Direction8 | undefined
  let paintedFacing: Direction8 = 'S'
  let tab: HTMLElement | null = null
  let distance = 0
  let start: number | undefined
  let duration = 0
  let blend = 0
  let arrivalStart: number | undefined
  let returnStart: number | undefined
  let waitsForResume = true
  let reach: ReturnType<typeof reachPose> = null
  let reachFacing: 'E' | 'W' = 'E'

  function clearTab() {
    tab?.removeAttribute('data-mori-tap-target')
    tab = null
  }

  function stop(continueNavigation: boolean) {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    preference?.removeEventListener('change', reduce)
    document.removeEventListener('visibilitychange', hide)
    signal.removeEventListener('abort', cancel)
    clearTab()
    reach?.svg.remove()
    sprite.remove()
    delete character.dataset.navigationStage
    delete character.dataset.navigationArt
    delete character.dataset.moriFacing
    character.style.removeProperty('transform')
    onSettled()
    arrive(continueNavigation)
  }

  function cancel() { stop(false) }
  function reduce() { if (preference?.matches) stop(true) }
  function hide() { if (document.hidden) stop(true) }

  function paint(stage: 'travel' | 'arrival' | 'return', base: Point, next: Point, scale: number) {
    const previous = position ?? base
    distance += Math.hypot(next.x - previous.x, next.y - previous.y)
    position = next
    const stepFacing = directionFor(previous, next, paintedFacing)
    paintedFacing = stage === 'arrival' ? reachFacing : stepFacing
    character.dataset.navigationStage = stage
    character.dataset.moriFacing = paintedFacing
    translation = { x: next.x - base.x, y: next.y - base.y }
    character.style.transform = `translate(${translation.x}px, ${translation.y}px)`

    if (stage === 'arrival' && reach) {
      sprite.remove()
      if (!reach.svg.isConnected) character.append(reach.svg)
      character.dataset.navigationArt = ''
      return
    }
    reach?.svg.remove()
    const image = moriSpriteFrame(stepFacing, distance / scale)
    if (image && loadedMoriSprite(image.src)) {
      if (sprite.getAttribute('src') !== image.src) sprite.src = image.src
      if (!sprite.isConnected) character.append(sprite)
      spriteFacing = stepFacing
      character.dataset.navigationArt = ''
    } else if (!sprite.isConnected || spriteFacing !== stepFacing) {
      sprite.remove()
      delete character.dataset.navigationArt
    }
  }

  function walk(base: Point, goal: Point, elapsed: number, scale: number, stage: 'travel' | 'return') {
    const progress = smooth(elapsed / duration)
    const step = blend < 1 ? (progress - blend) / (1 - blend) : 1
    const from = position ?? base
    blend = progress
    paint(stage, base, { x: from.x + (goal.x - from.x) * step, y: from.y + (goal.y - from.y) * step }, scale)
  }

  function tick(now: number) {
    if (preference?.matches || document.hidden) return stop(true)
    const bounds = trigger.getBoundingClientRect()
    if (!bounds.width) {
      // The discard dialog can close a frame before the companion is visible again.
      if (!waitsForResume) return stop(true)
      waitsForResume = false
      frame = requestAnimationFrame(tick)
      return
    }
    waitsForResume = false
    const scale = bounds.width / MORI_SPRITE_WIDTH
    const base = { x: bounds.left + bounds.width / 2 - translation.x, y: bounds.top + MORI_FOOT.y * scale - translation.y }

    if (returnStart !== undefined) {
      if (now - returnStart >= duration) return stop(true)
      walk(base, base, now - returnStart, scale, 'return')
    } else {
      const target = findTab()
      const center = visibleCenter(target)
      if (!target || !center) return stop(true)
      if (start === undefined) {
        reachFacing = base.x < center.x ? 'E' : 'W'
        reach = reachPose(reachFacing)
        if (!reach) return stop(true)
        preloadMoriSprites()
      }
      if (!reach) return stop(true)
      const goal = { x: center.x + (MORI_FOOT.x - reach.hand.x) * scale, y: center.y + (MORI_FOOT.y - reach.hand.y) * scale }
      if (start === undefined) {
        start = now
        duration = Math.min(920, Math.max(360, Math.hypot(goal.x - base.x, goal.y - base.y) * 1.4))
      }
      if (now - start < duration) walk(base, goal, now - start, scale, 'travel')
      else {
        arrivalStart ??= now
        if (tab !== target) {
          clearTab()
          tab = target
          tab.setAttribute('data-mori-tap-target', '')
        }
        paint('arrival', base, goal, scale)
        if (now - arrivalStart >= arrivalMs) {
          clearTab()
          character.dataset.navigationStage = 'return'
          returnStart = now
          duration = Math.min(540, Math.max(250, Math.hypot(goal.x - base.x, goal.y - base.y) * 1.1))
          blend = 0
          arrive(true)
        }
      }
    }
    frame = requestAnimationFrame(tick)
  }

  if (signal.aborted) cancel()
  else {
    signal.addEventListener('abort', cancel, { once: true })
    preference?.addEventListener('change', reduce)
    document.addEventListener('visibilitychange', hide)
    frame = requestAnimationFrame(tick)
  }
  return { arrived, cancel }
}
