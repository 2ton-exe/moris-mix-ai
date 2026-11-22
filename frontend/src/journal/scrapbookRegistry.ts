import chatBubble from '../assets/stickers/chat-bubble.svg?no-inline'
import chili from '../assets/stickers/chili.svg?no-inline'
import chocolate from '../assets/stickers/chocolate.svg?no-inline'
import clipboard from '../assets/stickers/clipboard.svg?no-inline'
import cookingPot from '../assets/stickers/cooking-pot.svg?no-inline'
import egg from '../assets/stickers/egg.svg?no-inline'
import flask from '../assets/stickers/flask.svg?no-inline'
import herbSprig from '../assets/stickers/herb-sprig.svg?no-inline'
import garlic from '../assets/stickers/garlic.svg?no-inline'
import ingredientBasket from '../assets/stickers/ingredient-basket.svg?no-inline'
import lemon from '../assets/stickers/lemon.svg?no-inline'
import mixingBowl from '../assets/stickers/mixing-bowl.svg?no-inline'
import mushroom from '../assets/stickers/mushroom.svg?no-inline'
import pantryBottle from '../assets/stickers/pantry-bottle.svg?no-inline'
import peppercorns from '../assets/stickers/peppercorns.svg?no-inline'
import pork from '../assets/stickers/pork.svg?no-inline'
import recipeBook from '../assets/stickers/recipe-book.svg?no-inline'
import riceBowl from '../assets/stickers/rice-bowl.svg?no-inline'
import salt from '../assets/stickers/salt.svg?no-inline'
import scrapbookHearts from '../assets/stickers/scrapbook-hearts.svg?no-inline'
import sparkle from '../assets/stickers/sparkle.svg?no-inline'
import strawberry from '../assets/stickers/strawberry.svg?no-inline'
import tomato from '../assets/stickers/tomato.svg?no-inline'

export const scrapbookRegistry = {
  'chat-bubble': { src: chatBubble, category: 'decoration', ingredientEligible: false, label: 'Chat bubble' },
  'chili': { src: chili, category: 'food', ingredientEligible: true, label: 'Chili' },
  'chocolate': { src: chocolate, category: 'food', ingredientEligible: true, label: 'Chocolate' },
  'clipboard': { src: clipboard, category: 'stationery', ingredientEligible: false, label: 'Clipboard' },
  'cooking-pot': { src: cookingPot, category: 'cooking', ingredientEligible: false, label: 'Cooking pot' },
  'egg': { src: egg, category: 'food', ingredientEligible: true, label: 'Egg' },
  'flask': { src: flask, category: 'decoration', ingredientEligible: false, label: 'Flask' },
  'garlic': { src: garlic, category: 'food', ingredientEligible: true, label: 'Garlic' },
  'herb-sprig': { src: herbSprig, category: 'decoration', ingredientEligible: false, label: 'Herb sprig' },
  'ingredient-basket': { src: ingredientBasket, category: 'decoration', ingredientEligible: false, label: 'Ingredient basket' },
  'lemon': { src: lemon, category: 'food', ingredientEligible: true, label: 'Lemon' },
  'mixing-bowl': { src: mixingBowl, category: 'cooking', ingredientEligible: false, label: 'Mixing bowl' },
  'mushroom': { src: mushroom, category: 'food', ingredientEligible: true, label: 'Mushroom' },
  'pantry-bottle': { src: pantryBottle, category: 'food', ingredientEligible: true, label: 'Pantry bottle' },
  'peppercorns': { src: peppercorns, category: 'food', ingredientEligible: true, label: 'Peppercorns' },
  'pork': { src: pork, category: 'food', ingredientEligible: true, label: 'Pork' },
  'recipe-book': { src: recipeBook, category: 'stationery', ingredientEligible: false, label: 'Recipe book' },
  'rice-bowl': { src: riceBowl, category: 'food', ingredientEligible: true, label: 'Rice bowl' },
  'salt': { src: salt, category: 'food', ingredientEligible: true, label: 'Salt' },
  'scrapbook-hearts': { src: scrapbookHearts, category: 'decoration', ingredientEligible: false, label: 'Scrapbook hearts' },
  'sparkle': { src: sparkle, category: 'decoration', ingredientEligible: false, label: 'Sparkle' },
  'strawberry': { src: strawberry, category: 'food', ingredientEligible: true, label: 'Strawberry' },
  'tomato': { src: tomato, category: 'food', ingredientEligible: true, label: 'Tomato' },
} as const

export type ScrapbookAsset = keyof typeof scrapbookRegistry
export type IngredientSticker = { [Name in ScrapbookAsset]: typeof scrapbookRegistry[Name]['ingredientEligible'] extends true ? Name : never }[ScrapbookAsset]
