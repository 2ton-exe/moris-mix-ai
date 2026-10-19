import type { RecipeDetail, RecipeSummary } from './types'

// Validate only the adapter's frontend view models. BE-06's eventual wire
// schema still belongs in its REST adapter; this does not define an API envelope.
export class InvalidRecipeData extends Error {
  constructor() {
    super('The recipe adapter returned invalid data.')
    this.name = 'InvalidRecipeData'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function isRecipeId(value: unknown) {
  if (!isText(value)) return false
  // Malformed UTF-16 must not throw from a card's encodeURIComponent call.
  try { encodeURIComponent(value); return true } catch { return false }
}

function isDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function isSummary(value: unknown): value is RecipeSummary {
  return isRecord(value) && isRecipeId(value.id) && isText(value.title) &&
    (value.star_rating == null || (isNumber(value.star_rating) && Number.isInteger(value.star_rating) && value.star_rating >= 1 && value.star_rating <= 5)) &&
    (value.cooked_at == null || isDate(value.cooked_at))
}

function isIngredient(value: unknown) {
  return isRecord(value) && typeof value.name === 'string' &&
    (value.quantity === null || isNumber(value.quantity)) &&
    (value.unit === null || typeof value.unit === 'string') &&
    typeof value.inferred === 'boolean' &&
    (value.quantityText === undefined || typeof value.quantityText === 'string')
}

function isInstruction(value: unknown) {
  return isRecord(value) && isNumber(value.step) && typeof value.text === 'string'
}

function isFlavors(value: unknown) {
  return isRecord(value) && ['sweet', 'salty', 'sour', 'bitter', 'umami', 'spicy']
    .every((key) => isNumber(value[key]) && value[key] >= 0 && value[key] <= 5) &&
    Object.values(value).every((score) => isNumber(score) && score >= 0 && score <= 5)
}

export function validateRecipeList(value: unknown): RecipeSummary[] {
  if (!Array.isArray(value) || !value.every(isSummary)) throw new InvalidRecipeData()
  return value
}

export function validateRecipeDetail(value: unknown, expectedId: string): RecipeDetail {
  if (!isRecord(value) || !isSummary(value) || value.id !== expectedId ||
    !Array.isArray(value.ingredients) || !value.ingredients.every(isIngredient) ||
    !Array.isArray(value.instructions) || !value.instructions.every(isInstruction) ||
    !(value.flavor_scores == null || isFlavors(value.flavor_scores))) {
    throw new InvalidRecipeData()
  }
  // Preserve extra properties (including future related/lineage data) intact.
  return value as unknown as RecipeDetail
}
