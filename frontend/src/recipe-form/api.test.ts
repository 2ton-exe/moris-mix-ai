import type { Session } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import { createHttpClient } from '../api/http'
import { recipeFormFixture } from './testing/fixtures'
import { createRecipeFormApi } from './api'

const originalVersion = '2026-11-26T00:00:00Z'
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
  updated_at: originalVersion,
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

  const created = await api.save(recipeFormFixture, request)
  expect(created.id).toBe(recipeId)
  await expect(api.save({ ...recipeFormFixture, ...updatedRecipe }, request, recipeId, created.record)).resolves.toMatchObject({ id: recipeId })

  expect(fetchImpl.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'PATCH'])
  expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual(recipeFormFixture)
  expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string)).toEqual({
    ...recipeFormFixture,
    title: 'Updated rice',
    notes: 'More ginger.',
    star_rating: null,
    cooked_at: null,
    expected_updated_at: originalVersion,
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

it('preserves a cooking note and cooked date added after a title editor opened', async () => {
  const updated_at = '2026-11-27T05:00:00Z'
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ recipe: { ...serverRecipe, title: 'A new title', notes: 'Added from another tab', cooked_at: '2026-11-27', updated_at } }))
  const api = createRecipeFormApi(client(fetchImpl))
  const result = await api.save({ ...recipeFormFixture, title: 'A new title' }, { userId: 'cook-a', signal: new AbortController().signal }, recipeId, { id: recipeId, userId: 'cook-a', values: recipeFormFixture, updatedAt: '2026-11-26T00:00:00Z' })
  const body = fetchImpl.mock.calls[0][1]?.body
  expect(typeof body === 'string' && JSON.parse(body)).toEqual({ title: 'A new title', ingredients: recipeFormFixture.ingredients, instructions: recipeFormFixture.instructions, star_rating: recipeFormFixture.star_rating, expected_updated_at: '2026-11-26T00:00:00Z' })
  expect(result.record.values.notes).toBe(recipeFormFixture.notes)
  expect(result.record.values.cooked_at).toBe(recipeFormFixture.cooked_at)
  expect(result.record.updatedAt).toBe('2026-11-26T00:00:00Z')
  await api.save({ ...recipeFormFixture, title: 'Another title' }, { userId: 'cook-a', signal: new AbortController().signal }, recipeId, result.record)
  const subsequent = fetchImpl.mock.calls[1][1]?.body
  expect(typeof subsequent === 'string' && JSON.parse(subsequent)).not.toHaveProperty('notes')
  expect(typeof subsequent === 'string' && JSON.parse(subsequent)).not.toHaveProperty('cooked_at')
})

it.each(['notes', 'cooked_at'] as const)('checks the loaded version before overwriting %s', async (field) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }))
  const draft = { ...recipeFormFixture, [field]: field === 'notes' ? 'Changed note' : '2026-11-27' }
  const original = { id: recipeId, userId: 'cook-a', values: recipeFormFixture, updatedAt: '2026-11-26T00:00:00Z' }
  await expect(createRecipeFormApi(client(fetchImpl)).save(draft, { userId: 'cook-a', signal: new AbortController().signal }, recipeId, original)).rejects.toMatchObject({ status: 409 })
  const body = fetchImpl.mock.calls[0][1]?.body
  expect(typeof body === 'string' && JSON.parse(body)).toMatchObject({ [field]: draft[field], expected_updated_at: original.updatedAt })
})

it('does not send changed cooking details without a loaded version', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
  await expect(createRecipeFormApi(client(fetchImpl)).save({ ...recipeFormFixture, notes: 'A changed note' }, { userId: 'cook-a', signal: new AbortController().signal }, recipeId, { id: recipeId, userId: 'cook-a', values: recipeFormFixture })).rejects.toMatchObject({ status: 409 })
  expect(fetchImpl).not.toHaveBeenCalled()
})

const contentEdits = [
  { title: 'Changed title' },
  { ingredients: [{ name: 'lentils', quantity: 1, unit: 'cup', inferred: false }] },
  { instructions: [{ step: 1, text: 'Simmer slowly.' }] },
  { star_rating: 5 },
]

it.each(contentEdits)('checks the loaded version before saving content: %j', async (changes) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'RECIPE_CHANGED' } }, { status: 409 }))
  const draft = { ...recipeFormFixture, ...changes }
  const original = { id: recipeId, userId: 'cook-a', values: recipeFormFixture, updatedAt: originalVersion }
  await expect(createRecipeFormApi(client(fetchImpl)).save(draft, { userId: 'cook-a', signal: new AbortController().signal }, recipeId, original)).rejects.toMatchObject({ status: 409 })
  const body = fetchImpl.mock.calls[0][1]?.body
  expect(typeof body === 'string' && JSON.parse(body)).toMatchObject({ ...changes, expected_updated_at: originalVersion })
})

it.each([undefined, { id: recipeId, userId: 'cook-a', values: recipeFormFixture }])('refuses an edit without the loaded version: %j', async (original) => {
  const fetchImpl = vi.fn<typeof fetch>()
  await expect(createRecipeFormApi(client(fetchImpl)).save({ ...recipeFormFixture, title: 'A title edit' }, { userId: 'cook-a', signal: new AbortController().signal }, recipeId, original)).rejects.toMatchObject({ status: 409 })
  expect(fetchImpl).not.toHaveBeenCalled()
})
