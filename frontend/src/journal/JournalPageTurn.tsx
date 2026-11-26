/* The transition context and snapshot helpers are consumed by shell/UI modules. */
/* eslint react-refresh/only-export-components: off */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { SINGLE_TURN_DURATION, TURN_DURATION, TURN_PERSPECTIVE, turnFrame } from './pageTurnMotion'

export type JournalTurnDirection = 'forward' | 'backward'
export type JournalTurnLayout = 'spread' | 'single'

interface PageSnapshot {
  left: HTMLElement | null
  right: HTMLElement | null
  single: HTMLElement | null
}

interface PendingTurn {
  id: number
  direction: JournalTurnDirection
  layout: JournalTurnLayout
  old: PageSnapshot
  pathname: string
  search: string
  expectedSearch?: string
  commit: () => void
  cancel?: () => void
  committed: boolean
  immediate: boolean
}

type TurnState = (PendingTurn & { phase: 'preparing' | 'ready' | 'animating' | 'committing'; next?: PageSnapshot; singleUnder?: HTMLElement | null }) | null

interface JournalPageTurnContextValue {
  isTurning: boolean
  requestPageTurn: (direction: JournalTurnDirection, prepare: () => void, commit: () => void, expectedSearch?: string, cancel?: () => void) => boolean
  turn: TurnState
  finish: (id: number) => void
}

interface JournalPageTurnRequestDetail {
  direction: JournalTurnDirection
  prepare: () => void
  commit: () => void
  expectedSearch?: string
  cancel?: () => void
  handled: boolean
  accepted: boolean
}

export const JOURNAL_PAGE_TURN_EVENT = 'mm-journal-page-turn-request'
export const JOURNAL_PAGE_TURN_FINISHED_EVENT = 'mm-journal-page-turn-finished'

function notifyTurnFinished(id: number, completed: boolean) {
  document.dispatchEvent(new CustomEvent(JOURNAL_PAGE_TURN_FINISHED_EVENT, { detail: { id, completed } }))
}

/** Lets a form above JournalShell request a turn without moving its live form/provider tree. */
export function requestJournalPageTurnFrom(source: HTMLElement | null, direction: JournalTurnDirection, prepare: () => void, commit: () => void, expectedSearch?: string, cancel?: () => void) {
  const book = source?.closest<HTMLElement>('.mm-journal-book') ?? source?.querySelector<HTMLElement>('.mm-journal-book')
  if (!book) {
    prepare()
    commit()
    return true
  }
  const detail: JournalPageTurnRequestDetail = { direction, prepare, commit, expectedSearch, cancel, handled: false, accepted: false }
  book.dispatchEvent(new CustomEvent<JournalPageTurnRequestDetail>(JOURNAL_PAGE_TURN_EVENT, { bubbles: true, cancelable: true, detail }))
  if (!detail.handled) {
    prepare()
    commit()
    return true
  }
  return detail.accepted
}

const defaultContext: JournalPageTurnContextValue = {
  isTurning: false,
  requestPageTurn: (_direction, prepare, commit) => { prepare(); commit(); return true },
  turn: null,
  finish: () => undefined,
}

const JournalPageTurnContext = createContext<JournalPageTurnContextValue>(defaultContext)

const activeBooks = new Set<symbol>()
const turnSubscribers = new Set<() => void>()
function publishTurn(owner: symbol, active: boolean) {
  if (active) activeBooks.add(owner)
  else activeBooks.delete(owner)
  turnSubscribers.forEach((listener) => listener())
}
const subscribeTurn = (listener: () => void) => { turnSubscribers.add(listener); return () => { turnSubscribers.delete(listener) } }
const readTurning = () => activeBooks.size > 0

export function useJournalPageTurn() {
  const { isTurning, requestPageTurn } = useContext(JournalPageTurnContext)
  const externalTurn = useSyncExternalStore(subscribeTurn, readTurning, () => false)
  return { isTurning: isTurning || externalTurn, requestPageTurn }
}

