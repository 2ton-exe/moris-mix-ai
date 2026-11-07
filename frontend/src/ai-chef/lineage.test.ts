import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createHttpClient } from '../api/http'
import { createLineageApi, LineageApiError, lineageMatchesSelection } from './lineage'

const childId = '11111111-1111-4111-8111-111111111111'
const parentOne = '22222222-2222-4222-8222-222222222222'
const parentTwo = '33333333-3333-4333-8333-333333333333'
const token = 'v1.opaque-signed-token'
const request = { userId: 'cook-a', signal: new AbortController().signal }

function response(parentIds: string[], id = childId) {
  return {
    lineage: parentIds.map((parentId, index) => ({
      id: (index + 4).toString().padStart(8, '0') + '-4444-4444-8444-444444444444',
      parent_recipe_id: parentId,
      child_recipe_id: id,
      created_at: '2026-11-07T00:00:00.000Z',
    })),
  }
}

function client(fetchImpl: typeof fetch) {
  const session = {
    user: { id: request.userId },
    access_token: 'fresh-token',
    expires_at: Date.now() / 1000 + 3600,
  } as Session
  return createHttpClient({
    baseUrl: 'https://recipes.example.test',
    apiKey: 'public-key',
    fetchImpl,
    getSession: async () => ({ data: { session }, error: null }),
  })
}

describe('authenticated AI Chef lineage API', () => {
  it('posts only selected candidate IDs with the unchanged opaque token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response([parentTwo]), { status: 201 }))
    const api = createLineageApi(client(fetchImpl))

    await expect(api.save(childId, [parentOne, parentTwo], [parentTwo], token, request)).resolves.toEqual(response([parentTwo]))

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://recipes.example.test/functions/v1/recipes/' + childId + '/lineage')
    expect(options?.method).toBe('POST')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fresh-token')
    expect(new Headers(options?.headers).get('apikey')).toBe('public-key')
    expect(JSON.parse(options?.body as string)).toEqual({
      parent_recipe_ids: [parentTwo],
      candidate_token: token,
    })
  })

  it.each([
    [[], token],
    [[parentOne, parentOne], token],
    [[parentTwo], ''],
    [[parentTwo], 'x'.repeat(2049)],
    [['not-a-uuid'], token],
    [['44444444-4444-4444-8444-444444444444'], token],
    [Array.from({ length: 11 }, (_, index) => '50000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')), token],
  ])('rejects an invalid selected-parent request before network access', async (selected, candidateToken) => {
    const fetchImpl = vi.fn<typeof fetch>()
    const api = createLineageApi(client(fetchImpl))

    await expect(api.save(childId, [parentOne, parentTwo], selected, candidateToken, request))
      .rejects.toMatchObject({ reason: 'validation' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects duplicated candidate IDs and invalid child IDs before network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const api = createLineageApi(client(fetchImpl))
    await expect(api.save(childId, [parentOne, parentOne], [parentOne], token, request))
      .rejects.toMatchObject({ reason: 'validation' })
    await expect(api.get('child/escape', request)).rejects.toMatchObject({ reason: 'validation' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('validates the POST response against the saved child and selected IDs', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ lineage: [] }, { status: 201 }))
      .mockResolvedValueOnce(Response.json(response([parentOne, parentTwo]), { status: 201 }))
    const api = createLineageApi(client(fetchImpl))

    await expect(api.save(childId, [parentOne, parentTwo], [parentOne], token, request))
      .rejects.toMatchObject({ reason: 'invalid-response', ambiguous: true })
    await expect(api.save(childId, [parentOne, parentTwo], [parentOne], token, request))
      .rejects.toMatchObject({ reason: 'invalid-response', ambiguous: true })
  })

  it('gets persisted lineage through the authenticated child route', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response([parentOne])))
    const api = createLineageApi(client(fetchImpl))

    await expect(api.get(childId, request)).resolves.toEqual(response([parentOne]))
    expect(fetchImpl.mock.calls[0][0]).toBe('https://recipes.example.test/functions/v1/recipes/' + childId + '/lineage')
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET')
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer fresh-token')
  })

  it.each([
    [{ error: { code: 'FORBIDDEN', details: [{ code: 'expired_token' }] } }, 403, 'expired-token'],
    [{ error: { code: 'FORBIDDEN', details: [{ code: 'invalid_token' }] } }, 403, 'invalid-token'],
    [{ error: { code: 'FORBIDDEN', details: [{ code: 'wrong_user' }] } }, 403, 'wrong-user'],
    [{ error: { code: 'FORBIDDEN', details: [{ code: 'not_a_candidate' }] } }, 403, 'not-candidate'],
    [{ error: { code: 'UNAUTHORIZED' } }, 401, 'unauthorized'],
    [{ error: { code: 'VALIDATION_ERROR' } }, 400, 'validation'],
    [{ error: { code: 'NOT_FOUND' } }, 404, 'ownership'],
    [{ error: { code: 'CONFLICT' } }, 409, 'conflict'],
  ])('maps documented backend errors without exposing their details', async (body, status, reason) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }))
    const api = createLineageApi(client(fetchImpl))

    await expect(api.save(childId, [parentOne], [parentOne], token, request))
      .rejects.toMatchObject({ reason })
  })

  it('marks network failures and malformed success responses as ambiguous', async () => {
    const network = createLineageApi(client(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))))
    await expect(network.save(childId, [parentOne], [parentOne], token, request))
      .rejects.toMatchObject({ reason: 'unavailable', ambiguous: true })

    const invalidJson = createLineageApi(client(vi.fn<typeof fetch>().mockResolvedValue(new Response('{bad json'))))
    await expect(invalidJson.get(childId, request))
      .rejects.toMatchObject({ reason: 'invalid-response', ambiguous: true })
  })

  it('matches only the exact selected parent set for the confirmed child', () => {
    expect(lineageMatchesSelection(response([parentOne, parentTwo]), childId, [parentTwo, parentOne])).toBe(true)
    expect(lineageMatchesSelection(response([parentOne]), childId, [parentOne, parentTwo])).toBe(false)
    expect(lineageMatchesSelection(response([parentOne, parentTwo]), childId, [parentOne])).toBe(false)
    expect(lineageMatchesSelection(response([parentOne], '99999999-9999-4999-8999-999999999999'), childId, [parentOne])).toBe(false)
  })

  it('keeps its own failures typed for the save coordinator', () => {
    expect(new LineageApiError('expired-token').ambiguous).toBe(false)
  })
})
