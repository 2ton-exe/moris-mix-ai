import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { z } from 'zod'
import { Mori, type MoriMood } from '../journal/Mori'
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

export function MoriCompanion() {
  const { activity, guidance } = useMoriCompanionState()
  const [preferences, setPreferences] = useState(readPreferences)
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
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
  const height = size * 1.2 + 40
  const clamp = (position: Position): Position => ({
    x: Math.max(8, Math.min(position.x, Math.max(8, viewport.width - width - 8))),
    y: Math.max(8, Math.min(position.y, Math.max(8, viewport.height - height - 8))),
  })
  const position = clamp(preferences.position ?? { x: viewport.width - width - 20, y: viewport.height - height - 20 })
  const actual = mobile ? { ...position, x: position.x < viewport.width / 2 ? 8 : Math.max(8, viewport.width - width - 8) } : position
  const message = activity.kind === 'idle' ? guidance?.message ?? activity.message : activity.message

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* Storage may be unavailable in private browsing. */ }
  }, [preferences])
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize) }
  }, [])
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
    if (mobile && description && x !== actual.x) x = x < actual.x ? 8 : viewport.width - width - 8
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
  const panelLeft = Math.max(8, Math.min(actual.x - 220, viewport.width - Math.min(300, viewport.width - 16) - 8))
  const panelTop = Math.max(8, Math.min(actual.y - 340, viewport.height - 380))

  return <div className="mori-pet-root" inert={suspended} style={{ visibility: suspended ? 'hidden' : undefined }}>
    <span className="mori-pet-sr" aria-live="polite">{moved}</span>
    {preferences.hidden ? <button ref={show} className="mori-pet-show" type="button" onClick={() => {
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
      {open && <section id={panelId} role="region" aria-labelledby={headingId} className="mori-pet-panel" style={{ left: panelLeft, top: panelTop, maxHeight: Math.max(80, viewport.height - panelTop - 8) }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
        <header><h2 ref={heading} id={headingId} tabIndex={-1}>Mori</h2><button type="button" onClick={close} aria-label="Close Mori">×</button></header>
        <p>{message}</p>
        {activity.kind === 'idle' && guidance?.action && <button className="button button-secondary" type="button" onClick={() => { guidance.action?.onClick(); close() }}>{guidance.action.label}</button>}
        <nav aria-label="Cooking ideas"><Link to="/app/quick-entry" onClick={close}>Organize cooking notes</Link><Link to="/app/chef" onClick={close}>Find something to cook</Link></nav>
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
