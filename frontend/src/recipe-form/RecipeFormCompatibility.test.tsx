import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RecipeForm } from './RecipeForm'
import { recipeFormFixture } from './testing/fixtures'

it('opens legacy zero quantities and arbitrary units for editing without silently rewriting them', () => {
  const submit = vi.fn()
  render(<RecipeForm mode="edit" onSubmit={submit} initialValues={{ ...recipeFormFixture, notes: '', ingredients: [
    { name: 'flour', quantity: 0, unit: 'Grandma’s mug', inferred: false },
  ] }} />)
  const quantity = screen.getByLabelText('Ingredient 1 quantity')
  expect(quantity.getAttribute('value')).toBe('0')
  expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('value')).toBe('Grandma’s mug')
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(quantity.getAttribute('aria-invalid')).toBe('true')
  expect(submit).not.toHaveBeenCalled()
  fireEvent.change(quantity, { target: { value: '1/2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ ingredients: [
    { name: 'flour', quantity: 0.5, unit: 'Grandma’s mug', inferred: false },
  ] }), expect.anything())
})
