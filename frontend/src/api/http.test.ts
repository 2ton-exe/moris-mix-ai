import { describe, expect, it, vi } from 'vitest'
import { createHttpClient, HttpError } from './http'

const baseUrl = 'https://demo.example.test'
const path = '/functions/v1/demo-recipe'

describe('HTTP JSON transport (without a recipe contract)', () => {
  it('requests JSON through the configured API origin', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ transportTest: true }))
    const controller = new AbortController()
    const client = createHttpClient({ baseUrl: `${baseUrl}/`, fetchImpl })

    await expect(client.getJson(path, { signal: controller.signal })).resolves.toEqual({ transportTest: true })
    expect(fetchImpl).toHaveBeenCalledWith(`${baseUrl}${path}`, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', signal: controller.signal,
    })
  })

  it('uses native fetch by default', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json('transport only'))
    vi.stubGlobal('fetch', fetchImpl)
    try {
      await expect(createHttpClient({ baseUrl }).getJson(path)).resolves.toBe('transport only')
      expect(fetchImpl).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([undefined, '', 'not a URL', 'ftp://demo.example.test', `${baseUrl}/functions/v1`,
    `${baseUrl}?token=value`, `${baseUrl}#fragment`, 'https://user:password@demo.example.test'])(
  'rejects invalid or missing configuration: %s', async (configuredUrl) => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(createHttpClient({ baseUrl: configuredUrl, fetchImpl }).getJson(path)).rejects.toMatchObject({
      kind: 'configuration', retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['https://other.example.test/data', '//other.example.test/data', '/\\other.example.test/data'])(
  'prevents requests to a different origin: %s', async (requestPath) => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(requestPath)).rejects.toBeInstanceOf(HttpError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403, 404, 408, 429, 500, 503])('preserves status %s and opaque server errors', async (status) => {
    const payload = { opaqueServerError: 'Not an FS-01 schema' }
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, { status }))
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).rejects.toMatchObject({
      kind: 'http', status, payload, retryable: [408, 429, 500, 503].includes(status),
    })
  })

  it('keeps the HTTP error when the error body is not JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 503 }))
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).rejects.toMatchObject({
      kind: 'http', status: 503, payload: undefined, retryable: true,
    })
  })

  it.each(['', '{broken JSON'])('rejects malformed success bodies: %s', async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).rejects.toMatchObject({
      kind: 'invalid-json', status: 200, retryable: false,
    })
  })

  it('represents HTTP 204 as no content', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).resolves.toBeNull()
  })

  it('allows any valid JSON through for later contract validation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null))
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).resolves.toBeNull()
  })

  it('reports network and CORS failures as retryable transport errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).rejects.toMatchObject({
      kind: 'network', retryable: true,
    })
  })

  it('handles connection failures while reading the body', async () => {
    const response = new Response()
    vi.spyOn(response, 'text').mockRejectedValue(new TypeError('Connection lost'))
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response)
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path)).rejects.toMatchObject({ kind: 'network' })
  })

  it('preserves cancellation rather than turning it into a user-facing failure', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('Aborted', 'AbortError')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(abortError)
    await expect(createHttpClient({ baseUrl, fetchImpl }).getJson(path, { signal: controller.signal }))
      .rejects.toBe(abortError)
  })

  it('allows a subsequent request to succeed after a network failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(Response.json({ transportTest: true }))
    const client = createHttpClient({ baseUrl, fetchImpl })
    await expect(client.getJson(path)).rejects.toMatchObject({ retryable: true })
    await expect(client.getJson(path)).resolves.toEqual({ transportTest: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
