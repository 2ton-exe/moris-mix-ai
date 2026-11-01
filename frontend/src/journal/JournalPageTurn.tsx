/* The transition context and snapshot helpers are consumed by shell/UI modules. */
/* eslint react-refresh/only-export-components: off */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AnimationEvent, CSSProperties, RefObject } from 'react'

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
}

interface VisualTurn extends PendingTurn {
  phase: 'playing'
  under: HTMLElement | null
  underSide: 'left' | 'right' | 'single' | null
  front: HTMLElement
  back: HTMLElement | null
  duration: number
}

type TurnState = (PendingTurn & { phase: 'capture' }) | VisualTurn | null

interface JournalPageTurnContextValue {
  isTurning: boolean
  requestPageTurn: (direction: JournalTurnDirection, commit: () => void, expectedSearch?: string) => boolean
  turn: TurnState
  finish: (id: number) => void
}

interface JournalPageTurnRequestDetail {
  direction: JournalTurnDirection
  commit: () => void
  expectedSearch?: string
  handled: boolean
  accepted: boolean
}

export const JOURNAL_PAGE_TURN_EVENT = 'mm-journal-page-turn-request'

/** Lets a form above JournalShell request a turn without moving its live form/provider tree. */
export function requestJournalPageTurnFrom(source: HTMLElement | null, direction: JournalTurnDirection, commit: () => void, expectedSearch?: string) {
  const book = source?.closest<HTMLElement>('.mm-journal-book') ?? source?.querySelector<HTMLElement>('.mm-journal-book')
  if (!book) {
    commit()
    return true
  }
  const detail: JournalPageTurnRequestDetail = { direction, commit, expectedSearch, handled: false, accepted: false }
  book.dispatchEvent(new CustomEvent<JournalPageTurnRequestDetail>(JOURNAL_PAGE_TURN_EVENT, { bubbles: true, cancelable: true, detail }))
  if (!detail.handled) {
    commit()
    return true
  }
  return detail.accepted
}

const defaultContext: JournalPageTurnContextValue = {
  isTurning: false,
  requestPageTurn: (_direction, commit) => { commit(); return true },
  turn: null,
  finish: () => undefined,
}

const JournalPageTurnContext = createContext<JournalPageTurnContextValue>(defaultContext)

export function useJournalPageTurn() {
  const { isTurning, requestPageTurn } = useContext(JournalPageTurnContext)
  return { isTurning, requestPageTurn }
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
    if (copy) copy.scrollTop = element.scrollTop
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

  clone.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })
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
  if (!(source instanceof HTMLElement) || getComputedStyle(source).display === 'none') return null
  const clone = source.cloneNode(true) as HTMLElement
  withCurrentFormValues(source, clone)
  sanitizeSnapshot(clone, prefix)
  return clone
}

function takePageSnapshot(book: HTMLElement, layout: JournalTurnLayout, prefix: string): PageSnapshot {
  if (layout === 'single') {
    return { left: null, right: null, single: clonePage(book.querySelector('.mm-journal-page'), prefix) }
  }
  return {
    left: clonePage(book.querySelector('.mm-journal-flyleaf'), `${prefix}-left`),
    right: clonePage(book.querySelector('.mm-journal-page'), `${prefix}-right`),
    single: null,
  }
}

export function JournalPageTurnLayer({ turn, finish }: { turn: TurnState; finish: (id: number) => void }) {
  const underLeft = useRef<HTMLDivElement>(null)
  const underRight = useRef<HTMLDivElement>(null)
  const underSingle = useRef<HTMLDivElement>(null)
  const frontFace = useRef<HTMLDivElement>(null)
  const backFace = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const containers = [underLeft.current, underRight.current, underSingle.current, frontFace.current, backFace.current]
    containers.forEach((container) => container?.replaceChildren())
    if (!turn || turn.phase !== 'playing') return
    const underTarget = turn.underSide === 'left' ? underLeft.current
      : turn.underSide === 'right' ? underRight.current
        : turn.underSide === 'single' ? underSingle.current : null
    if (underTarget && turn.under) underTarget.appendChild(turn.under)
    if (frontFace.current) frontFace.current.appendChild(turn.front)
    if (backFace.current && turn.back) backFace.current.appendChild(turn.back)
    return () => containers.forEach((container) => container?.replaceChildren())
  }, [turn])

  if (!turn || turn.phase !== 'playing') return null
  const leafClass = `mm-turn-leaf mm-turn-leaf--${turn.direction}`
  const leafStyle = { '--mm-turn-duration': `${turn.duration}ms` } as CSSProperties
  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) finish(turn.id)
  }

  return <div className="mm-page-turn-layer" data-journal-page-turn="true" data-direction={turn.direction} data-layout={turn.layout} data-duration={turn.duration} aria-hidden="true" inert>
    {turn.under && <div ref={underLeft} className="mm-turn-under mm-turn-under--left" />}
    {turn.under && <div ref={underRight} className="mm-turn-under mm-turn-under--right" />}
    {turn.under && <div ref={underSingle} className="mm-turn-under mm-turn-under--single" />}
    {turn.layout === 'spread' && <>
      <div className={`mm-turn-cast mm-turn-cast--${turn.direction === 'forward' ? 'right' : 'left'} mm-turn-cast--reveal`} />
      <div className={`mm-turn-cast mm-turn-cast--${turn.direction === 'forward' ? 'left' : 'right'} mm-turn-cast--land`} />
    </>}
    <div key={turn.id} className={leafClass} style={leafStyle} data-direction={turn.direction} data-layout={turn.layout} onAnimationEnd={onAnimationEnd}>
      <div ref={frontFace} className="mm-turn-face mm-turn-face--front"><div className="mm-turn-shade" /></div>
      <div ref={backFace} className={`mm-turn-face mm-turn-face--back${turn.back ? '' : ' mm-turn-face--blank'}`}><div className="mm-turn-shade" /></div>
    </div>
  </div>
}

