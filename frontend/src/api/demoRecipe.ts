import { apiClient } from './config'

export interface Ingredient {
  name: string
  quantity: number | null
  unit: string | null
  inferred: boolean
  quantityText?: string
}

export interface Instruction {
  step: number
  text: string
}

export interface FlavorScores {
  sweet: number
  salty: number
  sour: number
  bitter: number
  umami: number
  spicy: number
}

export interface DemoRecipe {
  id: string
  title: string
  ingredients: Ingredient[]
  instructions: Instruction[]
  flavor_scores: FlavorScores
  star_rating: number | null
  cooked_at: string | null
}

export interface DemoRecipeResponse {
  recipe: DemoRecipe
}

export class InvalidDemoRecipeResponse extends Error {
  constructor() {
    super('The demonstration recipe response is invalid.')
    this.name = 'InvalidDemoRecipeResponse'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isIngredient = (value: unknown): value is Ingredient =>
  isRecord(value) && typeof value.name === 'string' &&
  (value.quantity === null || isNumber(value.quantity)) &&
  isNullableString(value.unit) &&
  (value.inferred === undefined || typeof value.inferred === 'boolean') &&
  (value.quantityText === undefined || typeof value.quantityText === 'string')

const isInstruction = (value: unknown): value is Instruction =>
  isRecord(value) && isNumber(value.step) && typeof value.text === 'string'

const flavorNames = ['sweet', 'salty', 'sour', 'bitter', 'umami', 'spicy'] as const

const isFlavorScores = (value: unknown): value is FlavorScores =>
  isRecord(value) && flavorNames.every((name) =>
    isNumber(value[name]) && value[name] >= 0 && value[name] <= 5)

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function parseDemoRecipeResponse(value: unknown): DemoRecipeResponse {
  if (!isRecord(value) || !isRecord(value.recipe)) throw new InvalidDemoRecipeResponse()
  const recipe = value.recipe
  if (typeof recipe.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipe.id) ||
    typeof recipe.title !== 'string' || recipe.title.length === 0 ||
    !Array.isArray(recipe.ingredients) || !recipe.ingredients.every(isIngredient) ||
    !Array.isArray(recipe.instructions) || !recipe.instructions.every(isInstruction) ||
    !isFlavorScores(recipe.flavor_scores) ||
    !(recipe.star_rating === null || (Number.isInteger(recipe.star_rating) &&
      (recipe.star_rating as number) >= 1 && (recipe.star_rating as number) <= 5)) ||
    !(recipe.cooked_at === null || isIsoDate(recipe.cooked_at))) {
    throw new InvalidDemoRecipeResponse()
  }

  return {
    recipe: {
      id: recipe.id as string,
      title: recipe.title,
      ingredients: recipe.ingredients.map((ingredient: Ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        inferred: ingredient.inferred ?? false,
        ...(ingredient.quantityText === undefined ? {} : { quantityText: ingredient.quantityText }),
      })),
      instructions: recipe.instructions.map((instruction: Instruction) => ({
        step: instruction.step,
        text: instruction.text,
      })),
      flavor_scores: {
        sweet: (recipe.flavor_scores as FlavorScores).sweet,
        salty: (recipe.flavor_scores as FlavorScores).salty,
        sour: (recipe.flavor_scores as FlavorScores).sour,
        bitter: (recipe.flavor_scores as FlavorScores).bitter,
        umami: (recipe.flavor_scores as FlavorScores).umami,
        spicy: (recipe.flavor_scores as FlavorScores).spicy,
      },
      star_rating: recipe.star_rating as number | null,
      cooked_at: recipe.cooked_at as string | null,
    },
  }
}

export async function getDemoRecipe({
  signal,
  client = apiClient,
}: {
  signal?: AbortSignal
  client?: typeof apiClient
} = {}): Promise<DemoRecipe> {
  const payload = await client.getJson('/functions/v1/demo-recipe', { signal })
  return parseDemoRecipeResponse(payload).recipe
}
