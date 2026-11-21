import type { IngredientSticker } from '../journal/scrapbookRegistry'
import { ingredientArtworkKey } from './ingredientEmoji'

// Whole-food artwork uses exact phrases. Broader classifier aliases still use Twemoji.
const ingredientStickers: ReadonlyMap<string, IngredientSticker> = new Map([
  ['tomato', 'tomato'], ['tomatoes', 'tomato'], ['cherry tomato', 'tomato'], ['cherry tomatoes', 'tomato'],
  ['rice', 'rice-bowl'], ['white rice', 'rice-bowl'], ['brown rice', 'rice-bowl'], ['jasmine rice', 'rice-bowl'], ['basmati rice', 'rice-bowl'],
  ['egg', 'egg'], ['eggs', 'egg'], ['large egg', 'egg'], ['large eggs', 'egg'],
  ['garlic', 'garlic'], ['garlic clove', 'garlic'], ['garlic cloves', 'garlic'],
  ['lemon', 'lemon'], ['lemons', 'lemon'], ['strawberry', 'strawberry'], ['strawberries', 'strawberry'],
  ['mushroom', 'mushroom'], ['mushrooms', 'mushroom'], ['button mushrooms', 'mushroom'],
  ['chili', 'chili'], ['chilli', 'chili'], ['chilies', 'chili'], ['chillies', 'chili'],
  ['chili pepper', 'chili'], ['chili peppers', 'chili'], ['chilli pepper', 'chili'], ['chilli peppers', 'chili'],
  ['pork', 'pork'], ['salt', 'salt'], ['sea salt', 'salt'], ['kosher salt', 'salt'], ['chocolate', 'chocolate'],
])

export function ingredientStickerFor(name: string): IngredientSticker | undefined {
  const phrase = ingredientArtworkKey(name)
  if (/^(?:(?:apple cider|balsamic|rice|white|red wine) )?vinegar$|^olive oil$/.test(phrase)) return 'pantry-bottle'
  if (/^(?:(?:black|white) )?pepper(?:corns?)?$/.test(phrase)) return 'peppercorns'
  return ingredientStickers.get(phrase)
}
