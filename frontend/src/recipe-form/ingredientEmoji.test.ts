import { expect, it } from 'vitest'
import { genericIngredientEmoji, ingredientEmojiFor } from './ingredientEmoji'

it('uses explicit ingredient aliases and falls back without stripping distinguishing words', () => {
  expect(ingredientEmojiFor(' tomatoes ')).toBe(ingredientEmojiFor('tomato'))
  expect(ingredientEmojiFor('chicken breast')).toBe(ingredientEmojiFor('chicken'))
  expect(ingredientEmojiFor('green apples')).toBe(ingredientEmojiFor('green apple'))
  expect(ingredientEmojiFor('green apple')).not.toBe(ingredientEmojiFor('apple'))
  expect(ingredientEmojiFor('chicken broth')).toBe(genericIngredientEmoji)
  expect(ingredientEmojiFor('unlisted ingredient')).toBe(genericIngredientEmoji)
})
