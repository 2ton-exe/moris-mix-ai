// Shared by the browser and Edge Functions; keep this module dependency-free.
export const ingredientUnits = [
  { unit: 'tsp', aliases: ['teaspoon', 'teaspoons', 'tsp.', 't'], plural: 'tsp', category: 'volume' },
  { unit: 'tbsp', aliases: ['tablespoon', 'tablespoons', 'tbsp.', 'T'], plural: 'tbsp', category: 'volume' },
  { unit: 'cup', aliases: [], plural: 'cups', category: 'volume' },
  { unit: 'g', aliases: ['gram', 'grams', 'gramme', 'grammes'], plural: 'g', category: 'weight' },
  { unit: 'ml', aliases: ['milliliter', 'milliliters', 'millilitre', 'millilitres', 'mL'], plural: 'ml', category: 'volume' },
  { unit: 'kg', aliases: ['kilogram', 'kilograms', 'kilogramme', 'kilogrammes'], plural: 'kg', category: 'weight' },
  { unit: 'piece', aliases: ['pc', 'pcs'], plural: 'pieces', category: 'count' },
  { unit: 'clove', aliases: [], plural: 'cloves', category: 'count' },
  { unit: 'L', aliases: ['liter', 'liters', 'litre', 'litres', 'l'], plural: 'L', category: 'volume' },
  { unit: 'mg', aliases: ['milligram', 'milligrams'], plural: 'mg', category: 'weight' },
  { unit: 'oz', aliases: ['ounce', 'ounces'], plural: 'oz', category: 'weight' },
  { unit: 'lb', aliases: ['pound', 'pounds', 'lbs'], plural: 'lb', category: 'weight' },
  { unit: 'slice', aliases: [], plural: 'slices', category: 'count' },
  { unit: 'stalk', aliases: [], plural: 'stalks', category: 'count' },
  { unit: 'sprig', aliases: [], plural: 'sprigs', category: 'count' },
  { unit: 'head', aliases: [], plural: 'heads', category: 'count' },
  { unit: 'pinch', aliases: [], plural: 'pinches', category: 'informal' },
  { unit: 'dash', aliases: [], plural: 'dashes', category: 'informal' },
  { unit: 'handful', aliases: [], plural: 'handfuls', category: 'informal' },
  { unit: 'drop', aliases: [], plural: 'drops', category: 'informal' },
  { unit: 'can', aliases: [], plural: 'cans', category: 'packaging' },
  { unit: 'bottle', aliases: [], plural: 'bottles', category: 'packaging' },
  { unit: 'packet', aliases: [], plural: 'packets', category: 'packaging' },
  { unit: 'sachet', aliases: [], plural: 'sachets', category: 'packaging' },
  { unit: 'jar', aliases: [], plural: 'jars', category: 'packaging' },
  { unit: 'bag', aliases: [], plural: 'bags', category: 'packaging' },
  { unit: 'box', aliases: [], plural: 'boxes', category: 'packaging' },
  { unit: 'serving', aliases: [], plural: 'servings', category: 'portions' },
  { unit: 'scoop', aliases: [], plural: 'scoops', category: 'portions' },
];

export function normalizeIngredientUnit(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Cooking shorthand distinguishes tablespoon T from teaspoon t.
  if (trimmed === 'T') return 'tbsp';
  if (trimmed === 't') return 'tsp';
  const query = trimmed.toLowerCase();
  return ingredientUnits.find((entry) => [entry.unit, entry.plural, ...entry.aliases]
    .some((alias) => alias.toLowerCase() === query))?.unit ?? trimmed;
}

export function isValidIngredientUnit(value: string): boolean {
  return value.trim().length <= 100 && !/\p{Cc}/u.test(value);
}

const fractions = [
  ['½', 1, 2], ['⅓', 1, 3], ['⅔', 2, 3], ['¼', 1, 4], ['¾', 3, 4],
  ['⅛', 1, 8], ['⅜', 3, 8], ['⅝', 5, 8], ['⅞', 7, 8],
] satisfies [string, number, number][];

export function parseIngredientQuantity(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  for (const [symbol, numerator, denominator] of fractions) text = text.replace(symbol, ` ${numerator}/${denominator}`).trim();
  const fraction = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
  const quantity = fraction
    ? Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3])
    : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
  return Number.isFinite(quantity) ? quantity : NaN;
}

type IngredientAmount = { quantity: number | null; unit?: string | null; quantityText?: string };

export function scaleIngredientQuantity(ingredient: IngredientAmount, factor: number): number | null {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Scale must be a positive finite number.');
  if (ingredient.quantityText?.trim() || ingredient.quantity === null) return ingredient.quantity;
  const quantity = ingredient.quantity * factor;
  if (!Number.isFinite(quantity)) throw new RangeError('Scaled quantity must be finite.');
  return quantity;
}

export function formatIngredient(ingredient: IngredientAmount & { name: string }): string {
  const description = ingredient.quantityText?.trim();
  if (description) return `${ingredient.name}, ${description}`;
  const quantity = ingredient.quantity;
  const unit = normalizeIngredientUnit(ingredient.unit ?? null);
  const entry = ingredientUnits.find((item) => item.unit === unit);
  const displayUnit = entry && quantity !== null && quantity > 1 ? entry.plural : unit;
  const fraction = quantity === null ? undefined : fractions.find(([, numerator, denominator]) =>
    Math.abs(quantity % 1 - numerator / denominator) < 1e-8);
  const displayQuantity = quantity === null ? null : fraction
    ? `${Math.floor(quantity) || ''}${fraction[0]}` : String(quantity);
  return [displayQuantity, displayUnit, ingredient.name].filter((part) => part !== null && part !== '').join(' ');
}
