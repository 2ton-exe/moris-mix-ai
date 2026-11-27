import { describe, expect, it } from 'vitest'
import { addPantryItems, MAX_PANTRY_ITEM_CHARS, MAX_PANTRY_ITEMS, pantryEntryErrorMessage, splitPastedPantryText } from './pantry'

describe('pantry ingredient tokens', () => {
  it('trims values, skips case-insensitive duplicates, and preserves the first label', () => {
    expect(addPantryItems(['Rice'], ['  rice ', 'eggs', ' Eggs '])).toEqual({
      items: ['Rice', 'eggs'], added: 1, duplicates: 2, duplicateIdentities: ['rice', 'egg'], error: null,
    })
  })

  it('uses the same identity for bulk aliases, plurals, and existing entries', () => {
    expect(addPantryItems(['Green onions', 'Tomato'], [' scallions ', 'tomatoes', 'aubergines', 'eggplant', 'chickpeas', 'garbanzo beans']))
      .toEqual({
        items: ['Green onions', 'Tomato', 'aubergines', 'chickpeas'], added: 2, duplicates: 4,
        duplicateIdentities: ['green onion', 'tomato', 'eggplant', 'chickpea'], error: null,
      })
  })

  it('rejects empty, oversized, and over-limit input without changing the current list', () => {
    const current = ['rice']
    expect(addPantryItems(current, ['  ']).error).toBe('empty')
    expect(pantryEntryErrorMessage('empty')).toContain('Enter a pantry ingredient')
    expect(addPantryItems(current, ['x'.repeat(MAX_PANTRY_ITEM_CHARS + 1)])).toMatchObject({ items: current, error: 'too-long' })
    expect(addPantryItems(current, Array.from({ length: MAX_PANTRY_ITEMS }, (_, index) => `item-${index}`))).toMatchObject({ items: current, error: 'too-many' })
    expect(pantryEntryErrorMessage('too-many')).toContain(String(MAX_PANTRY_ITEMS))
  })

  it('accepts exactly the backend item and character limits', () => {
    const items = Array.from({ length: MAX_PANTRY_ITEMS }, (_, index) => `item-${index}`)
    items[0] = 'x'.repeat(MAX_PANTRY_ITEM_CHARS)
    expect(addPantryItems([], items).items).toHaveLength(MAX_PANTRY_ITEMS)
    expect(addPantryItems([], ['x'.repeat(MAX_PANTRY_ITEM_CHARS)]).error).toBeNull()
  })

  it('splits pasted comma and line-separated pantry items but preserves ordinary typed text', () => {
    expect(splitPastedPantryText(' rice, eggs\nsoy sauce ')).toEqual(['rice', 'eggs', 'soy sauce'])
    expect(splitPastedPantryText('  brown sugar  ')).toEqual(['  brown sugar  '])
  })
})
