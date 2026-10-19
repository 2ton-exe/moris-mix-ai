import type { Session } from '@supabase/supabase-js'

export type HttpErrorKind = 'configuration' | 'http' | 'network' | 'invalid-json'

// Transport errors keep server payloads opaque so UI code never renders raw details.
export class HttpError extends Error {
  readonly kind: HttpErrorKind
  readonly status?: number
  readonly payload?: unknown
  readonly retryable: boolean

  constructor(kind: HttpErrorKind, message: string, status?: number, payload?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.kind = kind
    this.status = status
    this.payload = payload
    this.retryable = kind === 'network' || (kind === 'http' && (
      status === 408 || status === 429 || (status !== undefined && status >= 500 && status < 600)
    ))
  }
}

interface HttpClientOptions {
  baseUrl?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  getSession?: () => Promise<{ data: { session: Session | null }; error: unknown }>
}

export function createHttpClient({ baseUrl, apiKey, fetchImpl = fetch, getSession }: HttpClientOptions = {}) {
  async function requestJson(path: string, { signal, accessToken }: { signal?: AbortSignal; accessToken?: string }): Promise<unknown> {
    let url: URL
    try {
      if (!baseUrl?.trim() || (apiKey !== undefined && !apiKey.trim()) ||
        !path.startsWith('/') || path.startsWith('//')) {
        throw new Error('Missing base URL or invalid API path')
      }
      const base = new URL(baseUrl.trim())
      if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password ||
        base.search || base.hash || base.pathname !== '/') {
        throw new Error('Expected an HTTP(S) API origin')
      }
      url = new URL(path, base)
      if (url.origin !== base.origin) throw new Error('API path changed origin')
    } catch {
      throw new HttpError('configuration', 'The API connection is not configured correctly.')
    }

    let response: Response
    let body: string
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(apiKey === undefined ? {} : {
            apikey: apiKey.trim(),
          }),
          ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
        },
        credentials: 'omit',
        signal,
      })
      body = await response.text()
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      throw new HttpError('network', 'Unable to reach the server. Check your connection and try again.')
    }

    let payload: unknown
    let validJson = false
    try {
      payload = JSON.parse(body)
      validJson = true
    } catch {
      // Preserve HTTP status even when a failed response contains HTML or no body.
    }
    if (!response.ok) {
      throw new HttpError('http', 'The server could not complete the request.', response.status, payload)
    }
    if (response.status === 204) return null
    if (!validJson) {
      throw new HttpError('invalid-json', 'The server returned an unreadable response.', response.status)
    }
    return payload
  }

  const authenticationRequired = () => new HttpError('http', 'Authentication required.', 401)

  return {
    // Return unknown until a contract-specific adapter validates the payload.
    getJson(path: string, { signal }: { signal?: AbortSignal } = {}): Promise<unknown> {
      return requestJson(path, { signal })
    },
    async getAuthenticatedJson(path: string, { userId, signal }: { userId: string; signal?: AbortSignal }): Promise<unknown> {
      let session: Session | null | undefined
      try {
        signal?.throwIfAborted()
        const result = await getSession?.()
        signal?.throwIfAborted()
        session = result?.error ? null : result?.data.session
      } catch {
        signal?.throwIfAborted()
        throw authenticationRequired()
      }

      if (!session || !session.access_token.trim() || typeof session.expires_at !== 'number' ||
        !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= Date.now() || session.user.id !== userId) {
        throw authenticationRequired()
      }
      return requestJson(path, { signal, accessToken: session.access_token })
    },
  }
}
