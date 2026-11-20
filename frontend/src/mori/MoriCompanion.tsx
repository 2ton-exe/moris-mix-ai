import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { useLocation } from 'react-router'
import { z } from 'zod'
import { Mori, type MoriMood } from '../journal/Mori'
import { mittAnchor, registerTurnCompanion, smooth } from '../journal/pageTurnMotion'
import { useJournalMedia } from '../journal/useJournalMedia'
import { MoriChatPanel } from './MoriChatPanel'
import { useMoriCompanionState } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'
import './mori-companion.css'

const navigationTapSize = 48
const navigationTapArm = -58
const navigationTapStyle: CSSProperties & { '--mori-navigation-arm': string } = { '--mori-navigation-arm': `${navigationTapArm}deg` }
const storageKey = 'moris-mix:mori-companion'
const preferencesSchema = z.object({
  hidden: z.boolean().default(false),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
})
type Position = { x: number; y: number }
function readPreferences() {
  try { return preferencesSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) }
  catch { return { hidden: false, position: null } }
}
const moods: Record<MoriActivity['kind'], MoriMood> = { idle: 'happy', curious: 'think', working: 'stir', thinking: 'think', celebrating: 'cheer', confused: 'worried', attention: 'wave' }
function readViewport() {
  const visual = window.visualViewport
  return { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight }
}

function companionPage(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/app/chef') return { area: 'chef', label: 'AI Chef', message: 'I’m on pantry duty. Add a few ingredients and I’ll help you find an idea.' }
  if (path === '/app/chef/review') return { area: 'chef', label: 'Recipe review', message: 'Your recipe idea is ready. Make it yours before you save it.' }
  if (path === '/app/quick-entry') return { area: 'notes', label: 'Cooking notes', message: 'Share your rough notes here; I’ll shape them into an editable recipe draft.' }
  if (path === '/app/quick-entry/review') return { area: 'notes', label: 'Recipe review', message: 'Your recipe draft is ready for you to edit and review.' }
  if (path === '/app' || path === '/app/recipes') return { area: 'recipes', label: 'My recipes', message: 'Your recipe collection is open. Choose a scrap to revisit it.' }
  if (path === '/app/recipes/new') return { area: 'editor', label: 'New recipe', message: 'Start a fresh scrap. I’m here if you need a hand.' }
  if (/^\/app\/recipes\/[^/]+\/edit$/.test(path)) return { area: 'editor', label: 'Recipe editor', message: 'You’re editing a recipe. I’m here if you need a hand.' }
  if (/^\/app\/recipes\/[^/]+$/.test(path)) return { area: 'reading', label: 'Recipe details', message: 'This recipe is open. I’m here if you need a hand.' }
  return { area: 'journal', label: 'Your journal', message: 'I’m here if you need a hand with your recipes.' }
}

