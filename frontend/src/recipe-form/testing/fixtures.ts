import type { RecipeDraft } from '../draft'

// Test-only frontend draft. No mock persistence adapter is shipped in the app.
export const recipeFormFixture: RecipeDraft = {
  title: 'A bowl of ginger rice',
  ingredients: [
    { name: 'rice', quantity: 2, unit: 'cups', inferred: false },
    { name: 'ginger', quantity: null, unit: null, quantityText: 'A small piece', inferred: true },
  ],
  instructions: [{ step: 1, text: 'Prepare the rice.' }, { step: 2, text: 'Add ginger.\nCook until tender.' }],
  star_rating: 4, cooked_at: '2026-10-19', notes: 'A family favorite.\nTry a little more ginger next time.',
}
