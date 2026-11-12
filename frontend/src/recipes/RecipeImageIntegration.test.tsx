import { createElement } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sessionProvider = vi.hoisted(() => ({ getSession: vi.fn() }))
const recipeId = '33333333-3333-4333-8333-333333333333'
const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = 'cook-a'
const oldImageUrl = 'https://images.example.test/old-signed-image'
const newImageUrl = 'https://images.example.test/new-signed-image'

let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>
let apiUrl = ''
let testSequence = 0
let modules: {
  AuthContext: typeof import('../auth/context').AuthContext
  CreateRecipePage: typeof import('../pages/CreateRecipePage').default
  RecipeDetailPage: typeof import('../pages/RecipeDetailPage').default
  EditRecipePage: typeof import('../pages/EditRecipePage').default
  RecipeQueryProvider: typeof import('./RecipeQueryProvider').RecipeQueryProvider
  createMemoryRouter: typeof import('react-router').createMemoryRouter
  RouterProvider: typeof import('react-router').RouterProvider
}
let authState: import('../auth/context').AuthState
let activeImage: 'old' | 'new' = 'old'
let noImage = false
let refreshOnFailure = false
let downloadLifetimeMs = 60_000
let putFirstErrorCode = 'STORAGE_UNAVAILABLE'
let putFirstErrorStatus = 503
let putFirstFails = true
let downloadCount = 0
let intentCount = 0
let putCount = 0
let attachCount = 0
let attachFailuresRemaining = 0
let testURL: typeof URL

beforeEach(async () => {
  vi.resetModules()
  apiUrl = `https://images-project-${++testSequence}.example.test`
  vi.stubEnv('VITE_SUPABASE_URL', apiUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
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
  const [{ AuthContext }, { getAuthClient }, { default: CreateRecipePage }, { default: RecipeDetailPage }, { default: EditRecipePage }, { RecipeQueryProvider }, router] = await Promise.all([
    import('../auth/context'), import('../auth/client'), import('../pages/CreateRecipePage'), import('../pages/RecipeDetailPage'), import('../pages/EditRecipePage'),
    import('./RecipeQueryProvider'), import('react-router'),
  ])
  vi.spyOn(getAuthClient(), 'getSession').mockImplementation(() => sessionProvider.getSession())
  modules = { AuthContext, CreateRecipePage, RecipeDetailPage, EditRecipePage, RecipeQueryProvider, createMemoryRouter: router.createMemoryRouter, RouterProvider: router.RouterProvider }
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
  putFirstErrorCode = 'STORAGE_UNAVAILABLE'
  putFirstErrorStatus = 503
  putFirstFails = true
  attachFailuresRemaining = 0
  downloadCount = 0
  intentCount = 0
  putCount = 0
  attachCount = 0
  fetchImpl.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname === '/functions/v1/recipe-image-download-url') {
      downloadCount++
      if (noImage) return Response.json({ error: { code: 'IMAGE_NOT_FOUND' } }, { status: 404 })
      return Response.json({
        url: activeImage === 'new' || (refreshOnFailure && downloadCount > 1) ? newImageUrl : oldImageUrl,
        expires_at: new Date(Date.now() + downloadLifetimeMs).toISOString(),
      })
    }
    if (url.pathname === '/functions/v1/recipe-image-upload-url' && method === 'POST') {
      intentCount++
      return Response.json({ upload: {
        id: uploadId,
        url: `${apiUrl}/functions/v1/recipe-image-upload-url?upload_id=${uploadId}`,
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      } })
    }
    if (url.pathname === '/functions/v1/recipe-image-upload-url' && method === 'PUT') {
      putCount++
      if (putCount === 1 && putFirstFails) return Response.json({ error: { code: putFirstErrorCode } }, { status: putFirstErrorStatus })
      return Response.json({ upload: { id: uploadId, received: true } }, { status: 201 })
    }
    if (url.pathname === '/functions/v1/recipe-image-attach') {
      attachCount++
      if (attachFailuresRemaining > 0) {
        attachFailuresRemaining--
        return Response.json({ error: { code: 'TEMPORARY_UNAVAILABLE' } }, { status: 503 })
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
  }], { initialEntries: [`/app/recipes/${recipeId}/edit`] })
  return render(createElement(modules.AuthContext.Provider, { value: authState },
    createElement(modules.RecipeQueryProvider, { source, children: createElement(modules.RouterProvider, { router }) })))
}

