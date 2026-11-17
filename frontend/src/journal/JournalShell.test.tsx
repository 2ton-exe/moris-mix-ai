import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { JournalShell } from './JournalShell'

it('keeps public bookmarks beside the signed-in recipe navigation', () => {
  render(<MemoryRouter initialEntries={['/app/recipes']}><JournalShell><h1>My recipes</h1></JournalShell></MemoryRouter>)
  const recipes = screen.getByRole('navigation', { name: 'Journal sections' })
  expect(recipes.closest('.mm-desk')?.classList.contains('mm-desk--with-companion')).toBe(true)
  expect(within(recipes).getByRole('link', { name: 'My recipes' }).getAttribute('href')).toBe('/app/recipes')
  expect(within(recipes).getByRole('link', { name: 'New recipe' }).getAttribute('href')).toBe('/app/recipes/new')
  expect(within(recipes).getByRole('link', { name: 'Import recipe notes' }).getAttribute('href')).toBe('/app/quick-entry')
  expect(within(recipes).getByRole('link', { name: 'Suggest a recipe' }).getAttribute('href')).toBe('/app/chef')
  const bookmarks = screen.getByRole('navigation', { name: 'Journal bookmarks' })
  expect(within(bookmarks).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/home')
  expect(within(bookmarks).getByRole('link', { name: 'About' }).getAttribute('href')).toBe('/about')
  expect(within(bookmarks).getByRole('link', { name: 'Demo recipe' }).getAttribute('href')).toBe('/demo-recipe')
})

it('preserves public bookmarks and identifies the active page', () => {
  render(<MemoryRouter initialEntries={['/about']}><JournalShell publicNavigation><h1>About</h1></JournalShell></MemoryRouter>)
  const bookmarks = screen.getByRole('navigation', { name: 'Journal sections' })
  expect(within(bookmarks).getAllByRole('link')).toHaveLength(3)
  expect(within(bookmarks).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page')
  expect(screen.queryByRole('link', { name: 'My recipes' })).toBeNull()
  expect(screen.getByRole('navigation', { name: 'Journal sections' }).closest('.mm-desk')?.classList.contains('mm-desk--with-companion')).toBe(false)
})
