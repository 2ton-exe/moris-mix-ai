// FE-08 browser acceptance with a synthetic session and an isolated cross-origin local API.
// This suite never contacts a hosted Supabase project or writes recipe records.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userId = '33333333-3333-4333-8333-333333333333'
const user = {
  id: userId, aud: 'authenticated', role: 'authenticated', email: 'cook@example.test',
  app_metadata: {}, user_metadata: {}, created_at: '2026-10-19T00:00:00Z',
  email_confirmed_at: '2026-10-19T00:00:00Z',
}
const session = {
  access_token: 'quick-ai-test-access', refresh_token: 'quick-ai-test-refresh', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
}
const recipe = {
  title: 'Garlic soy chicken',
  ingredients: [{ name: 'chicken', quantity: null, unit: null, quantityText: 'some', inferred: true }],
  instructions: [{ step: 1, text: 'Boil the chicken with garlic.' }],
  flavor_scores: { sweet: 1, salty: 4, sour: 0, bitter: 0, umami: 4, spicy: 0 },
}
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'moris-fe08-'))
let appOrigin
let apiOrigin
let extractionMode = 'success'
const requests = []

function corsHeaders(request, exposeRetryAfter = true) {
  return {
    ...(request.headers.origin === appOrigin ? { 'Access-Control-Allow-Origin': appOrigin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    ...(exposeRetryAfter ? { 'Access-Control-Expose-Headers': 'Retry-After' } : {}),
    Vary: 'Origin',
  }
}

function sendJson(request, response, status, body, { retryAfter, exposeRetryAfter = true } = {}) {
  response.writeHead(status, {
    ...corsHeaders(request, exposeRetryAfter),
    'Content-Type': 'application/json',
    ...(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
  })
  response.end(JSON.stringify(body))
}

async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
}

async function continueLocalRequest(route) {
  const url = new URL(route.request().url())
  assert.ok(
    url.origin === appOrigin || url.origin === apiOrigin,
    `Unexpected external request: ${url.origin}`,
  )
  await route.continue()
}

async function handleApiRequest(request, response) {
  const url = new URL(request.url, apiOrigin)
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request))
    response.end()
    return
  }

  let body = null
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') body = await requestBody(request)
  } catch {
    sendJson(request, response, 400, { error: { code: 'invalid_test_json', message: 'Invalid test request.' } })
    return
  }
  requests.push({ method: request.method, path: url.pathname, body, authorization: request.headers.authorization })

  if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
    if (request.headers.authorization === 'Bearer quick-ai-test-access') sendJson(request, response, 200, user)
    else sendJson(request, response, 401, { error: { code: 'UNAUTHORIZED', message: 'Not signed in.' } })
    return
  }
  if (url.pathname === '/auth/v1/logout' && request.method === 'POST') {
    response.writeHead(204, corsHeaders(request))
    response.end()
    return
  }
  if (url.pathname === '/functions/v1/recipes' && request.method === 'GET') {
    sendJson(request, response, 200, { recipes: [], has_more: false, next_cursor: null })
    return
  }
  if (url.pathname !== '/functions/v1/extract-recipe' || request.method !== 'POST') {
    sendJson(request, response, 404, { error: { code: 'unexpected_test_request', message: 'Unexpected isolated request' } })
    return
  }

  if (extractionMode === 'network') {
    response.destroy()
    return
  }
  if (extractionMode === 'provider') {
    sendJson(request, response, 503, { error: { code: 'AI_UNAVAILABLE', message: 'private provider detail' } })
    return
  }
  if (extractionMode === 'provider-rate-limit' || extractionMode === 'provider-hidden-retry-after') {
    sendJson(request, response, 429, { error: { code: 'AI_RATE_LIMITED', message: 'private provider detail' } }, {
      retryAfter: '60', exposeRetryAfter: extractionMode !== 'provider-hidden-retry-after',
    })
    return
  }
  if (extractionMode === 'quota') {
    sendJson(request, response, 429, { error: { code: 'QUOTA_EXCEEDED', message: 'private quota detail' } }, { retryAfter: '60' })
    return
  }
  if (extractionMode === 'auth-rate-limit') {
    sendJson(request, response, 503, { error: { code: 'AUTH_SERVICE_RATE_LIMITED', message: 'private auth detail' } }, { retryAfter: '60' })
    return
  }
  if (extractionMode === 'slow-success') {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500))
    sendJson(request, response, 200, { recipe })
    return
  }
  if (extractionMode === 'invalid') {
    sendJson(request, response, 200, { recipe: { ...recipe, instructions: [{ step: 3, text: 'Malformed sequence.' }] } })
    return
  }
  sendJson(request, response, 200, { recipe })
}