function withCurrentFormValues(source: HTMLElement, clone: HTMLElement) {
  const sourceControls = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  const clonedControls = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  sourceControls.forEach((control, index) => {
    const copy = clonedControls[index]
    if (!copy || copy.tagName !== control.tagName) return
    if (control instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      try { copy.value = control.value } catch { /* File inputs cannot be assigned a value. */ }
      copy.checked = control.checked
    } else if (control instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.value = control.value
      copy.textContent = control.value
    } else if (control instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
      copy.selectedIndex = control.selectedIndex
      Array.from(control.options).forEach((option, optionIndex) => {
        if (copy.options[optionIndex]) copy.options[optionIndex].selected = option.selected
      })
    }
  })

  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>('*')]
  const clonedElements = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  sourceElements.forEach((element, index) => {
    const copy = clonedElements[index]
    if (copy) {
      if (element.scrollTop || element.scrollLeft) {
        copy.dataset.turnScrollTop = String(element.scrollTop)
        copy.dataset.turnScrollLeft = String(element.scrollLeft)
      }
      if (element instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement) {
        copy.width = element.width
        copy.height = element.height
        try { copy.getContext('2d')?.drawImage(element, 0, 0) } catch { /* A protected canvas keeps its reserved paper space. */ }
      }
    }
  })
}

