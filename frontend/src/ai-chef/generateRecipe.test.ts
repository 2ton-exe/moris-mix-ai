import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { createHttpClient, HttpError } from '../api/http'
import type { RecipeRequest } from '../recipes/types'
import {
  createGenerateRecipeApi,
  GENERATE_RECIPE_PATH,
  generateRecipeErrorMessage,
  generateRecipeRequestSchema,
  generateRecipeResponseSchema,
  InvalidGeneratedRecipeResponse,
} from './generateRecipe'

const recipe = {
  title: 'Tomato egg rice',
  ingredients: [
    { name: 'rice', quantity: null, unit: null, quantityText: 'leftover', inferred: false },
    { name: 'tomatoes', quantity: 2, unit: null, inferred: false },
  ],
  instructions: [{ step: 1, text: 'Warm the rice and fold in the tomatoes.' }],
  flavor_scores: { sweet: 1, salty: 2, sour: 2, bitter: 0, umami: 3, spicy: 0 },
}

const generated = {
  recipe,
  substitutions: [{ original: 'tomatoes', replacement: 'bell pepper', reason: 'Use what is available.' }],
  parents: [{ id: '123e4567-e89b-42d3-a456-426614174000', title: 'Garden rice', star_rating: 4 }],
  candidate_token: 'v1.short-lived-test-token',
  context: { status: 'MATCHED', matchedCandidateCount: 1, totalCandidateCount: 3 },
}

const request: RecipeRequest = { userId: 'chef-user', signal: new AbortController().signal }

describe('AI Chef request and response contract', () => {
  it('mirrors backend pantry and preference limits and normalizes whitespace', () => {
    const parsed = generateRecipeRequestSchema.safeParse({ pantryItems: [' rice ', 'eggs'], preferences: ' quick, no frying ' })
    expect(parsed.success && parsed.data).toEqual({ pantryItems: ['rice', 'eggs'], preferences: 'quick, no frying' })
    expect(generateRecipeRequestSchema.safeParse({ pantryItems: [] }).success).toBe(false)
    expect(generateRecipeRequestSchema.safeParse({ pantryItems: ['x'.repeat(101)] }).success).toBe(false)
    expect(generateRecipeRequestSchema.safeParse({ pantryItems: Array.from({ length: 101 }, () => 'rice') }).success).toBe(false)
    expect(generateRecipeRequestSchema.safeParse({ pantryItems: ['rice'], preferences: 'x'.repeat(1001) }).success).toBe(false)
  })

  it('validates recipe, substitution, lineage token, and cold-start response fields', () => {
    expect(generateRecipeResponseSchema.safeParse(generated).success).toBe(true)
    expect(generateRecipeResponseSchema.safeParse({
      ...generated,
      parents: [],
      candidate_token: null,
      context: { status: 'NO_SAVED_RECIPES', matchedCandidateCount: 0, totalCandidateCount: 0 },
    }).success).toBe(true)
    expect(generateRecipeResponseSchema.safeParse({ ...generated, candidate_token: null }).success).toBe(false)
    expect(generateRecipeResponseSchema.safeParse({
      ...generated,
      substitutions: [{ original: 'garlic', replacement: 'onion' }],
    }).success).toBe(false)
    expect(generateRecipeResponseSchema.safeParse({
      ...generated,
      recipe: { ...recipe, instructions: [{ step: 2, text: 'Skip a step.' }] },
    }).success).toBe(false)
  })

  it('sends one authenticated REST request and returns the validated unsaved result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(generated))
    const session = {
      user: { id: request.userId }, access_token: 'fresh-chef-test-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
    } as Session
    const client = createHttpClient({
      baseUrl: 'https://project.supabase.co', apiKey: 'publishable-test-key', fetchImpl,
      getSession: async () => ({ data: { session }, error: null }),
    })
    const api = createGenerateRecipeApi(client)

    await expect(api.generate([' rice ', 'eggs'], '  ', request)).resolves.toEqual(generated)

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(`https://project.supabase.co${GENERATE_RECIPE_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json', apikey: 'publishable-test-key',
        Authorization: 'Bearer fresh-chef-test-token', 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pantryItems: ['rice', 'eggs'] }),
      credentials: 'omit', signal: request.signal,
    })
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('/recipes')
  })

  it('rejects malformed success responses without accepting partial recipe data', async () => {
    const api = createGenerateRecipeApi({
      postAuthenticatedJson: vi.fn().mockResolvedValue({ ...generated, recipe: { title: 'incomplete' } }),
    })
    await expect(api.generate(['rice'], '', request)).rejects.toBeInstanceOf(InvalidGeneratedRecipeResponse)
  })

  it('maps documented auth, quota, provider, timeout, and malformed-response errors safely', () => {
    const http = (status: number, code: string, retryAfter?: string) => new HttpError(
      'http', 'private server text', status, { error: { code, message: 'private response' } }, retryAfter,
    )
    expect(generateRecipeErrorMessage(http(401, 'UNAUTHORIZED'))).toContain('session could not be verified')
    expect(generateRecipeErrorMessage(http(429, 'QUOTA_EXCEEDED', '3600'))).toContain('today’s AI Chef limit')
    expect(generateRecipeErrorMessage(http(429, 'AI_RATE_LIMITED', '30'))).toContain('30 seconds')
    expect(generateRecipeErrorMessage(http(503, 'AI_DISABLED'))).toContain('temporarily unavailable')
    expect(generateRecipeErrorMessage(http(503, 'AI_UNAVAILABLE'))).toContain('temporarily unavailable')
    expect(generateRecipeErrorMessage(http(504, 'AI_TIMEOUT'))).toContain('too long')
    expect(generateRecipeErrorMessage(http(502, 'AI_OUTPUT_INVALID'))).toContain('could not be checked safely')
    expect(generateRecipeErrorMessage(new Error('timeout'), true)).toContain('took too long')
    expect(generateRecipeErrorMessage(http(500, 'INTERNAL_ERROR'))).not.toContain('private')
  })
})
