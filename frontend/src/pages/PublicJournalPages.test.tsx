import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import { AboutPage, HomePage } from './PublicJournalPages'

it('previews the approved demo recipe and links to its full page', () => {
  render(<MemoryRouter><HomePage /></MemoryRouter>)

  const preview = screen.getByRole('region', { name: 'Demonstration recipe excerpt' })
  expect(within(preview).getByRole('heading', { name: fixture.recipe.title })).toBeTruthy()
  for (const ingredient of fixture.recipe.ingredients) {
    const amount = ingredient.quantity === null ? '' : `${ingredient.quantity} ${ingredient.unit} `
    expect(preview.textContent?.toLowerCase()).toContain(`${amount}${ingredient.name}`.toLowerCase())
  }
  expect(preview.textContent).toContain(fixture.recipe.instructions[0].text)
  expect(within(preview).getByRole('link', { name: 'Read the demonstration recipe' }).getAttribute('href')).toBe('/demo-recipe')
})

it('shows the real recipe-keeping workflow on the about page', () => {
  render(<MemoryRouter><AboutPage /></MemoryRouter>)

  const workflow = screen.getByRole('region', { name: 'Keep the notes that help next time.' })
  expect(within(workflow).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'Save the ingredients and cooking steps.',
    'Rate the dish and add a note about what you’d change.',
    'Open the recipe again when you cook it next time.',
  ])
})
