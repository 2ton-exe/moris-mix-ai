import { ingredientEmojiFor } from './ingredientEmoji'

export function IngredientEmoji({ name }: { name: string }) {
  const emoji = ingredientEmojiFor(name)
  const codePoint = Array.from(emoji, (character) => character.codePointAt(0)?.toString(16))
    .filter((point) => point && point !== 'fe0f')
    .join('-')

  return <img
    className="recipe-ingredient-emoji"
    src={`/twemoji/svg/${codePoint}.svg`}
    alt=""
    aria-hidden="true"
    loading="lazy"
    draggable={false}
  />
}
