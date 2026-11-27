import { createElement } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sessionProvider = vi.hoisted(() => ({ getSession: vi.fn() }))
const recipeId = '33333333-3333-4333-8333-333333333333'
const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const retryUploadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const userId = '11111111-1111-4111-8111-111111111111'
const oldImageUrl = 'https://images.example.test/old-signed-image'
const newImageUrl = 'https://images.example.test/new-signed-image'
const r2Origin = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'

let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>
let apiUrl = ''
let testSequence = 0
let modules: {
  AuthContext: typeof import('../auth/context').AuthContext
  CreateRecipePage: typeof import('../pages/CreateRecipePage').default
  RecipeDetailPage: typeof import('../pages/RecipeDetailPage').default
  EditRecipePage: typeof import('../pages/EditRecipePage').default
  RecipeCard: typeof import('./RecipeCard').RecipeCard
  RecipeQueryProvider: typeof import('./RecipeQueryProvider').RecipeQueryProvider
  createMemoryRouter: typeof import('react-router').createMemoryRouter
  RouterProvider: typeof import('react-router').RouterProvider
}
let authState: import('../auth/context').AuthState
let activeImage: 'old' | 'new' = 'old'
let noImage = false
let refreshOnFailure = false
let downloadLifetimeMs = 60_000
let putFirstErrorStatus = 503
let putFirstFails = true
let expireFirstUpload = false
let uploadExpiresAt = 0
let uploadUrlOverride = ''
let waitForPutAbort = false
let putSignal: AbortSignal | undefined
let resolvePutStarted: (() => void) | undefined
let putStarted: Promise<void>
let attachFailureCode = 'TEMPORARY_UNAVAILABLE'
let attachFailureStatus = 503
let loseFirstIntentResponse = false
let delayFirstDownload = false
let delayPostAttachDownload = false
let resolveFirstDownloadStarted: (() => void) | undefined
let firstDownloadStarted: Promise<void>
let resolveInitialDownload: ((response: Response) => void) | undefined
let resolvePostAttachDownloadStarted: (() => void) | undefined
let postAttachDownloadStarted: Promise<void>
let resolvePostAttachDownload: ((response: Response) => void) | undefined
let downloadCount = 0
let intentCount = 0
let intentRequests: Array<{ recipe_id: string; content_type: string; byte_size: number; request_id?: string }> = []
let intentIdsByRequestId = new Map<string, string>()
let putCount = 0
let attachCount = 0
let attachFailuresRemaining = 0
let attachedUploadIds: string[]
let testURL: typeof URL

