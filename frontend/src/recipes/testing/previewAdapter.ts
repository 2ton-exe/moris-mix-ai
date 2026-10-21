import { HttpError } from '../../api/http'
import type { RecipeDetail, RecipeSource } from '../types'

// Synthetic fixtures for opt-in development preview and tests only.
export const previewRecipes: RecipeDetail[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Ginger and garlic rice',
    ingredients: [
      { name: 'cooked rice', quantity: 2, unit: 'cups', inferred: false },
      { name: 'ginger', quantity: 1, unit: 'tbsp', inferred: false },
      { name: 'garlic', quantity: 2, unit: 'cloves', inferred: false },
      { name: 'salt', quantity: null, unit: null, quantityText: 'To taste', inferred: false },
    ],
    instructions: [
      { step: 1, text: 'Warm a little oil in a pan. Add the ginger and garlic and stir until fragrant.' },
      { step: 2, text: 'Add the cooked rice and stir until hot. Season to taste and serve.' },
    ],
    star_rating: 4,
    cooked_at: '2026-10-18',
    flavor_scores: { sweet: 0, salty: 3, sour: 0, bitter: 0, umami: 3, spicy: 1 },
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Lemon chickpea salad',
    ingredients: [
      { name: 'cooked chickpeas', quantity: 1, unit: 'cup', inferred: false },
      { name: 'lemon juice', quantity: 1, unit: 'tbsp', inferred: false },
      { name: 'olive oil', quantity: 1, unit: 'tbsp', inferred: false },
    ],
    instructions: [{ step: 1, text: 'Toss the chickpeas with lemon juice and olive oil. Season to taste.' }],
    star_rating: null,
    cooked_at: null,
  },
]

export const previewRecipeSource: RecipeSource = {
  mode: 'preview',
  list: async ({ signal }) => {
    signal.throwIfAborted()
    return previewRecipes.map(({ id, title, star_rating, cooked_at }) => ({ id, title, star_rating, cooked_at }))
  },
  detail: async (id, { signal }) => {
    signal.throwIfAborted()
    const recipe = previewRecipes.find((recipe) => recipe.id === id)
    if (!recipe) throw new HttpError('http', 'Recipe not found.', 404)
    return structuredClone(recipe)
  },
}
