import { describe, expect, it } from 'vitest'
import { mapExtractedRecipeToDraft } from './recipeDraft'
import type { ExtractedRecipe } from './extractRecipe'

const extraction: ExtractedRecipe = {
  title: 'Garlic soy rice',
  ingredients: [
    { name: 'rice', quantity: 2, unit: 'cups', inferred: false },
    { name: 'soy sauce', quantity: null, unit: null, quantityText: 'a splash', inferred: true },
    { name: 'garlic', quantity: null, unit: null, inferred: true },
  ],
  instructions: [{ step: 1, text: 'Warm the rice, then stir in the sauce and garlic.' }],
  flavor_scores: { sweet: 0, salty: 4, sour: 0, bitter: 0, umami: 3, spicy: 0 },
}

describe('mapExtractedRecipeToDraft', () => {
  it('maps editable recipe fields and preserves uncertain ingredient metadata', () => {
    expect(mapExtractedRecipeToDraft(extraction)).toEqual({
      title: 'Garlic soy rice',
      ingredients: [
        { name: 'rice', quantity: 2, unit: 'cups', inferred: false },
        { name: 'soy sauce', quantity: null, unit: null, quantityText: 'a splash', inferred: true },
        { name: 'garlic', quantity: null, unit: null, inferred: true },
      ],
      instructions: [{ step: 1, text: 'Warm the rice, then stir in the sauce and garlic.' }],
      star_rating: null,
      cooked_at: null,
      notes: '',
    })
  })

  it('rejects extraction data that the recipe draft schema cannot represent', () => {
    expect(mapExtractedRecipeToDraft({ ...extraction, title: '   ' })).toBeNull()
  })

  it('does not put optional flavor estimates into recipe form data', () => {
    const mapped = mapExtractedRecipeToDraft(extraction)
    expect(mapped).not.toHaveProperty('flavor_scores')
    expect(extraction.flavor_scores).toEqual({ sweet: 0, salty: 4, sour: 0, bitter: 0, umami: 3, spicy: 0 })
  })
})