beforeEach(async () => {
  vi.resetModules()
  apiUrl = `https://images-project-${++testSequence}.example.test`
  vi.stubEnv('VITE_SUPABASE_URL', apiUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_RECIPE_IMAGES', 'true')
  vi.stubEnv('VITE_RECIPE_IMAGE_UPLOAD_IDEMPOTENCY', 'false')
  fetchImpl = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchImpl)

  const NativeURL = globalThis.URL
  testURL = class TestURL extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:recipe-preview')
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', testURL)

  const session = {
    user: { id: userId } as User,
    access_token: 'fresh-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
  } as Session
  sessionProvider.getSession.mockReset().mockResolvedValue({ data: { session }, error: null })
  const [{ AuthContext }, { getAuthClient }, { default: CreateRecipePage }, { default: RecipeDetailPage }, { default: EditRecipePage }, { RecipeCard }, { RecipeQueryProvider }, router] = await Promise.all([
    import('../auth/context'), import('../auth/client'), import('../pages/CreateRecipePage'), import('../pages/RecipeDetailPage'), import('../pages/EditRecipePage'),
    import('./RecipeCard'), import('./RecipeQueryProvider'), import('react-router'),
  ])
  vi.spyOn(getAuthClient(), 'getSession').mockImplementation(() => sessionProvider.getSession())
  modules = { AuthContext, CreateRecipePage, RecipeDetailPage, EditRecipePage, RecipeCard, RecipeQueryProvider, createMemoryRouter: router.createMemoryRouter, RouterProvider: router.RouterProvider }
  authState = {
    user: session.user,
    session,
    isLoading: false,
    isAuthenticated: true,
    error: null,
    logoutNotice: null,
    dismissLogoutNotice: vi.fn(),
    retryInitialization: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    resendVerification: vi.fn(),
  }

  activeImage = 'old'
  noImage = false
  refreshOnFailure = false
  downloadLifetimeMs = 60_000
  putFirstErrorStatus = 503
  putFirstFails = true
  expireFirstUpload = false
  uploadExpiresAt = 0
  uploadUrlOverride = ''
  waitForPutAbort = false
  putSignal = undefined
  putStarted = new Promise((resolve) => { resolvePutStarted = resolve })
  attachFailureCode = 'TEMPORARY_UNAVAILABLE'
  attachFailureStatus = 503
  loseFirstIntentResponse = false
  delayFirstDownload = false
  delayPostAttachDownload = false
  firstDownloadStarted = new Promise((resolve) => { resolveFirstDownloadStarted = resolve })
  resolveInitialDownload = undefined
  postAttachDownloadStarted = new Promise((resolve) => { resolvePostAttachDownloadStarted = resolve })
  resolvePostAttachDownload = undefined
  attachFailuresRemaining = 0
  attachedUploadIds = []
  downloadCount = 0
  intentCount = 0
  intentRequests = []
  intentIdsByRequestId = new Map()
  putCount = 0
  attachCount = 0
  fetchImpl.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname === '/functions/v1/recipe-image-download-url') {
      downloadCount++
      if (delayFirstDownload && downloadCount === 1) {
        resolveFirstDownloadStarted?.()
        return await new Promise<Response>((resolve) => { resolveInitialDownload = resolve })
      }
      if (delayPostAttachDownload && downloadCount === 2) {
        resolvePostAttachDownloadStarted?.()
        return await new Promise<Response>((resolve) => { resolvePostAttachDownload = resolve })
      }
      if (noImage) return Response.json({ error: { code: 'IMAGE_NOT_FOUND' } }, { status: 404 })
      return Response.json({
        url: activeImage === 'new' || (refreshOnFailure && downloadCount > 1) ? newImageUrl : oldImageUrl,
        expires_at: new Date(Date.now() + downloadLifetimeMs).toISOString(),
      })
    }
    if (url.pathname === '/functions/v1/recipe-image-upload-url' && method === 'POST') {
      intentCount++
      const request = JSON.parse(String(init?.body)) as { recipe_id: string; content_type: string; byte_size: number; request_id?: string }
      intentRequests.push(request)
      let id = request.request_id ? intentIdsByRequestId.get(request.request_id) : undefined
      if (!id) {
        id = intentCount === 1 ? uploadId : retryUploadId
        if (request.request_id) intentIdsByRequestId.set(request.request_id, id)
      }
      if (loseFirstIntentResponse && intentCount === 1) {
        return Response.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 })
      }
      uploadExpiresAt = Date.now() + 10 * 60_000
      return Response.json({ upload: {
        id,
        url: uploadUrlOverride || `${r2Origin}/mock-recipe-images/recipe-images/staging/${userId}/${recipeId}/${id}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=TESTACCESSKEY%2F20261115%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261115T000000Z&X-Amz-Expires=600&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Signature=${'a'.repeat(64)}`,
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp', 'If-None-Match': '*' },
        byte_size: 10,
        expires_at: new Date(uploadExpiresAt).toISOString(),
      } })
    }
    if (url.origin === r2Origin && method === 'PUT') {
      putCount++
      putSignal = init?.signal as AbortSignal | undefined
      if (waitForPutAbort) {
        resolvePutStarted?.()
        if (!putSignal) throw new Error('Binary upload did not receive an AbortSignal.')
        return await new Promise<Response>((_resolve, reject) => {
          putSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      if (putCount === 1 && putFirstFails) {
        if (expireFirstUpload) vi.spyOn(Date, 'now').mockReturnValue(uploadExpiresAt + 1)
        return new Response(null, { status: putFirstErrorStatus })
      }
      return new Response(null, { status: 200 })
    }
    if (url.pathname === '/functions/v1/recipe-image-attach') {
      attachCount++
      const request = JSON.parse(String(init?.body)) as { upload_id: string }
      attachedUploadIds.push(request.upload_id)
      if (attachFailuresRemaining > 0) {
        attachFailuresRemaining--
        return Response.json({ error: { code: attachFailureCode } }, { status: attachFailureStatus })
      }
      activeImage = 'new'
      return Response.json({ image: { recipe_id: recipeId, content_type: 'image/webp', byte_size: 10, uploaded_at: new Date().toISOString() } })
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  })

  const bitmap = { width: 4096, height: 2048, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, mimeType, quality) {
    expect(this.width).toBe(2048)
    expect(this.height).toBe(1024)
    expect(mimeType).toBe('image/webp')
    expect(quality).toBe(0.82)
    callback(new Blob(['webp-bytes'], { type: 'image/webp' }))
  })
})

