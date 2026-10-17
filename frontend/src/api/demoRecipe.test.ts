import { describe, expect, it, vi } from 'vitest'
import fixture from '../../../fixtures/demo-recipe.json'
import { createHttpClient } from './http'
import { getDemoRecipe, InvalidDemoRecipeResponse, parseDemoRecipeResponse } from './demoRecipe'

const baseUrl = 'https://demo.example.test'
const path = `${baseUrl}/functions/v1/demo-recipe`

describe('demo recipe contract', () => {
  it('accepts the approved fixture and preserves structured fields', () => {
    const response = parseDemoRecipeResponse(fixture)
    expect(response.recipe.title).toBe('Classic Tomato Scraps Pasta')
    expect(response.recipe.ingredients[0]).toEqual({ name: 'spaghetti', quantity: 200, unit: 'g', inferred: false })
    expect(response.recipe.instructions[0]).toEqual({ step: 1, text: 'Boil pasta in salted water.' })
    expect(response.recipe.flavor_scores.umami).toBe(4)
    expect(response.recipe.star_rating).toBe(4)
    expect(response.recipe.cooked_at).toBe('2026-10-13')
  })

  it('normalizes omitted inferred to false and supports quantityText and nullable values', () => {
    const response = structuredClone(fixture) as unknown as { recipe: Record<string, unknown> }
    response.recipe.ingredients = [{ name: 'basil', quantity: null, unit: null, quantityText: 'a handful' }]
    response.recipe.star_rating = null
    response.recipe.cooked_at = null
    expect(parseDemoRecipeResponse(response).recipe.ingredients[0]).toEqual({
      name: 'basil', quantity: null, unit: null, quantityText: 'a handful', inferred: false,
    })
  })

  it.each([
    null,
    {},
    { data: fixture.recipe },
    { recipe: { ...fixture.recipe, id: 42 } },
    { recipe: { ...fixture.recipe, ingredients: ['spaghetti'] } },
    { recipe: { ...fixture.recipe, instructions: [{ step: 1, text: null }] } },
    { recipe: { ...fixture.recipe, flavor_scores: null } },
    { recipe: { ...fixture.recipe, flavor_scores: { ...fixture.recipe.flavor_scores, sweet: 6 } } },
    { recipe: { ...fixture.recipe, star_rating: 0 } },
    { recipe: { ...fixture.recipe, cooked_at: '2026-02-30' } },
  ])('rejects malformed success payloads', (payload) => {
    expect(() => parseDemoRecipeResponse(payload)).toThrow(InvalidDemoRecipeResponse)
  })

  it('fetches the endpoint and validates the live response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture))
    const client = createHttpClient({ baseUrl, apiKey: 'public-test-key', fetchImpl })
    const controller = new AbortController()
    await expect(getDemoRecipe({ client, signal: controller.signal })).resolves.toMatchObject({ title: fixture.recipe.title })
    expect(fetchImpl).toHaveBeenCalledWith(path, expect.objectContaining({
      method: 'GET', signal: controller.signal,
      headers: expect.objectContaining({ apikey: 'public-test-key' }),
    }))
  })

  it('rejects HTTP errors, invalid JSON, no content, and network failures without fallback data', async () => {
    const responses = [
      Response.json({ error: { code: 'DEMO_RECIPE_NOT_FOUND', message: 'Unavailable' } }, { status: 404 }),
      new Response('{broken JSON'),
      new Response(null, { status: 204 }),
    ]
    for (const response of responses) {
      const client = createHttpClient({ baseUrl, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response) })
      await expect(getDemoRecipe({ client })).rejects.toThrow()
    }
    const client = createHttpClient({ baseUrl, fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Offline')) })
    await expect(getDemoRecipe({ client })).rejects.toThrow()
  })
})
