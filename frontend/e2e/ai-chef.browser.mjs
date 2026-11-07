// Isolated FE-10 browser acceptance with a synthetic session and API fixture.
// It never contacts a hosted Supabase project or persists user data.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'
import { settleJournalLayout } from './journal-geometry.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userId = '44444444-4444-4444-8444-444444444444'
const user = {
  id: userId, aud: 'authenticated', role: 'authenticated', email: 'chef@example.test',
  app_metadata: {}, user_metadata: {}, created_at: '2026-10-19T00:00:00Z',
  email_confirmed_at: '2026-10-19T00:00:00Z',
}
const session = {
  access_token: 'chef-fe10-test-access', refresh_token: 'chef-fe10-test-refresh', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
}
const generated = {
  recipe: {
    title: 'Egg and rice skillet',
    ingredients: [
      { name: 'rice', quantity: null, unit: null, quantityText: 'leftover', inferred: false },
      { name: 'eggs', quantity: 2, unit: null, quantityText: '2', inferred: false },
    ],
    instructions: [{ step: 1, text: 'Warm the rice, then fold in the eggs.' }],
  },
  substitutions: [{ original: 'eggs', replacement: 'firm tofu', reason: 'A plant-based option.' }],
  parents: [{ id: '123e4567-e89b-42d3-a456-426614174000', title: 'Sunday fried rice', star_rating: 4 }],
  candidate_token: 'v1.fe10-browser-test-token',
  context: { status: 'MATCHED', matchedCandidateCount: 1, totalCandidateCount: 2 },
}
const requests = []
const recipeWrites = []
let appOrigin
let apiOrigin
let apiServer
let server
let browser

