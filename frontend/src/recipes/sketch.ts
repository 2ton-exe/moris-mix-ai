export type SketchKind = 'bowl' | 'pan' | 'cake' | 'bread' | 'noodles' | 'pot' | 'egg' | 'cup'

const RULES: Array<[SketchKind, RegExp]> = [
  ['cup', /\b(coffee|tea|latte|chai|smoothie|lemonade|cocktail|drink|juice|cocoa)\b/i],
  ['cake', /\b(cake|cheesecake|tart|pie|brownie|cookie|muffin|cupcake|pancake|waffle|crumble|dessert)s?\b/i],
  ['bread', /\b(bread|focaccia|loaf|toast|bun|bagel|sourdough|brioche|baguette|scone|pizza)s?\b/i],
  ['noodles', /\b(pasta|spaghetti|noodle|soba|ramen|udon|ragù|ragu|lasagne|lasagna|linguine|tagliatelle|gnocchi|pad thai)s?\b/i],
  ['egg', /\b(egg|eggs|shakshuka|omelette|omelet|frittata|quiche)\b/i],
  ['pot', /\b(stew|dal|dhal|chili|chilli|braise|curry|casserole|goulash|risotto)\b/i],
  ['bowl', /\b(soup|salad|bowl|poke|porridge|oats|broth|congee)s?\b/i],
]

/** Picks an illustrated placeholder for scraps without a photo. */
export function sketchFor(title: string): SketchKind {
  for (const [kind, pattern] of RULES) {
    if (pattern.test(title)) return kind
  }
  return 'pan'
}
