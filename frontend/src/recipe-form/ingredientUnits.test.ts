import { describe, expect, it } from 'vitest'
import { formatIngredient, ingredientUnits, isValidIngredientUnit, normalizeIngredientUnit, parseIngredientQuantity, scaleIngredientQuantity } from '../../../supabase/functions/_shared/ingredient-units.ts'

describe('ingredient units', () => {
  it.each([
    ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'], ['TBSP', 'tbsp'], ['teaspoons', 'tsp'],
    ['grams', 'g'], ['kilograms', 'kg'], ['milliliters', 'ml'], ['millilitres', 'ml'], ['mL', 'ml'],
    ['cups', 'cup'], ['pcs', 'piece'], ['pieces', 'piece'], ['cloves', 'clove'], ['ounces', 'oz'],
    ['litres', 'L'], ['liters', 'L'], ['pounds', 'lb'], ['pinches', 'pinch'], ['boxes', 'box'],
    ['T', 'tbsp'], ['t', 'tsp'], [' scoops ', 'scoop'], ['  heaped bamboo cup  ', 'heaped bamboo cup'],
    ['US cup', 'US cup'], ['fl oz', 'fl oz'], ['', null], ['   ', null], [null, null],
  ])('normalizes %s as %s without inventing capacities', (input, expected) => {
    expect(normalizeIngredientUnit(input)).toBe(expected)
  })
  it('has one canonical entry per unit and recognizes every catalog alias and plural', () => {
    expect(new Set(ingredientUnits.map((entry) => entry.unit)).size).toBe(ingredientUnits.length)
    for (const entry of ingredientUnits) {
      for (const value of [entry.unit, entry.plural, ...entry.aliases]) expect(normalizeIngredientUnit(value)).toBe(entry.unit)
    }
  })
  it('bounds custom units and rejects control characters without restricting ordinary cooking names', () => {
    expect(isValidIngredientUnit('')).toBe(true)
    expect(isValidIngredientUnit('a'.repeat(100))).toBe(true)
    expect(isValidIngredientUnit('a'.repeat(101))).toBe(false)
    expect(isValidIngredientUnit('mug\nfull')).toBe(false)
    expect(isValidIngredientUnit('mug\u0000full')).toBe(false)
    expect(isValidIngredientUnit('½-cup tin (400 g)')).toBe(true)
  })
})

describe('ingredient quantities and presentation', () => {
  it.each([['1/2', 0.5], ['1 1/2', 1.5], ['½', 0.5], ['1½', 1.5], ['1 ½', 1.5], ['2.5', 2.5], ['.5', 0.5], ['1e2', 100], ['', null]])('parses %s', (input, expected) => {
    expect(parseIngredientQuantity(input)).toBe(expected)
  })
  it.each(['many', '1/0', '1/2/3', '1 2 3', 'Infinity', 'NaN', '0x10', '1e999'])('rejects invalid quantity %s', (input) => {
    expect(Number.isNaN(parseIngredientQuantity(input))).toBe(true)
  })
  it.each([
    [{ name: 'garlic', quantity: 2, unit: 'clove' }, '2 cloves garlic'],
    [{ name: 'eggs', quantity: 2, unit: null }, '2 eggs'],
    [{ name: 'Salt', quantity: null, unit: null, quantityText: 'to taste' }, 'Salt, to taste'],
    [{ name: 'Oil', quantity: 1, unit: 'tsp', quantityText: 'as needed' }, 'Oil, as needed'],
    [{ name: 'seasoning', quantity: 1, unit: 'sachet' }, '1 sachet seasoning'],
    [{ name: 'milk', quantity: 0.5, unit: 'cups' }, '½ cup milk'],
    [{ name: 'milk', quantity: 1.5, unit: 'cup' }, '1½ cups milk'],
    [{ name: 'salt', quantity: 2, unit: 'pinch' }, '2 pinches salt'],
    [{ name: 'flour', quantity: 2, unit: 'Grandma’s mug' }, '2 Grandma’s mug flour'],
    [{ name: 'garlic, finely chopped', quantity: 2, unit: 'cloves' }, '2 cloves garlic, finely chopped'],
  ])('formats ingredient amounts', (ingredient, expected) => expect(formatIngredient(ingredient)).toBe(expected))
  it('restores structured presentation when a description is removed without mutating amounts', () => {
    const ingredient = { name: 'Oil', quantity: 1, unit: 'tsp', quantityText: 'as needed' }
    expect(formatIngredient(ingredient)).toBe('Oil, as needed')
    expect(formatIngredient({ ...ingredient, quantityText: '' })).toBe('1 tsp Oil')
    expect(ingredient).toEqual({ name: 'Oil', quantity: 1, unit: 'tsp', quantityText: 'as needed' })
  })
  it.each(['cup', 'clove', 'pinch', 'can', 'Grandma’s mug', null])('scales numeric %s without conversion', (unit) => {
    expect(scaleIngredientQuantity({ quantity: 2, unit }, 2)).toBe(4)
  })
  it('does not scale an overridden or unspecified amount and rejects invalid factors', () => {
    expect(scaleIngredientQuantity({ quantity: 1, unit: 'tsp', quantityText: 'as needed' }, 2)).toBe(1)
    expect(scaleIngredientQuantity({ quantity: null, unit: null }, 2)).toBeNull()
    for (const factor of [0, -1, NaN, Infinity]) expect(() => scaleIngredientQuantity({ quantity: 1 }, factor)).toThrow()
  })
})
