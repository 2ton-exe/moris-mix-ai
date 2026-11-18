import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JournalFacingPage } from './JournalFacingPage'
import { JournalShell } from './JournalShell'
import { useJournalPageTurn } from './JournalPageTurn'
import { TURN_DURATION } from './pageTurnMotion'

let matchMediaDescriptor: PropertyDescriptor | undefined
function mockMatchMedia(matches: (query: string) => boolean) {
  matchMediaDescriptor ??= Object.getOwnPropertyDescriptor(window, 'matchMedia')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  })
}

function TurnProbe() {
  const { isTurning, requestPageTurn } = useJournalPageTurn()
  const location = useLocation()
  const [page, setPage] = useState(0)
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  const visiblePage = previewPage ?? page
  const [draft, setDraft] = useState('one persistent draft')
  const [order, setOrder] = useState(['rice', 'ginger'])

  const turn = (next: number) => requestPageTurn(next > page ? 'forward' : 'backward', () => setPreviewPage(next), () => {
    setPage(next)
    setPreviewPage(null)
  }, undefined, () => setPreviewPage(null))

  return <>
    <JournalFacingPage><h2 id="left-title">Left page {visiblePage}</h2></JournalFacingPage>
    <section aria-label="Right page">
      <h1 id="right-title">Right page {visiblePage}</h1>
      <form aria-label="One live recipe form">
        <label htmlFor="recipe-title">Recipe title</label>
        <input id="recipe-title" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <ol>{order.map((item) => <li key={item}>{item}</li>)}</ol>
        <button type="button" onClick={() => setOrder((items) => [...items].reverse())}>Reorder ingredients</button>
      </form>
      <button type="button" data-testid="previous-page" disabled={visiblePage === 0 || isTurning} onClick={() => turn(visiblePage - 1)}>Previous</button>
      <button type="button" data-testid="next-page" disabled={isTurning} onClick={() => turn(page + 1)}>Next</button>
      <button type="button" data-testid="repeat-turn" onClick={() => turn(page + 1)}>Repeat turn</button>
    </section>
    <output data-testid="probe-location" data-committed-page={page}>{location.pathname}</output>
  </>
}

function renderProbe(initialPath = '/app/recipes/new') {
  return render(<MemoryRouter initialEntries={[initialPath]}><JournalShell mode="writing"><TurnProbe /></JournalShell></MemoryRouter>)
}

