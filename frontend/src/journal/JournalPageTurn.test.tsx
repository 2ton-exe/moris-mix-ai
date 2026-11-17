import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { JournalFacingPage } from './JournalFacingPage'
import { JournalShell } from './JournalShell'
import { useJournalPageTurn } from './JournalPageTurn'

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

function transitionEnd(leaf: Element, propertyName: string) {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  fireEvent(leaf, event)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
  else Reflect.deleteProperty(window, 'matchMedia')
  matchMediaDescriptor = undefined
})

it('previews without committing, preserves inert snapshots, blocks overlap, and commits on transform transition end', () => {
  renderProbe()
  const form = screen.getByRole('form', { name: 'One live recipe form' })
  const input = screen.getByLabelText('Recipe title') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'edited draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reorder ingredients' }))

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  const layer = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(layer.dataset.direction).toBe('forward')
  expect(layer.dataset.layout).toBe('spread')
  expect(layer.dataset.duration).toBe('580')
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

  transitionEnd(layer.querySelector('.mm-turn-leaf')!, 'opacity')
  expect(document.querySelector('[data-journal-page-turn]')).not.toBeNull()
  transitionEnd(layer.querySelector('.mm-turn-leaf')!, 'transform')
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(screen.getByTestId('probe-location').getAttribute('data-committed-page')).toBe('1')
  fireEvent.click(screen.getByTestId('previous-page'))
  const reverse = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(reverse.dataset.direction).toBe('backward')
  expect(reverse.dataset.duration).toBe('580')
  transitionEnd(reverse.querySelector('.mm-turn-leaf')!, 'transform')
  expect(document.querySelector('#right-title')?.textContent).toBe('Right page 0')
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
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
  const layer = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(layer.dataset.layout).toBe('single')
  expect(layer.dataset.duration).toBe('580')
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
})
