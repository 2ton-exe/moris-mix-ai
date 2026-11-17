import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUp, MoreHorizontal, X } from 'lucide-react'
import { useLocation } from 'react-router'
import { z } from 'zod'
import { AuthContext } from '../auth/context'
import { HttpError } from '../api/http'
import { Mori, type MoriMood } from '../journal/Mori'
import { useJournalMedia } from '../journal/useJournalMedia'
import { useMoriActivity, useMoriCompanionState } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'
import { sendMoriChat } from './chatApi'
import type { MoriChatPage, MoriChatTurn } from './chatApi'
import './mori-companion.css'

const preferencesSchema = z.object({
  hidden: z.boolean(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
})
const greeting = 'What are we cooking today?'
const starters = [
  { label: 'Find a dinner idea', prompt: 'Suggest something I can cook with ingredients I have.' },
  { label: 'Find one of my recipes', prompt: 'Find one of my saved recipes for tonight.' },
  { label: 'Help with ingredients', prompt: 'Help me cook with an ingredient I have.' },
] as const

type Position = { x: number; y: number }
type Viewport = { left: number; top: number; width: number; height: number }
type ChatPlacement = 'mobile' | 'above' | 'below' | 'left' | 'right' | 'sidecar-left' | 'sidecar-right' | 'sidecar-short'
type ChatLayout = { placement: ChatPlacement; left: number }
type ChatBounds = { left: number; top: number; right: number; bottom: number }
type Message = MoriChatTurn & { id: number }
type ChatStatus = 'idle' | 'thinking' | 'responding' | 'error'
type DragState = { pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean }

function storageKey(userId: string) { return `moris-mix:mori-companion:${userId}` }

function readPreferences(userId: string) {
  try {
    return preferencesSchema.parse(JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null'))
  } catch {
    return { hidden: false, position: null }
  }
}

function readViewport(): Viewport {
  const visual = window.visualViewport
  return { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight }
}

function clampRect(rect: Position, width: number, height: number, bounds: ChatBounds): Position {
  return {
    x: Math.max(bounds.left, Math.min(rect.x, bounds.right - width)),
    y: Math.max(bounds.top, Math.min(rect.y, bounds.bottom - height)),
  }
}

function overlapArea(a: Position & { width: number; height: number }, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): number {
  return Math.max(0, Math.min(a.x + a.width, b.right) - Math.max(a.x, b.left)) *
    Math.max(0, Math.min(a.y + a.height, b.bottom) - Math.max(a.y, b.top))
}

function findChatLayout({
  position,
  companionWidth,
  companionHeight,
  panelWidth,
  maxPanelHeight,
  bounds,
  obstacles,
  book,
}: {
  position: Position
  companionWidth: number
  companionHeight: number
  panelWidth: number
  maxPanelHeight: number
  bounds: ChatBounds
  obstacles: HTMLElement[]
  book?: DOMRect
}): ChatLayout {
  const centerX = position.x + companionWidth / 2 - panelWidth / 2
  const centerY = position.y + companionHeight / 2 - maxPanelHeight / 2
  const candidates: Array<{ placement: Exclude<ChatPlacement, 'mobile'>; position: Position }> = []
  const addIfVisible = (placement: Exclude<ChatPlacement, 'mobile'>, raw: Position) => {
    const clipped = clampRect(raw, panelWidth, maxPanelHeight, bounds)
    const rect = { ...clipped, width: panelWidth, height: maxPanelHeight }
    const companion = { left: position.x, right: position.x + companionWidth, top: position.y, bottom: position.y + companionHeight }
    if (overlapArea(rect, companion) === 0) {
      candidates.push({ placement, position: clipped })
    }
  }

  const above = position.y - maxPanelHeight - 12
  const below = position.y + companionHeight + 12
  if (above >= bounds.top) addIfVisible('above', { x: centerX, y: above })
  if (below + maxPanelHeight <= bounds.bottom) addIfVisible('below', { x: centerX, y: below })
  if (position.x - panelWidth - 12 >= bounds.left) addIfVisible('left', { x: position.x - panelWidth - 12, y: centerY })
  if (position.x + companionWidth + 12 + panelWidth <= bounds.right) addIfVisible('right', { x: position.x + companionWidth + 12, y: centerY })

  if (book && bounds.right - book.right >= panelWidth + 12) {
    addIfVisible('sidecar-right', { x: book.right + 12, y: centerY })
  }
  if (book && book.left - bounds.left >= panelWidth + 12) {
    addIfVisible('sidecar-left', { x: book.left - panelWidth - 12, y: centerY })
  }
  if (candidates.length === 0) {
    candidates.push({ placement: 'above', position: clampRect({ x: centerX, y: bounds.top }, panelWidth, maxPanelHeight, bounds) })
  }

  const score = (candidate: typeof candidates[number]) => {
    const rect = { ...candidate.position, width: panelWidth, height: maxPanelHeight }
    return obstacles.reduce((total, element) => {
      const obstacle = element.getBoundingClientRect()
      if (obstacle.width <= 0 || obstacle.height <= 0) return total
      const area = overlapArea(rect, obstacle)
      const weight = element.matches('.mm-desk-toolbar, .mm-collection-tools, .discovery-controls, .mm-page-turns') ? 8 : 2
      return total + area / Math.max(1, panelWidth * maxPanelHeight) * weight
    }, 0)
  }
  const selected = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best)
  return { placement: selected.placement, left: selected.position.x }
}

function pageContext(pathname: string): { page: MoriChatPage; recipeId?: string } {
  const recipe = /^\/app\/recipes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(pathname)
  if (recipe) return { page: 'recipe', recipeId: recipe[1] }
  if (/^\/app\/recipes\/new\/?$/i.test(pathname)) return { page: 'new-recipe' }
  if (/^\/app\/quick-entry(?:\/|$)/.test(pathname)) return { page: 'quick-entry' }
  if (/^\/app\/chef(?:\/|$)/.test(pathname)) return { page: 'chef' }
  if (pathname === '/app' || /^\/app\/recipes\/?$/.test(pathname)) return { page: 'recipes' }
  return { page: 'other' }
}

function chatErrorMessage(error: unknown) {
  if (error instanceof HttpError && error.status === 429) return "We've reached today's AI limit. Try again after it resets."
  if (error instanceof HttpError && error.status === 503) return "Mori's kitchen is unavailable right now. Please try again shortly."
  if (error instanceof HttpError && error.status === 422) return 'That conversation has too much context. Try a shorter question.'
  return "I couldn't get a reply just now. Check your connection and try again."
}

const moods: Record<MoriActivity['kind'], MoriMood> = {
  idle: 'happy', hover: 'wave', dragging: 'happy', curious: 'think', working: 'stir',
  thinking: 'think', responding: 'wave', celebrating: 'cheer', confused: 'worried', attention: 'wave',
}

export function MoriCompanion() {
  const user = useContext(AuthContext)?.user
  const userId = user?.id
  const { activity } = useMoriCompanionState()
  const location = useLocation()
  const [preferences, setPreferences] = useState(() => userId ? readPreferences(userId) : { hidden: false, position: null })
  const preferencesOwner = useRef(userId)
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatLayout, setChatLayout] = useState<ChatLayout>({ placement: 'above', left: 0 })
  const [chatHeight, setChatHeight] = useState(0)
  const [protectedTop, setProtectedTop] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [viewport, setViewport] = useState(readViewport)
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'assistant', content: greeting }])
  const [draft, setDraft] = useState('')
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle')
  const [chatError, setChatError] = useState<string | null>(null)
  const mobile = useJournalMedia('(max-width: 600px)')
  const tabletDock = useJournalMedia('(min-width: 601px) and (max-width: 760px)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const trigger = useRef<HTMLButtonElement>(null)
  const show = useRef<HTMLButtonElement>(null)
  const settingsToggle = useRef<HTMLButtonElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const hideAction = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const drag = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  const restoreTriggerFocus = useRef(false)
  const restoreSettingsFocus = useRef(false)
  const requestController = useRef<AbortController | null>(null)
  const previousPathname = useRef(location.pathname)
  const messageId = useRef(0)
  const headingId = useId()
  const panelId = useId()
  const composerId = useId()
  const instructionsId = useId()
  const settingsId = useId()
  const size = mobile ? 72 : 96
  const width = size + 20
  const height = size + 8
  const left = viewport.left + 8
  const top = viewport.top + 8
  const right = viewport.left + viewport.width - 8
  const bottom = viewport.top + viewport.height - 8
  const shortViewport = viewport.height <= 520
  const chatSafeTop = shortViewport ? Math.min(bottom, Math.max(top, protectedTop + 12)) : top
  const clamp = useCallback(({ x, y }: Position): Position => ({
    x: Math.max(left, Math.min(x, Math.max(left, right - width))),
    y: Math.max(top, Math.min(y, Math.max(top, bottom - height))),
  }), [left, top, right, bottom, width, height])
  const position = useMemo(() => clamp(preferences.position ?? {
    x: mobile ? left + 12 : right - width - 12,
    y: tabletDock ? top : Math.max(top, bottom - height - 12),
  }), [clamp, preferences.position, mobile, left, right, width, tabletDock, top, bottom, height])
  const panelWidth = Math.max(0, Math.min(mobile ? 520 : 360, viewport.width - 16))
  const viewportPanelMaxHeight = mobile
    ? Math.max(0, Math.min(560, viewport.height * 0.72, viewport.height - 16))
    : Math.max(0, Math.min(480, viewport.height * 0.8, viewport.height - 16))
  const panelMaxHeight = shortViewport
    ? Math.min(viewportPanelMaxHeight, Math.max(0, bottom - chatSafeTop))
    : viewportPanelMaxHeight
  const panelHeight = Math.min(chatHeight || Math.min(panelMaxHeight, 260), panelMaxHeight)
  const panelLeft = mobile ? viewport.left + (viewport.width - panelWidth) / 2 : chatLayout.left
  const panelTop = mobile
    ? Math.max(top, bottom - panelHeight - 8)
    : chatLayout.placement === 'sidecar-short'
    ? Math.max(chatSafeTop, bottom - panelHeight)
    : chatLayout.placement === 'above'
    ? Math.max(top, position.y - panelHeight - 12)
    : chatLayout.placement === 'below'
    ? Math.min(bottom - panelHeight, position.y + height + 12)
    : Math.max(top, Math.min(position.y + height / 2 - panelHeight / 2, bottom - panelHeight))
  const visiblePanelMaxHeight = Math.min(panelMaxHeight, Math.max(0, bottom - panelTop))
  const chatActivity: MoriActivity | null = chatStatus === 'thinking'
    ? { kind: 'thinking', message: 'Mori is thinking through your question.' }
    : chatStatus === 'responding'
    ? { kind: 'responding', message: 'Mori has a thought for you.' }
    : chatStatus === 'error'
    ? { kind: 'confused', message: 'Mori needs another try.' }
    : null
  useMoriActivity(chatActivity)
  const visualState = dragging ? 'dragging' : hovered && activity.kind === 'idle' ? 'hover' : activity.kind
  const mood = moods[visualState]
  const statusLabel = chatStatus === 'thinking' ? 'Thinking' : chatStatus === 'responding' ? 'Replying' : chatStatus === 'error' ? 'Needs another try' : activity.kind === 'idle' ? 'Ready when you are' : activity.message

  useEffect(() => {
    if (preferencesOwner.current !== userId) {
      preferencesOwner.current = userId
      setPreferences(userId ? readPreferences(userId) : { hidden: false, position: null })
      return
    }
    if (!userId) return
    try { localStorage.setItem(storageKey(userId), JSON.stringify(preferences)) } catch { /* Browser storage can be unavailable. */ }
  }, [preferences, userId])
  useEffect(() => {
    if (previousPathname.current === location.pathname) return
    previousPathname.current = location.pathname
    setOpen(false)
    setSettingsOpen(false)
  }, [location.pathname])
  useEffect(() => {
    const resize = () => setViewport(readViewport())
    const visual = window.visualViewport
    window.addEventListener('resize', resize)
    visual?.addEventListener('resize', resize)
    visual?.addEventListener('scroll', resize)
    return () => {
      window.removeEventListener('resize', resize)
      visual?.removeEventListener('resize', resize)
      visual?.removeEventListener('scroll', resize)
    }
  }, [])
  useEffect(() => {
    const resize = () => setViewport(readViewport())
    window.addEventListener('scroll', resize, true)
    return () => window.removeEventListener('scroll', resize, true)
  }, [])
  useEffect(() => {
    if (chatStatus !== 'responding') return
    const timer = window.setTimeout(() => setChatStatus('idle'), 1600)
    return () => window.clearTimeout(timer)
  }, [chatStatus])
  useEffect(() => () => requestController.current?.abort(), [])
  useEffect(() => {
    const check = () => setSuspended(Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')))
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'role'] })
    check()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (open) composer.current?.focus()
    else if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false
      trigger.current?.focus()
    }
  }, [open])
  useLayoutEffect(() => {
    if (settingsOpen) hideAction.current?.focus()
    else if (restoreSettingsFocus.current) {
      restoreSettingsFocus.current = false
      settingsToggle.current?.focus()
    }
  }, [settingsOpen])
  useLayoutEffect(() => {
    if (!open || !shortViewport) {
      setProtectedTop(0)
      return
    }
    const controls = Array.from(document.querySelectorAll<HTMLElement>('.mm-desk-toolbar, .mm-bookmarks'))
    const measure = () => setProtectedTop(controls.reduce((lowest, control) => Math.max(lowest, control.getBoundingClientRect().bottom), top - 12))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    controls.forEach((control) => observer.observe(control))
    return () => observer.disconnect()
  }, [open, shortViewport, viewport.width, viewport.height, viewport.left, viewport.top, top])
  useLayoutEffect(() => {
    const element = panel.current
    if (!open || !element) {
      setChatHeight(0)
      return
    }
    const measure = () => setChatHeight(Math.ceil(element.getBoundingClientRect().height))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open, panelMaxHeight, panelWidth])
  useLayoutEffect(() => {
    if (!open) return
    if (mobile) {
      setChatLayout({ placement: 'mobile', left: viewport.left + (viewport.width - panelWidth) / 2 })
      return
    }
    if (shortViewport) {
      setChatLayout({ placement: 'sidecar-short', left: Math.max(left, Math.min(position.x + width / 2 - panelWidth / 2, right - panelWidth)) })
      return
    }
    const obstacleSelector = '.mm-desk-toolbar, .mm-collection-tools, .discovery-controls, .mm-page-turns, .recipe-grid a, .mm-empty-slot'
    setChatLayout(findChatLayout({
      position,
      companionWidth: width,
      companionHeight: height,
      panelWidth,
      maxPanelHeight: panelMaxHeight,
      bounds: { left, top, right, bottom },
      obstacles: Array.from(document.querySelectorAll<HTMLElement>(obstacleSelector)),
      book: document.querySelector<HTMLElement>('.mm-journal-book')?.getBoundingClientRect(),
    }))
  }, [open, mobile, shortViewport, panelWidth, panelMaxHeight, viewport.left, viewport.top, viewport.width, viewport.height, position, width, height, left, top, right, bottom])
  useLayoutEffect(() => {
    const element = composer.current
    if (!element) return
    element.style.height = 'auto'
    const maxHeight = 96
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [draft, open])
  useLayoutEffect(() => {
    const element = log.current
    if (!element || !followsLatest.current) return
    if (typeof element.scrollTo === 'function') element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
    else element.scrollTop = element.scrollHeight
  }, [messages, chatStatus, chatError, reducedMotion])
  useEffect(() => {
    setPreferences((previous) => previous.position ? { ...previous, position: clamp(previous.position) } : previous)
  }, [viewport.width, viewport.height, viewport.left, viewport.top, clamp])

  function move(x: number, y: number) {
    setPreferences((previous) => ({ ...previous, position: clamp({ x, y }) }))
  }

  function moveByKey(event: KeyboardEvent<HTMLButtonElement>) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-18, 0], ArrowRight: [18, 0], ArrowUp: [0, -18], ArrowDown: [0, 18],
    }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    move(position.x + direction[0], position.y + direction[1])
    setMoved(`Mori moved ${event.key.replace('Arrow', '').toLowerCase()}.`)
  }

  async function sendMessage(text: string, retry = false) {
    if (chatStatus === 'thinking' || !userId) return
    const trimmed = text.trim()
    if (!retry && !trimmed) return
    let nextMessages = messages
    if (!retry) {
      const submitted: Message = { id: ++messageId.current, role: 'user', content: trimmed }
      nextMessages = [...messages, submitted]
      setMessages((previous) => [...previous, submitted].slice(-41))
      setDraft('')
    }
    const turns = nextMessages.filter((message) => message.id !== 0).slice(-8).map(({ role, content }) => ({ role, content }))
    const page = pageContext(location.pathname)
    const controller = new AbortController()
    requestController.current?.abort()
    requestController.current = controller
    setChatError(null)
    setChatStatus('thinking')
    try {
      const reply = await sendMoriChat({
        messages: turns,
        page: page.page,
        ...(page.recipeId ? { recipeId: page.recipeId } : {}),
        userId,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      const responseMessage: Message = { id: ++messageId.current, role: 'assistant', content: reply }
      setMessages((previous) => [...previous, responseMessage].slice(-41))
      setChatStatus('responding')
    } catch (error) {
      if (controller.signal.aborted) return
      setChatError(chatErrorMessage(error))
      setChatStatus('error')
    } finally {
      if (requestController.current === controller) requestController.current = null
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage(draft)
  }

  function inputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage(draft)
    }
  }

  function closeChat() {
    restoreTriggerFocus.current = true
    setOpen(false)
    setSettingsOpen(false)
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function dragMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return
    current.moved = true
    setDragging(true)
    setHovered(false)
    setOpen(false)
    setSettingsOpen(false)
    move(event.clientX - current.offsetX, event.clientY - current.offsetY)
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (current.moved) {
      suppressClick.current = true
      setMoved('Mori moved to a new spot.')
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function cancelDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }

  return <div className="mori-pet-root" inert={suspended} style={{ visibility: suspended ? 'hidden' : undefined }}>
    <span className="mori-pet-sr" aria-live="polite">{moved}</span>
    <span className="mori-pet-sr" id={instructionsId}>Drag Mori to move. When focused, use the arrow keys to reposition.</span>
    {preferences.hidden ? <button ref={show} className="mori-pet-show" type="button" style={{ left: Math.max(left, right - 112), top: Math.max(top, bottom - 44), right: 'auto', bottom: 'auto' }} onClick={() => {
      setPreferences((previous) => ({ ...previous, hidden: false }))
      window.requestAnimationFrame(() => trigger.current?.focus())
    }}>Show Mori</button> : <>
      <div className="mori-pet-character" role="group" aria-label="Mori companion" data-state={visualState} data-chat-open={open && mobile ? 'true' : undefined} style={{ left: position.x, top: position.y, width, height }}>
        <button
          className="mori-pet-trigger"
          ref={trigger}
          type="button"
          aria-label="Talk to Mori"
          aria-describedby={instructionsId}
          aria-controls={panelId}
          aria-expanded={open}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onPointerDown={beginDrag}
          onPointerMove={dragMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onKeyDown={moveByKey}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return }
            setSettingsOpen(false)
            setOpen((previous) => !previous)
          }}
        >
          <Mori size={size} mood={mood} animated={!reducedMotion} />
        </button>
      </div>
      {open && <section
        id={panelId}
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        className="mori-chat-panel"
        data-placement={chatLayout.placement}
        style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: visiblePanelMaxHeight, '--mori-chat-log-max-height': `${Math.max(0, visiblePanelMaxHeight - 142)}px` } as CSSProperties}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeChat() } }}
      >
        <header className="mori-chat-header">
          <Mori size={42} mood={mood} animated={!reducedMotion} />
          <div className="mori-chat-heading"><h2 id={headingId}>Mori</h2><span>{statusLabel}</span></div>
          <button ref={settingsToggle} type="button" onClick={() => setSettingsOpen((previous) => !previous)} aria-label="Mori settings" aria-controls={settingsId} aria-expanded={settingsOpen}><MoreHorizontal size={19} aria-hidden="true" /></button>
          <button type="button" onClick={closeChat} aria-label="Close Mori chat"><X size={19} aria-hidden="true" /></button>
          {settingsOpen && <div className="mori-chat-settings" id={settingsId} role="group" aria-label="Mori settings" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              restoreSettingsFocus.current = true
              setSettingsOpen(false)
            }
          }}>
            <button ref={hideAction} type="button" onClick={() => {
              setSettingsOpen(false)
              setOpen(false)
              setPreferences((previous) => ({ ...previous, hidden: true }))
              window.requestAnimationFrame(() => show.current?.focus())
            }}>Hide Mori</button>
          </div>}
        </header>
        <div className="mori-chat-log" ref={log} role="log" aria-live="polite" aria-relevant="additions text" onScroll={(event) => {
          const element = event.currentTarget
          followsLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
        }}>
          {messages.map((message) => <article className={`mori-chat-message mori-chat-message--${message.role}`} key={message.id}>
            {message.id !== 0 && <span className="mori-chat-message-speaker">{message.role === 'assistant' ? 'Mori' : 'You'}</span>}
            <p>{message.content}</p>
          </article>)}
          {messages.length === 1 && <div className="mori-chat-starters" aria-label="Conversation starters">
            {starters.map((starter) => <button key={starter.label} type="button" disabled={chatStatus === 'thinking'} onClick={() => { void sendMessage(starter.prompt) }}>{starter.label}</button>)}
          </div>}
          {chatStatus === 'thinking' && <p className="mori-chat-thinking" role="status">Mori is thinking…</p>}
          {chatError && <div className="mori-chat-error" role="alert"><p>{chatError}</p><button type="button" disabled={chatStatus === 'thinking'} onClick={() => { void sendMessage('', true) }}>Try again</button></div>}
        </div>
        <form className="mori-chat-composer" onSubmit={submit} aria-busy={chatStatus === 'thinking'}>
          <label className="mori-pet-sr" htmlFor={composerId}>Message Mori</label>
          <div className="mori-chat-composer-field">
            <textarea ref={composer} id={composerId} rows={1} maxLength={1200} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={inputKeyDown} placeholder="Ask Mori about cooking…" disabled={!userId} />
            <button type="submit" disabled={!userId || chatStatus === 'thinking' || !draft.trim()} aria-label="Send message to Mori"><ArrowUp size={19} aria-hidden="true" /></button>
          </div>
          <span className="mori-pet-sr">Press Enter to send. Press Shift and Enter for a new line.</span>
        </form>
      </section>}
    </>}
  </div>
}
