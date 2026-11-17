import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { z } from 'zod'
import { Mori, type MoriMood } from '../journal/Mori'
import { journalReturnFromLocation } from '../journal/indexNavigation'
import { useJournalMedia } from '../journal/useJournalMedia'
import { useMoriCompanionState } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'
import './mori-companion.css'

const storageKey = 'moris-mix:mori-companion'
const preferencesSchema = z.object({ hidden: z.boolean(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable() })
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

export function MoriCompanion() {
  const { activity, guidance } = useMoriCompanionState()
  const location = useLocation()
  const [preferences, setPreferences] = useState(readPreferences)
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [viewport, setViewport] = useState(readViewport)
  const mobile = useJournalMedia('(max-width: 600px)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const show = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const headingId = useId()
  const panelId = useId()
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
  const position = clamp(preferences.position ?? { x: right - width - 12, y: tabletDock ? top : bottom - height - 12 })
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
    const check = () => setSuspended(Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')))
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'role'] })
    check()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => { if (open) heading.current?.focus() }, [open])

  function close() { setOpen(false); trigger.current?.focus() }
  function move(x: number, y: number, description?: string) {
    if (mobile && description && x !== actual.x) x = x < actual.x ? left : right - width
    setPreferences((previous) => ({ ...previous, position: clamp({ x, y }) }))
    if (description) setMoved(description)
  }
  function moveKey(event: KeyboardEvent<HTMLButtonElement>) {
    const directions: Record<string, [number, number, string]> = { ArrowLeft: [-16, 0, 'left'], ArrowRight: [16, 0, 'right'], ArrowUp: [0, -16, 'up'], ArrowDown: [0, 16, 'down'] }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    move(actual.x + direction[0], actual.y + direction[1], `Mori moved ${direction[2]}.`)
  }
  const panelWidth = Math.min(300, viewport.width - 16)
  const panelLeft = Math.max(left, Math.min(actual.x - 220, right - panelWidth))
  const roomAbove = actual.y - top - 8
  const roomBelow = bottom - actual.y - height - 8
  const panelTop = roomAbove >= 160 ? Math.max(top, actual.y - 448) : roomBelow >= 160 ? actual.y + height + 8 : top
  const panelHeight = roomAbove >= 160 ? actual.y - panelTop - 8 : bottom - panelTop

  return <div className="mori-pet-root" inert={suspended} style={{ visibility: suspended ? 'hidden' : undefined }}>
    <span className="mori-pet-sr" aria-live="polite">{moved}</span>
    {preferences.hidden ? <button ref={show} className="mori-pet-show" type="button" style={{ left: Math.max(left, right - 112), top: Math.max(top, bottom - 44), right: 'auto', bottom: 'auto' }} onClick={() => {
      setPreferences((previous) => ({ ...previous, hidden: false }))
      window.requestAnimationFrame(() => trigger.current?.focus())
    }}>Show Mori</button> : <>
      <div className="mori-pet-character" role="group" aria-label="Mori companion" data-activity={activity.kind} style={{ left: actual.x, top: actual.y, width }}>
        <button className="mori-pet-trigger" ref={trigger} type="button" aria-label="Talk to Mori" aria-controls={panelId} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
          <Mori size={size} mood={moods[activity.kind]} animated={!reducedMotion} />
          <span className="mori-pet-caption">{activity.kind === 'idle' ? 'Mori' : activity.kind === 'celebrating' ? 'Saved!' : activity.kind === 'attention' ? 'A little help?' : activity.kind === 'confused' ? 'Let’s try again' : activity.kind === 'curious' ? 'A closer look…' : 'Mixing ideas…'}</span>
        </button>
        <button className="mori-pet-grip" type="button" aria-label="Move Mori. Use arrow keys to reposition." onKeyDown={moveKey}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return
            drag.current = { pointerId: event.pointerId, x: event.clientX - actual.x, y: event.clientY - actual.y }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) move(event.clientX - drag.current.x, event.clientY - drag.current.y) }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; setMoved('Mori moved to a new spot.') }}
          onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>···</button>
      </div>
      {open && <section id={panelId} role="region" aria-labelledby={headingId} className="mori-pet-panel" style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: Math.max(0, panelHeight) }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
        <header><h2 ref={heading} id={headingId} tabIndex={-1}>Mori</h2><button type="button" onClick={close} aria-label="Close Mori">×</button></header>
        <p>{message}</p>
        {activity.kind === 'idle' && guidance?.action && <button className="button button-secondary" type="button" onClick={() => guidance.action?.onClick()}>{guidance.action.label}</button>}
        <nav aria-label="Cooking ideas"><Link to="/app/quick-entry" state={{ journalReturn: journalReturnFromLocation(location) }}>Organize cooking notes</Link><Link to="/app/chef">Find something to cook</Link></nav>
        <details><summary>Move Mori</summary><p>Drag the dotted handle, or focus it and use arrow keys. You can also use these buttons.</p>
          <div className="mori-pet-directions">{([['left', -32, 0], ['right', 32, 0], ['up', 0, -32], ['down', 0, 32]] satisfies [string, number, number][]).map(([name, x, y]) => <button type="button" key={name} onClick={() => move(actual.x + x, actual.y + y, `Mori moved ${name}.`)}>Move {name}</button>)}</div>
        </details>
        <footer><button type="button" onClick={() => { setPreferences((previous) => ({ ...previous, position: null })); setMoved('Mori returned to the starting position.') }}>Reset position</button><button type="button" onClick={() => {
          setOpen(false); setPreferences((previous) => ({ ...previous, hidden: true })); window.requestAnimationFrame(() => show.current?.focus())
        }}>Hide Mori</button></footer>
      </section>}
    </>}
  </div>
}
