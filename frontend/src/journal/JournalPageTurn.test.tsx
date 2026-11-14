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
  const [draft, setDraft] = useState('one persistent draft')
  const [order, setOrder] = useState(['rice', 'ginger'])

  const turn = (next: number) => requestPageTurn(next > page ? 'forward' : 'backward', () => setPage(next))

  return <>
    <JournalFacingPage><h2 id="left-title">Left page {page}</h2></JournalFacingPage>
    <section aria-label="Right page">
      <h1 id="right-title">Right page {page}</h1>
      <form aria-label="One live recipe form">
        <label htmlFor="recipe-title">Recipe title</label>
        <input id="recipe-title" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <ol>{order.map((item) => <li key={item}>{item}</li>)}</ol>
        <button type="button" onClick={() => setOrder((items) => [...items].reverse())}>Reorder ingredients</button>
      </form>
      <button type="button" disabled={page === 0 || isTurning} onClick={() => turn(page - 1)}>Previous</button>
      <button type="button" disabled={isTurning} onClick={() => turn(page + 1)}>Next</button>
      <button type="button" data-testid="repeat-turn" onClick={() => turn(page + 1)}>Repeat turn</button>
    </section>
    <output data-testid="probe-location">{location.pathname}</output>
  </>
}

function renderProbe(initialPath = '/app/recipes/new') {
  return render(<MemoryRouter initialEntries={[initialPath]}><JournalShell mode="writing"><TurnProbe /></JournalShell></MemoryRouter>)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
  else Reflect.deleteProperty(window, 'matchMedia')
  matchMediaDescriptor = undefined
})

it('turns forward and backward with one inert snapshot, blocks overlap, and cleans up on animation end', () => {
  renderProbe()
  const form = screen.getByRole('form', { name: 'One live recipe form' })
  const input = screen.getByLabelText('Recipe title') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'edited draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reorder ingredients' }))

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  const layer = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(layer.dataset.direction).toBe('forward')
  expect(layer.dataset.layout).toBe('spread')
  expect(layer.dataset.duration).toBe('820')
  expect(layer.getAttribute('aria-hidden')).toBe('true')
  expect(layer.hasAttribute('inert')).toBe(true)
  expect(screen.getByRole('heading', { name: 'Right page 1' })).toBeTruthy()
  expect(screen.getByRole('form', { name: 'One live recipe form' })).toBe(form)
  expect((within(form).getByLabelText('Recipe title') as HTMLInputElement).value).toBe('edited draft')
  expect(within(form).getByText('ginger').compareDocumentPosition(within(form).getByText('rice')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

  const snapshots = [...layer.querySelectorAll<HTMLElement>('[data-journal-turn-snapshot]')]
  expect(snapshots.length).toBeGreaterThan(0)
  expect(snapshots.every((snapshot) => snapshot.hasAttribute('inert') && snapshot.getAttribute('aria-hidden') === 'true')).toBe(true)
  const copiedInput = snapshots.flatMap((snapshot) => [...snapshot.querySelectorAll<HTMLInputElement>('input')])[0]
  expect(copiedInput.disabled).toBe(true)
  expect(copiedInput.tabIndex).toBe(-1)
  expect(copiedInput.value).toBe('edited draft')
  expect(copiedInput.id).not.toBe('recipe-title')
  expect([...document.querySelectorAll('form')].filter((candidate) => !candidate.closest('[inert]'))).toHaveLength(1)

  fireEvent.click(screen.getByTestId('repeat-turn'))
  expect(screen.getByRole('heading', { name: 'Right page 1' })).toBeTruthy()
  expect(document.querySelectorAll('[data-journal-page-turn]')).toHaveLength(1)

  fireEvent.animationEnd(layer.querySelector('.mm-turn-leaf')!)
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  const reverse = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(reverse.dataset.direction).toBe('backward')
  expect(reverse.dataset.duration).toBe('820')
  fireEvent.animationEnd(reverse.querySelector('.mm-turn-leaf')!)
  expect(screen.getByRole('heading', { name: 'Right page 0' })).toBeTruthy()
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
})

it('uses the single-page timing and cancels a snapshot when a route interrupts the turn', () => {
  mockMatchMedia((query) => query.includes('max-width') && window.innerWidth <= 1099)

  function RouteProbe() {
    const { requestPageTurn } = useJournalPageTurn()
    const location = useLocation()
    const navigate = useNavigate()
    const [page, setPage] = useState(0)
    return <>
      <p>{location.pathname} · page {page}</p>
      <button onClick={() => requestPageTurn('forward', () => setPage(1))}>Start single turn</button>
      <button onClick={() => void navigate('/app/recipes/reading')}>Leave route</button>
    </>
  }

  render(<MemoryRouter initialEntries={['/app/recipes']}><JournalShell><RouteProbe /></JournalShell></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Start single turn' }))
  const layer = document.querySelector<HTMLElement>('[data-journal-page-turn]')!
  expect(layer.dataset.layout).toBe('single')
  expect(layer.dataset.duration).toBe('620')
  expect(layer.querySelectorAll('.mm-turn-cast')).toHaveLength(0)
  expect(screen.getByText('/app/recipes · page 1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Leave route' }))
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
})

it('commits without a turn layer when reduced motion is enabled', () => {
  mockMatchMedia((query) => query.includes('prefers-reduced-motion'))
  renderProbe()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Right page 1' })).toBeTruthy()
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
})
