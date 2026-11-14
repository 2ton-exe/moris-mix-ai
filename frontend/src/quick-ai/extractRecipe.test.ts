import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { apiClient } from '../api/config'
import { createHttpClient } from '../api/http'
import type { RecipeRequest } from '../recipes/types'
import { createExtractRecipeApi, extractRecipeResponseSchema, InvalidExtractionResponse } from './extractRecipe'

const recipe = {
  title: 'Garlic soy chicken',
  ingredients: [
    { name: 'chicken', quantity: null, unit: null, quantityText: 'some', inferred: true },
    { name: 'garlic', quantity: 2, unit: 'cloves', inferred: false },
  ],
  instructions: [{ step: 1, text: 'Boil the chicken with garlic.' }],
  flavor_scores: { sweet: 1, salty: 4, sour: 0, bitter: 0, umami: 4, spicy: 0 },
}

const request: RecipeRequest = { userId: 'cook-1', signal: new AbortController().signal }

describe('AI-05 extraction adapter', () => {
  it('validates the backend recipe schema, including ordered steps', () => {
    expect(extractRecipeResponseSchema.safeParse({ recipe }).success).toBe(true)
    expect(extractRecipeResponseSchema.safeParse({ recipe: { ...recipe, instructions: [{ step: 2, text: 'Cook.' }] } }).success).toBe(false)
    expect(extractRecipeResponseSchema.safeParse({ recipe: { title: 12 } }).success).toBe(false)
  })

  it('sends exact notes through the authenticated extraction endpoint and does not save a recipe', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ recipe }))
    const session = {
      user: { id: 'cook-1' }, access_token: 'fresh-test-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
    } as Session
    const client = createHttpClient({
      baseUrl: 'https://project.supabase.co', apiKey: 'publishable-test-key', fetchImpl,
      getSession: async () => ({ data: { session }, error: null }),
    })
    const api = createExtractRecipeApi(client)
    const notes = '  leftover rice\n2 eggs, soy sauce  '

    await expect(api.extract(notes, request)).resolves.toEqual(recipe)

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/extract-recipe', {
      method: 'POST',
      headers: {
        Accept: 'application/json', apikey: 'publishable-test-key',
        Authorization: 'Bearer fresh-test-token', 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes }), credentials: 'omit', signal: request.signal,
    })
    expect(fetchImpl.mock.calls[0][0]).not.toContain('/recipes')
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ notes })
  })

  it('rejects malformed success payloads instead of treating them as recipes', async () => {
    const postAuthenticatedJson = vi.fn<typeof apiClient.postAuthenticatedJson>().mockResolvedValue({
      recipe: { ...recipe, instructions: [{ step: 1, text: '' }] },
    })
    const api = createExtractRecipeApi({ postAuthenticatedJson })

    await expect(api.extract('notes', request)).rejects.toBeInstanceOf(InvalidExtractionResponse)
  })
})
