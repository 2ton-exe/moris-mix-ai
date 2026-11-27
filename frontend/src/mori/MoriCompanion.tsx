import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { useLocation } from 'react-router'
import { z } from 'zod'
import { Mori, type MoriMood } from '../journal/Mori'
import { MORI_ART_SCALE, MORI_DESKTOP_SIZE, moriRestFoot } from '../journal/moriPaperMotion'
import { MORI_FOOT, preloadMoriSprites } from '../journal/moriSpriteAtlas'
import { JOURNAL_SINGLE_LAYOUT_QUERY, mittAnchor } from '../journal/pageTurnMotion'
import { useJournalMedia } from '../journal/useJournalMedia'
import { MoriChatPanel } from './MoriChatPanel'
import { useMoriCompanionState } from './MoriCompanionContext'
import type { MoriActivity } from './MoriCompanionContext'
import { travelToJournalTab } from './moriNavigationMotion'
import './mori-companion.css'

const navigationTapSize = 48
const navigationTapArm = -58
const navigationTapStyle: CSSProperties & { '--mori-navigation-arm': string } = { '--mori-navigation-arm': `${navigationTapArm}deg` }
const defaultChatSize = { width: 520, height: 560 }
const smallChatSize = { width: 380, height: 420 }
const desktopChatSize = { width: 420, height: 560 }
const smallDesktopChatSize = { width: 360, height: 480 }
type ChatSize = typeof defaultChatSize & { leftOffset: number; bottomOffset: number; placement: 'left' | 'right' }
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
  const [chatSize, setChatSize] = useState<ChatSize | null>(null)
  const [moved, setMoved] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [traveling, setTraveling] = useState(false)
  const [dock, setDock] = useState<Position | null>(null)
  const [viewport, setViewport] = useState(readViewport)
  const [bubbleHeight, setBubbleHeight] = useState(260)
  const mobile = useJournalMedia('(max-width: 600px)')
  const singleLayout = useJournalMedia(JOURNAL_SINGLE_LAYOUT_QUERY)
  const desktopPointer = useJournalMedia('(hover: hover) and (pointer: fine)')
  const reducedMotion = useJournalMedia('(prefers-reduced-motion: reduce)')
  const character = useRef<HTMLDivElement>(null)
  const navigationTap = useRef<HTMLDivElement>(null)
  const stopNavigationTravel = useRef<(() => void) | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const showButton = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const resizeDrag = useRef<{ pointerId: number; x: number; y: number; size: typeof defaultChatSize } | null>(null)
  const resizedByDrag = useRef(false)
  const suppressClick = useRef(false)
  const focusAfterVisibilityChange = useRef(false)
  const headingId = useId()
  const panelId = useId()
  const moveHintId = useId()
  const size = mobile ? 72 : MORI_DESKTOP_SIZE
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
  const position = clamp(preferences.position ?? dock ?? { x: mobile ? left + 12 : right - width - 12, y: bottom - height - 12 })
  const actual = mobile ? { ...position, x: position.x < viewport.left + viewport.width / 2 ? left : Math.max(left, right - width) } : position
  const page = companionPage(location.pathname)
  const pageGuidance = page.area === 'recipes' || page.area === 'chef' ? guidance : null
  const companionMessage = activity.kind === 'idle' ? pageGuidance?.message ?? page.message : activity.message
  const resizableChat = Boolean(userId && !singleLayout)
  const dialogue = resizableChat && desktopPointer
  const naturalDialogue = dialogue

  useEffect(() => () => stopNavigationTravel.current?.(), [])
  useEffect(() => { if (!singleLayout && !reducedMotion) preloadMoriSprites() }, [singleLayout, reducedMotion])
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
  useLayoutEffect(() => {
    if (singleLayout) { setDock(null); return }
    let paper: HTMLElement | null = null
    const place = () => {
      const rect = paper?.getBoundingClientRect()
      const next = rect?.width ? moriRestFoot(rect) : null
      let dockPosition: Position | null = null
      if (next && rect && paper) {
        const candidate = clamp({ x: next.x - width / 2, y: next.y - MORI_FOOT.y * MORI_ART_SCALE })
        const x = candidate.x + (width - size) / 2
        const artHeight = size * 1.2 + 24
        const controls = Array.from(paper.querySelectorAll('button, a[href], input, textarea, select, [contenteditable], h1, h2, h3, h4, h5, h6, [role="heading"], [role="alert"], [role="status"], .field-hint, .mm-recipe-artwork, .mm-collection-entry, .recipe-update, .request-state'), (control) => control.getBoundingClientRect())
          .filter((control) => control.width > 1 && control.height > 1 && control.left < x + size && control.right > x)
        let y = candidate.y
        const minimum = Math.max(rect.top + 8, 8)
        controls.sort((a, b) => b.bottom - a.bottom)
        for (const control of controls) {
          if (control.top < y + artHeight && control.bottom > y) y = control.top - artHeight - 4
        }
        if (y >= minimum) dockPosition = { x: candidate.x, y }
      }
      setDock((current) => current?.x === dockPosition?.x && current?.y === dockPosition?.y ? current : dockPosition)
    }
    const findPaper = () => {
      if (paper?.isConnected) return
      paper = document.querySelector('.mm-desk--with-companion .mm-journal-spread > .mm-journal-page')
      place()
    }
    const mutation = new MutationObserver((records) => {
      if (!paper?.isConnected) findPaper()
      else if (records.some(({ target }) => paper?.contains(target))) place()
    })
    const root = character.current?.closest('.mori-pet-root')?.parentElement
    if (root) mutation.observe(root, { childList: true, subtree: true })
    findPaper()
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      mutation.disconnect()
      window.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [location.pathname, singleLayout, size, width, clamp])
  const keepOpen = typeof location.state === 'object' && location.state !== null && 'moriKeepOpen' in location.state && location.state.moriKeepOpen === true
  useEffect(() => {
    if (keepOpen) setOpen(true)
    else setOpen(false)
  }, [location.pathname, keepOpen])
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
    if (!open) return
    const composer = userId ? bubble.current?.querySelector('textarea') : null
    ;(composer ?? heading.current)?.focus({ preventScroll: true })
  }, [open, userId])
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
  const mouthY = actual.y + size * 0.67
  const resizeFromSide = resizableChat && (placement === 'left' || placement === 'right')
  const resizeBottom = Math.min(bottom, Math.max(top + defaultChatSize.height, mouthY + defaultChatSize.height / 2))
  const verticalSpace = placement === 'bottom' ? belowSpace : placement === 'top' ? aboveSpace : (resizeFromSide && !naturalDialogue ? resizeBottom : bottom) - top
  const standardChat = desktopPointer ? desktopChatSize : defaultChatSize
  const smallChat = desktopPointer ? smallDesktopChatSize : smallChatSize
  const preferredChat = chatSize ?? standardChat
  const preferredWidth = resizableChat ? preferredChat.width : userId && viewport.width >= 1100 ? defaultChatSize.width : 380
  const preferredHeight = resizableChat ? preferredChat.height : userId && viewport.width >= 1100 ? defaultChatSize.height : 460
  const anchoredLeft = resizeFromSide && chatSize?.placement === placement
    ? Math.max(left, Math.min(actual.x + chatSize.leftOffset, right - smallChat.width)) : null
  const panelWidth = anchoredLeft !== null ? Math.min(preferredWidth, right - anchoredLeft) : placement === 'left'
    ? Math.min(preferredWidth, viewport.width - 16, leftSpace)
    : placement === 'right'
      ? Math.min(preferredWidth, viewport.width - 16, rightSpace)
      : Math.min(preferredWidth, viewport.width - 16)
  const maxPanelHeight = Math.max(0, Math.min(preferredHeight, viewport.height - 16, verticalSpace))
  const manuallySized = resizeFromSide && chatSize?.placement === placement
  const anchoredBottom = manuallySized ? Math.min(bottom, actual.y + chatSize.bottomOffset) : null
  const naturalSide = naturalDialogue && !manuallySized && resizeFromSide
  const naturalShift = `clamp(${top - mouthY}px, -50%, calc(${bottom - mouthY}px - 100%))`
  const naturalTail = `clamp(14px, clamp(calc(100% - ${bottom - mouthY}px), 50%, ${mouthY - top}px), calc(100% - 14px))`
  const measuredPanelHeight = userId && (!naturalDialogue || manuallySized) ? maxPanelHeight : Math.min(bubbleHeight, maxPanelHeight)
  const panelLeft = anchoredLeft ?? (placement === 'left'
    ? actual.x - gap - panelWidth
    : placement === 'right'
      ? actual.x + width + gap
      : Math.max(left, Math.min(actual.x + width / 2 - panelWidth / 2, right - panelWidth)))
  const panelTop = placement === 'left' || placement === 'right'
    ? anchoredBottom !== null ? Math.max(top, anchoredBottom - measuredPanelHeight) : resizeFromSide && !naturalDialogue ? resizeBottom - measuredPanelHeight : Math.max(top, Math.min(mouthY - measuredPanelHeight / 2, bottom - measuredPanelHeight))
    : placement === 'top'
      ? Math.max(top, Math.min(actual.y - gap - measuredPanelHeight, bottom - measuredPanelHeight))
      : Math.max(top, Math.min(actual.y + height + gap, bottom - measuredPanelHeight))
  const availablePanelHeight = naturalDialogue ? maxPanelHeight : Math.max(0, Math.min(maxPanelHeight, bottom - panelTop))
  const visiblePanelHeight = userId && (!naturalDialogue || manuallySized) ? availablePanelHeight : Math.min(bubbleHeight, availablePanelHeight)
  const tailOffset = placement === 'left' || placement === 'right'
    ? Math.max(14, Math.min(visiblePanelHeight - 14, mouthY - panelTop))
    : Math.max(20, Math.min(panelWidth - 20, actual.x + width / 2 - panelLeft))
  const tailAttached = placement === 'left' ? Math.abs(panelLeft + panelWidth + gap - actual.x) < 1
    : placement === 'right' ? Math.abs(panelLeft - gap - actual.x - width) < 1 : true
  function resizeChat(width: number, height: number) {
    if (placement !== 'left' && placement !== 'right') return
    const bounds = bubble.current?.getBoundingClientRect()
    const currentLeft = bounds?.left ?? panelLeft
    const currentBottom = bounds?.bottom ?? panelTop + visiblePanelHeight
    setChatSize({
      width: Math.min(right - currentLeft, Math.max(smallChat.width, width)),
      height: Math.min(verticalSpace, currentBottom - top, Math.max(smallChat.height, height)),
      leftOffset: currentLeft - actual.x,
      bottomOffset: currentBottom - actual.y,
      placement,
    })
  }
  useLayoutEffect(() => {
    if (!open || (userId && !naturalDialogue)) return
    const element = bubble.current
    if (!element) return
    const measure = () => {
      const height = element.offsetHeight
      if (height > 0) setBubbleHeight(current => Math.abs(height - current) > 1 ? height : current)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open, naturalDialogue, userId])

  async function playNavigationTap(findAnchor: () => HTMLElement | null, signal: AbortSignal) {
    if (document.hidden) return
    stopNavigationTravel.current?.()
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

  async function playNavigationTravel(findTab: () => HTMLElement | null, signal: AbortSignal) {
    const element = character.current
    const button = trigger.current
    if (signal.aborted) return false
    if (!element || !button) return true
    stopNavigationTravel.current?.()
    setTraveling(true)
    const travel = travelToJournalTab({ character: element, trigger: button, findTab, signal, onSettled() {
      stopNavigationTravel.current = null
      setTraveling(false)
    } })
    stopNavigationTravel.current = travel.cancel
    return travel.arrived
  }

  useEffect(() => {
    const controller = new AbortController()
    const walk = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.mm-bookmarks--journal a') : null
      if (link) void playNavigationTravel(() => Array.from(document.querySelectorAll<HTMLAnchorElement>('.mm-bookmarks--journal a'))
        .find((tab) => tab.pathname === link.pathname) ?? null, controller.signal)
    }
    document.addEventListener('click', walk)
    return () => { controller.abort(); document.removeEventListener('click', walk) }
  }, [])

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
    if (traveling) return
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
    '--mori-navigation-width': `${size}px`,
  } as CSSProperties
  return <>
  <div className="mori-pet-root" data-dialogue-state={open ? undefined : 'idle'}>
    <button ref={showButton} className="mori-pet-show" type="button" hidden={!preferences.hidden || suspended} inert={suspended} onClick={show}>Show Mori</button>
    <div hidden={preferences.hidden || suspended} inert={preferences.hidden || suspended}>
      <span className="mori-pet-sr" aria-live="polite">{moved}</span>
      <span id={moveHintId} className="mori-pet-sr">Drag Mori to move. When focused, use the arrow keys to reposition.</span>
      <div ref={character} className="mori-pet-character" role="group" aria-label="Mori companion" data-activity={activity.kind} style={characterStyle}>
        <button className="mori-pet-trigger" ref={trigger} type="button" aria-label="Talk to Mori" aria-describedby={moveHintId} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-controls={panelId} aria-expanded={open} aria-disabled={traveling ? 'true' : undefined} tabIndex={traveling ? -1 : undefined}
          onClick={(event) => {
            if (traveling) { event.preventDefault(); return }
            if (suppressClick.current) {
              suppressClick.current = false
              if (event.detail !== 0) { event.preventDefault(); return }
            }
            if (open) close()
            else setOpen(true)
          }}
          onKeyDown={moveKey}
          onPointerDown={(event) => {
            if (traveling || event.button !== 0 || !event.isPrimary) return
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
      <div ref={bubble} hidden={!open} className="mori-pet-bubble" data-placement={placement} style={{ left: panelLeft, top: naturalSide ? mouthY : anchoredBottom ?? panelTop, translate: naturalSide ? `0 ${naturalShift}` : anchoredBottom !== null ? '0 -100%' : undefined, width: panelWidth }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
        {tailAttached && <span className="mori-pet-bubble-tail" style={placement === 'left' || placement === 'right' ? { top: naturalSide ? naturalTail : tailOffset } : { left: tailOffset }} aria-hidden="true" />}
        <section id={panelId} role="region" aria-labelledby={headingId} className="mori-pet-panel" data-chat={Boolean(userId)} data-dialogue={dialogue || undefined} data-resizable={resizeFromSide || undefined} data-sized={manuallySized || undefined} style={{ maxHeight: availablePanelHeight, height: resizeFromSide && (!naturalDialogue || manuallySized) ? availablePanelHeight : undefined }}>
          <header><h2 ref={heading} id={headingId} tabIndex={-1}>Mori</h2><button className="mori-pet-close" type="button" onClick={close} aria-label="Close Mori"><X size={18} strokeWidth={2.2} aria-hidden="true" /></button></header>
          {!userId && <><p className="mori-pet-context">{page.label}</p>
          <p className="mori-pet-message">{companionMessage}</p></>}
          {userId && activity.kind !== 'idle' && <p className="mori-pet-message" role="status">{companionMessage}</p>}
          {userId && <MoriChatPanel key={userId} userId={userId} playNavigationTap={playNavigationTap} playNavigationTravel={playNavigationTravel} traveling={traveling} />}
          {!userId && activity.kind === 'idle' && pageGuidance?.action && <button className="button button-secondary" type="button" onClick={() => {
            pageGuidance.action?.onClick()
            if (!bubble.current?.contains(document.activeElement)) setOpen(false)
          }}>{pageGuidance.action.label}</button>}
        </section>
        {resizeFromSide && <button className="mori-pet-resize" type="button" aria-label="Resize Mori chat" aria-description="Drag or use the arrow keys to resize. Press Enter to reset." aria-controls={panelId}
          onClick={(event) => {
            if (event.detail === 0) setChatSize(null)
          }}
          onKeyDown={(event) => {
            const horizontal = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0
            const vertical = event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0
            if (!horizontal && !vertical) return
            event.preventDefault()
            resizeChat(panelWidth + horizontal, (bubble.current?.getBoundingClientRect().height ?? visiblePanelHeight) - vertical)
          }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return
            resizedByDrag.current = false
            resizeDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, size: { width: panelWidth, height: bubble.current?.getBoundingClientRect().height ?? visiblePanelHeight } }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const start = resizeDrag.current
            if (start?.pointerId !== event.pointerId) return
            const dx = event.clientX - start.x
            const dy = event.clientY - start.y
            if (!resizedByDrag.current && Math.hypot(dx, dy) < 4) return
            resizedByDrag.current = true
            resizeChat(start.size.width + dx, start.size.height - dy)
          }}
          onLostPointerCapture={(event) => { if (resizeDrag.current?.pointerId === event.pointerId) resizeDrag.current = null }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3L15 15M8 3L15 10M13 3L15 5" />
          </svg>
        </button>}
      </div>
    </div>
  </div>
  <div ref={navigationTap} className="mori-navigation-tap" hidden aria-hidden="true" style={navigationTapStyle}>
    <Mori mood="wave" size={navigationTapSize} />
  </div>
  </>
}