let frames = new Map<number, FrameRequestCallback>()
let frameId = 0
beforeEach(() => {
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
function advance(now = 0) {
  act(() => { const current = [...frames.values()]; frames.clear(); current.forEach((callback) => callback(now)) })
}
function sample(progress: number) {
  act(() => document.querySelector('[data-journal-page-turn]')?.dispatchEvent(new CustomEvent('mm-journal-turn-sample', { detail: progress })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
  else Reflect.deleteProperty(window, 'matchMedia')
  matchMediaDescriptor = undefined
})

it('previews without committing, preserves inert snapshots, blocks overlap, and commits exactly once after the shared controller settles', () => {
  renderProbe()
  const form = screen.getByRole('form', { name: 'One live recipe form' })
  const input = screen.getByLabelText('Recipe title') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'edited draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reorder ingredients' }))

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  advance()
  const layer = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(layer.dataset.direction).toBe('forward')
  expect(layer.dataset.layout).toBe('spread')
  expect(layer.dataset.duration).toBe(String(TURN_DURATION))
  expect(layer.getAttribute('aria-hidden')).toBe('true')
  expect(layer.hasAttribute('inert')).toBe(true)
  expect(document.querySelector('#right-title')?.textContent).toBe('Right page 1')
  expect(screen.getByTestId('probe-location').getAttribute('data-committed-page')).toBe('0')
  expect(form.isConnected).toBe(true)
  expect((within(form).getByLabelText('Recipe title') as HTMLInputElement).value).toBe('edited draft')
  expect(within(form).getByText('ginger').compareDocumentPosition(within(form).getByText('rice')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect((screen.getByTestId('next-page') as HTMLButtonElement).disabled).toBe(true)

  const snapshots = [...layer.querySelectorAll<HTMLElement>('[data-journal-turn-snapshot]')]
  expect(snapshots.length).toBeGreaterThan(0)
  expect(snapshots.every((snapshot) => snapshot.hasAttribute('inert') && snapshot.getAttribute('aria-hidden') === 'true')).toBe(true)
  expect(layer.querySelector('.mm-turn-under--left')?.textContent).toContain('Left page 0')
  expect(layer.querySelector('.mm-turn-face--front')?.textContent).toContain('Right page 0')
  expect(layer.querySelector('.mm-turn-face--back')?.textContent).toContain('Left page 1')
  const copiedInput = snapshots.flatMap((snapshot) => [...snapshot.querySelectorAll<HTMLInputElement>('input')])[0]
  expect(copiedInput.disabled).toBe(true)
  expect(copiedInput.tabIndex).toBe(-1)
  expect(copiedInput.value).toBe('edited draft')
  expect(copiedInput.id).not.toBe('recipe-title')
  expect(document.querySelector('.mm-journal-spread')?.hasAttribute('inert')).toBe(true)

  fireEvent.click(screen.getByTestId('repeat-turn'))
  expect(document.querySelector('#right-title')?.textContent).toBe('Right page 1')
  expect(document.querySelectorAll('[data-journal-page-turn]')).toHaveLength(1)

  sample(.54)
  expect(document.querySelector('[data-journal-page-turn]')).not.toBeNull()
  sample(1)
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(screen.getByTestId('probe-location').getAttribute('data-committed-page')).toBe('1')
  fireEvent.click(screen.getByTestId('previous-page'))
  advance()
  const reverse = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(reverse.dataset.direction).toBe('backward')
  expect(reverse.dataset.duration).toBe(String(TURN_DURATION))
  sample(1)
  expect(document.querySelector('#right-title')?.textContent).toBe('Right page 0')
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(frames.size).toBe(0)
})

it('uses one timing and cancels a preview when a route interrupts a single-page turn', () => {
  mockMatchMedia((query) => query.includes('max-width') && window.innerWidth <= 1099)

  function RouteProbe() {
    const { requestPageTurn } = useJournalPageTurn()
    const location = useLocation()
    const navigate = useNavigate()
    const [page, setPage] = useState(0)
    const [previewPage, setPreviewPage] = useState<number | null>(null)
    return <>
      <p data-testid="route-state">{location.pathname} · page {previewPage ?? page} · committed {page}</p>
      <button data-testid="start-single-turn" onClick={() => requestPageTurn('forward', () => setPreviewPage(1), () => { setPage(1); setPreviewPage(null) }, undefined, () => setPreviewPage(null))}>Start single turn</button>
      <button data-testid="leave-route" onClick={() => void navigate('/app/recipes/reading')}>Leave route</button>
    </>
  }

  render(<MemoryRouter initialEntries={['/app/recipes']}><JournalShell><RouteProbe /></JournalShell></MemoryRouter>)
  fireEvent.click(screen.getByTestId('start-single-turn'))
  advance()
  const layer = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(layer.dataset.layout).toBe('single')
  expect(layer.dataset.duration).toBe(String(TURN_DURATION))
  expect(layer.querySelectorAll('.mm-turn-cast')).toHaveLength(0)
  expect(screen.getByTestId('route-state').textContent).toBe('/app/recipes · page 1 · committed 0')
  fireEvent.click(screen.getByTestId('leave-route'))
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(screen.getByTestId('route-state').textContent).toBe('/app/recipes/reading · page 0 · committed 0')
})

it('commits without a turn layer when reduced motion is enabled', () => {
  mockMatchMedia((query) => query.includes('prefers-reduced-motion'))
  renderProbe()
  fireEvent.click(screen.getByTestId('next-page'))
  expect(document.querySelector('#right-title')?.textContent).toBe('Right page 1')
  expect(screen.getByTestId('probe-location').getAttribute('data-committed-page')).toBe('1')
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(frames.size).toBe(0)
})

function ReadinessProbe({ commit, cancel }: { commit: () => void; cancel: () => void }) {
  const { requestPageTurn } = useJournalPageTurn()
  const [preview, setPreview] = useState(false)
  const [ready, setReady] = useState('false')
  return <div data-journal-ready={preview ? ready : 'true'}>
    <p>{preview ? 'Destination' : 'Outgoing'}</p>
    <button data-testid="start" onClick={() => requestPageTurn('forward', () => setPreview(true), commit, undefined, () => { setPreview(false); cancel() })}>Start</button>
    <button data-testid="ready" onClick={() => setReady('true')}>Ready</button>
    <button data-testid="failure" onClick={() => setReady('error')}>Fail</button>
  </div>
}
function readinessProbe() {
  const commit = vi.fn(), cancel = vi.fn()
  const view = render(<MemoryRouter><JournalShell><ReadinessProbe commit={commit} cancel={cancel} /></JournalShell></MemoryRouter>)
  fireEvent.click(screen.getByTestId('start'))
  return { ...view, commit, cancel }
}
it('retains outgoing surfaces while critical data is delayed, ignores repeated input, and commits once', () => {
  const { commit, cancel } = readinessProbe()
  advance()
  expect(document.querySelector('[data-journal-page-turn]')?.textContent).toContain('Outgoing')
  expect(document.querySelector('.mm-turn-leaf')).toBeNull()
  fireEvent.click(screen.getByTestId('start'))
  fireEvent.click(screen.getByTestId('ready'))
  advance()
  expect(document.querySelector('.mm-turn-shade')).not.toBeNull()
  sample(.54)
  expect(commit).not.toHaveBeenCalled()
  sample(1)
  sample(1)
  advance(1200)
  expect(commit).toHaveBeenCalledTimes(1)
  expect(cancel).not.toHaveBeenCalled()
  expect(frames.size).toBe(0)
})
it('cancels failed preparation once and retains the original live content', () => {
  const { commit, cancel } = readinessProbe()
  fireEvent.click(screen.getByTestId('failure'))
  advance()
  expect(commit).not.toHaveBeenCalled()
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Outgoing')).toBeTruthy()
  expect(frames.size).toBe(0)
})
it('cancels pending readiness on unmount without committing', () => {
  const { commit, cancel, unmount } = readinessProbe()
  unmount()
  advance()
  expect(commit).not.toHaveBeenCalled()
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(frames.size).toBe(0)
})
it('settles an accepted animated request once when resized', () => {
  const { commit, cancel } = readinessProbe()
  fireEvent.click(screen.getByTestId('ready'))
  advance()
  sample(.4)
  fireEvent(window, new Event('resize'))
  fireEvent(window, new Event('resize'))
  expect(commit).toHaveBeenCalledTimes(1)
  expect(cancel).not.toHaveBeenCalled()
  expect(frames.size).toBe(0)
})
it('keeps the final paper mounted until the expected location acknowledges the commit', () => {
  const commit = vi.fn()
  function AcknowledgementProbe() {
    const { requestPageTurn } = useJournalPageTurn()
    const navigate = useNavigate()
    return <><p>Persistent route owner</p><button data-testid="ack-start" onClick={() => requestPageTurn('forward', () => undefined, commit, '?leaf=2')}>Start</button><button data-testid="ack-location" onClick={() => void navigate('?leaf=2')}>Acknowledge location</button></>
  }
  render(<MemoryRouter><JournalShell><AcknowledgementProbe /></JournalShell></MemoryRouter>)
  fireEvent.click(screen.getByTestId('ack-start'))
  advance()
  sample(1)
  expect(commit).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[data-journal-page-turn]')?.getAttribute('data-phase')).toBe('committing')
  sample(1)
  expect(commit).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByTestId('ack-location'))
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(frames.size).toBe(0)
})
it('waits for critical data after a resize interrupts preparation, then settles without motion', () => {
  const { commit } = readinessProbe()
  fireEvent(window, new Event('resize'))
  advance()
  expect(commit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('ready'))
  advance()
  expect(commit).toHaveBeenCalledTimes(1)
  expect(document.querySelector('.mm-turn-leaf')).toBeNull()
  expect(frames.size).toBe(0)
})
it('does not block on a delayed decorative image and preserves the visible scroll viewport', () => {
  function ImageProbe() {
    const { requestPageTurn } = useJournalPageTurn()
    return <div data-testid="scroller" style={{ overflow: 'auto', height: 100 }}><img src="/delayed-image.png" width="80" height="40" alt="Recipe illustration" /><p>Visible viewport</p><button data-testid="image-start" onClick={() => requestPageTurn('forward', () => undefined, () => undefined)}>Start</button></div>
  }
  render(<MemoryRouter><JournalShell><ImageProbe /></JournalShell></MemoryRouter>)
  screen.getByTestId('scroller').scrollTop = 42
  fireEvent.click(screen.getByTestId('image-start'))
  advance()
  expect(document.querySelector('.mm-turn-leaf')).not.toBeNull()
  expect(document.querySelector('.mm-turn-face--front [data-turn-scroll-top="42"]')?.scrollTop).toBe(42)
  expect(document.querySelector('.mm-turn-face--front img')?.getAttribute('style')).toContain('visibility: hidden')
  sample(1)
  expect(screen.getByTestId('scroller').scrollTop).toBe(42)
})

it('acknowledges reading readiness after commit without requiring a parent render', async () => {
  const commit = vi.fn()
  function SettledReadinessProbe() {
    const { requestPageTurn } = useJournalPageTurn()
    const [ready, setReady] = useState(true)
    return <div data-reading-ready={ready}>
      <button data-testid="settle-start" onClick={() => requestPageTurn('forward', () => undefined, () => { commit(); setReady(false) })}>Start</button>
      <button data-testid="settle-ready" onClick={() => setReady(true)}>Ready</button>
    </div>
  }
  render(<MemoryRouter><JournalShell><SettledReadinessProbe /></JournalShell></MemoryRouter>)
  fireEvent.click(screen.getByTestId('settle-start'))
  advance()
  sample(1)
  expect(document.querySelector('[data-journal-page-turn]')?.getAttribute('data-phase')).toBe('committing')
  fireEvent.click(screen.getByTestId('settle-ready'))
  await waitFor(() => expect(document.querySelector('[data-journal-page-turn]')).toBeNull())
  expect(commit).toHaveBeenCalledTimes(1)
  expect(frames.size).toBe(0)
})
it('reads readiness only from the live single paper, not its frozen outgoing snapshot', () => {
  mockMatchMedia((query) => query.includes('max-width'))
  const commit = vi.fn()
  function EarlyTurnProbe() {
    const { requestPageTurn } = useJournalPageTurn()
    const [ready, setReady] = useState(false)
    return <div data-reading-ready={ready}><button data-testid="early-turn" onClick={() => requestPageTurn('forward', () => setReady(true), commit)}>Turn</button></div>
  }
  render(<MemoryRouter><JournalShell><EarlyTurnProbe /></JournalShell></MemoryRouter>)
  fireEvent.click(screen.getByTestId('early-turn'))
  advance()
  expect(document.querySelector('[data-journal-page-turn]')?.getAttribute('data-phase')).toBe('animating')
  const under = document.querySelector('.mm-turn-under--single [data-journal-turn-snapshot]')
  const reverse = document.querySelector('.mm-turn-face--back [data-journal-turn-snapshot]')
  expect(under).not.toBeNull()
  expect(under).not.toBe(reverse)
  expect(under?.querySelector('[data-reading-ready]')?.getAttribute('data-reading-ready')).toBe('true')
  sample(1)
  expect(commit).toHaveBeenCalledTimes(1)
  expect(frames.size).toBe(0)
})
