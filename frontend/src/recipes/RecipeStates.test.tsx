import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { RecipeReadingSkeleton, RecipeSkeleton } from './RecipeStates'
import { RecipeCollectionCardContent, RecipeIndexCardContent } from './RecipeCard'

afterEach(cleanup)
it('uses collection artwork and copy slots rather than a generic grid', () => {
  const { container } = render(<RecipeSkeleton />)
  expect(screen.getByRole('status').textContent).toContain('Loading your recipes')
  expect(container.querySelectorAll('.mm-collection-entry')).toHaveLength(2)
  expect(container.querySelectorAll('.mm-recipe-artwork')).toHaveLength(2)
  expect(container.querySelectorAll('.mm-collection-entry.is-flipped')).toHaveLength(1)
  expect(container.querySelector('ul')?.hasAttribute('inert')).toBe(true)
})
it('uses the index layout for search result placeholders', () => {
  const { container } = render(<RecipeSkeleton index />)
  expect(container.querySelectorAll('.mm-index-card')).toHaveLength(3)
  expect(container.querySelectorAll('.mm-index-card__number')).toHaveLength(3)
  expect(container.querySelector('.mm-recipe-artwork')).toBeNull()
})
it('keeps the loading announcement outside busy content and hides inert pagination', () => {
  const { container } = render(<MemoryRouter><RecipeReadingSkeleton back={<a href="/app">Back to recipes</a>} /></MemoryRouter>)
  expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull()
  expect(container.querySelectorAll('.mm-reading-identity')).toHaveLength(2)
  expect(container.querySelector('.mm-pagination-half')?.getAttribute('aria-hidden')).toBe('true')
  expect(container.querySelector('.mm-pagination-half')?.hasAttribute('inert')).toBe(true)
})
it('shares title and metadata hierarchy between real and placeholder card content', () => {
  const recipe = { id: 'one', title: 'Tomato rice', star_rating: 4 }
  const { container, rerender } = render(<RecipeCollectionCardContent folio={1} />)
  expect(container.querySelector('.mm-collection-entry__title .mm-skeleton-line')).toBeTruthy()
  rerender(<RecipeCollectionCardContent recipe={recipe} folio={1} />)
  expect(screen.getByText('Tomato rice')).toBeTruthy()
  rerender(<RecipeIndexCardContent />)
  expect(container.querySelector('h2 .mm-skeleton-line')).toBeTruthy()
  rerender(<RecipeIndexCardContent recipe={recipe} />)
  expect(screen.getByRole('heading', { name: 'Tomato rice' })).toBeTruthy()
})