afterEach(async () => {
  cleanup()
  const { getAuthClient } = await import('../auth/client')
  await getAuthClient().dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderEditPage() {
  const source = { mode: 'live' as const, list: vi.fn(), detail: vi.fn() }
  const record = {
    id: recipeId,
    userId,
    values: {
      title: 'Ginger rice',
      ingredients: [{ name: 'rice', quantity: 2, unit: 'cups' }],
      instructions: [{ step: 1, text: 'Cook the rice.' }],
      star_rating: null,
      cooked_at: null,
      notes: '',
    },
  }
  const router = modules.createMemoryRouter([{
    path: '/app/recipes/:recipeId/edit',
    element: createElement(modules.EditRecipePage, { record, save: async () => ({ id: recipeId }) }),
  }, {
    path: '/app',
    element: createElement('h1', null, 'Journal'),
  }], { initialEntries: [`/app/recipes/${recipeId}/edit`] })
  const tree = (state: import('../auth/context').AuthState) => createElement(modules.AuthContext.Provider, { value: state },
    createElement(modules.RecipeQueryProvider, { source, children: createElement(modules.RouterProvider, { router }) }))
  const view = render(tree(authState))
  return { ...view, setAuthState: (state: import('../auth/context').AuthState) => view.rerender(tree(state)) }
}

function renderCreatePage(save: () => Promise<{ id: string }>) {
  const source = { mode: 'live' as const, list: vi.fn(), detail: vi.fn() }
  const router = modules.createMemoryRouter([{
    path: '/app/recipes/new',
    element: createElement(modules.CreateRecipePage, { save }),
  }], { initialEntries: ['/app/recipes/new'] })
  const tree = (state: import('../auth/context').AuthState) => createElement(modules.AuthContext.Provider, { value: state },
    createElement(modules.RecipeQueryProvider, { source, children: createElement(modules.RouterProvider, { router }) }))
  const view = render(tree(authState))
  return { ...view, setAuthState: (state: import('../auth/context').AuthState) => view.rerender(tree(state)) }
}

function renderDetailPage() {
  const recipe = {
    id: recipeId,
    title: 'Ginger rice',
    ingredients: [{ name: 'rice', quantity: 2, unit: 'cups', inferred: false }],
    instructions: [{ step: 1, text: 'Cook the rice.' }],
  }
  const source = { mode: 'live' as const, list: async () => [], detail: async () => recipe }
  const router = modules.createMemoryRouter([{
    path: '/app/recipes/:recipeId',
    element: createElement(modules.RecipeDetailPage),
  }], { initialEntries: [`/app/recipes/${recipeId}`] })
  return render(createElement(modules.AuthContext.Provider, { value: authState },
    createElement(modules.RecipeQueryProvider, { source, children: createElement(modules.RouterProvider, { router }) })))
}

function renderCollectionCard() {
  const recipeSummary = { id: recipeId, title: 'Ginger rice', cooked_at: null }
  const recipe = {
    ...recipeSummary,
    ingredients: [{ name: 'rice', quantity: 2, unit: 'cups', inferred: false }],
    instructions: [{ step: 1, text: 'Cook the rice.' }],
  }
  const source = { mode: 'live' as const, list: async () => [recipeSummary], detail: async () => recipe }
  const router = modules.createMemoryRouter([{
    path: '/app/recipes',
    element: createElement('ul', null, createElement(modules.RecipeCard, { recipe: recipeSummary, folio: 1 })),
  }, {
    path: '/app/recipes/:recipeId',
    element: createElement(modules.RecipeDetailPage),
  }], { initialEntries: ['/app/recipes'] })
  return render(createElement(modules.AuthContext.Provider, { value: authState },
    createElement(modules.RecipeQueryProvider, { source, children: createElement(modules.RouterProvider, { router }) })))
}

it('keeps image panels and endpoint calls disabled unless recipe images are explicitly enabled', () => {
  vi.stubEnv('VITE_RECIPE_IMAGES', 'false')
  renderEditPage()

  expect(screen.queryByLabelText('Choose recipe image')).toBeNull()
  expect(screen.queryByText('Recipe image')).toBeNull()
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('enables image upload for a new recipe only after its save returns a stable ID', async () => {
  noImage = true
  const save = vi.fn(async () => ({ id: recipeId }))
  renderCreatePage(save)
  expect(screen.queryByLabelText('Choose recipe image')).toBeNull()
  expect(fetchImpl).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'New dish' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
  expect(await screen.findByText('No recipe photo has been added yet.')).toBeTruthy()
  expect(screen.getByLabelText('Choose recipe image')).toBeTruthy()
  expect(screen.getByLabelText('Choose recipe image').closest('[data-writing-leaf-key]')?.getAttribute('data-writing-leaf-key')).toBe('identity')
  expect(save).toHaveBeenCalledOnce()
  const downloadRequest = fetchImpl.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('recipe-image-download-url'))
  expect(JSON.parse(downloadRequest?.[1]?.body as string)).toEqual({ recipe_id: recipeId })
})

it('distinguishes an empty photo slot, a selected preview, failed upload, and verified attachment', async () => {
  noImage = true
  renderEditPage()
  await screen.findByText('No recipe photo has been added yet.')
  expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeTruthy()
  expect(screen.getByLabelText('Empty recipe photo frame')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  expect(screen.queryByText('No recipe photo has been added yet.')).toBeNull()
  expect(screen.getByText('Selected photo — upload to attach privately.')).toBeTruthy()
  expect(screen.queryByText('Attached privately')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('img', { name: 'Selected recipe image preview' })).toBeTruthy()
  expect(screen.queryByText('Attached privately')).toBeNull()

  noImage = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await screen.findByText('Recipe image saved.')
  expect(screen.getByText('Attached privately')).toBeTruthy()
  expect(screen.queryByText('Selected photo — upload to attach privately.')).toBeNull()
  expect(screen.queryByRole('img', { name: 'Selected recipe image preview' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Replace photo' })).toBeTruthy()
})

it('keeps verified attachment distinct from a selected photo when its display URL cannot refresh', async () => {
  noImage = true
  putFirstFails = false
  renderEditPage()
  await screen.findByText('No recipe photo has been added yet.')
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  await screen.findByRole('button', { name: 'Refresh attached image' })
  expect(screen.getByText('Photo attached; refreshing the saved image.')).toBeTruthy()
  expect(screen.queryByText('No recipe photo has been added yet.')).toBeNull()
  expect(screen.queryByText('Selected photo — upload to attach privately.')).toBeNull()
  expect(attachCount).toBe(1)
})

it('hides saved create-image controls when the authenticated account changes', async () => {
  noImage = true
  const view = renderCreatePage(vi.fn(async () => ({ id: recipeId })))
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'New dish' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save recipe' }))
  await screen.findByLabelText('Choose recipe image')
  const requests = fetchImpl.mock.calls.length

  view.setAuthState({ ...authState, user: { ...authState.user!, id: 'cook-b' } })

  expect(screen.queryByLabelText('Choose recipe image')).toBeNull()
  expect(screen.queryByRole('img', { name: 'New dish photo' })).toBeNull()
  expect((screen.getByLabelText('Recipe title') as HTMLTextAreaElement).value).toBe('')
  expect(fetchImpl.mock.calls.length).toBe(requests)
})

it('preserves the image selection and dirty recipe when journal navigation is cancelled', async () => {
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Recipe title'), { target: { value: 'Unsaved ginger rice' } })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: /Back to recipe/ }))
  await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
  fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))

  expect(screen.getByDisplayValue('Unsaved ginger rice')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Selected recipe image preview' })).toBeTruthy()
  expect(intentCount).toBe(0)
})

it('rejects unsupported files before requesting an upload intent', async () => {
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })

  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['not-an-image'], 'meal.gif', { type: 'image/gif' })] },
  })

  expect((await screen.findByRole('alert')).textContent).toContain('Choose a JPEG, PNG, or WebP image')
  expect(intentCount).toBe(0)
})

