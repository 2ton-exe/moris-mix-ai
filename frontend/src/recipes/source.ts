import { createContext } from 'react'
import { createRecipeSource } from './apiSource'
import type { RecipeSource } from './types'

export class RecipeIntegrationUnavailable extends Error {
  constructor() {
    super('Recipe integration is unavailable.')
    this.name = 'RecipeIntegrationUnavailable'
  }
}

const liveRecipeSource = createRecipeSource()
const unavailable = async (): Promise<never> => { throw new RecipeIntegrationUnavailable() }
const unavailableRecipeSource: RecipeSource = { mode: 'unavailable', list: unavailable, detail: unavailable }
const hasApiConfig = !!import.meta.env.VITE_SUPABASE_URL?.trim() &&
  !!(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim())

export const defaultRecipeSource: RecipeSource = import.meta.env.DEV && import.meta.env.VITE_RECIPE_PREVIEW === 'true'
  ? {
    mode: 'preview',
    list: async (request) => (await import('./testing/previewAdapter')).previewRecipeSource.list(request),
    detail: async (id, request) => (await import('./testing/previewAdapter')).previewRecipeSource.detail(id, request),
  }
  : hasApiConfig ? liveRecipeSource : unavailableRecipeSource

export const RecipeSourceContext = createContext(defaultRecipeSource)
