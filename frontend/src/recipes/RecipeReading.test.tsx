import { createRef } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { JournalShell } from '../journal/JournalShell'
import { RecipeReading } from './RecipeReading'
import type { RecipeDetail } from './types'

const measured = vi.hoisted(() => ({ single: false, ready: true, pages: [['ingredient-0', 'ingredient-1'], ['ingredient-2'], ['instruction-0', 'instruction-1', 'instruction-1-part-1', 'instruction-1-part-2', 'instruction-1-part-3', 'instruction-1-part-4', 'instruction-1-part-5', 'instruction-1-part-6', 'note-0', 'note-1', 'flavors']] }))
vi.mock('../journal/useJournalMedia', () => ({ useJournalMedia: () => measured.single }))
vi.mock('./useReadingPagination', () => ({ useReadingPagination: () => ({
  bodyRef: createRef(), leftRef: createRef(), bankRef: createRef(), measurable: false, ready: measured.ready,
  textChunkSize: 600, layout: measured.ready ? { pages: measured.pages, capacity: 400, width: 400 } : null,
}) }))

const recipe: RecipeDetail = {
  id: 'reading-test', title: 'A recipe to keep', cooked_at: '2026-10-13', star_rating: 4,
  ingredients: ['Rice', 'Garlic', 'Salt'].map((name) => ({ name, quantity: null, unit: null, inferred: false })),
  instructions: [{ step: 5, text: 'Serve everything. '.repeat(200) }, { step: 2, text: 'Cook gently.' }],
  notes: 'First paragraph.\n\nLast paragraph.',
  flavor_scores: { sweet: 0, salty: 1, sour: 2, bitter: 3, umami: 4, spicy: 5 },
}

function RouteView({ data = recipe }: { data?: RecipeDetail }) {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <output data-testid="location">{location.pathname}{location.search}|{JSON.stringify(location.state)}</output>
    <button onClick={() => void navigate(-1)}>Browser back</button>
    <button onClick={() => void navigate(1)}>Browser forward</button>
    <JournalShell><RecipeReading recipe={data} back={<Link to="/app/recipes?entry=6">Back to recipes</Link>} /></JournalShell>
  </>
}

const live = () => within(document.querySelector<HTMLElement>('.mm-journal-book > .mm-journal-spread')!)

beforeEach(() => {
  measured.single = false
  measured.ready = true
  measured.pages = [['ingredient-0', 'ingredient-1'], ['ingredient-2'], ['instruction-0', 'instruction-1', 'instruction-1-part-1', 'instruction-1-part-2', 'instruction-1-part-3', 'instruction-1-part-4', 'instruction-1-part-5', 'instruction-1-part-6', 'note-0', 'note-1', 'flavors']]
})

async function finishPageTurn() {
  await waitFor(() => expect(document.querySelector('[data-journal-page-turn]')?.getAttribute('data-phase')).toBe('animating'))
  fireEvent(document.querySelector('[data-journal-page-turn]')!, new CustomEvent('mm-journal-turn-sample', { detail: 1 }))
}

it('leaves boundary PageUp/PageDown actions available and only cancels valid page turns', async () => {
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test']}><RouteView /></MemoryRouter>)
  const region = () => screen.getByRole('region', { name: 'Recipe ingredients, instructions and notes' })
  expect(fireEvent.keyDown(region(), { key: 'PageUp' })).toBe(true)
  expect(live().getByText('Pages 1–2 of 4')).toBeTruthy()
  expect(fireEvent.keyDown(region(), { key: 'PageDown' })).toBe(false)
  await live().findByText('Pages 3–4 of 4')
  expect(fireEvent.keyDown(region(), { key: 'PageDown' })).toBe(true)
  expect(live().getByText('Pages 3–4 of 4')).toBeTruthy()
  expect(document.querySelector('[data-journal-page-turn]')).not.toBeNull()
  await finishPageTurn()
  expect(document.querySelector('[data-journal-page-turn]')).toBeNull()
  expect(fireEvent.keyDown(region(), { key: 'PageUp' })).toBe(false)
  await live().findByText('Pages 1–2 of 4')
})

it('keeps the identity visible while measured page boundaries are prepared', () => {
  measured.ready = false
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test']}><RouteView /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: recipe.title })).toBeTruthy()
  expect(live().getByText('Preparing recipe pages…')).toBeTruthy()
  expect(live().queryByText(/Scroll this paper/)).toBeNull()
})

it('restores an exact content anchor without matching a longer entry prefix', () => {
  measured.pages = [['ingredient-10-part-1'], ['ingredient-1']]
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=ingredient-1']}><RouteView /></MemoryRouter>)
  expect(live().getByText('Page 3 of 3')).toBeTruthy()
})

