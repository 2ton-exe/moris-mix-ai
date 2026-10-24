import type { Session } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import { createHttpClient } from '../api/http'
import { recipeFormFixture } from './testing/fixtures'
import { createRecipeFormApi } from './api'

const recipeId = '33333333-3333-4333-8333-333333333333'
const serverRecipe = {
  id: recipeId,
  user_id: 'cook-a',
  title: recipeFormFixture.title,
  notes: recipeFormFixture.notes,
  ingredients: recipeFormFixture.ingredients,
  instructions: recipeFormFixture.instructions,
  flavor_scores: null,
  star_rating: recipeFormFixture.star_rating,
  cooked_at: recipeFormFixture.cooked_at,
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

it('sends complete create and edit drafts to the REST contract', async () => {
  const updatedRecipe = { ...serverRecipe, title: 'Updated rice', notes: 'More ginger.', star_rating: null, cooked_at: null }
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ recipe: serverRecipe }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ recipe: updatedRecipe }))
  const api = createRecipeFormApi(client(fetchImpl))
  const request = { userId: 'cook-a', signal: new AbortController().signal }

  await expect(api.save(recipeFormFixture, request)).resolves.toEqual({ id: recipeId })
  await expect(api.save({ ...recipeFormFixture, ...updatedRecipe }, request, recipeId)).resolves.toEqual({ id: recipeId })

  expect(fetchImpl.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'PATCH'])
  expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual(recipeFormFixture)
  expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string)).toEqual({
    ...recipeFormFixture,
    title: 'Updated rice',
    notes: 'More ginger.',
    star_rating: null,
    cooked_at: null,
  })
  for (const [, options] of fetchImpl.mock.calls) {
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fresh-token')
    expect(new Headers(options?.headers).get('apikey')).toBe('public-key')
    expect(options?.credentials).toBe('omit')
  }
})

it('rejects a response owned by a different account', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ recipe: { ...serverRecipe, user_id: 'cook-b' } }))
  const api = createRecipeFormApi(client(fetchImpl))
  await expect(api.save(recipeFormFixture, { userId: 'cook-a', signal: new AbortController().signal })).rejects.toThrow()
})
