// Isolated AI Chef browser acceptance with a synthetic session and API fixture.
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
  parents: [
    { id: '123e4567-e89b-42d3-a456-426614174000', title: 'Sunday fried rice', star_rating: 4 },
    { id: '223e4567-e89b-42d3-a456-426614174000', title: 'Mori’s tomato rice', star_rating: null },
  ],
  candidate_token: 'v1.fe10-browser-test-token',
  context: { status: 'MATCHED', matchedCandidateCount: 1, totalCandidateCount: 2 },
}
const requests = []
const recipeWrites = []
const recipeUpdates = []
const lineageWrites = []
const lineageRows = new Map()
const scenarioRecipeIds = {
  success: '55555555-5555-4555-8555-555555555555',
  'no-parents': '66666666-6666-4666-8666-666666666666',
  partial: '77777777-7777-4777-8777-777777777777',
  expired: '88888888-8888-4888-8888-888888888888',
  uncertain: '99999999-9999-4999-8999-999999999999',
}
let activeScenario = 'success'
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

function resetScenario(name) {
  activeScenario = name
  requests.length = 0
  recipeWrites.length = 0
  recipeUpdates.length = 0
  lineageWrites.length = 0
  lineageRows.clear()
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
    sendJson(request, response, 200, activeScenario === 'no-parents' ? {
      ...generated,
      parents: [],
      candidate_token: null,
      context: { status: 'NO_SAVED_RECIPES', matchedCandidateCount: 0, totalCandidateCount: 0 },
    } : generated)
    return
  }
  if (url.pathname === '/functions/v1/recipes' && request.method === 'POST') {
    recipeWrites.push({ body, authorization: request.headers.authorization })
    sendJson(request, response, 201, { recipe: {
      id: scenarioRecipeIds[activeScenario], user_id: userId, ...body, flavor_scores: null,
    } })
    return
  }
  const recipeRoute = /^\/functions\/v1\/recipes\/([^/]+)$/.exec(url.pathname)
  if (recipeRoute && request.method === 'PATCH') {
    const recipeId = decodeURIComponent(recipeRoute[1])
    recipeUpdates.push({ recipeId, body, authorization: request.headers.authorization })
    sendJson(request, response, 200, { recipe: {
      id: recipeId, user_id: userId, ...body, flavor_scores: null,
    } })
    return
  }
  const lineageRoute = /^\/functions\/v1\/recipes\/([^/]+)\/lineage$/.exec(url.pathname)
  if (lineageRoute && request.method === 'POST') {
    const childRecipeId = decodeURIComponent(lineageRoute[1])
    lineageWrites.push({ childRecipeId, body, authorization: request.headers.authorization })
    if (activeScenario === 'expired') {
      sendJson(request, response, 403, {
        error: { code: 'FORBIDDEN', message: 'Not authorized.', details: [{ code: 'expired_token' }] },
      })
      return
    }
    if (activeScenario === 'partial' && lineageWrites.length === 1) {
      sendJson(request, response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unavailable.' } })
      return
    }
    const rows = body.parent_recipe_ids.map((parentId, index) => ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(index + 1).padStart(12, '0'),
      parent_recipe_id: parentId,
      child_recipe_id: childRecipeId,
      created_at: '2026-11-07T00:00:00.000Z',
    }))
    lineageRows.set(childRecipeId, rows)
    if (activeScenario === 'uncertain' && lineageWrites.length === 1) {
      const raw = JSON.stringify({ lineage: rows })
      response.writeHead(201, {
        ...corsHeaders(request),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw) + 16,
      })
      response.flushHeaders()
      response.write(raw.slice(0, -1))
      response.destroy()
      return
    }
    sendJson(request, response, 201, { lineage: rows })
    return
  }
  if (lineageRoute && request.method === 'GET') {
    sendJson(request, response, 200, { lineage: lineageRows.get(decodeURIComponent(lineageRoute[1])) ?? [] })
    return
  }
  sendJson(request, response, 404, { error: { code: 'unexpected_test_request', message: 'Unexpected isolated request.' } })
}

