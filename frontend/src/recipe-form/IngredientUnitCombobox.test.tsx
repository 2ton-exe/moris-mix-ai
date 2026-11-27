import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { IngredientUnitCombobox } from './IngredientUnitCombobox'

function Editor({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><label htmlFor="unit">Ingredient unit</label>
    <IngredientUnitCombobox id="unit" value={value} onChange={setValue} />
    <button type="button">Outside</button></>
}
const input = () => screen.getByRole('combobox', { name: 'Ingredient unit' })
const type = (value: string) => fireEvent.change(input(), { target: { value } })

it('offers a short common list on focus and selects a standard unit', () => {
  render(<Editor />)
  fireEvent.focus(input())
  expect(screen.getAllByRole('option')).toHaveLength(6)
  fireEvent.click(screen.getByRole('option', { name: 'cup' }))
  expect(input()).toHaveProperty('value', 'cup')
  expect(input().getAttribute('aria-expanded')).toBe('false')
})

it('filters aliases and plurals, keeping case-sensitive cooking shorthand distinct', () => {
  render(<Editor />)
  type('tablespoons')
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['tbsp'])
  type('T')
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['tbsp'])
  type('t')
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['tsp'])
  type('sach')
  expect(screen.getByRole('option', { name: 'sachet' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'cup' })).toBeNull()
})

it('keeps custom values as text, offers their trimmed value, and allows clearing the unit', () => {
  render(<Editor initial="Grandma’s tea mug" />)
  expect(input()).toHaveProperty('value', 'Grandma’s tea mug')
  type('  <tea mug>  ')
  fireEvent.click(screen.getByRole('option', { name: 'Use "<tea mug>"' }))
  expect(input()).toHaveProperty('value', '<tea mug>')
  expect(document.querySelector('tea')).toBeNull()
  type('')
  fireEvent.blur(input())
  expect(input()).toHaveProperty('value', '')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('supports arrows and Enter selection, Escape dismissal, and Tab without trapping focus', () => {
  render(<Editor />)
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  expect(input().getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'tsp' }).id)
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'ArrowUp' })
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(input()).toHaveProperty('value', 'tsp')
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.focus(input())
  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  type('grams')
  fireEvent.keyDown(input(), { key: 'Tab' })
  fireEvent.blur(input())
  expect(input()).toHaveProperty('value', 'g')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('dismisses outside clicks and announces the available suggestions', async () => {
  render(<Editor />)
  fireEvent.focus(input())
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('6 unit suggestions'))
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('does not pass Escape to a containing editor while suggestions are open', () => {
  const parentKey = vi.fn()
  render(<div onKeyDown={parentKey}><Editor /></div>)
  fireEvent.focus(input())
  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(parentKey).not.toHaveBeenCalled()
})