it('rejects an upload URL outside the request-scoped R2 staging object', async () => {
  uploadUrlOverride = `https://evil.example.test/mock-recipe-images/recipe-images/staging/${userId}/${recipeId}/${uploadId}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=TESTACCESSKEY%2F20261115%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261115T000000Z&X-Amz-Expires=600&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Signature=${'a'.repeat(64)}`
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Could not upload this image. Try again.')
  expect(putCount).toBe(0)
  expect(attachCount).toBe(0)
})

it('rejects converted images larger than 10 MiB before requesting an upload intent', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/webp' }))
  })
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })

  expect((await screen.findByRole('alert')).textContent).toContain('within 10 MiB')
  expect(screen.queryByRole('img', { name: 'Selected recipe image preview' })).toBeNull()
  expect(intentCount).toBe(0)
})

it('refreshes the private display URL after an image load failure', async () => {
  refreshOnFailure = true
  renderEditPage()
  const image = await screen.findByRole('img', { name: 'Ginger rice photo' })

  fireEvent.error(image)

  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(downloadCount).toBe(2)
})

it('shows the private image in the taped frame above the recipe title', async () => {
  renderDetailPage()

  expect(await screen.findByRole('img', { name: 'Ginger rice photo' })).toBeTruthy()
  const photo = screen.getByRole('img', { name: 'Ginger rice photo' })
  const frame = photo.closest('figure')
  expect(frame?.classList.contains('mm-recipe-artwork--detail')).toBe(true)
  expect(frame?.querySelectorAll('.mm-tape')).toHaveLength(2)
  expect(frame?.querySelector('figcaption')?.textContent).toBe('No date recorded')
  expect(screen.queryByRole('img', { name: /Illustrated placeholder/ })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Recipe image' })).toBeNull()
  expect(frame && (frame.compareDocumentPosition(screen.getByRole('heading', { name: 'Ginger rice' })) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Recipe identity and details' }).contains(screen.getByRole('img', { name: 'Ginger rice photo' }))).toBe(true)
  const downloadRequest = fetchImpl.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('recipe-image-download-url'))
  expect(JSON.parse(downloadRequest?.[1]?.body as string)).toEqual({ recipe_id: recipeId })
  expect(new Headers(downloadRequest?.[1]?.headers).get('Authorization')).toBe('Bearer fresh-access-token')
})

it('shows the private image on the journal card and reuses its fresh URL on detail navigation', async () => {
  renderCollectionCard()
  const cardPhoto = await screen.findByRole('img', { name: 'Ginger rice photo' })
  expect(cardPhoto.closest('figure')?.classList.contains('mm-recipe-artwork--card')).toBe(true)
  expect(downloadCount).toBe(1)

  fireEvent.click(screen.getByRole('link', { name: 'Open recipe Ginger rice' }))
  await screen.findByRole('heading', { name: 'Ginger rice', level: 1 })
  expect((await screen.findByRole('img', { name: 'Ginger rice photo' })).getAttribute('src')).toBe(oldImageUrl)
  expect(downloadCount).toBe(1)
})

it('falls back to the illustration when a failed card photo is re-signed with the same URL', async () => {
  renderCollectionCard()
  fireEvent.error(await screen.findByRole('img', { name: 'Ginger rice photo' }))

  expect(await screen.findByRole('img', { name: /Illustrated placeholder for Ginger rice/ })).toBeTruthy()
  await waitFor(() => expect(downloadCount).toBe(2))
  expect(screen.queryByRole('img', { name: 'Ginger rice photo' })).toBeNull()
})

it('keeps the illustrated journal card when no private photo is attached', async () => {
  noImage = true
  renderCollectionCard()

  expect(await screen.findByRole('img', { name: /Illustrated placeholder for Ginger rice/ })).toBeTruthy()
  await waitFor(() => expect(downloadCount).toBe(1))
  expect(screen.queryByRole('img', { name: 'Ginger rice photo' })).toBeNull()
})

it('keeps the framed illustration when the recipe has no photo', async () => {
  noImage = true
  renderDetailPage()
  await waitFor(() => expect(downloadCount).toBe(1))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Recipe photo for Ginger rice' }).getAttribute('aria-busy')).toBe('false'))
  expect(screen.getByRole('img', { name: /Illustrated placeholder for Ginger rice/ }).closest('figure')?.querySelector('figcaption')?.textContent).toBe('No date recorded')
  expect(screen.queryByRole('img', { name: 'Ginger rice photo' })).toBeNull()
})

it('keeps the illustration without private reads when images are disabled', async () => {
  vi.stubEnv('VITE_RECIPE_IMAGES', 'false')
  renderDetailPage()
  expect(await screen.findByRole('img', { name: /Illustrated placeholder for Ginger rice/ })).toBeTruthy()
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('restores the illustration after repeated photo failures and allows a manual refresh', async () => {
  renderDetailPage()
  fireEvent.error(await screen.findByRole('img', { name: 'Ginger rice photo' }))
  await waitFor(() => expect(downloadCount).toBe(2))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Recipe photo for Ginger rice' }).getAttribute('aria-busy')).toBe('false'))
  fireEvent.error(screen.getByRole('img', { name: 'Ginger rice photo' }))
  expect(screen.getByRole('img', { name: /Illustrated placeholder for Ginger rice/ })).toBeTruthy()
  expect(screen.queryByRole('img', { name: 'Ginger rice photo' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh photo' }))
  expect(await screen.findByRole('img', { name: 'Ginger rice photo' })).toBeTruthy()
  expect(downloadCount).toBe(3)
})

it('names the photo region when no heading is shown', async () => {
  const { RecipeImagePanel } = await import('./RecipeImagePanel')
  render(createElement(modules.AuthContext.Provider, { value: authState },
    createElement(RecipeImagePanel, { recipeId, recipeTitle: 'Ginger rice' })))
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  expect(screen.getByRole('region', { name: 'Recipe photo for Ginger rice' })).toBeTruthy()
})

it('requests another private URL when the current URL expires', async () => {
  refreshOnFailure = true
  downloadLifetimeMs = 30
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })

  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(downloadCount).toBeGreaterThanOrEqual(2)
})

it('keeps the new private URL when an older initial read finishes after attachment', async () => {
  delayFirstDownload = true
  putFirstFails = false
  renderEditPage()
  await firstDownloadStarted
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(downloadCount).toBe(2)

  await act(async () => {
    resolveInitialDownload?.(Response.json({ url: oldImageUrl, expires_at: new Date(Date.now() + 60_000).toISOString() }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl)
})

it('continues to verified attachment after a repeated signed PUT returns 412', async () => {
  putFirstErrorStatus = 412
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(putCount).toBe(1)
  expect(attachCount).toBe(1)
})

it('requests a new upload intent after a presigned URL expires', async () => {
  putFirstErrorStatus = 403
  expireFirstUpload = true
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  expect((await screen.findByRole('alert')).textContent).toContain('This upload expired. Retry to start a new upload.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(intentCount).toBe(2)
  expect(putCount).toBe(2)
  expect(attachCount).toBe(1)
})

it('keeps the current photo after attachment failure and retries verification without resending bytes', async () => {
  putFirstFails = false
  attachFailuresRemaining = 1
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Could not upload this image. Try again.')
  expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(oldImageUrl)
  expect(putCount).toBe(1)
  expect(attachCount).toBe(1)

  fireEvent.click(screen.getByRole('button', { name: 'Retry attachment' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(putCount).toBe(1)
  expect(attachCount).toBe(2)
})

it('requests a fresh intent after attachment reports that the old intent was not found', async () => {
  putFirstFails = false
  attachFailuresRemaining = 1
  attachFailureCode = 'UPLOAD_NOT_FOUND'
  attachFailureStatus = 404
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  expect((await screen.findByRole('alert')).textContent).toContain('This upload is no longer available. Retry to start a new upload.')
  expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(oldImageUrl)
  expect(screen.getByRole('button', { name: 'Retry upload' })).toBeTruthy()
  expect(intentCount).toBe(1)
  expect(putCount).toBe(1)
  expect(attachCount).toBe(1)

  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(intentCount).toBe(2)
  expect(putCount).toBe(2)
  expect(attachCount).toBe(2)
  expect(attachedUploadIds).toEqual([uploadId, retryUploadId])
})

it('recovers from a stalled upload without claiming success', async () => {
  waitForPutAbort = true
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  await act(async () => { await putStarted })
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(putSignal?.aborted).toBe(true)
  expect(attachCount).toBe(0)
  expect(screen.getByRole('alert').textContent).toContain('took too long')
  expect(screen.getByRole('button', { name: 'Retry upload' })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(oldImageUrl)
  vi.useRealTimers()
})

it('aborts an in-flight byte PUT when the recipe image panel unmounts', async () => {
  waitForPutAbort = true
  const view = renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  await putStarted

  view.unmount()

  expect(putSignal).toBeTruthy()
  expect(putSignal?.aborted).toBe(true)
  expect(attachCount).toBe(0)
})

it('aborts an in-flight byte PUT when the authenticated account changes', async () => {
  waitForPutAbort = true
  const view = renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  await putStarted

  const nextUser = { ...authState.user!, id: 'cook-b' }
  view.setAuthState({ ...authState, user: nextUser, session: { ...authState.session!, user: nextUser } })

  expect(putSignal?.aborted).toBe(true)
  expect(attachCount).toBe(0)
  expect(screen.queryByLabelText('Choose recipe image')).toBeNull()
})

it('uploads optimized bytes directly to the signed R2 URL and preserves the current image until attachment', async () => {
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })

  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Could not upload this image. Try again.')
  expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(oldImageUrl)
  expect(attachCount).toBe(0)

  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))

  expect(intentCount).toBe(1)
  expect(putCount).toBe(2)
  expect(attachCount).toBe(1)
  expect(downloadCount).toBe(2)
  const intentRequest = fetchImpl.mock.calls.find(([input, init]) =>
    new URL(String(input)).pathname.endsWith('recipe-image-upload-url') && init?.method === 'POST')
  const intentBody = JSON.parse(intentRequest?.[1]?.body as string)
  expect(intentBody).toMatchObject({ recipe_id: recipeId, content_type: 'image/webp', byte_size: 10 })
  expect(intentBody).not.toHaveProperty('request_id')

  const putRequests = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'PUT')
  const putRequest = putRequests[0]
  const attachRequest = fetchImpl.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('recipe-image-attach'))
  expect(putRequest?.[0]).toContain(`${r2Origin}/mock-recipe-images/recipe-images/staging/${userId}/${recipeId}/${uploadId}?`)
  expect(putRequest?.[1]?.body).toBeInstanceOf(Blob)
  expect((putRequest?.[1]?.body as Blob).type).toBe('image/webp')
  expect(new Headers(putRequest?.[1]?.headers).get('Content-Type')).toBe('image/webp')
  expect(new Headers(putRequest?.[1]?.headers).get('If-None-Match')).toBe('*')
  expect(new Headers(putRequest?.[1]?.headers).has('Authorization')).toBe(false)
  expect(new Headers(putRequest?.[1]?.headers).has('apikey')).toBe(false)
  expect(intentRequest?.[1]?.signal).toBe(putRequest?.[1]?.signal)
  expect(putRequests[1]?.[1]?.signal).toBe(attachRequest?.[1]?.signal)
  await waitFor(() => expect(testURL.revokeObjectURL).toHaveBeenCalledWith('blob:recipe-preview'))
  expect(screen.getByText('Recipe image saved.')).toBeTruthy()
})

it('reuses the same upload request ID after the authorization response is lost', async () => {
  vi.stubEnv('VITE_RECIPE_IMAGE_UPLOAD_IDEMPOTENCY', 'true')
  loseFirstIntentResponse = true
  putFirstFails = false
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })

  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not upload this image. Try again.')

  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  await screen.findByText('Recipe image saved.')

  expect(intentRequests).toHaveLength(2)
  const requestId = intentRequests[0].request_id
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(intentRequests[1].request_id).toBe(requestId)
  if (!requestId) throw new Error('The enabled idempotency gate did not send a request ID.')
  expect(intentIdsByRequestId.get(requestId)).toBe(uploadId)
  expect(putCount).toBe(1)
  expect(attachCount).toBe(1)
})

it('clears image loading when the upload deadline aborts a post-attachment refresh', async () => {
  delayPostAttachDownload = true
  downloadLifetimeMs = 60 * 60_000
  putFirstFails = false
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  vi.useFakeTimers()
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
    await act(async () => { await postAttachDownloadStarted })

    expect(screen.getByText('Loading current recipe image…')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })

    expect(screen.queryByText('Loading current recipe image…')).toBeNull()
    expect(document.querySelector('.recipe-image-panel')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('alert').textContent).toContain('took too long')
    resolvePostAttachDownload?.(Response.json({
      url: newImageUrl,
      expires_at: new Date(Date.now() + downloadLifetimeMs).toISOString(),
    }))
    await act(async () => { await Promise.resolve() })
  } finally {
    vi.useRealTimers()
  }
})