async function beginScenario(page, origin, name) {
  resetScenario(name)
  await page.evaluate(() => globalThis.sessionStorage.clear())
  await page.goto(origin + 'app/chef')
  await expect(page.getByRole('heading', { name: /pantry/ })).toBeVisible()
  const pantry = page.getByRole('textbox', { name: 'Pantry ingredient' })
  await pantry.fill('rice')
  await pantry.press('Enter')
  await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const generation = requests.find((request) => request.path === '/functions/v1/generate-recipe')
  assert.ok(generation, 'AI Chef did not call the authenticated generation endpoint in ' + name)
  assert.equal(generation.authorization, 'Bearer ' + session.access_token)
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
  const firstParent = page.getByRole('checkbox', { name: /Sunday fried rice/ })
  const secondParent = page.getByRole('checkbox', { name: /Mori’s tomato rice/ })
  await expect(firstParent).not.toBeChecked()
  await expect(secondParent).not.toBeChecked()
  await firstParent.focus()
  await page.keyboard.press('Space')
  await expect(firstParent).toBeChecked()
  const focusStyle = await firstParent.evaluate((element) => ({
    focused: element === globalThis.document.activeElement,
    outlineStyle: globalThis.getComputedStyle(element).outlineStyle,
  }))
  assert.equal(focusStyle.focused, true)
  assert.notEqual(focusStyle.outlineStyle, 'none')
  assert.equal(lineageWrites.length, 0, 'Selecting a parent created lineage before Save')
  const draft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)
  assert.equal(draft.handoff.saved, false)
  assert.equal(draft.handoff.response.candidate_token, generated.candidate_token)
  assert.deepEqual(draft.handoff.selectedParentIds, [generated.parents[0].id])

  await page.getByRole('button', { name: 'Next Pages' }).click()
  const instruction = page.locator('textarea[name="instructions.0.text"]:not([disabled])')
  await expect(instruction).toHaveValue('Warm the rice, then fold in the eggs.')
  await instruction.fill('Warm the rice first, then fold in the eggs.')
  assert.equal(recipeWrites.length, 0, 'Editing the review saved a recipe before explicit confirmation')
  assert.equal(lineageWrites.length, 0, 'Editing the review saved lineage before explicit confirmation')

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
  await expect(page.getByText('Recipe and selected parent links saved.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Explicit Save did not create exactly one recipe')
  assert.equal(recipeWrites[0].authorization, `Bearer ${session.access_token}`)
  assert.equal(recipeWrites[0].body.title, 'Egg and rice skillet')
  assert.equal(recipeWrites[0].body.instructions[0].text, 'Warm the rice first, then fold in the eggs.')
  assert.equal('candidate_token' in recipeWrites[0].body, false)
  assert.equal(lineageWrites.length, 1, 'Explicit Save did not persist the selected lineage')
  assert.equal(lineageWrites[0].childRecipeId, scenarioRecipeIds.success)
  assert.deepEqual(lineageWrites[0].body.parent_recipe_ids, [generated.parents[0].id])
  assert.equal(lineageWrites[0].body.candidate_token, generated.candidate_token)
  const mutationOrder = requests
    .filter((request) => (request.path === '/functions/v1/recipes' && request.method === 'POST') ||
      (request.path.endsWith('/lineage') && request.method === 'POST'))
    .map((request) => request.method + ' ' + request.path)
  assert.deepEqual(mutationOrder, [
    'POST /functions/v1/recipes',
    'POST /functions/v1/recipes/' + scenarioRecipeIds.success + '/lineage',
  ])
  const clearedDraft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)
  assert.equal(clearedDraft.handoff, null, 'A confirmed save did not clear the unsaved review handoff')
  process.stdout.write('AI Chef browser acceptance Scenario A passed: keyboard-selected parents, recipe-first save, and confirmed lineage completion.\n')
  await beginScenario(page, origin, 'no-parents')
  await expect(page.getByRole('region', { name: 'Suggested parent recipes' })).toContainText('There are no saved recipes to suggest yet.')
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  const emptyDraft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), 'moris-mix:ai-chef:v1:' + userId)
  assert.equal(emptyDraft.handoff.response.candidate_token, null)
  const chefDraftKey = 'moris-mix:ai-chef:v1:' + userId
  await page.evaluate((key) => {
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
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('could not clear the saved preview')
  assert.equal(recipeWrites.length, 1)
  assert.equal(lineageWrites.length, 0, 'The empty-parent path called the lineage endpoint')
  const failedClearProgress = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), chefDraftKey)
  assert.equal(failedClearProgress.handoff.savedRecipeId, scenarioRecipeIds['no-parents'])
  assert.equal(failedClearProgress.handoff.lineageStatus, 'confirmed')
  const failedClearAttempts = await page.evaluate(() => globalThis.__getChefClearAttempts())
  assert.ok(failedClearAttempts > 0, 'The initial handoff cleanup did not try writing session storage')

  await page.evaluate(() => globalThis.__setChefClearFailure(false))
  await page.getByRole('button', { name: 'Try clearing the saved preview' }).click()
  await expect.poll(async () => (await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), chefDraftKey)).handoff).toBeNull()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const retriedClearAttempts = await page.evaluate(() => globalThis.__getChefClearAttempts())
  assert.ok(retriedClearAttempts > failedClearAttempts, 'Retry did not make a real session storage write')

  await page.getByLabel('Recipe title').fill('Edited after storage recovered')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.', { exact: true })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Editing after cleanup retry created another recipe')
  assert.equal(recipeUpdates.length, 1, 'Editing after cleanup retry did not update the saved recipe')
  assert.equal(recipeUpdates[0].recipeId, scenarioRecipeIds['no-parents'])
  assert.equal(recipeUpdates[0].body.title, 'Edited after storage recovered')
  assert.equal((await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), chefDraftKey)).handoff, null)
  process.stdout.write('AI Chef browser acceptance Scenario B passed: recipe-only save, cleared-handoff storage retry, and same-recipe update after recovery.\n')

  await beginScenario(page, origin, 'partial')
  await page.getByRole('checkbox', { name: /Sunday fried rice/ }).check()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe saved. Parent links still need attention.')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Your recipe was saved, but Mori could not confirm its parent links.')
  assert.equal(recipeWrites.length, 1)
  assert.equal(lineageWrites.length, 1)
  const partialChildId = scenarioRecipeIds.partial
  const partialDraft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), 'moris-mix:ai-chef:v1:' + userId)
  assert.equal(partialDraft.handoff.savedRecipeId, partialChildId)
  assert.deepEqual(partialDraft.handoff.selectedParentIds, [generated.parents[0].id])
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  await expect(page.getByText('Recipe saved. Parent links still need attention.')).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Reload recovery created a second recipe')
  await page.getByLabel('Recipe title').fill('Edited after recovery')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved. Parent links still need attention.')).toBeVisible()
  assert.equal(recipeUpdates.length, 1, 'Editing a recovered recipe did not use its existing ID')
  assert.equal(recipeUpdates[0].recipeId, partialChildId)
  assert.equal(recipeUpdates[0].body.title, 'Edited after recovery')
  assert.equal(recipeWrites.length, 1, 'Editing a recovered recipe created another child')
  await page.getByRole('button', { name: 'Check and retry parent links' }).click()
  await expect(page.getByText('Recipe and selected parent links saved.')).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Lineage retry created a second recipe')
  assert.equal(lineageWrites.length, 2)
  assert.equal(lineageWrites[0].childRecipeId, partialChildId)
  assert.equal(lineageWrites[1].childRecipeId, partialChildId)
  assert.equal(requests.filter((request) => request.path.endsWith('/lineage') && request.method === 'GET').length, 2)
  process.stdout.write('AI Chef browser acceptance Scenario C passed: partial save, saved-ID draft recovery, GET reconciliation and lineage-only retry.\n')

  await beginScenario(page, origin, 'expired')
  await page.getByRole('checkbox', { name: /Sunday fried rice/ }).check()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('alert')).toContainText('authorization for its parent links expired')
  await expect(page.getByText('Recipe saved. Parent links still need attention.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check and retry parent links' })).toHaveCount(0)
  assert.equal(recipeWrites.length, 1)
  assert.equal(lineageWrites.length, 1)
  assert.equal(requests.filter((request) => request.path.endsWith('/lineage') && request.method === 'GET').length, 0)
  assert.equal(requests.filter((request) => request.path === '/functions/v1/generate-recipe').length, 1)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Expired-token recovery created a second recipe')
  process.stdout.write('AI Chef browser acceptance Scenario D passed: expired authorization preserves the saved recipe without retry or regeneration.\n')

  await beginScenario(page, origin, 'uncertain')
  await page.getByRole('checkbox', { name: /Sunday fried rice/ }).check()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe and selected parent links saved.')).toBeVisible()
  assert.equal(recipeWrites.length, 1)
  assert.equal(lineageWrites.length, 1, 'Lost response caused a duplicate lineage POST: ' +
    JSON.stringify(requests.filter((request) => request.path.endsWith('/lineage')).map((request) => ({
      method: request.method, path: request.path, parents: request.body?.parent_recipe_ids,
    }))))
  assert.equal(requests.filter((request) => request.path.endsWith('/lineage') && request.method === 'GET').length, 1)
  assert.equal(lineageWrites[0].childRecipeId, scenarioRecipeIds.uncertain)
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write('AI Chef browser acceptance Scenario E passed: lost lineage response reconciled through GET without a duplicate POST.\n')
} finally {
  await browser?.close()
  await server?.close()
  if (apiServer?.listening) await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
}
