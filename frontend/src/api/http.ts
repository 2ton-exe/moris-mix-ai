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

interface JsonRequestOptions {
  signal?: AbortSignal
  accessToken?: string
  method?: RequestInit['method']
  body?: unknown
  expectedStatus?: number
}

interface AuthenticatedRequestOptions {
  userId: string
  signal?: AbortSignal
}

export function createHttpClient({ baseUrl, apiKey, fetchImpl = fetch, getSession }: HttpClientOptions = {}) {
  async function requestJson(path: string, { signal, accessToken, method = 'GET', body: jsonBody, expectedStatus }: JsonRequestOptions): Promise<unknown> {
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

    let requestBody: string | undefined
    if (method === 'POST' || method === 'PATCH') {
      try {
        requestBody = JSON.stringify(jsonBody)
        if (requestBody === undefined) throw new Error('Request body is not JSON serializable')
      } catch {
        throw new HttpError('configuration', 'The request could not be prepared.')
      }
    }

    let response: Response
    let responseBody: string
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: {
          Accept: 'application/json',
          ...(apiKey === undefined ? {} : {
            apikey: apiKey.trim(),
          }),
          ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
          ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(requestBody === undefined ? {} : { body: requestBody }),
        credentials: 'omit',
        signal,
      })
      responseBody = await response.text()
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      throw new HttpError('network', 'Unable to reach the server. Check your connection and try again.')
    }

    let payload: unknown
    let validJson = false
    try {
      payload = JSON.parse(responseBody)
      validJson = true
    } catch {
      // Preserve HTTP status even when a failed response contains HTML or no body.
    }
    if (!response.ok) {
      throw new HttpError('http', 'The server could not complete the request.', response.status, payload)
    }
    if (expectedStatus !== undefined && response.status !== expectedStatus) {
      throw new HttpError('http', 'The server could not confirm the operation.', response.status, payload)
    }
    if (response.status === 204) return null
    if (!validJson) {
      throw new HttpError('invalid-json', 'The server returned an unreadable response.', response.status)
    }
    return payload
  }

  const authenticationRequired = () => new HttpError('http', 'Authentication required.', 401)

  async function authenticatedJson(
    path: string,
    { userId, signal, method, body, expectedStatus }: AuthenticatedRequestOptions & { method: RequestInit['method']; body?: unknown; expectedStatus?: number },
  ): Promise<unknown> {
    let session: Session | null | undefined
    let abortListener: (() => void) | undefined
    try {
      signal?.throwIfAborted()
      const sessionRequest = getSession?.()
      const result = signal
        ? await Promise.race([
          sessionRequest,
          new Promise<never>((_, reject) => {
            abortListener = () => reject(signal.reason)
            signal.addEventListener('abort', abortListener, { once: true })
            if (signal.aborted) abortListener()
          }),
        ])
        : await sessionRequest
      signal?.throwIfAborted()
      session = result?.error ? null : result?.data.session
    } catch {
      signal?.throwIfAborted()
      throw authenticationRequired()
    } finally {
      if (abortListener) signal?.removeEventListener('abort', abortListener)
    }

    if (!session || !session.access_token.trim() || typeof session.expires_at !== 'number' ||
      !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= Date.now() || session.user.id !== userId) {
      throw authenticationRequired()
    }
    return requestJson(path, { signal, accessToken: session.access_token, method, body, expectedStatus })
  }

  return {
    // Return unknown until a contract-specific adapter validates the payload.
    getJson(path: string, { signal }: { signal?: AbortSignal } = {}): Promise<unknown> {
      return requestJson(path, { signal })
    },
    getAuthenticatedJson(path: string, options: AuthenticatedRequestOptions): Promise<unknown> {
      return authenticatedJson(path, { ...options, method: 'GET' })
    },
    postAuthenticatedJson(path: string, body: unknown, options: AuthenticatedRequestOptions): Promise<unknown> {
      return authenticatedJson(path, { ...options, method: 'POST', body })
    },
    patchAuthenticatedJson(path: string, body: unknown, options: AuthenticatedRequestOptions): Promise<unknown> {
      return authenticatedJson(path, { ...options, method: 'PATCH', body })
    },
    deleteAuthenticatedJson(path: string, options: AuthenticatedRequestOptions): Promise<unknown> {
      return authenticatedJson(path, { ...options, method: 'DELETE', expectedStatus: 204 })
    },
  }
}
