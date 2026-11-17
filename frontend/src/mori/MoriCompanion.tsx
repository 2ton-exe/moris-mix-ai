import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { z } from 'zod'
import { Mori, type MoriMood } from '../journal/Mori'
import { journalReturnFromLocation } from '../journal/indexNavigation'
import { useJournalMedia } from '../journal/useJournalMedia'
import { useMoriCompanionState } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'
import './mori-companion.css'

const storageKey = 'moris-mix:mori-companion'
const preferencesSchema = z.object({ position: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable() })
type Position = { x: number; y: number }
type PageTurn = { direction: 'forward' | 'backward'; distance: number; duration: number; signature: string }
function readPreferences() {
  try { return preferencesSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) }
  catch { return { position: null } }
}
const moods: Record<MoriActivity['kind'], MoriMood> = { idle: 'happy', curious: 'think', working: 'stir', thinking: 'think', celebrating: 'cheer', confused: 'worried', attention: 'wave' }
function readViewport() {
  const visual = window.visualViewport
  return { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight }
}

export function MoriCompanion() {
  const { activity, guidance } = useMoriCompanionState()
  const location = useLocation()
  const [preferences, setPreferences] = useState(readPreferences)
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [pageTurn, setPageTurn] = useState<PageTurn | null>(null)
  const [viewport, setViewport] = useState(readViewport)
  const [bubbleHeight, setBubbleHeight] = useState(260)
  const mobile = useJournalMedia('(max-width: 600px)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const headingId = useId()
  const panelId = useId()
  const moveHintId = useId()
  const size = mobile ? 72 : 96
  const width = size + 20
  const height = size * 1.2 + 64
  const tabletDock = useJournalMedia('(min-width: 601px) and (max-width: 760px)')
  const left = viewport.left + 8
  const top = viewport.top + 8
  const right = viewport.left + viewport.width - 8
  const bottom = viewport.top + viewport.height - 8
  const clamp = (position: Position): Position => ({
    x: Math.max(left, Math.min(position.x, right - width)),
    y: Math.max(top, Math.min(position.y, bottom - height)),
  })
  const position = clamp(preferences.position ?? { x: mobile ? left + 12 : right - width - 12, y: tabletDock ? top : bottom - height - 12 })
  const actual = mobile ? { ...position, x: position.x < viewport.left + viewport.width / 2 ? left : Math.max(left, right - width) } : position
  const message = activity.kind === 'idle' ? guidance?.message ?? activity.message : activity.message

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
  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    const check = () => {
      setSuspended(Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')))
      const layer = document.querySelector<HTMLElement>('[data-journal-page-turn][data-direction]')
      const book = layer?.closest<HTMLElement>('.mm-journal-book')
      const direction = layer?.dataset.direction
      if (!layer || !book || (direction !== 'forward' && direction !== 'backward')) {
        setPageTurn((current) => current ? null : current)
        return
      }
      const signature = `${direction}:${layer.dataset.layout}:${layer.dataset.duration}`
      const rect = book.getBoundingClientRect()
      const targetX = rect.left + rect.width * (actual.x + width / 2 < rect.left + rect.width / 2 ? 0.78 : 0.22) - width / 2
      const distance = Math.max(left, Math.min(targetX, right - width)) - actual.x
      setPageTurn((current) => current?.signature === signature ? current : {
        direction,
        distance,
        duration: Number(layer.dataset.duration) || 620,
        signature,
      })
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'role'] })
    check()
    return () => observer.disconnect()
  }, [actual.x, left, right, width])
  useLayoutEffect(() => { if (open) heading.current?.focus() }, [open])
  const gap = 12
  const leftSpace = actual.x - left - gap
  const rightSpace = right - (actual.x + width) - gap
  const side = leftSpace >= rightSpace ? 'left' : 'right'
  const sideSpace = side === 'left' ? leftSpace : rightSpace
  const belowSpace = bottom - (actual.y + height) - gap
  const aboveSpace = actual.y - top - gap
  const placement = sideSpace >= 160 ? side : belowSpace >= aboveSpace ? 'bottom' : 'top'
  const verticalSpace = placement === 'bottom' ? belowSpace : placement === 'top' ? aboveSpace : bottom - top
  const panelWidth = placement === 'left'
    ? Math.min(300, viewport.width - 16, leftSpace)
    : placement === 'right'
      ? Math.min(300, viewport.width - 16, rightSpace)
      : Math.min(300, viewport.width - 16)
  const maxPanelHeight = Math.max(0, Math.min(360, viewport.height - 16, verticalSpace))
  const measuredPanelHeight = Math.min(bubbleHeight, maxPanelHeight)
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
  const visiblePanelHeight = Math.min(bubbleHeight, availablePanelHeight)
  const tailOffset = placement === 'left' || placement === 'right'
    ? Math.max(14, Math.min(visiblePanelHeight - 14, mouthY - panelTop))
    : Math.max(20, Math.min(panelWidth - 20, actual.x + width / 2 - panelLeft))
  useLayoutEffect(() => {
    if (!open) return
    const height = bubble.current?.offsetHeight ?? 0
    if (height > 0 && Math.abs(height - bubbleHeight) > 1) setBubbleHeight(height)
  }, [open, pageTurn, panelWidth, availablePanelHeight, message, guidance?.message, guidance?.action?.label, bubbleHeight])

  function close() { setOpen(false); trigger.current?.focus() }
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
    ...(pageTurn ? { '--mori-turn-distance': `${pageTurn.distance}px`, '--mori-turn-duration': `${pageTurn.duration}ms` } : {}),
  } as CSSProperties
  return <div className="mori-pet-root" inert={suspended} style={{ visibility: suspended ? 'hidden' : undefined }}>
    <span className="mori-pet-sr" aria-live="polite">{moved}</span>
    <span id={moveHintId} className="mori-pet-sr">Drag Mori to move. When focused, use the arrow keys to reposition.</span>
    <div className="mori-pet-character" role="group" aria-label="Mori companion" data-activity={activity.kind} data-turn-direction={pageTurn?.direction} style={characterStyle}>
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
        <Mori size={size} mood={pageTurn ? 'turn' : open ? 'talk' : moods[activity.kind]} animated={!reducedMotion} />
        <span className="mori-pet-caption">{activity.kind === 'idle' ? 'Mori' : activity.kind === 'celebrating' ? 'Saved!' : activity.kind === 'attention' ? 'A little help?' : activity.kind === 'confused' ? 'Let’s try again' : activity.kind === 'curious' ? 'A closer look…' : 'Mixing ideas…'}</span>
      </button>
    </div>
    {open && !pageTurn && <div ref={bubble} className="mori-pet-bubble" data-placement={placement} style={{ left: panelLeft, top: panelTop, width: panelWidth }}>
      <span className="mori-pet-bubble-tail" style={placement === 'left' || placement === 'right' ? { top: tailOffset } : { left: tailOffset }} aria-hidden="true" />
      <section id={panelId} role="region" aria-labelledby={headingId} className="mori-pet-panel" style={{ maxHeight: availablePanelHeight }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
        <header><h2 ref={heading} id={headingId} tabIndex={-1}>Mori</h2><button className="mori-pet-close" type="button" onClick={close} aria-label="Close Mori"><X size={18} strokeWidth={2.2} aria-hidden="true" /></button></header>
        <p>{message}</p>
        {activity.kind === 'idle' && guidance?.action && <button className="button button-secondary" type="button" onClick={() => guidance.action?.onClick()}>{guidance.action.label}</button>}
        <nav aria-label="Cooking ideas"><Link to="/app/quick-entry" state={{ journalReturn: journalReturnFromLocation(location) }}>Organize cooking notes</Link><Link to="/app/chef">Find something to cook</Link></nav>
      </section>
    </div>}
  </div>
}
