import { createRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { JournalShell } from '../journal/JournalShell'
import { RecipeReading } from './RecipeReading'
import type { RecipeDetail } from './types'

const measured = vi.hoisted(() => ({ single: false, pages: [['ingredient-0', 'ingredient-1'], ['ingredient-2'], ['instruction-0', 'instruction-1', 'note-0', 'note-1', 'flavors']] }))
vi.mock('../journal/useJournalMedia', () => ({ useJournalMedia: () => measured.single }))
vi.mock('./useReadingPagination', () => ({ useReadingPagination: () => ({
  bodyRef: createRef(), leftRef: createRef(), bankRef: createRef(), measurable: false,
  layout: { pages: measured.pages, capacity: 400, oversized: ['instruction-1'] },
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

beforeEach(() => { measured.single = false })

it('turns through facing leaves with live announcements and preserves route return state', async () => {
  render(<MemoryRouter initialEntries={[{ pathname: '/app/recipes/reading-test', search: '?keep=value', state: { journalReturn: '/app/recipes?entry=6' } }]}><RouteView /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: recipe.title })).toBeTruthy()
  expect(screen.getByText('Rice')).toBeTruthy()
  expect(screen.queryByText('Salt')).toBeNull()
  expect((screen.getByRole('button', { name: 'Previous Page' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next Page' }))
  await screen.findByText('Salt')
  expect(screen.queryByRole('heading', { name: recipe.title })).toBeNull()
  expect(screen.getByText('Cook gently.')).toBeTruthy()
  expect(screen.getByText('First paragraph.')).toBeTruthy()
  expect(screen.getByText('Last paragraph.')).toBeTruthy()
  const indicator = screen.getByText('Page 2 of 2')
  expect(indicator.getAttribute('aria-live')).toBe('polite')
  expect(indicator.getAttribute('aria-atomic')).toBe('true')
  expect((screen.getByRole('button', { name: 'Next Page' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByTestId('location').textContent).toContain('?keep=value&read=ingredient-2')
  expect(screen.getByTestId('location').textContent).toContain('"journalReturn":"/app/recipes?entry=6"')
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
  await screen.findByRole('heading', { name: recipe.title })
  fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
  await screen.findByText('Salt')
})

it('restores a direct content anchor and keeps that item through reflow and data updates', async () => {
  const view = render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=ingredient-2']}><RouteView /></MemoryRouter>)
  expect(screen.getByText('Salt')).toBeTruthy()
  measured.single = true
  view.rerender(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=ingredient-2']}><RouteView data={{ ...recipe, notes: 'Updated notes.' }} /></MemoryRouter>)
  expect(screen.getByText('Page 3 of 4')).toBeTruthy()
  expect(screen.getByText('Salt')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: recipe.title })).toBeNull()
  fireEvent.keyDown(screen.getByRole('region', { name: 'Recipe ingredients, instructions and notes' }), { key: 'ArrowRight' })
  await screen.findByText('Updated notes.')
  expect(screen.getByText('Page 4 of 4')).toBeTruthy()
})

it('provides a named bounded region for an oversized step and leaves its scroll keys alone', async () => {
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=ingredient-2']}><RouteView /></MemoryRouter>)
  const fallback = screen.getByRole('region', { name: /method|In the kitchen, instruction 1. Scroll to continue/ })
  expect(screen.getByText('Long entry · scroll to continue')).toBeTruthy()
  expect(fallback.textContent).toContain(recipe.instructions[0].text)
  expect(fallback.getAttribute('tabindex')).toBe('0')
  expect(fallback.style.maxHeight).not.toBe('')
  fireEvent.keyDown(fallback, { key: 'ArrowLeft' })
  expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('region', { name: 'Left recipe page' }), { key: 'PageUp' })
  await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeTruthy())
})

it('opens the first spread safely when a direct URL names an unavailable content anchor', () => {
  render(<MemoryRouter initialEntries={['/app/recipes/reading-test?read=removed-entry']}><RouteView /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: recipe.title })).toBeTruthy()
  expect(screen.getByText('Rice')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Previous Page' }) as HTMLButtonElement).disabled).toBe(true)
})
