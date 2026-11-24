import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import { AboutPage, HomePage, NotFoundPage } from './PublicJournalPages'

it('previews the approved demo recipe and links to its full page', () => {
  render(<MemoryRouter><HomePage /></MemoryRouter>)

  const preview = screen.getByRole('region', { name: 'Demonstration recipe excerpt' })
  expect(within(preview).getByRole('heading', { name: fixture.recipe.title })).toBeTruthy()
  for (const ingredient of fixture.recipe.ingredients) {
    const amount = ingredient.quantity === null ? '' : `${ingredient.quantity} ${ingredient.unit} `
    expect(preview.textContent?.toLowerCase()).toContain(`${amount}${ingredient.name}`.toLowerCase())
  }
  expect(preview.textContent).toContain(fixture.recipe.instructions[0].text)
  expect(within(preview).getByRole('link', { name: 'Read the full sample recipe' }).getAttribute('href')).toBe('/demo-recipe')
  expect(screen.getByText(/Keep recipes and notes in one private journal\. Quick AI Entry turns rough notes into editable drafts\./)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Start a private journal' }).getAttribute('href')).toBe('/signup')
  expect(screen.getByRole('link', { name: 'Log in to your journal' }).getAttribute('href')).toBe('/login')
  expect(screen.getByRole('link', { name: 'See how the journal works' }).getAttribute('href')).toBe('/about')
})

it('shows a compact editable-recipe example and a direct signup action', () => {
  render(<MemoryRouter><AboutPage /></MemoryRouter>)

  const workflow = screen.getByRole('region', { name: 'From note to recipe' })
  expect(workflow.textContent).toContain('Eggs, garlic, leftover rice, soy sauce.')
  expect(workflow.textContent).toContain('Garlic egg fried rice')
  expect(workflow.textContent).toContain('Review the draft, then choose Save recipe to add it to My recipes.')
  expect(workflow.textContent).toContain('After signup: New recipe to write, Quick AI Entry for notes, or AI Chef for pantry ideas.')
  expect(screen.getByRole('link', { name: 'Read a sample recipe' }).getAttribute('href')).toBe('/demo-recipe')
  expect(screen.getByRole('link', { name: 'Start a private journal' }).getAttribute('href')).toBe('/signup')
  expect(screen.getByRole('link', { name: 'Log in to your journal' }).getAttribute('href')).toBe('/login')
})

it('offers concise public recovery routes for a missing page', () => {
  render(<MemoryRouter><NotFoundPage /></MemoryRouter>)

  expect(screen.getByText('Start at Home, or read a sample recipe without an account.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to home page' }).getAttribute('href')).toBe('/home')
  expect(screen.getByRole('link', { name: 'View sample recipe' }).getAttribute('href')).toBe('/demo-recipe')
})

it('explains journal recovery and keeps My recipes as the primary route', () => {
  render(<MemoryRouter><NotFoundPage journal /></MemoryRouter>)

  expect(screen.getByText('If you followed an old recipe link, search saved recipes by title.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Search saved recipes' }).getAttribute('href')).toBe('/app/recipes?view=index')
  expect(screen.getByRole('link', { name: 'Browse saved recipes' }).getAttribute('href')).toBe('/app/recipes')
  expect(screen.queryByRole('link', { name: 'View sample recipe' })).toBeNull()
})