export function useJournalPageTurnManager({
  bookRef,
  pathname,
  search,
  singleLayout,
  reducedMotion,
}: {
  bookRef: RefObject<HTMLDivElement | null>
  pathname: string
  search: string
  singleLayout: boolean
  reducedMotion: boolean
}) {
  const [turn, setTurn] = useState<TurnState>(null)
  const pending = useRef<PendingTurn | null>(null)
  const active = useRef(false)
  const sequence = useRef(0)

  const finish = useCallback((id: number) => {
    if (pending.current?.id !== id) return
    pending.current = null
    active.current = false
    setTurn((current) => current?.id === id ? null : current)
  }, [])

  const requestPageTurn = useCallback((direction: JournalTurnDirection, commit: () => void, expectedSearch?: string) => {
    if (active.current) return false
    const book = bookRef.current
    const layout: JournalTurnLayout = singleLayout ? 'single' : 'spread'
    const id = ++sequence.current
    const old = book ? takePageSnapshot(book, layout, `mm-turn-${id}-old`) : { left: null, right: null, single: null }
    if (!book || (layout === 'single' ? !old.single : !old.right)) {
      commit()
      return true
    }
    if (reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      commit()
      return true
    }

    const pendingTurn: PendingTurn = { id, direction, layout, old, pathname, search, expectedSearch }
    pending.current = pendingTurn
    active.current = true
    setTurn({ ...pendingTurn, phase: 'capture' })
    try {
      commit()
    } catch (error) {
      pending.current = null
      active.current = false
      setTurn(null)
      throw error
    }
    return true
  }, [bookRef, pathname, search, singleLayout, reducedMotion])

  useLayoutEffect(() => {
    if (!turn || turn.phase !== 'capture') return
    const request = pending.current
    const book = bookRef.current
    if (!request || request.id !== turn.id || !book) return finish(turn.id)
    const next = takePageSnapshot(book, request.layout, `mm-turn-${request.id}-next`)
    let under: HTMLElement | null = null
    let underSide: VisualTurn['underSide'] = null
    let front: HTMLElement | null = null
    let back: HTMLElement | null = null
    if (request.layout === 'spread') {
      if (request.direction === 'forward') {
        front = request.old.right
        back = next.left
        under = request.old.left
        underSide = 'left'
      } else {
        front = request.old.left
        back = next.right
        under = request.old.right
        underSide = 'right'
      }
    } else if (request.direction === 'forward') {
      front = request.old.single
    } else {
      front = next.single
      under = request.old.single
      underSide = 'single'
    }
    if (!front) return finish(request.id)
    const duration = request.layout === 'spread' ? 820 : 620
    setTurn({ ...request, phase: 'playing', under, underSide, front, back, duration })
  }, [turn, bookRef, finish])

  useLayoutEffect(() => {
    if (!turn || turn.phase !== 'playing') return
    const request = pending.current
    if (!request || request.id !== turn.id) return finish(turn.id)
    if (pathname !== request.pathname) return finish(turn.id)
    if (search !== request.search) {
      if (request.expectedSearch === search) request.expectedSearch = undefined
      else return finish(turn.id)
    }
  }, [turn, pathname, search, finish])

  useLayoutEffect(() => {
    if (!turn || turn.phase !== 'playing') return
    const id = turn.id
    const timer = window.setTimeout(() => finish(id), turn.duration + 80)
    return () => window.clearTimeout(timer)
  }, [turn, finish])

  useLayoutEffect(() => {
    if (!turn) return
    if (turn.layout !== (singleLayout ? 'single' : 'spread') || reducedMotion) finish(turn.id)
  }, [turn, singleLayout, reducedMotion, finish])

  useEffect(() => () => {
    pending.current = null
    active.current = false
  }, [])

  const value: JournalPageTurnContextValue = { isTurning: active.current || turn !== null, requestPageTurn, turn, finish }
  return { contextValue: value, turn, finish, isTurning: value.isTurning }
}

export { JournalPageTurnContext }
