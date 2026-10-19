import { createContext } from 'react'
import type { RecipeSource } from './types'

export class RecipeIntegrationUnavailable extends Error {
  constructor() {
    super('Recipe integration is unavailable.')
    this.name = 'RecipeIntegrationUnavailable'
  }
}

const unavailable = async (): Promise<never> => { throw new RecipeIntegrationUnavailable() }

// No guessed endpoint or anonymous demo fallback. Replace this source only
// after BE-06 and FS-02 supply their validated, authenticated REST integration.
export const defaultRecipeSource: RecipeSource = import.meta.env.DEV && import.meta.env.VITE_RECIPE_PREVIEW === 'true'
  ? {
    mode: 'preview',
    list: async (request) => (await import('./testing/previewAdapter')).previewRecipeSource.list(request),
    detail: async (id, request) => (await import('./testing/previewAdapter')).previewRecipeSource.detail(id, request),
  }
  : { mode: 'unavailable', list: unavailable, detail: unavailable }

export const RecipeSourceContext = createContext(defaultRecipeSource)
