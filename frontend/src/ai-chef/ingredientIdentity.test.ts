import { describe, expect, it } from 'vitest'
import { normalizePantryIngredient, uniquePantryIngredients } from '../../../supabase/functions/_shared/ingredient-identity.ts'

describe('shared pantry ingredient identity', () => {
  it('keeps the display label independent from case and whitespace normalization', () => {
    expect(normalizePantryIngredient('  GREEN   Onions\n')).toEqual({ identity: 'green onion', label: 'GREEN Onions' })
    expect(uniquePantryIngredients(['  Green   Onions', 'scallions', 'GREEN ONION'])).toEqual(['Green Onions'])
  })

  it.each([
    ['tomatoes', 'tomato'], ['potatoes', 'potato'], ['eggs', 'egg'],
    ['chicken breasts', 'chicken breast'], ['fresh basil leaves', 'fresh basil leaf'],
    ['courgettes', 'zucchini'], ['aubergines', 'eggplant'], ['garbanzo beans', 'chickpea'],
    ['chillies', 'chili'], ['chopped scallions', 'chopped green onion'],
    ['fresh coriander leaves', 'fresh cilantro'],
  ])('matches %s with %s', (left, right) => {
    expect(normalizePantryIngredient(left).identity).toBe(normalizePantryIngredient(right).identity)
  })

  it.each([
    ['chicken breast', 'chicken thigh'], ['chicken', 'ground chicken'],
    ['raw chicken', 'cooked chicken'], ['tomato', 'tomato sauce'],
    ['tomato', 'cherry tomato'], ['fresh tomato', 'canned tomato'],
    ['onion', 'green onion'], ['red onion', 'white onion'],
    ['cilantro', 'coriander seed'], ['chili', 'chili powder'],
    ['rice', 'rice flour'], ['black bean', 'green bean'],
    ['peas', 'pears'], ['bass', 'bas'], ['molasses', 'molasse'],
    ['diced tomato', 'whole tomato'], ['skinless chicken breast', 'chicken breast'],
  ])('preserves the distinction between %s and %s', (left, right) => {
    expect(normalizePantryIngredient(left).identity).not.toBe(normalizePantryIngredient(right).identity)
  })

  it('is idempotent and removes empty restored entries', () => {
    const normalized = uniquePantryIngredients([' ', ' Eggs ', 'egg', 'EGGS', 'rice'])
    expect(normalized).toEqual(['Eggs', 'rice'])
    expect(uniquePantryIngredients(normalized)).toEqual(normalized)
  })
})
