import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { JournalShell } from './JournalShell'

it('keeps public links alongside the signed-in recipe tabs', () => {
  render(<MemoryRouter initialEntries={['/app/recipes']}><JournalShell><h1>My recipes</h1></JournalShell></MemoryRouter>)
  const recipes = screen.getByRole('navigation', { name: 'Journal sections' })
  expect(recipes.closest('.mm-desk')?.classList.contains('mm-desk--with-companion')).toBe(true)
  expect(within(recipes).getByRole('link', { name: 'My recipes' }).getAttribute('href')).toBe('/app/recipes')
  expect(within(recipes).getByRole('link', { name: 'New recipe' }).getAttribute('href')).toBe('/app/recipes/new')
  expect(within(recipes).getByRole('link', { name: 'AI Chef' }).getAttribute('href')).toBe('/app/chef')
  const bookmarks = screen.getByRole('navigation', { name: 'Public pages' })
  expect(within(bookmarks).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/home')
  expect(within(bookmarks).getByRole('link', { name: 'About' }).getAttribute('href')).toBe('/about')
  expect(within(bookmarks).getByRole('link', { name: 'Demo recipe' }).getAttribute('href')).toBe('/demo-recipe')
})

it('keeps AI Chef discoverable and current across its authenticated workflow', () => {
  for (const pathname of ['/app/chef', '/app/chef/review']) {
    const { unmount } = render(<MemoryRouter initialEntries={[pathname]}><JournalShell><h1>AI Chef</h1></JournalShell></MemoryRouter>)
    const navigation = screen.getByRole('navigation', { name: 'Journal sections' })
    expect(within(navigation).getByRole('link', { name: 'AI Chef' }).getAttribute('aria-current')).toBe('page')
    expect(within(navigation).getByRole('link', { name: 'My recipes' }).getAttribute('aria-current')).toBeNull()
    unmount()
  }
})

it('keeps Quick AI Entry current through draft review and keeps its direct destination', () => {
  const { unmount } = render(<MemoryRouter initialEntries={['/app/quick-entry/review']}><JournalShell><h1>Review</h1></JournalShell></MemoryRouter>)
  const sections = screen.getByRole('navigation', { name: 'Journal sections' })
  expect(within(sections).getByRole('link', { name: 'Quick AI Entry' }).getAttribute('aria-current')).toBe('page')
  expect(within(sections).getByRole('link', { name: 'My recipes' }).getAttribute('aria-current')).toBeNull()
  unmount()

  render(<MemoryRouter initialEntries={['/app/recipes?view=index&leaf=2']}><JournalShell><h1>Index</h1></JournalShell></MemoryRouter>)
  expect(within(screen.getByRole('navigation', { name: 'Journal sections' })).getByRole('link', { name: 'Quick AI Entry' }).getAttribute('href')).toBe('/app/quick-entry')
})

it('preserves public bookmarks and identifies the active page', () => {
  render(<MemoryRouter initialEntries={['/about']}><JournalShell publicNavigation><h1>About</h1></JournalShell></MemoryRouter>)
  const bookmarks = screen.getByRole('navigation', { name: 'Journal sections' })
  expect(bookmarks.closest('.mm-desk')?.classList.contains('mm-desk--with-companion')).toBe(false)
  expect(within(bookmarks).getAllByRole('link')).toHaveLength(3)
  expect(within(bookmarks).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page')
  expect(screen.queryByRole('link', { name: 'My recipes' })).toBeNull()
})