export function MoriCompanion({ userId }: { userId?: string } = {}) {
  const { activity, guidance } = useMoriCompanionState()
  const location = useLocation()
  const [preferences, setPreferences] = useState(readPreferences)
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [pageTurn, setPageTurn] = useState(false)
  const [viewport, setViewport] = useState(readViewport)
  const [bubbleHeight, setBubbleHeight] = useState(260)
  const mobile = useJournalMedia('(max-width: 600px)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const character = useRef<HTMLDivElement>(null)
  const navigationTap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const showButton = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const focusAfterVisibilityChange = useRef(false)
  const headingId = useId()
  const panelId = useId()
  const moveHintId = useId()
  const size = mobile ? 72 : 96
  const width = size + 20
  const height = size * 1.2 + 64
  const left = viewport.left + 8
  const top = viewport.top + 8
  const right = viewport.left + viewport.width - 8
  const bottom = viewport.top + viewport.height - 8
  const clamp = useCallback((position: Position): Position => ({
    x: Math.max(left, Math.min(position.x, right - width)),
    y: Math.max(top, Math.min(position.y, bottom - height)),
  }), [left, right, width, top, bottom, height])
  const position = clamp(preferences.position ?? { x: mobile ? left + 12 : right - width - 12, y: bottom - height - 12 })
  const actual = mobile ? { ...position, x: position.x < viewport.left + viewport.width / 2 ? left : Math.max(left, right - width) } : position
  const page = companionPage(location.pathname)
  const pageGuidance = page.area === 'recipes' || page.area === 'chef' ? guidance : null
  const companionMessage = activity.kind === 'idle' ? pageGuidance?.message ?? page.message : activity.message

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* Storage may be unavailable in private browsing. */ }
  }, [preferences])
  useEffect(() => {
    const resize = () => setViewport(readViewport())
    const visual = window.visualViewport
    window.addEventListener('resize', resize)
    visual?.addEventListener('resize', resize)
    visual?.addEventListener('scroll', resize)
    return () => { window.removeEventListener('resize', resize); visual?.removeEventListener('resize', resize); visual?.removeEventListener('scroll', resize) }
  }, [])
  const keepOpen = typeof location.state === 'object' && location.state !== null && 'moriKeepOpen' in location.state && location.state.moriKeepOpen === true
  useEffect(() => { if (keepOpen) setOpen(true); else setOpen(false) }, [location.pathname, keepOpen])
  useEffect(() => {
    const check = () => {
      setSuspended(Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')))
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'role'] })
    check()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const element = character.current
    const svg = trigger.current?.querySelector('svg')
    if (!element || !svg) return
    const arm = svg.querySelector('[data-mori-grip-arm]')
    const closed = svg.querySelector<SVGElement>('[data-mori-closed-mitt]')
    const openMitt = svg.querySelector<SVGElement>('[data-mori-open-mitt]')
    const neutralArm = arm?.getAttribute('transform')
    return registerTurnCompanion({
      start(direction, single) {
        element.dataset.turnDirection = direction
        svg.style.transform = 'none'
        const rect = element.getBoundingClientRect()
        const art = svg.getBoundingClientRect()
        const scale = art.width / 200
        const offset = { x: art.left - rect.left, y: art.top - rect.top }
        const mirror = !single && direction === 'backward'
        const turnScale = single ? .6 : 1
        setPageTurn(true)
        setOpen(false)
        return (frame, corner) => {
          const hand = mittAnchor(frame.armAngle)
          const target = { x: corner.x - (offset.x + (mirror ? 200 - hand.x : hand.x) * scale) * turnScale, y: corner.y - (offset.y + hand.y * scale) * turnScale }
          const blend = frame.progress < .18 ? smooth(frame.progress / .18) : 1 - smooth((frame.progress - .9) / .1)
          element.style.transform = `translate(${(target.x - rect.left) * blend}px, ${(target.y - rect.top) * blend}px) scale(${1 + (turnScale - 1) * blend})`
          svg.style.transform = mirror ? 'scaleX(-1)' : 'none'
          arm?.setAttribute('transform', `rotate(${frame.armAngle} 128 168)`)
          if (frame.attached) {
            const matrix = svg.getScreenCTM()
            if (matrix) {
              const rendered = new DOMPoint(hand.x, hand.y).matrixTransform(matrix)
              element.style.transform = `translate(${(target.x - rect.left) * blend + corner.x - rendered.x}px, ${(target.y - rect.top) * blend + corner.y - rendered.y}px) scale(${1 + (turnScale - 1) * blend})`
            }
          }
          if (closed) closed.style.opacity = String(frame.grip)
          if (openMitt) openMitt.style.opacity = String(1 - frame.grip)
          element.dataset.turnStage = frame.stage
        }
      },
      stop() {
        element.style.removeProperty('transform')
        svg.style.removeProperty('transform')
        if (neutralArm == null) arm?.removeAttribute('transform')
        else arm?.setAttribute('transform', neutralArm)
        closed?.style.removeProperty('opacity')
        openMitt?.style.removeProperty('opacity')
        delete element.dataset.turnDirection
        delete element.dataset.turnStage
        setPageTurn(false)
      },
    })
  }, [size])
  useLayoutEffect(() => { if (open) heading.current?.focus() }, [open])
  useLayoutEffect(() => {
    if (!focusAfterVisibilityChange.current) return
    focusAfterVisibilityChange.current = false
    if (preferences.hidden) showButton.current?.focus()
    else trigger.current?.focus()
  }, [preferences.hidden])
  const gap = 12
  const leftSpace = actual.x - left - gap
  const rightSpace = right - (actual.x + width) - gap
  const side = leftSpace >= rightSpace ? 'left' : 'right'
  const sideSpace = side === 'left' ? leftSpace : rightSpace
  const belowSpace = bottom - (actual.y + height) - gap
  const aboveSpace = actual.y - top - gap
  const placement = sideSpace >= Math.min(340, viewport.width - 16) ? side : belowSpace >= aboveSpace ? 'bottom' : 'top'
  const verticalSpace = placement === 'bottom' ? belowSpace : placement === 'top' ? aboveSpace : bottom - top
  const preferredWidth = userId && viewport.width >= 1100 ? 520 : 380
  const preferredHeight = userId && viewport.width >= 1100 ? 560 : 460
  const panelWidth = placement === 'left'
    ? Math.min(preferredWidth, viewport.width - 16, leftSpace)
    : placement === 'right'
      ? Math.min(preferredWidth, viewport.width - 16, rightSpace)
      : Math.min(preferredWidth, viewport.width - 16)
  const maxPanelHeight = Math.max(0, Math.min(preferredHeight, viewport.height - 16, verticalSpace))
  const measuredPanelHeight = userId ? maxPanelHeight : Math.min(bubbleHeight, maxPanelHeight)
  const mouthY = actual.y + size * 0.67
  const panelLeft = placement === 'left'
    ? actual.x - gap - panelWidth
    : placement === 'right'
      ? actual.x + width + gap
      : Math.max(left, Math.min(actual.x + width / 2 - panelWidth / 2, right - panelWidth))
  const panelTop = placement === 'left' || placement === 'right'
    ? Math.max(top, Math.min(mouthY - measuredPanelHeight / 2, bottom - measuredPanelHeight))
    : placement === 'top'
      ? Math.max(top, Math.min(actual.y - gap - measuredPanelHeight, bottom - measuredPanelHeight))
      : Math.max(top, Math.min(actual.y + height + gap, bottom - measuredPanelHeight))
  const availablePanelHeight = Math.max(0, Math.min(maxPanelHeight, bottom - panelTop))
  const visiblePanelHeight = userId ? availablePanelHeight : Math.min(bubbleHeight, availablePanelHeight)
  const tailOffset = placement === 'left' || placement === 'right'
    ? Math.max(14, Math.min(visiblePanelHeight - 14, mouthY - panelTop))
    : Math.max(20, Math.min(panelWidth - 20, actual.x + width / 2 - panelLeft))
  useLayoutEffect(() => {
    if (!open) return
    const height = bubble.current?.offsetHeight ?? 0
    if (height > 0 && Math.abs(height - bubbleHeight) > 1) setBubbleHeight(height)
  }, [open, pageTurn, panelWidth, availablePanelHeight, companionMessage, page.label, pageGuidance?.action?.label, bubbleHeight])

  async function playNavigationTap(findAnchor: () => HTMLElement | null, signal: AbortSignal) {
    if (document.hidden) return
    // Let the acknowledgment or the closing dialog paint before measuring the anchor.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    const anchor = findAnchor()
    const tap = navigationTap.current
    if (signal.aborted || !tap?.animate || !anchor?.isConnected || !anchor.getClientRects().length ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const rect = anchor.getBoundingClientRect()
    const currentViewport = readViewport()
    const distance = 14
    const availableRight = currentViewport.left + currentViewport.width - rect.right
    const fromRight = availableRight > rect.left - currentViewport.left
    const hand = mittAnchor(navigationTapArm)
    const scale = navigationTapSize / 200
    const x = fromRight ? rect.right - (200 - hand.x) * scale : rect.left - hand.x * scale
    const y = rect.top + rect.height / 2 - hand.y * scale
    tap.style.left = `${Math.max(currentViewport.left, Math.min(x, currentViewport.left + currentViewport.width - navigationTapSize))}px`
    tap.style.top = `${Math.max(currentViewport.top, Math.min(y, currentViewport.top + currentViewport.height - navigationTapSize * 1.2))}px`
    tap.dataset.side = fromRight ? 'right' : 'left'
    const approach = fromRight ? distance : -distance
    const motion = tap.animate([
      { transform: `translateX(${approach}px)`, opacity: 0, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      { transform: 'translateX(0)', opacity: 1, offset: .55 },
      { transform: 'translateX(0)', opacity: 1, offset: .72 },
      { transform: `translateX(${approach / 2}px)`, opacity: 0 },
    ], { duration: 260 })
    tap.hidden = false
    anchor.setAttribute('data-mori-tap-target', '')
    const stop = () => motion.cancel()
    signal.addEventListener('abort', stop, { once: true })
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduce = (event: MediaQueryListEvent) => { if (event.matches) stop() }
    preference.addEventListener('change', reduce)
    try { await motion.finished }
    catch { /* Cancellation releases the tap without requiring an animationend event. */ }
    finally {
      signal.removeEventListener('abort', stop)
      preference.removeEventListener('change', reduce)
      tap.hidden = true
      anchor.removeAttribute('data-mori-tap-target')
    }
  }

  function close() { setOpen(false); trigger.current?.focus() }
  function show() {
    focusAfterVisibilityChange.current = true
    setPreferences((previous) => ({ ...previous, hidden: false }))
  }
  function move(x: number, y: number, description?: string) {
    if (mobile && description && x !== actual.x) x = x < actual.x ? left : right - width
    setPreferences((previous) => ({ ...previous, position: clamp({ x, y }) }))
    if (description) setMoved(description)
  }
  function moveKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (pageTurn) return
    const directions: Record<string, [number, number, string]> = { ArrowLeft: [-16, 0, 'left'], ArrowRight: [16, 0, 'right'], ArrowUp: [0, -16, 'up'], ArrowDown: [0, 16, 'down'] }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    move(actual.x + direction[0], actual.y + direction[1], `Mori moved ${direction[2]}.`)
  }
  const characterStyle = {
    left: actual.x,
    top: actual.y,
    width,
  } as CSSProperties
  return <>
  <div className="mori-pet-root">
    <button ref={showButton} className="mori-pet-show" type="button" hidden={!preferences.hidden || suspended} inert={suspended} onClick={show}>Show Mori</button>
    <div hidden={preferences.hidden || suspended} inert={preferences.hidden || suspended}>
      <span className="mori-pet-sr" aria-live="polite">{moved}</span>
      <span id={moveHintId} className="mori-pet-sr">Drag Mori to move. When focused, use the arrow keys to reposition.</span>
      <div ref={character} className="mori-pet-character" role="group" aria-label="Mori companion" data-activity={activity.kind} style={characterStyle}>
        <button className="mori-pet-trigger" ref={trigger} type="button" aria-label="Talk to Mori" aria-describedby={moveHintId} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-controls={panelId} aria-expanded={open && !pageTurn} aria-disabled={pageTurn ? 'true' : undefined}
          onClick={(event) => {
            if (pageTurn) { event.preventDefault(); return }
            if (suppressClick.current) {
              suppressClick.current = false
              if (event.detail !== 0) { event.preventDefault(); return }
            }
            if (open) close()
            else setOpen(true)
          }}
          onKeyDown={moveKey}
          onPointerDown={(event) => {
            if (pageTurn || event.button !== 0 || !event.isPrimary) return
            drag.current = { pointerId: event.pointerId, x: event.clientX - actual.x, y: event.clientY - actual.y, startX: event.clientX, startY: event.clientY, moved: false }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const current = drag.current
            if (current?.pointerId !== event.pointerId) return
            if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return
            current.moved = true
            move(event.clientX - current.x, event.clientY - current.y)
          }}
          onPointerUp={(event) => {
            const current = drag.current
            if (current?.pointerId !== event.pointerId) return
            drag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            if (!current.moved) return
            suppressClick.current = true
            window.setTimeout(() => { suppressClick.current = false }, 0)
            setMoved('Mori moved to a new spot.')
          }}
          onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null }}
          onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null }}>
          <Mori size={size} mood={open ? 'talk' : moods[activity.kind]} animated={!reducedMotion} />
        </button>
      </div>
      <div ref={bubble} hidden={!open || pageTurn} className="mori-pet-bubble" data-placement={placement} style={{ left: panelLeft, top: panelTop, width: panelWidth }}>
        <span className="mori-pet-bubble-tail" style={placement === 'left' || placement === 'right' ? { top: tailOffset } : { left: tailOffset }} aria-hidden="true" />
        <section id={panelId} role="region" aria-labelledby={headingId} className="mori-pet-panel" data-chat={Boolean(userId)} style={{ maxHeight: availablePanelHeight }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
          <header><h2 ref={heading} id={headingId} tabIndex={-1}>Mori</h2><button className="mori-pet-close" type="button" onClick={close} aria-label="Close Mori"><X size={18} strokeWidth={2.2} aria-hidden="true" /></button></header>
          {!userId && <><p className="mori-pet-context">{page.label}</p>
          <p className="mori-pet-message">{companionMessage}</p></>}
          {userId && <MoriChatPanel key={userId} userId={userId} playNavigationTap={playNavigationTap} />}
          {!userId && activity.kind === 'idle' && pageGuidance?.action && <button className="button button-secondary" type="button" onClick={() => {
            pageGuidance.action?.onClick()
            if (!bubble.current?.contains(document.activeElement)) setOpen(false)
          }}>{pageGuidance.action.label}</button>}
        </section>
      </div>
    </div>
  </div>
  <div ref={navigationTap} className="mori-navigation-tap" hidden aria-hidden="true" style={navigationTapStyle}>
    <Mori mood="wave" size={navigationTapSize} />
  </div>
  </>
}
