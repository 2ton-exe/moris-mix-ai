import { mittAnchor, smooth } from '../journal/pageTurnMotion'

const travelMs = 360
const arrivalMs = 120
const returnMs = 260
const arrivalArm = -58

type Position = { x: number; y: number }

export function travelToJournalTab(character: HTMLElement, art: SVGSVGElement, findTab: () => HTMLElement | null, signal: AbortSignal, onSettled: () => void) {
  const initialBounds = character.getBoundingClientRect()
  let origin = initialBounds.width ? initialBounds : undefined
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0
  let started: number | undefined
  let waitingForCharacter = true
  let landing: Position | undefined
  let tab: HTMLElement | null = null
  let stopped = false
  let arrive: (continueNavigation: boolean) => void = () => {}
  const arrived = new Promise<boolean>((resolve) => { arrive = resolve })

  function stop(continueNavigation = false) {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    preference.removeEventListener('change', reduce)
    document.removeEventListener('visibilitychange', hide)
    signal.removeEventListener('abort', cancel)
    delete character.dataset.navigationStage
    delete character.dataset.navigationDirection
    character.style.removeProperty('transform')
    character.style.removeProperty('--mori-travel-arm')
    tab?.removeAttribute('data-mori-tap-target')
    onSettled()
    arrive(continueNavigation)
  }

  function cancel() { stop() }
  function reduce() { if (preference.matches) stop(true) }
  function hide() { if (document.hidden) stop(true) }

  function pose(base: Position, point: Position, faceLeft: boolean, armAngle: number) {
    character.dataset.navigationDirection = faceLeft ? 'left' : 'right'
    character.style.setProperty('--mori-travel-arm', `${armAngle}deg`)
    character.style.transform = `translate(${point.x - base.x}px, ${point.y - base.y}px)`
  }

  function tick(now: number) {
    started ??= now
    const elapsed = now - started
    const base = { x: Number.parseFloat(character.style.left), y: Number.parseFloat(character.style.top) }
    if (landing) {
      const progress = (elapsed - travelMs - arrivalMs) / returnMs
      if (progress >= 1) return stop()
      const blend = smooth(progress)
      pose(base, { x: landing.x + (base.x - landing.x) * blend, y: landing.y + (base.y - landing.y) * blend }, base.x < landing.x, arrivalArm * (1 - blend))
    } else {
      const target = findTab()
      const bounds = target?.getBoundingClientRect()
      const characterBounds = character.getBoundingClientRect()
      const artBounds = art.getBoundingClientRect()
      if (!target || !bounds?.width || !bounds.height || getComputedStyle(target).visibility !== 'visible') return stop(true)
      if (!artBounds.width && waitingForCharacter) {
        // The discard dialog can close a frame before the companion is visible again.
        waitingForCharacter = false
        started = undefined
        frame = requestAnimationFrame(tick)
        return
      }
      if (!artBounds.width) return stop(true)
      waitingForCharacter = false
      origin ??= characterBounds
      const viewport = window.visualViewport
      const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      if (center.x < left || center.x > left + (viewport?.width ?? innerWidth) ||
        center.y < top || center.y > top + (viewport?.height ?? innerHeight)) return stop(true)
      if (tab !== target) {
        tab?.removeAttribute('data-mori-tap-target')
        tab = target
        tab.setAttribute('data-mori-tap-target', '')
      }

      const faceLeft = center.x < origin.left + origin.width / 2
      const hand = mittAnchor(arrivalArm)
      const goal = {
        x: center.x - (artBounds.left - characterBounds.left) - (faceLeft ? 200 - hand.x : hand.x) * artBounds.width / 200,
        y: center.y - (artBounds.top - characterBounds.top) - hand.y * artBounds.height / 240,
      }
      const progress = Math.min(elapsed / travelMs, 1)
      const blend = smooth(progress)
      character.dataset.navigationStage = progress < 1 ? 'travel' : 'arrival'
      pose(base, {
        x: origin.left + (goal.x - origin.left) * blend,
        y: origin.top + (goal.y - origin.top) * blend - 8 * Math.sin(progress * Math.PI),
      }, faceLeft, arrivalArm * smooth((progress - .75) / .25))
      if (elapsed >= travelMs + arrivalMs) {
        landing = goal
        character.dataset.navigationStage = 'return'
        tab.removeAttribute('data-mori-tap-target')
        tab = null
        arrive(true)
      }
    }
    frame = requestAnimationFrame(tick)
  }

  if (signal.aborted) cancel()
  else if (preference.matches || document.hidden) stop(true)
  else {
    signal.addEventListener('abort', cancel, { once: true })
    preference.addEventListener('change', reduce)
    document.addEventListener('visibilitychange', hide)
    frame = requestAnimationFrame(tick)
  }
  return { arrived, cancel }
}