const apiServer = createHttpServer(handleApiRequest)
let server
let browser

try {
  await new Promise((resolve, reject) => {
    apiServer.once('error', reject)
    apiServer.listen(0, '127.0.0.1', resolve)
  })
  const apiAddress = apiServer.address()
  assert.ok(apiAddress && typeof apiAddress === 'object')
  apiOrigin = `http://127.0.0.1:${apiAddress.port}`
  server = await createServer({
    root, configFile: false, envDir: false, plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-quick-ai-public-key'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
      'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
    },
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  })
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  const storageKey = `sb-${new URL(apiOrigin).hostname.split('.')[0]}-auth-token`
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(({ session, storageKey }) => {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(session))
  }, { session, storageKey })
  await context.route('**/*', continueLocalRequest)
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await guestContext.route('**/*', continueLocalRequest)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`${origin}app/quick-entry`)
  await expect(guestPage).toHaveURL(/\/login(?:\?|$)/)
  await expect(guestPage.getByRole('heading', { name: 'Quick AI Entry' })).toHaveCount(0)
  await guestContext.close()

  await page.goto(`${origin}app`)
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  await page.getByRole('link', { name: 'Quick AI Entry', exact: true }).click()
  await expect(page).toHaveURL(`${origin}app/quick-entry`)
  await expect(page.getByRole('heading', { name: 'Quick AI Entry' })).toBeVisible()
  const notes = page.getByRole('textbox', { name: 'Cooking notes' })
  await expect(notes).toHaveAttribute('maxlength', '10000')
  await expect(page.getByRole('link', { name: 'Back to journal' })).toBeVisible()
  await expect(page.locator('.mm-quick-ai-intro .mm-mori')).toBeVisible()

  const sourceNotes = 'rice, two eggs\nsoy sauce and garlic; fry the eggs first'
  await notes.fill(sourceNotes)
  await notes.press('End')
  await notes.press('Enter')
  assert.ok((await notes.inputValue()).includes('\n'))
  await notes.fill(sourceNotes)
  await page.screenshot({ path: path.join(outputDir, 'desktop-empty-notes.png'), fullPage: true })

  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  await expect(page.getByText('This recipe is only a preview. Nothing has been saved to your journal.')).toBeVisible()
  await expect(page.locator('blockquote')).toHaveText(sourceNotes)
  assert.ok(requests.some((request) => request.path === '/functions/v1/extract-recipe' && request.authorization === 'Bearer quick-ai-test-access'))
  assert.deepEqual(requests.find((request) => request.path === '/functions/v1/extract-recipe')?.body, { notes: sourceNotes })
  assert.equal(requests.filter((request) => request.path === '/functions/v1/recipes' && request.method !== 'GET').length, 0)
  await page.screenshot({ path: path.join(outputDir, 'desktop-unsaved-preview.png'), fullPage: true })

  const extractionCount = requests.filter((request) => request.path === '/functions/v1/extract-recipe').length
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  await expect(page.locator('blockquote')).toHaveText(sourceNotes)
  await page.getByRole('link', { name: 'Back to journal' }).click()
  await page.getByRole('link', { name: 'Quick AI Entry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  await expect(page.locator('blockquote')).toHaveText(sourceNotes)
  assert.equal(requests.filter((request) => request.path === '/functions/v1/extract-recipe').length, extractionCount)

  extractionMode = 'network'
  await notes.fill('beans, cumin, lemon, a splash of water')
  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('alert')).toContainText('Mori could not reach the kitchen')
  await expect(notes).toHaveValue('beans, cumin, lemon, a splash of water')
  extractionMode = 'success'
  await page.getByRole('button', { name: 'Retry extraction' }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  assert.deepEqual(requests.filter((request) => request.path === '/functions/v1/extract-recipe').slice(-2).map((request) => request.body), [
    { notes: 'beans, cumin, lemon, a splash of water' }, { notes: 'beans, cumin, lemon, a splash of water' },
  ])

  extractionMode = 'provider'
  await notes.fill('slow beans with garlic')
  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('alert')).toContainText('Mori could not organize those notes just now')
  await expect(page.getByText('private provider detail')).toHaveCount(0)

  extractionMode = 'provider-rate-limit'
  const providerPage = await context.newPage()
  providerPage.on('pageerror', (error) => errors.push(error.message))
  await providerPage.goto(`${origin}app/quick-entry`)
  const providerNotes = providerPage.getByRole('textbox', { name: 'Cooking notes' })
  await providerNotes.fill('keep these notes while the provider cools down')
  await providerPage.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(providerPage.getByRole('alert')).toContainText('temporarily busy')
  const providerCooldown = providerPage.getByText(/Please wait \d+ seconds for Mori's cooldown before retrying\./)
  await expect(providerCooldown).toBeVisible()
  await expect(providerPage.getByRole('button', { name: 'Please wait to retry' })).toBeDisabled()
  const providerWait = Number((await providerCooldown.textContent()).match(/Please wait (\d+) seconds/)[1])
  assert.ok(providerWait > 30 && providerWait <= 60, `Expected the exposed 60-second provider cooldown, got ${providerWait}`)
  await expect(providerNotes).toHaveValue('keep these notes while the provider cools down')
  await expect(providerPage.getByText('private provider detail')).toHaveCount(0)
  await providerPage.close()

  extractionMode = 'invalid'
  await notes.fill('notes that receive a malformed result')
  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('alert')).toContainText("Mori couldn't validate the recipe")
  await expect(notes).toHaveValue('notes that receive a malformed result')
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toHaveCount(0)

  extractionMode = 'quota'
  await notes.fill('curry notes that remain after quota failure')
  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('alert')).toContainText("You've reached today's AI organizing limit")
  await expect(page.getByRole('button', { name: 'Please wait to retry' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Retry extraction' })).toHaveCount(0)
  await expect(page.getByText('private quota detail')).toHaveCount(0)

  await page.getByRole('link', { name: 'Back to journal' }).click()
  await expect(page).toHaveURL(`${origin}app`)
  await page.getByRole('link', { name: 'Quick AI Entry', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Cooking notes' })).toHaveValue('curry notes that remain after quota failure')
  await expect(page.getByRole('button', { name: 'Please wait to retry' })).toBeDisabled()

  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('textbox', { name: 'Cooking notes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Please wait to retry' })).toBeVisible()
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Horizontal overflow at ${width}px`)
    assert.equal(await notes.evaluate((element) => element.scrollWidth <= element.clientWidth), true, `Textarea overflow at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `quick-entry-${width}.png`), fullPage: true })
  }

  // A 720px CSS viewport is the app's established 200% zoom-equivalent reflow check.
  await page.setViewportSize({ width: 720, height: 450 })
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, 'Horizontal overflow at 200% equivalent reflow')
  await expect(page.getByRole('textbox', { name: 'Cooking notes' })).toBeVisible()
  await page.screenshot({ path: path.join(outputDir, 'quick-entry-zoom-200-equivalent.png'), fullPage: true })

  await notes.focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.locator(':focus').evaluate((element) => globalThis.getComputedStyle(element).outlineStyle !== 'none'), true, 'Keyboard focus is not visible')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('button', { name: 'Please wait to retry' })).toHaveCSS('transition-property', 'none')
  extractionMode = 'auth-rate-limit'
  const authPage = await context.newPage()
  authPage.on('pageerror', (error) => errors.push(error.message))
  await authPage.goto(`${origin}app/quick-entry`)
  const authNotes = authPage.getByRole('textbox', { name: 'Cooking notes' })
  await authNotes.fill('keep these notes while authentication recovers')
  await authPage.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(authPage.getByRole('alert')).toContainText('could not verify your session')
  await expect(authPage.getByRole('button', { name: 'Please wait to retry' })).toBeDisabled()
  const authCooldown = authPage.getByText(/Please wait \d+ seconds before asking Mori to try again\./)
  await expect(authCooldown).toBeVisible()
  const authWait = Number((await authCooldown.textContent()).match(/Please wait (\d+) seconds/)[1])
  assert.ok(authWait > 30 && authWait <= 60, `Expected the exposed 60-second authentication cooldown, got ${authWait}`)
  await expect(authNotes).toHaveValue('keep these notes while authentication recovers')
  await expect(authPage.getByText('private auth detail')).toHaveCount(0)

  extractionMode = 'provider-hidden-retry-after'
  const fallbackPage = await context.newPage()
  fallbackPage.on('pageerror', (error) => errors.push(error.message))
  await fallbackPage.goto(`${origin}app/quick-entry`)
  const fallbackNotes = fallbackPage.getByRole('textbox', { name: 'Cooking notes' })
  await fallbackNotes.fill('keep these notes when the cooldown header is not exposed')
  await fallbackPage.getByRole('button', { name: 'Organize my notes' }).click()
  const fallbackCooldown = fallbackPage.getByText(/Please wait \d+ seconds for Mori's cooldown before retrying\./)
  await expect(fallbackCooldown).toBeVisible()
  await expect(fallbackPage.getByRole('button', { name: 'Please wait to retry' })).toBeDisabled()
  const fallbackWait = Number((await fallbackCooldown.textContent()).match(/Please wait (\d+) seconds/)[1])
  assert.ok(fallbackWait >= 25 && fallbackWait <= 30, `Expected the 30-second fallback for a hidden header, got ${fallbackWait}`)
  await expect(fallbackNotes).toHaveValue('keep these notes when the cooldown header is not exposed')
  await fallbackPage.close()
  const reducedMotionPage = await context.newPage()
  reducedMotionPage.on('pageerror', (error) => errors.push(error.message))
  await reducedMotionPage.emulateMedia({ reducedMotion: 'reduce' })
  await reducedMotionPage.goto(`${origin}app/quick-entry`)
  await reducedMotionPage.getByRole('textbox', { name: 'Cooking notes' }).fill('notes prepared with reduced motion enabled')
  extractionMode = 'slow-success'
  await reducedMotionPage.getByRole('button', { name: 'Organize my notes' }).click()
  const loadingMori = reducedMotionPage.locator('.mm-quick-ai__loading .mm-mori')
  await expect(loadingMori).toHaveAttribute('data-animated', 'true')
  await expect(loadingMori).toBeVisible()
  assert.equal(await loadingMori.locator('.mori-spoon').evaluate((element) => globalThis.getComputedStyle(element).animationName), 'none', 'Mori kept animating under reduced motion')
  await expect(reducedMotionPage.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write(`Quick AI Entry authenticated extraction, validated unsaved handoff persistence, network/provider/quota/auth-rate-limit/invalid responses, exposed and hidden Retry-After behavior, retry and source-note preservation, keyboard focus, 320/375/768/1440px layout, and 200% equivalent reflow passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server?.close()
  await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
}