function sanitizeSnapshot(clone: HTMLElement, prefix: string) {
  const elements = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  const ids = new Map<string, string>()

  elements.forEach((element, index) => {
    const id = element.getAttribute('id')
    if (!id) return
    const nextId = `${prefix}-${index}-${id}`
    if (!ids.has(id)) ids.set(id, nextId)
    element.setAttribute('id', nextId)
  })

  const idReferences = new Set(['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'list', 'form'])
  elements.forEach((element) => {
    const focusable = element.matches('a, button, input, textarea, select, [tabindex], [contenteditable]')
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (idReferences.has(name)) {
        const rewritten = attribute.value.split(/\s+/).map((id) => ids.get(id) ?? id).join(' ')
        element.setAttribute(attribute.name, rewritten)
      } else if (attribute.value.includes('url(#')) {
        element.setAttribute(attribute.name, attribute.value.replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${ids.get(id) ?? id})`))
      }
    }
    element.removeAttribute('data-testid')
    element.removeAttribute('data-form-focus-key')
    element.removeAttribute('autofocus')
    element.removeAttribute('contenteditable')
    if (focusable) element.setAttribute('tabindex', '-1')
  })

  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  clone.setAttribute('data-journal-turn-snapshot', 'true')
  clone.style.pointerEvents = 'none'
  clone.style.userSelect = 'none'

  // Inert blocks interaction while keeping enabled buttons visually intact.
  clone.querySelectorAll('button').forEach((button) => { button.type = 'button' })
  clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((control) => { control.disabled = true })
  clone.querySelectorAll<HTMLAnchorElement>('a').forEach((anchor) => anchor.removeAttribute('href'))
  clone.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    form.removeAttribute('action')
    form.removeAttribute('method')
    form.removeAttribute('target')
    form.noValidate = true
  })
}

function clonePage(source: Element | null, prefix: string): HTMLElement | null {
  if (!(source instanceof HTMLElement)) return null
  const style = getComputedStyle(source)
  if (style.display === 'none') return null
  const clone = source.cloneNode(true) as HTMLElement
  if (source.matches('.mm-journal-page, .mm-journal-flyleaf')) {
    // Freeze spread-dependent paper, including the tokens used by bookmarks and seams.
    clone.style.setProperty('--mm-journal-paper-color', style.getPropertyValue('--mm-journal-paper-color'))
    clone.style.setProperty('--mm-journal-paper-image', style.getPropertyValue('--mm-journal-paper-image'))
    clone.style.backgroundColor = style.backgroundColor
    clone.style.backgroundImage = style.backgroundImage
    clone.style.backgroundSize = style.backgroundSize
  }
  withCurrentFormValues(source, clone)
  const images = clone.querySelectorAll('img')
  source.querySelectorAll('img').forEach((image, index) => {
    const copy = images[index]
    if (!copy) return
    const rect = image.getBoundingClientRect()
    copy.style.width = `${rect.width}px`
    copy.style.height = `${rect.height}px`
    if (!image.complete) copy.style.visibility = 'hidden'
  })
  const sourceTop = source.getBoundingClientRect().top
  const sourceFooters = source.querySelectorAll<HTMLElement>('.mm-journal-page-footer')
  clone.querySelectorAll<HTMLElement>('.mm-journal-page-footer').forEach((footer, index) => {
    const original = sourceFooters[index]
    if (original) footer.dataset.turnFooterTop = String(original.getBoundingClientRect().top - sourceTop)
  })
  clone.querySelectorAll('.mm-index-measure, .mm-reading-measure, .mm-pagination-measure').forEach((element) => element.remove())
  sanitizeSnapshot(clone, prefix)
  return clone
}

function takePageSnapshot(book: HTMLElement, layout: JournalTurnLayout, prefix: string): PageSnapshot {
  if (layout === 'single') {
    return { left: null, right: null, single: clonePage(book.querySelector('.mm-journal-spread'), prefix) }
  }
  return {
    left: clonePage(book.querySelector('.mm-journal-flyleaf'), `${prefix}-left`),
    right: clonePage(book.querySelector('.mm-journal-page'), `${prefix}-right`),
    single: null,
  }
}

function installSnapshot(container: HTMLElement | null, snapshot: HTMLElement | null | undefined) {
  container?.replaceChildren()
  if (!container || !snapshot) return
  container.appendChild(snapshot)
  for (const element of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('[data-turn-scroll-top]')]) {
    element.scrollTop = Number(element.dataset.turnScrollTop ?? 0)
    element.scrollLeft = Number(element.dataset.turnScrollLeft ?? 0)
  }
  // Sticky footers use the live scrollport, which the frozen sheet does not share.
  const top = snapshot.getBoundingClientRect().top
  snapshot.querySelectorAll<HTMLElement>('[data-turn-footer-top]').forEach((footer) => {
    footer.style.removeProperty('translate')
    footer.style.translate = `0 ${Number(footer.dataset.turnFooterTop) - (footer.getBoundingClientRect().top - top)}px`
  })
}

export function JournalPageTurnLayer({ turn }: { turn: TurnState }) {
  const left = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const single = useRef<HTMLDivElement>(null)
  const front = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const old = turn?.old
  const next = turn?.next
  const singleUnder = turn?.singleUnder
  const singleLeaf = turn?.layout === 'single'
  const forward = turn?.direction === 'forward'
  useLayoutEffect(() => {
    if (!old) return
    if (!next) {
      installSnapshot(left.current, old.left)
      installSnapshot(right.current, old.right)
      installSnapshot(single.current, old.single)
    } else {
      installSnapshot(single.current, singleUnder)
      installSnapshot(left.current, forward ? old.left : next.left)
      installSnapshot(right.current, forward ? next.right : old.right)
      installSnapshot(front.current, singleLeaf ? old.single : forward ? old.right : old.left)
      installSnapshot(back.current, singleLeaf ? next.single : forward ? next.left : next.right)
    }
    // Snapshots own no application state; their mounting must never replace the shading nodes.
  }, [old, next, singleUnder, singleLeaf, forward])
  if (!turn) return null
  return <div className="mm-page-turn-layer" style={{ perspective: TURN_PERSPECTIVE }} data-journal-page-turn="true" data-turn-id={turn.id} data-direction={turn.direction} data-layout={turn.layout} data-duration={turn.layout === 'single' ? SINGLE_TURN_DURATION : TURN_DURATION} data-phase={turn.phase} aria-hidden="true" inert>
    <div ref={left} className="mm-turn-under mm-turn-under--left" />
    <div ref={right} className="mm-turn-under mm-turn-under--right" />
    {turn.layout === 'single' && <div ref={single} className="mm-turn-under mm-turn-under--single" />}
    {next && <div className="mm-turn-ground-shadow" />}
    {next && <div className={`mm-turn-leaf mm-turn-leaf--${turn.direction}`} data-direction={turn.direction} data-layout={turn.layout}>
      <div className="mm-turn-face mm-turn-face--front"><div ref={front} className="mm-turn-content" /><div className="mm-turn-shade" /></div>
      <div className="mm-turn-face mm-turn-face--back"><div ref={back} className="mm-turn-content" /><div className="mm-turn-shade" /></div>
    </div>}
  </div>
}

export function useJournalPageTurnManager({ bookRef, pathname, search, singleLayout, reducedMotion }: {
  bookRef: RefObject<HTMLDivElement | null>
  pathname: string
  search: string
  singleLayout: boolean
  reducedMotion: boolean
}) {
  const [turn, setTurn] = useState<TurnState>(null)
  const pending = useRef<PendingTurn | null>(null)
  const sequence = useRef(0)
  const owner = useRef(Symbol('journal-turn'))
  const frame = useRef<number | null>(null)
  const settleFrame = useRef<(() => void) | null>(null)
  const animations = useRef<Animation[]>([])
  const clearMotion = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    settleFrame.current = null
  }, [])

  const cancel = useCallback((id: number) => {
    const request = pending.current
    if (!request || request.id !== id || request.committed) return
    pending.current = null
    publishTurn(owner.current, false)
    clearMotion()
    try { request.cancel?.() }
    finally { notifyTurnFinished(id, false); setTurn(null) }
  }, [clearMotion])

  const finish = useCallback((id: number) => {
    const request = pending.current
    if (!request || request.id !== id || request.committed) return
    request.committed = true
    settleFrame.current?.()
    clearMotion()
    setTurn((current) => current?.id === id ? { ...current, phase: 'committing' } : current)
    try { request.commit() }
    catch (error) {
      pending.current = null
      publishTurn(owner.current, false)
      request.cancel?.()
      setTurn(null)
      notifyTurnFinished(id, false)
      throw error
    }
  }, [clearMotion])

  const requestPageTurn = useCallback((direction: JournalTurnDirection, prepare: () => void, commit: () => void, expectedSearch?: string, onCancel?: () => void) => {
    if (pending.current) return false
    const book = bookRef.current
    const layout = singleLayout ? 'single' : 'spread'
    const id = ++sequence.current
    const old = book ? takePageSnapshot(book, layout, `mm-turn-${id}-old`) : { left: null, right: null, single: null }
    if (!book || (layout === 'single' ? !old.single : !old.right)) { prepare(); commit(); return true }
    const request: PendingTurn = { id, direction, layout, old, pathname, search, expectedSearch, commit, cancel: onCancel, committed: false, immediate: reducedMotion || globalThis.CSS?.supports?.('transform-style', 'preserve-3d') === false }
    pending.current = request
    publishTurn(owner.current, true)
    setTurn({ ...request, phase: 'preparing' })
    try {
      flushSync(prepare)
      const live = book.querySelector('.mm-journal-spread')
      if (live?.querySelector('[data-journal-ready="error"]')) cancel(id)
      else if (request.immediate && !live?.querySelector('[data-journal-ready="false"], [data-reading-ready="false"]')) finish(id)
    }
    catch (error) { cancel(id); throw error }
    return true
  }, [bookRef, pathname, search, singleLayout, reducedMotion, cancel, finish])

  useLayoutEffect(() => {
    if (!turn || turn.phase !== 'preparing') return
    const started = performance.now()
    const request = pending.current
    const book = bookRef.current
    if (!request || !book) return
    // ResizeObserver pagination must settle before the destination is frozen.
    let settled = false
    const prepare = () => {
      if (pending.current !== request) return
      if (book.querySelector('.mm-journal-spread')?.querySelector('[data-journal-ready="error"]')) { cancel(request.id); return }
      if (book.querySelector('.mm-journal-spread')?.querySelector('[data-journal-ready="false"], [data-reading-ready="false"]') || (document.fonts?.status === 'loading' && performance.now() - started < 1000)) {
        settled = false
        frame.current = requestAnimationFrame(prepare)
        return
      }
      if (!settled) {
        settled = true
        frame.current = requestAnimationFrame(prepare)
        return
      }
      // Images are noncritical: snapshots retain their reserved boxes; network delays never block a turn.
      try {
        const next = takePageSnapshot(book, request.layout, `mm-turn-${request.id}-next`)
        if (request.immediate) finish(request.id)
        else {
          const singleUnder = request.layout === 'single' ? clonePage(book.querySelector('.mm-journal-spread'), `mm-turn-${request.id}-under`) : null
          setTurn({ ...request, next, singleUnder, phase: 'ready' })
        }
      } catch { finish(request.id) }
    }
    frame.current = requestAnimationFrame(prepare)
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [turn, bookRef, cancel, finish])

  const motionId = turn?.id
  const motionNext = turn?.next
  const motionDirection = turn?.direction
  const motionLayout = turn?.layout
  useLayoutEffect(() => {
    if (!motionId || !motionNext || !motionDirection || !motionLayout) return
    const book = bookRef.current
    const layer = book?.querySelector<HTMLElement>('[data-journal-page-turn]')
    const leaf = layer?.querySelector<HTMLElement>('.mm-turn-leaf')
    if (!book || !leaf || !layer) return finish(motionId)
    const duration = motionLayout === 'single' ? SINGLE_TURN_DURATION : TURN_DURATION
    const shades = [...leaf.querySelectorAll<HTMLElement>('.mm-turn-shade'), ...layer.querySelectorAll<HTMLElement>('.mm-turn-ground-shadow')]
    const front = leaf.querySelector<HTMLElement>('.mm-turn-face--front')!
    const back = leaf.querySelector<HTMLElement>('.mm-turn-face--back')!
    setTurn((current) => current?.id === motionId && current.phase === 'ready' ? { ...current, phase: 'animating' } : current)
    const apply = (progress: number, paint = true) => {
      const value = turnFrame(progress, motionDirection, motionLayout === 'single')
      if (paint) {
        leaf.style.transform = `rotateY(${value.angle}deg)`
        shades.forEach((shade) => { shade.style.opacity = String(value.shade) })
        if (motionLayout === 'single') {
          front.style.visibility = value.travel < .5 ? 'visible' : 'hidden'
          back.style.visibility = value.travel < .5 ? 'hidden' : 'visible'
        }
      }
      if (import.meta.env.DEV) {
        layer.dataset.progress = String(progress)
        layer.dataset.travel = String(value.travel)
        layer.dataset.stage = value.stage
      }
    }
    settleFrame.current = () => apply(1)
    let started: number | null = null
    const tick = (now: number) => {
      if (pending.current?.id !== motionId || pending.current.committed) return
      started ??= now
      const progress = Math.min(1, (now - started) / duration)
      if (!nativeMotion || import.meta.env.DEV) apply(progress, !nativeMotion)
      if (progress === 1) finish(motionId)
      else frame.current = requestAnimationFrame(tick)
    }
    apply(0)
    const nativeMotion = motionLayout === 'spread' && typeof leaf.animate === 'function'
    if (nativeMotion) {
      const frames = Array.from({ length: 61 }, (_, index) => turnFrame(index / 60, motionDirection))
      const timing: KeyframeAnimationOptions = { duration, fill: 'both', easing: 'linear' }
      animations.current = [
        leaf.animate(frames.map(({ angle }) => ({ transform: `rotateY(${angle}deg)` })), timing),
        ...shades.map((shade) => shade.animate(frames.map(({ shade: opacity }) => ({ opacity })), timing)),
      ]
    }
    frame.current = requestAnimationFrame(tick)
    // Development-only deterministic sampling measures the rendered SVG and paper independently.
    const sample = (event: Event) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      animations.current.forEach((animation) => animation.cancel())
      const progress = (event as CustomEvent<number>).detail
      apply(progress)
      if (progress >= 1) finish(motionId)
    }
    if (import.meta.env.DEV) layer.addEventListener('mm-journal-turn-sample', sample)
    return () => { clearMotion(); layer.removeEventListener('mm-journal-turn-sample', sample) }
  }, [motionId, motionNext, motionDirection, motionLayout, bookRef, finish, clearMotion])

  useLayoutEffect(() => {
    const request = pending.current
    if (!request || !turn) return
    const expectedLocation = pathname === request.pathname && (request.expectedSearch === undefined || search === request.expectedSearch)
    if (turn.phase === 'committing' && expectedLocation) {
      // Navigation can replace the spread while the destination is becoming ready.
      // Observe the stable book root and resolve the current spread on every callback;
      // observing the outgoing spread can strand the turn layer on a detached node.
      const book = bookRef.current
      const acknowledge = () => {
        const live = book?.querySelector('.mm-journal-spread')
        // A navigation gap is not an acknowledgement: wait for the replacement spread
        // to mount, then for its critical content to become ready.
        if (pending.current !== request || !live || live.querySelector('[data-journal-ready="false"], [data-reading-ready="false"]')) return
        pending.current = null
        publishTurn(owner.current, false)
        notifyTurnFinished(request.id, true)
        setTurn(null)
      }
      const observer = new MutationObserver(acknowledge)
      if (book) observer.observe(book, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-journal-ready', 'data-reading-ready'] })
      acknowledge()
      return () => observer.disconnect()
    } else if (pathname !== request.pathname || (search !== request.search && search !== request.expectedSearch)) {
      if (!request.committed) cancel(request.id)
      else { pending.current = null; publishTurn(owner.current, false); clearMotion(); setTurn(null); notifyTurnFinished(request.id, false) }
    }
  }, [turn, pathname, search, bookRef, cancel, clearMotion])

  useLayoutEffect(() => {
    const settle = () => {
      const request = pending.current
      if (!request || request.committed) return
      request.immediate = true
      if (turn?.phase !== 'preparing') finish(request.id)
    }
    window.addEventListener('resize', settle)
    if (reducedMotion || (turn && turn.layout !== (singleLayout ? 'single' : 'spread'))) settle()
    return () => window.removeEventListener('resize', settle)
  }, [turn, singleLayout, reducedMotion, finish])

  useEffect(() => () => {
    const request = pending.current
    pending.current = null
    publishTurn(owner.current, false)
    clearMotion()
    if (request) { if (!request.committed) request.cancel?.(); notifyTurnFinished(request.id, false) }
  }, [clearMotion])

  const value: JournalPageTurnContextValue = { isTurning: turn !== null, requestPageTurn, turn, finish }
  return { contextValue: value, turn, finish, isTurning: value.isTurning }
}

export { JournalPageTurnContext }
