import type { FlavorScores, Ingredient, Instruction } from '../api/demoRecipe'
import type { RecipeDiscoverySource } from './discoveryTypes'

// Frontend view models, not the BE-06 wire contract. The REST adapter validates
// API responses against these shapes. Nested shapes reuse FS-01.
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
  notes?: string | null
}

export interface RecipeRequest {
  // Cache/session identity check for the adapter, never an authorization claim.
  userId: string
  signal: AbortSignal
}

export interface RecipeSource {
  mode: 'live' | 'preview' | 'unavailable'
  discovery?: RecipeDiscoverySource
  list: (request: RecipeRequest) => Promise<RecipeSummary[]>
  detail: (id: string, request: RecipeRequest) => Promise<RecipeDetail>
  // Must resolve only after the authenticated backend confirms deletion.
  deleteRecipe?: (id: string, request: RecipeRequest) => Promise<void>
}