it('uses PageDown for physical navigation even when an identity element has a scroll range', async () => {
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test']}><RouteView /></MemoryRouter>)
  const region = screen.getByRole('region', { name: 'Left recipe page' })
  Object.defineProperties(region, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 300 },
  })
  region.scrollTop = 100
  region.focus()

  expect(fireEvent.keyDown(region, { key: 'PageDown' })).toBe(false)
  await live().findByText('Pages 3–4 of 4')
  await finishPageTurn()
})

it('turns through facing leaves with live announcements and preserves route return state', async () => {
  render(<MemoryRouter initialEntries={[{ pathname: '/app/recipes/reading-test', search: '?keep=value', state: { journalReturn: '/app/recipes?entry=6' } }]}><RouteView /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: recipe.title })).toBeTruthy()
  expect(live().getByText('Rice')).toBeTruthy()
  expect(live().queryByText('Salt')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Previous Page' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Next Page' }))
  await waitFor(() => expect(document.querySelector('.mm-journal-spread')?.textContent).toContain('Salt'))
  expect(screen.getByTestId('location').textContent).toContain('?keep=value')
  expect(screen.getByTestId('location').textContent).not.toContain('read=ingredient-2')
  expect(screen.queryByRole('heading', { name: recipe.title })).toBeNull()
  expect(live().getByText('Cook gently.')).toBeTruthy()
  expect(live().getByText('First paragraph.')).toBeTruthy()
  expect(live().getByText('Last paragraph.')).toBeTruthy()
  const indicator = live().getByText('Pages 3–4 of 4')
  expect(indicator.getAttribute('aria-live')).toBe('polite')
  expect(indicator.getAttribute('aria-atomic')).toBe('true')
  expect(screen.queryByRole('button', { name: 'Next Page' })).toBeNull()
  expect(screen.getByTestId('location').textContent).toContain('?keep=value')
  expect(screen.getByTestId('location').textContent).not.toContain('read=ingredient-2')
  await finishPageTurn()
  expect(screen.getByTestId('location').textContent).toContain('?keep=value&read=ingredient-2')
  expect(screen.getByTestId('location').textContent).toContain('"journalReturn":"/app/recipes?entry=6"')
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
  await screen.findByRole('heading', { name: recipe.title })
  fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
  await live().findByText('Salt')
})

it('restores a direct content anchor and keeps that item through reflow and data updates', async () => {
  const view = render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=ingredient-2']}><RouteView /></MemoryRouter>)
  expect(live().getByText('Salt')).toBeTruthy()
  measured.single = true
  view.rerender(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=ingredient-2']}><RouteView data={{ ...recipe, notes: 'Updated notes.' }} /></MemoryRouter>)
  expect(live().getByText('Page 3 of 4')).toBeTruthy()
  expect(live().getByText('Salt')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: recipe.title })).toBeNull()
  fireEvent.keyDown(screen.getByRole('region', { name: 'Recipe ingredients, instructions and notes' }), { key: 'ArrowRight' })
  await live().findByText('Updated notes.')
  expect(live().getByText('Page 4 of 4')).toBeTruthy()
})

it('continues a long cooking step across measured units without an inner scroll region', async () => {
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=instruction-1']}><RouteView /></MemoryRouter>)
  const body = screen.getByRole('region', { name: 'Recipe ingredients, instructions and notes' })
  const paragraphs = Array.from(body.querySelectorAll('.mm-reading-method p'))
  expect(paragraphs.length).toBeGreaterThan(1)
  const visibleText = paragraphs.map((paragraph) => {
    const clone = paragraph.cloneNode(true) as HTMLParagraphElement
    clone.querySelectorAll('.visually-hidden').forEach((label) => label.remove())
    return clone.textContent
  }).join('')
  expect(visibleText).toContain(recipe.instructions[0].text)
  expect(getComputedStyle(body).overflowY).not.toBe('auto')
  expect(live().getByText('Pages 3–4 of 4')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('region', { name: 'Left recipe page' }), { key: 'PageUp' })
  await waitFor(() => expect(live().getByText('Pages 1–2 of 4')).toBeTruthy())
})

it('opens the first spread safely when a direct URL names an unavailable content anchor', () => {
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=removed-entry']}><RouteView /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: recipe.title })).toBeTruthy()
  expect(live().getByText('Rice')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Previous Page' })).toBeNull()
})


it('renders amount descriptions before structured quantities and restores amounts after editing', () => {
  const ingredient = { name: 'Oil', quantity: 1, unit: 'teaspoons', quantityText: 'as needed', inferred: false }
  const data = { ...recipe, ingredients: [ingredient] }
  const view = render(<MemoryRouter><RouteView data={data} /></MemoryRouter>)
  expect(live().getByText('Oil, as needed')).toBeTruthy()
  expect(live().queryByText('1 tsp Oil')).toBeNull()
  view.rerender(<MemoryRouter><RouteView data={{ ...data, ingredients: [{ ...ingredient, quantityText: '' }] }} /></MemoryRouter>)
  expect(live().getByText('1 tsp Oil')).toBeTruthy()
})
