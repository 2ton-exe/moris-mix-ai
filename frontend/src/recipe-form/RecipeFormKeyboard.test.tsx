import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { JournalShell } from '../journal/JournalShell'
import { RecipeForm } from './RecipeForm'
import { recipeFormFixture } from './testing/fixtures'

const manyRows = {
  ...recipeFormFixture,
  ingredients: Array.from({ length: 8 }, (_, index) => ({
    name: `Ingredient ${index + 1}`, quantity: index + 1, unit: 'cups', inferred: false,
  })),
  instructions: Array.from({ length: 8 }, (_, index) => ({ step: index + 1, text: `Step ${index + 1}.` })),
}

let matchMediaDescriptor: PropertyDescriptor | undefined
function mockMatchMedia(single: boolean, reducedMotion: boolean) {
  matchMediaDescriptor ??= Object.getOwnPropertyDescriptor(window, 'matchMedia')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : query.includes('max-width') && single,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

function renderForm({ single = false, reducedMotion = true, renderFrame }: {
  single?: boolean
  reducedMotion?: boolean
  renderFrame?: (content: React.ReactNode) => React.ReactNode
} = {}) {
  mockMatchMedia(single, reducedMotion)
  return render(<MemoryRouter initialEntries={['/app/recipes/new']}>
    <JournalShell mode="writing">
      <RecipeForm mode="edit" initialValues={manyRows} renderFrame={renderFrame} />
    </JournalShell>
  </MemoryRouter>)
}

function pageIndex() {
  return document.querySelector('.mm-writing-pages')?.getAttribute('data-form-page')
}

function firstLeaf() {
  return document.querySelector<HTMLElement>('.mm-writing-leaf')!
}

function setScrollGeometry(element: HTMLElement, { overflowY = 'auto', scrollHeight = 400, clientHeight = 100, scrollTop = 0 } = {}) {
  element.style.overflowY = overflowY
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  })
  element.scrollTop = scrollTop
}

function nextPage() {
  fireEvent.click(document.querySelector<HTMLButtonElement>('.mm-writing-turns button:last-child')!)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
  else Reflect.deleteProperty(window, 'matchMedia')
  matchMediaDescriptor = undefined
})

it('keeps PageDown available to scroll an overflowing desktop writing leaf', () => {
  renderForm()
  const leaf = firstLeaf()
  setScrollGeometry(leaf)

  expect(fireEvent.keyDown(leaf, { key: 'PageDown' })).toBe(true)
  expect(pageIndex()).toBe('0')
})

it('keeps PageUp available to scroll upward without turning pages', () => {
  renderForm()
  const leaf = firstLeaf()
  setScrollGeometry(leaf, { scrollTop: 120 })

  expect(fireEvent.keyDown(leaf, { key: 'PageUp' })).toBe(true)
  expect(pageIndex()).toBe('0')
})

it('turns forward only when PageDown reaches the bottom of a writing leaf', () => {
  renderForm()
  const leaf = firstLeaf()
  setScrollGeometry(leaf, { scrollTop: 298 })

  expect(fireEvent.keyDown(leaf, { key: 'PageDown' })).toBe(false)
  expect(pageIndex()).toBe('1')
})

it('turns backward only when PageUp reaches the top of a writing leaf', () => {
  renderForm()
  nextPage()
  const leaf = firstLeaf()
  setScrollGeometry(leaf)

  expect(fireEvent.keyDown(leaf, { key: 'PageUp' })).toBe(false)
  expect(pageIndex()).toBe('0')
})

it('does not consume PageUp on the first page or PageDown on the final page', () => {
  renderForm()
  const first = firstLeaf()
  setScrollGeometry(first, { scrollHeight: 100, clientHeight: 100 })
  expect(fireEvent.keyDown(first, { key: 'PageUp' })).toBe(true)
  expect(pageIndex()).toBe('0')

  while (!(document.querySelector<HTMLButtonElement>('.mm-writing-turns button:last-child')?.disabled)) nextPage()
  const last = firstLeaf()
  setScrollGeometry(last, { scrollHeight: 100, clientHeight: 100 })
  const finalPage = pageIndex()
  expect(fireEvent.keyDown(last, { key: 'PageDown' })).toBe(true)
  expect(pageIndex()).toBe(finalPage)
})

it('keeps valid arrow navigation and leaves invalid arrow turns unconsumed', () => {
  renderForm()
  const leaf = firstLeaf()
  expect(fireEvent.keyDown(leaf, { key: 'ArrowLeft' })).toBe(true)
  expect(pageIndex()).toBe('0')
  expect(fireEvent.keyDown(leaf, { key: 'ArrowRight' })).toBe(false)
  expect(pageIndex()).toBe('1')
  expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowLeft' })).toBe(false)
  expect(pageIndex()).toBe('0')
  expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowLeft' })).toBe(true)
})

it('preserves native key behavior in controls, links, editable content, and with modifiers', () => {
  renderForm({ renderFrame: (content) => <>
    <a href="#help">Help link</a>
    <div contentEditable="true" suppressContentEditableWarning>Editable note</div>
    {content}
  </> })
  const targets = [
    screen.getByLabelText('Recipe title'),
    screen.getByLabelText('Cooked date'),
    screen.getByLabelText('Rating'),
    screen.getByRole('button', { name: 'Next Pages' }),
    screen.getByRole('link', { name: 'Help link' }),
    screen.getByText('Editable note'),
  ]
  for (const target of targets) {
    expect(fireEvent.keyDown(target, { key: 'PageDown' })).toBe(true)
    expect(pageIndex()).toBe('0')
  }
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
    expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowRight', [modifier]: true })).toBe(true)
    expect(pageIndex()).toBe('0')
  }
})

it.each([
  { name: 'desktop leaf', single: false, scrollElement: 'leaf' as const },
  { name: 'mobile spread ancestor', single: true, scrollElement: 'spread' as const },
])('preserves native PageDown scrolling through the $name scroll region', ({ single, scrollElement }) => {
  renderForm({ single })
  const leaf = firstLeaf()
  const spread = document.querySelector<HTMLElement>('.mm-journal-spread')!
  if (scrollElement === 'leaf') setScrollGeometry(leaf)
  else {
    setScrollGeometry(leaf, { overflowY: 'visible' })
    setScrollGeometry(spread)
  }

  expect(fireEvent.keyDown(leaf, { key: 'PageDown' })).toBe(true)
  expect(pageIndex()).toBe('0')
})

it('does not consume an arrow key when the journal rejects an overlapping page turn', () => {
  renderForm({ reducedMotion: false })
  expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowRight' })).toBe(false)
  expect(pageIndex()).toBe('1')
  expect(document.querySelector('[data-journal-page-turn]')).toBeTruthy()

  expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowRight' })).toBe(true)
  expect(pageIndex()).toBe('1')
})