function corsHeaders(request) {
  return {
    ...(request.headers.origin === appOrigin ? { 'Access-Control-Allow-Origin': appOrigin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
}

function sendJson(request, response, status, body) {
  response.writeHead(status, { ...corsHeaders(request), 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function bodyJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
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
    if (request.method !== 'GET' && request.method !== 'HEAD') body = await bodyJson(request)
  } catch {
    sendJson(request, response, 400, { error: { code: 'invalid_test_json', message: 'Invalid test request.' } })
    return
  }
  requests.push({ method: request.method, path: url.pathname, body, authorization: request.headers.authorization })

  if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
    sendJson(request, response, request.headers.authorization === `Bearer ${session.access_token}` ? 200 : 401,
      request.headers.authorization === `Bearer ${session.access_token}` ? user : { error: { code: 'UNAUTHORIZED' } })
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
  if (url.pathname === '/functions/v1/generate-recipe' && request.method === 'POST') {
    sendJson(request, response, 200, generated)
    return
  }
  if (url.pathname === '/functions/v1/recipes' && request.method === 'POST') {
    recipeWrites.push({ body, authorization: request.headers.authorization })
    sendJson(request, response, 201, { recipe: {
      id: 'fe10-saved-recipe', user_id: userId, ...body, flavor_scores: null,
    } })
    return
  }
  sendJson(request, response, 404, { error: { code: 'unexpected_test_request', message: 'Unexpected isolated request.' } })
}

async function continueLocalRequest(route) {
  const url = new URL(route.request().url())
  assert.ok(url.origin === appOrigin || url.origin === apiOrigin, `Unexpected external request: ${url.origin}`)
  await route.continue()
}

try {
  apiServer = createHttpServer(handleApiRequest)
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
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-fe10-public-key'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
      'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
    },
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  })
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const storageKey = `sb-${new URL(apiOrigin).hostname.split('.')[0]}-auth-token`
  await page.addInitScript(({ session, storageKey }) => globalThis.localStorage.setItem(storageKey, JSON.stringify(session)), { session, storageKey })
  await context.route('**/*', continueLocalRequest)

  await page.goto(`${origin}app`)
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  const moriBookmark = page.getByRole('button', { name: 'Talk to Mori' })
  await moriBookmark.click()
  const chooser = page.getByRole('dialog', { name: 'Mori' })
  await expect(chooser).toBeVisible()
  await expect(chooser).toHaveAttribute('aria-modal', 'true')
  await expect(chooser).toContainText('Hey, chef! What are we cooking up today?')
  await expect(chooser.getByRole('button', { name: 'Close Talk to Mori' })).toBeVisible()
  assert.equal(requests.filter((request) => request.path === '/functions/v1/generate-recipe' ||
    (request.path === '/functions/v1/recipes' && request.method !== 'GET')).length, 0,
  'Opening Talk to Mori initiated AI generation or a recipe write')
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    const focusState = await chooser.evaluate((element) => ({
      contained: element.contains(globalThis.document.activeElement),
      open: element.open,
      modal: element.matches(':modal'),
      active: globalThis.document.activeElement?.outerHTML.slice(0, 180),
    }))
    assert.equal(focusState.contained, true, `Keyboard focus escaped the Talk to Mori modal on Tab ${index + 1}: ${JSON.stringify(focusState)}`)
  }
  await page.keyboard.press('Escape')
  await expect(chooser).toHaveCount(0)
  await expect(moriBookmark).toBeFocused()
  await moriBookmark.click()
  await page.getByRole('button', { name: "2. Let's figure out what to cook!" }).click()
  await expect(page).toHaveURL(`${origin}app/chef`)
  await expect(page.getByRole('heading', { name: 'What’s in your pantry?' })).toBeVisible()

  const pantryInput = page.getByRole('textbox', { name: 'Pantry ingredient' })
  await pantryInput.fill('rice')
  await pantryInput.press('Enter')
  await pantryInput.fill('eggs')
  await pantryInput.press('Enter')
  await pantryInput.fill('RICE')
  await pantryInput.press('Enter')
  await expect(page.getByRole('status')).toContainText('already in your pantry list')
  await expect(page.getByRole('region', { name: 'Pantry list, 2 items' })).toContainText('rice')
  await page.getByRole('textbox', { name: /^Cooking preferences/ }).fill('quick, no frying')
  await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()

  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const generation = requests.find((request) => request.path === '/functions/v1/generate-recipe')
  assert.ok(generation, 'AI Chef did not call the authenticated generation endpoint')
  assert.equal(generation.authorization, `Bearer ${session.access_token}`)
  assert.deepEqual(generation.body, { pantryItems: ['rice', 'eggs'], preferences: 'quick, no frying' })
  assert.equal(recipeWrites.length, 0, 'Generation saved a recipe before review')
  await assertJournalSemantics(page, 'AI Chef recipe review')
  await expect(page.getByLabel('Recipe title')).toHaveValue('Egg and rice skillet')
  await expect(page.getByRole('region', { name: 'Suggested substitutions' })).toContainText('firm tofu')
  await expect(page.getByRole('region', { name: 'Suggested parent recipes' })).toContainText('Sunday fried rice')
  const draft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)
  assert.equal(draft.handoff.saved, false)
  assert.equal(draft.handoff.response.candidate_token, generated.candidate_token)

  await page.getByRole('button', { name: 'Next Pages' }).click()
  const instruction = page.locator('textarea[name="instructions.0.text"]:not([disabled])')
  await expect(instruction).toHaveValue('Warm the rice, then fold in the eggs.')
  await instruction.fill('Warm the rice first, then fold in the eggs.')
  assert.equal(recipeWrites.length, 0, 'Editing the review saved a recipe before explicit confirmation')

  for (const width of [1440, 768, 375, 320, 720]) {
    await page.setViewportSize({ width, height: width === 720 ? 450 : 900 })
    await settleJournalLayout(page)
    const layout = await page.evaluate(() => ({
      viewport: globalThis.innerWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      overflowing: [...globalThis.document.querySelectorAll('body *')]
        .filter((element) => element.getBoundingClientRect().right > globalThis.innerWidth + 1 || element.getBoundingClientRect().left < -1)
        .slice(0, 12)
        .map((element) => ({ tag: element.tagName, className: String(element.className), text: element.textContent?.slice(0, 50), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })),
    }))
    assert.equal(layout.scrollWidth <= layout.viewport, true, `Horizontal overflow at ${width}px: ${JSON.stringify(layout.overflowing)}`)
    await expect(page.getByRole('button', { name: 'Save recipe' })).toBeVisible()
    await page.screenshot({ path: path.join(os.tmpdir(), `moris-fe10-review-${width}.png`), fullPage: true })
  }

  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Explicit Save did not create exactly one recipe')
  assert.equal(recipeWrites[0].authorization, `Bearer ${session.access_token}`)
  assert.equal(recipeWrites[0].body.title, 'Egg and rice skillet')
  assert.equal(recipeWrites[0].body.instructions[0].text, 'Warm the rice first, then fold in the eggs.')
  assert.equal('candidate_token' in recipeWrites[0].body, false)
  assert.equal(requests.some((request) => request.path.includes('/lineage')), false)
  const clearedDraft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)
  assert.equal(clearedDraft.handoff, null, 'A confirmed save did not clear the unsaved review handoff')
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write('FE-10 browser acceptance passed: Talk to Mori modal and keyboard close, authenticated AI Chef generation, duplicate pantry handling, retained unsaved review, substitutions and parent suggestions, explicit edited save, no lineage write, 320/375/768/1440px layouts, and 200% equivalent reflow.\n')
} finally {
  await browser?.close()
  await server?.close()
  if (apiServer?.listening) await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
}
