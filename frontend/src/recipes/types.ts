import type { FlavorScores, Ingredient, Instruction } from '../api/demoRecipe'

// Frontend view models, NOT a BE-06 wire contract. The eventual REST adapter
// must validate the agreed response and map it here. Nested shapes reuse FS-01.
export interface RecipeSummary {
  id: string
  title: string
  star_rating?: number | null
  cooked_at?: string | null
}

export interface RecipeDetail extends RecipeSummary {
  ingredients: Ingredient[]
  instructions: Instruction[]
  flavor_scores?: FlavorScores | null
}

export interface RecipeRequest {
  // Cache/session identity check for the adapter, never an authorization claim.
  userId: string
  signal: AbortSignal
}

export interface RecipeSource {
  mode: 'live' | 'preview' | 'unavailable'
  list: (request: RecipeRequest) => Promise<RecipeSummary[]>
  detail: (id: string, request: RecipeRequest) => Promise<RecipeDetail>
}
