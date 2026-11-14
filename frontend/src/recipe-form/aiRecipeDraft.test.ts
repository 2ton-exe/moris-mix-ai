import { describe, expect, it } from 'vitest'
import { mapAiRecipeToDraft } from './aiRecipeDraft'

describe('shared AI recipe mapping', () => {
  it('preserves ingredient names, unknown measurements, inference markers, and step order without guessing', () => {
    expect(mapAiRecipeToDraft({
      title: 'Pantry noodles',
      ingredients: [
        { name: 'noodles', quantity: null, unit: null, quantityText: 'a handful', inferred: true },
        { name: 'soy sauce', quantity: 1, unit: 'tablespoon', inferred: false },
      ],
      instructions: [
        { step: 1, text: 'Boil the noodles.' },
        { step: 2, text: 'Stir in the soy sauce.' },
      ],
      flavor_scores: { sweet: 0, salty: 3, sour: 0, bitter: 0, umami: 4, spicy: 1 },
    })).toMatchObject({
      title: 'Pantry noodles',
      ingredients: [
        { name: 'noodles', quantity: null, unit: null, quantityText: 'a handful', inferred: true },
        { name: 'soy sauce', quantity: 1, unit: 'tablespoon', inferred: false },
      ],
      instructions: [{ step: 1, text: 'Boil the noodles.' }, { step: 2, text: 'Stir in the soy sauce.' }],
      star_rating: null,
      cooked_at: null,
      notes: '',
    })
  })

  it('returns null when a generated field cannot be represented by the recipe editor', () => {
    expect(mapAiRecipeToDraft({
      title: ' ', ingredients: [], instructions: [],
    })).toBeNull()
  })
})
