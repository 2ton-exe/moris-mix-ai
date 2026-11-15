import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { Mori } from './Mori'
import { MoriDialogue } from './MoriDialogue'
import type { MoriDialogueChoice, MoriDialogueLine } from './MoriDialogue'
import { journalReturnFromLocation } from './indexNavigation'

const talkLines: readonly MoriDialogueLine[] = [{
  id: 'feature-selection',
  speaker: 'Mori',
  text: 'What are we cooking today?',
  expression: 'wave',
  choices: [
    { id: 'quick-entry', label: 'Organize cooking notes' },
    { id: 'ai-chef', label: 'Find something to cook' },
  ],
}]

const edge = 12
// Route changes can remount the desk within the same tab.
let deskPosition = { right: edge, bottom: edge }

export function MoriAssistant() {
  const location = useLocation()
  const navigate = useNavigate()
  const dialogueId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const assistantRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; right: number; bottom: number } | null>(null)
  const dragged = useRef(false)
  const [announcement, setAnnouncement] = useState('')
  const [open, setOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [position, setPosition] = useState(deskPosition)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const activeFeature = /^\/app\/(?:quick-entry|chef)(?:\/|$)/.test(location.pathname)

  function close() {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  function chooseFeature(choice: MoriDialogueChoice) {
    close()
    if (choice.id === 'quick-entry') {
      navigate('/app/quick-entry', { state: { journalReturn: journalReturnFromLocation(location) } })
    } else if (choice.id === 'ai-chef') {
      navigate('/app/chef')
    }
  }

  function move(right: number, bottom: number) {
    deskPosition = { right, bottom }
    setPosition(deskPosition)
  }

  function moveWithinViewport(right: number, bottom: number, bounds: DOMRect) {
    move(
      Math.max(edge, Math.min(right, window.innerWidth - bounds.width - edge)),
      Math.max(edge, Math.min(bottom, window.innerHeight - bounds.height - edge)),
    )
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    const bounds = assistantRef.current?.getBoundingClientRect()
    if (!bounds || !event.isPrimary || event.button !== 0) return
    dragged.current = false
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, right: window.innerWidth - bounds.right, bottom: window.innerHeight - bounds.bottom }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    const bounds = assistantRef.current?.getBoundingClientRect()
    if (!bounds || start?.id !== event.pointerId) return
    const dx = start.x - event.clientX
    const dy = start.y - event.clientY
    if (!dragged.current && Math.hypot(dx, dy) < 4) return
    dragged.current = true
    setMoving(true)
    moveWithinViewport(start.right + dx, start.bottom + dy, bounds)
  }

  function moveWithKeys(event: KeyboardEvent<HTMLButtonElement>) {
    const bounds = assistantRef.current?.getBoundingClientRect()
    if (!bounds) return
    const right = window.innerWidth - bounds.right
    const bottom = window.innerHeight - bounds.bottom
    switch (event.key) {
      case 'ArrowLeft': moveWithinViewport(right + 24, bottom, bounds); break
      case 'ArrowRight': moveWithinViewport(right - 24, bottom, bounds); break
      case 'ArrowUp': moveWithinViewport(right, bottom + 24, bounds); break
      case 'ArrowDown': moveWithinViewport(right, bottom - 24, bounds); break
      default: return
    }
    event.preventDefault()
    announcePosition(bounds)
  }

  function announcePosition(bounds: DOMRect) {
    const vertical = deskPosition.bottom > (window.innerHeight - bounds.height) / 2 ? 'upper' : 'lower'
    const horizontal = deskPosition.right > (window.innerWidth - bounds.width) / 2 ? 'left' : 'right'
    setAnnouncement(`Mori moved to the ${vertical} ${horizontal}.`)
  }

  function dock() {
    const bounds = assistantRef.current?.getBoundingClientRect()
    if (!bounds) return
    const inDefaultCorner = deskPosition.right === edge && deskPosition.bottom === edge
    moveWithinViewport(inDefaultCorner ? window.innerWidth - bounds.width - edge : edge, edge, bounds)
    announcePosition(bounds)
  }

  return <div
    ref={assistantRef}
    className="mm-mori-assistant"
    data-panel-below={position.bottom > (viewportHeight - 44) / 2 || undefined}
    style={{ '--mori-right': `${position.right}px`, '--mori-bottom': `${position.bottom}px` } as CSSProperties}
    onKeyDown={(event) => {
      if (open && event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }}
  >
    <button ref={triggerRef} className="button button-secondary mm-mori-assistant__trigger" type="button"
      aria-current={activeFeature ? 'page' : undefined} aria-expanded={open} aria-controls={open ? dialogueId : undefined}
      onClick={() => { if (open) close(); else setOpen(true) }}>
      <Mori mood={open ? 'happy' : 'wave'} size={36} />
      <span>Talk to Mori</span>
    </button>
    {open && <div className="mm-mori-assistant__panel">
      <MoriDialogue id={dialogueId} lines={talkLines} showContinue={false} typewriter={false} eyebrow=""
        closeLabel="Close Mori" onChoice={chooseFeature} onClose={close} />
    </div>}
    <button className="button button-secondary mm-mori-assistant__grip" type="button"
      aria-label="Move Mori with arrow keys. Activate to dock Mori in a corner."
      data-moving={moving || undefined}
      onPointerDown={startDrag} onPointerMove={moveDrag}
      onLostPointerCapture={() => {
        drag.current = null
        setMoving(false)
        const bounds = assistantRef.current?.getBoundingClientRect()
        if (dragged.current && bounds) announcePosition(bounds)
      }}
      onKeyDown={moveWithKeys} onClick={(event) => { if (event.detail === 0 || !dragged.current) dock() }}>
      <GripVertical size={16} aria-hidden="true" />
    </button>
    <span className="visually-hidden" aria-live="polite">{announcement}</span>
  </div>
}