function renderCreatePage(save: () => Promise<{ id: string }>) {
  const source = { mode: 'live' as const, list: vi.fn(), detail: vi.fn() }
  const router = modules.createMemoryRouter([{
    path: '/app/recipes/new',
    element: createElement(modules.CreateRecipePage, { save }),
  }], { initialEntries: ['/app/recipes/new'] })
  return render(createElement(modules.AuthContext.Provider, { value: authState },
    createElement(modules.RecipeQueryProvider, { source, children: createElement(modules.RouterProvider, { router }) })))
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
  expect(save).toHaveBeenCalledOnce()
  const downloadRequest = fetchImpl.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('recipe-image-download-url'))
  expect(JSON.parse(downloadRequest?.[1]?.body as string)).toEqual({ recipe_id: recipeId })
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

it('shows an attached private image on the recipe detail page', async () => {
  renderDetailPage()

  expect(await screen.findByRole('img', { name: 'Ginger rice photo' })).toBeTruthy()
  const downloadRequest = fetchImpl.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith('recipe-image-download-url'))
  expect(JSON.parse(downloadRequest?.[1]?.body as string)).toEqual({ recipe_id: recipeId })
  expect(new Headers(downloadRequest?.[1]?.headers).get('Authorization')).toBe('Bearer fresh-access-token')
})

it('requests another private URL when the current URL expires', async () => {
  refreshOnFailure = true
  downloadLifetimeMs = 30
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })

  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(downloadCount).toBeGreaterThanOrEqual(2)
})

it('waits on an in-progress upload without resending bytes or attaching immediately', async () => {
  putFirstErrorCode = 'UPLOAD_IN_PROGRESS'
  putFirstErrorStatus = 409
  renderEditPage()
  await screen.findByRole('img', { name: 'Ginger rice photo' })
  fireEvent.change(screen.getByLabelText('Choose recipe image'), {
    target: { files: [new File(['source-image'], 'lunch.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByRole('img', { name: 'Selected recipe image preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Wait, then retry to finish attaching it.')
  expect(putCount).toBe(1)
  expect(attachCount).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Retry attachment' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Ginger rice photo' }).getAttribute('src')).toBe(newImageUrl))
  expect(putCount).toBe(1)
  expect(attachCount).toBe(1)
})

it('does not resend bytes when the upload intent was already used', async () => {
  putFirstErrorCode = 'UPLOAD_ALREADY_USED'
  putFirstErrorStatus = 409
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

it('requests a new upload intent after the current one expires', async () => {
  putFirstErrorCode = 'UPLOAD_EXPIRED'
  putFirstErrorStatus = 410
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

it('uploads optimized bytes through authenticated ingress and preserves the current image until attachment', async () => {
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
  expect(JSON.parse(intentRequest?.[1]?.body as string)).toEqual({ recipe_id: recipeId, content_type: 'image/webp', byte_size: 10 })

  const putRequest = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(putRequest?.[0]).toBe(`${apiUrl}/functions/v1/recipe-image-upload-url?upload_id=${uploadId}`)
  expect(putRequest?.[1]?.body).toBeInstanceOf(Blob)
  expect((putRequest?.[1]?.body as Blob).type).toBe('image/webp')
  expect(new Headers(putRequest?.[1]?.headers).get('Authorization')).toBe('Bearer fresh-access-token')
  expect(new Headers(putRequest?.[1]?.headers).get('apikey')).toBe('public-test-key')
  expect(new Headers(putRequest?.[1]?.headers).get('Content-Type')).toBe('image/webp')
  await waitFor(() => expect(testURL.revokeObjectURL).toHaveBeenCalledWith('blob:recipe-preview'))
  expect(screen.getByText('Recipe image saved.')).toBeTruthy()
})
