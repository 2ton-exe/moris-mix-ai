import { describe, expect, it } from 'vitest'
import { ingredientStickerFor } from './scrapbookIngredient'
import { ingredientEmojiFor } from './ingredientEmoji'

describe('scrapbook ingredient artwork', () => {
  it.each([
    [' Tomatoes ', 'tomato'], ['cherry   tomatoes', 'tomato'], ['BROWN RICE', 'rice-bowl'],
    ['large eggs', 'egg'], ['garlic cloves', 'garlic'], ['strawberries', 'strawberry'],
    ['lemons', 'lemon'], ['button mushrooms', 'mushroom'], ['chilli peppers', 'chili'],
    ['pork', 'pork'], ['rice vinegar', 'pantry-bottle'], ['black peppercorns', 'peppercorns'],
  ])('uses %s artwork', (name, asset) => expect(ingredientStickerFor(name)).toBe(asset))

  it.each([
    ['tomato sauce', '🍅'], ['garlic powder', '🧄'], ['chili flakes', '🌶️'],
    ['sausages', '🥩'], ['carrots', '🥕'], ['unknown ingredient', '🍽️'], ['constructor', '🍽️'],
  ])('preserves the emoji fallback for %s', (name, emoji) => {
    expect(ingredientStickerFor(name)).toBeUndefined()
    expect(ingredientEmojiFor(name)).toBe(emoji)
  })
})
