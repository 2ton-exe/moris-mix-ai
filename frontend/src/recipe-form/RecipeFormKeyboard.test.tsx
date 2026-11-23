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
function mockMatchMedia(single: boolean, reducedMotion: boolean, desktop = false) {
  matchMediaDescriptor ??= Object.getOwnPropertyDescriptor(window, 'matchMedia')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : query.includes('min-width') ? desktop : query.includes('max-width') && single,
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

it('shares desktop rating and note controls across create and edit while keeping stickers on new recipes', () => {
  mockMatchMedia(false, true, true)
  const { rerender } = render(<MemoryRouter><JournalShell mode="writing">
    <RecipeForm key="edit" mode="edit" initialValues={manyRows} notesSupported />
  </JournalShell></MemoryRouter>)

  expect(document.querySelector('.recipe-form')?.classList.contains('mm-recipe-form-editor')).toBe(true)
  expect(screen.getByRole('group', { name: 'Rating' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clear rating' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Expand notes' })).toBeTruthy()
  expect(document.querySelector('.mm-scrapbook-form__tape')).toBeNull()

  rerender(<MemoryRouter><JournalShell mode="writing">
    <RecipeForm key="create" mode="create" newRecipeScrapbook notesSupported />
  </JournalShell></MemoryRouter>)
  expect(document.querySelector('.mm-new-recipe')).toBeTruthy()
  expect(document.querySelector('.mm-scrapbook-form__tape')).toBeTruthy()
})

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
  fireEvent.click(screen.getByRole('button', { name: /^Next(?::| Pages?$)/ }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
  else Reflect.deleteProperty(window, 'matchMedia')
  matchMediaDescriptor = undefined
})

it('turns a writing page with PageDown even if its content has a scroll range', () => {
  renderForm()
  const leaf = firstLeaf()
  setScrollGeometry(leaf)

  expect(fireEvent.keyDown(leaf, { key: 'PageDown' })).toBe(false)
  expect(pageIndex()).toBe('1')
})

it('turns backward with PageUp even if its content has a scroll range', () => {
  renderForm()
  nextPage()
  const leaf = firstLeaf()
  setScrollGeometry(leaf, { scrollTop: 120 })

  expect(fireEvent.keyDown(leaf, { key: 'PageUp' })).toBe(false)
  expect(pageIndex()).toBe('0')
})

it('does not consume PageUp on the first page or PageDown on the final page', () => {
  renderForm()
  const first = firstLeaf()
  setScrollGeometry(first, { scrollHeight: 100, clientHeight: 100 })
  expect(fireEvent.keyDown(first, { key: 'PageUp' })).toBe(true)
  expect(pageIndex()).toBe('0')

  while (screen.queryByRole('button', { name: /^Next(?::| Pages?$)/ })) nextPage()
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
    screen.getByLabelText(/^Cooked date(?: \(optional\))?$/),
    screen.getByLabelText(/^Rating(?: \(optional\))?$/),
    screen.getByRole('button', { name: /^Next(?::| Pages?$)/ }),
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
])('uses PageDown to turn through the $name even when its ancestor could scroll', ({ single, scrollElement }) => {
  renderForm({ single })
  const leaf = firstLeaf()
  const spread = document.querySelector<HTMLElement>('.mm-journal-spread')!
  if (scrollElement === 'leaf') setScrollGeometry(leaf)
  else {
    setScrollGeometry(leaf, { overflowY: 'visible' })
    setScrollGeometry(spread)
  }

  expect(fireEvent.keyDown(leaf, { key: 'PageDown' })).toBe(false)
  expect(pageIndex()).toBe('1')
})

it('does not consume an arrow key when the journal rejects an overlapping page turn', () => {
  renderForm({ reducedMotion: false })
  expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowRight' })).toBe(false)
  expect(pageIndex()).toBe('1')
  expect(document.querySelector('[data-journal-page-turn]')).toBeTruthy()

  expect(fireEvent.keyDown(firstLeaf(), { key: 'ArrowRight' })).toBe(true)
  expect(pageIndex()).toBe('1')
})


it('gives desktop image controls their own writing leaf', () => {
  mockMatchMedia(false, true, true)
  render(<MemoryRouter><RecipeForm mode="create" supplement={<section aria-label="Image controls">Choose a photo<input aria-label="Photo caption" defaultValue="" /></section>} /></MemoryRouter>)
  expect(screen.queryByRole('region', { name: 'Image controls' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Next(?::| Pages?$)/ }))
  expect(screen.getByRole('region', { name: 'Image controls' })).toBeTruthy()
  expect(screen.queryByLabelText('Recipe title')).toBeNull()
  fireEvent.change(screen.getByLabelText('Photo caption'), { target: { value: 'Keep this selection' } })
  fireEvent.click(screen.getByRole('button', { name: 'Previous Pages' }))
  fireEvent.click(screen.getByRole('button', { name: /^Next(?::| Pages?$)/ }))
  expect(screen.getByLabelText('Photo caption')).toHaveProperty('value', 'Keep this selection')
})
