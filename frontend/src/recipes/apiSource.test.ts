import type { Session } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import { createHttpClient } from '../api/http'
import { InvalidRecipeData } from './validation'
import { createRecipeSource } from './apiSource'

const recipeId = '33333333-3333-4333-8333-333333333333'
const recipe = {
  id: recipeId,
  user_id: 'cook-a',
  title: 'Garlic rice',
  notes: 'Toast the garlic slowly.',
  ingredients: [{ name: 'rice', quantity: 2, unit: 'cups', inferred: false }],
  instructions: [{ step: 1, text: 'Cook the rice.' }],
  flavor_scores: null,
  star_rating: 4,
  cooked_at: '2026-10-19',
}

function client(fetchImpl: typeof fetch) {
  const session = { user: { id: 'cook-a' }, access_token: 'fresh-token', expires_at: Date.now() / 1000 + 3600 } as Session
  return createHttpClient({
    baseUrl: 'https://recipes.example.test',
    apiKey: 'public-key',
    fetchImpl,
    getSession: async () => ({ data: { session }, error: null }),
  })
}

it('reads owned recipes and waits for the authenticated 204 delete response', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ recipes: [recipe] }))
    .mockResolvedValueOnce(Response.json({ recipe }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  const source = createRecipeSource(client(fetchImpl))
  const request = { userId: 'cook-a', signal: new AbortController().signal }

  await expect(source.list(request)).resolves.toMatchObject([{ id: recipeId, title: 'Garlic rice' }])
  await expect(source.detail(recipeId, request)).resolves.toMatchObject({ notes: 'Toast the garlic slowly.' })
  await expect(source.deleteRecipe?.(recipeId, request)).resolves.toBeUndefined()

  expect(fetchImpl.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
    ['https://recipes.example.test/functions/v1/recipes', 'GET'],
    [`https://recipes.example.test/functions/v1/recipes/${recipeId}`, 'GET'],
    [`https://recipes.example.test/functions/v1/recipes/${recipeId}`, 'DELETE'],
  ])
  for (const [, options] of fetchImpl.mock.calls) {
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fresh-token')
    expect(new Headers(options?.headers).get('apikey')).toBe('public-key')
    expect(options?.credentials).toBe('omit')
  }
})

it('rejects recipes returned for another account and rejects non-204 delete success', async () => {
  const wrongOwner = { ...recipe, user_id: 'cook-b' }
  const wrongOwnerSource = createRecipeSource(client(
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ recipes: [wrongOwner] })),
  ))
  await expect(wrongOwnerSource.list({ userId: 'cook-a', signal: new AbortController().signal }))
    .rejects.toBeInstanceOf(InvalidRecipeData)

  const badDeleteSource = createRecipeSource(client(
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ deleted: true })),
  ))
  await expect(badDeleteSource.deleteRecipe?.(recipeId, { userId: 'cook-a', signal: new AbortController().signal }))
    .rejects.toBeInstanceOf(InvalidRecipeData)
})
