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
let nextRecipeNumber = 1
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
    const id = `fe10-saved-recipe-${nextRecipeNumber++}`
    recipeWrites.push({ method: request.method, id, body, authorization: request.headers.authorization })
    sendJson(request, response, 201, { recipe: {
      id, user_id: userId, ...body, flavor_scores: null,
    } })
    return
  }
  if (url.pathname.startsWith('/functions/v1/recipes/') && request.method === 'PATCH') {
    const id = decodeURIComponent(url.pathname.split('/').at(-1))
    recipeWrites.push({ method: request.method, id, body, authorization: request.headers.authorization })
    sendJson(request, response, 200, { recipe: {
      id, user_id: userId, ...body, flavor_scores: null,
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

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Previous Pages' }).click()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Explicit Save did not create exactly one recipe')
  assert.equal(recipeWrites[0].method, 'POST')
  assert.equal(recipeWrites[0].authorization, `Bearer ${session.access_token}`)
  assert.equal(recipeWrites[0].body.title, 'Egg and rice skillet')
  assert.equal(recipeWrites[0].body.instructions[0].text, 'Warm the rice first, then fold in the eggs.')
  assert.equal('candidate_token' in recipeWrites[0].body, false)
  assert.equal(requests.some((request) => request.path.includes('/lineage')), false)
  await expect(page.getByLabel('Recipe title')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  const clearedDraft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)
  assert.equal(clearedDraft.handoff, null, 'A confirmed save did not clear the unsaved review handoff')

  await page.getByLabel('Recipe title').fill('Updated egg and rice skillet')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  assert.equal(recipeWrites.length, 2, 'Saving changed values created a second recipe')
  assert.equal(recipeWrites[1].method, 'PATCH', 'Save changes did not update the confirmed recipe')
  assert.equal(recipeWrites[1].id, recipeWrites[0].id)
  assert.equal(recipeWrites[1].body.title, 'Updated egg and rice skillet')
  await expect(page.getByText(/changed elsewhere/)).toHaveCount(0)
  assert.equal((await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)).handoff, null)

  await page.getByLabel('Recipe title').fill('A third saved version')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  assert.equal(recipeWrites.length, 3, 'Repeated cleanup created a second recipe')
  assert.deepEqual(recipeWrites.map((write) => [write.method, write.id]), [
    ['POST', recipeWrites[0].id], ['PATCH', recipeWrites[0].id], ['PATCH', recipeWrites[0].id],
  ])
  assert.equal((await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)).handoff, null)

  const retryPage = await context.newPage()
  await retryPage.goto(`${origin}app/chef`)
  await expect(retryPage.getByRole('button', { name: 'Ask Mori for a recipe' })).toBeVisible()
  const retryPantry = retryPage.getByRole('textbox', { name: 'Pantry ingredient' })
  await retryPantry.fill('rice')
  await retryPantry.press('Enter')
  await retryPage.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
  await expect(retryPage.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const chefDraftKey = `moris-mix:ai-chef:v1:${userId}`
  await retryPage.evaluate((key) => {
    const originalSetItem = globalThis.Storage.prototype.setItem
    let failClear = true
    let clearAttempts = 0
    globalThis.Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === key && JSON.parse(value).handoff === null) {
        clearAttempts += 1
        if (failClear) throw new globalThis.DOMException('Storage temporarily unavailable', 'QuotaExceededError')
      }
      return originalSetItem.call(this, itemKey, value)
    }
    globalThis.__setChefClearFailure = (fail) => { failClear = fail }
    globalThis.__getChefClearAttempts = () => clearAttempts
  }, chefDraftKey)
  await retryPage.getByRole('button', { name: 'Save recipe' }).click()
  await expect(retryPage.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  await expect(retryPage.getByRole('alert')).toContainText('could not clear the old preview')
  const firstClearAttemptCount = await retryPage.evaluate(() => globalThis.__getChefClearAttempts())
  assert.ok(firstClearAttemptCount > 0, 'The first clear did not attempt a session storage write')
  const draftBeforeRetry = await retryPage.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), chefDraftKey)
  assert.notEqual(draftBeforeRetry.handoff, null, 'The failed clear unexpectedly removed the handoff')
  assert.equal(recipeWrites.at(-1).method, 'POST', 'Recipe persistence should succeed even when draft cleanup fails')

  await retryPage.evaluate(() => globalThis.__setChefClearFailure(false))
  await retryPage.getByRole('button', { name: 'Try saving the review again' }).click()
  await expect.poll(async () => (await retryPage.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), chefDraftKey)).handoff).toBeNull()
  await expect(retryPage.getByRole('alert')).toHaveCount(0)
  const finalClearAttemptCount = await retryPage.evaluate(() => globalThis.__getChefClearAttempts())
  assert.ok(finalClearAttemptCount > firstClearAttemptCount, 'The retry did not attempt a real session storage write')
  assert.equal(recipeWrites.at(-1).method, 'POST')

  const conflictPage = await context.newPage()
  await conflictPage.goto(`${origin}app/chef`)
  await expect(conflictPage.getByRole('button', { name: 'Ask Mori for a recipe' })).toBeVisible()
  const conflictPantry = conflictPage.getByRole('textbox', { name: 'Pantry ingredient' })
  await conflictPantry.fill('eggs')
  await conflictPantry.press('Enter')
  await conflictPage.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
  await expect(conflictPage.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const conflictDraftKey = `moris-mix:ai-chef:v1:${userId}`
  await conflictPage.evaluate((key) => {
    const draft = JSON.parse(globalThis.sessionStorage.getItem(key))
    draft.handoff.response.recipe.title = 'A newer recipe from another tab'
    globalThis.sessionStorage.setItem(key, JSON.stringify(draft))
  }, conflictDraftKey)
  await conflictPage.getByRole('button', { name: 'Save recipe' }).click()
  await expect(conflictPage.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  await expect(conflictPage.getByRole('alert')).toContainText('changed elsewhere')
  const newerDraft = await conflictPage.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), conflictDraftKey)
  assert.equal(newerDraft.handoff.response.recipe.title, 'A newer recipe from another tab')
  await expect(conflictPage.getByRole('button', { name: 'Try saving the review again' })).toHaveCount(0)

  assert.deepEqual(errors, [])
  await retryPage.close()
  await conflictPage.close()
  await context.close()
  process.stdout.write('AI Chef browser acceptance passed: first save and continued editing, same-recipe updates after a cleared handoff, failed-clear retry with a real storage write, protection of a newer handoff, repeated cleanup, Talk to Mori keyboard behavior, authenticated generation, no lineage write in FE-10, and responsive reflow.\n')
} finally {
  await browser?.close()
  await server?.close()
  if (apiServer?.listening) await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
}
