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
    flavor_scores: { sweet: 1, salty: 3, sour: 2.5, bitter: 0, umami: 5, spicy: 0 },
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
const expandedIngredients = ['smoked paprika', 'spring onions', 'sesame oil', 'toasted sesame seeds', 'light soy sauce']
const extraParent = { id: '323e4567-e89b-42d3-a456-426614174000', title: 'Toasted sesame rice with spring onions', star_rating: 5 }
const expandedSuggestion = {
  ...generated,
  recipe: {
    ...generated.recipe,
    ingredients: [
      ...generated.recipe.ingredients,
      ...expandedIngredients.map((name) => ({ name, quantity: null, unit: null, quantityText: 'to taste', inferred: false })),
    ],
  },
  parents: [...generated.parents, extraParent],
  context: { ...generated.context, totalCandidateCount: 3 },
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
    if (activeScenario === 'generation-failure') {
      response.setHeader('Retry-After', '2')
      response.setHeader('Access-Control-Expose-Headers', 'Retry-After')
      sendJson(request, response, 429, { error: { code: 'AI_RATE_LIMITED', message: 'private provider detail' } })
      return
    }

    if (activeScenario === 'expanded-review') {
      sendJson(request, response, 200, expandedSuggestion)
      return
    }

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
  await expect(page.getByRole('heading', { name: /pantry/, level: 1 })).toBeVisible()
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
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
  const chooser = page.getByRole('region', { name: 'Mori' })
  await expect(chooser).toBeVisible()
  await expect(chooser.getByRole('button', { name: 'Close Mori' })).toBeVisible()
  assert.equal(requests.filter((request) => request.path === '/functions/v1/generate-recipe' ||
    (request.path === '/functions/v1/recipes' && request.method !== 'GET')).length, 0,
  'Opening Talk to Mori initiated AI generation or a recipe write')
  await page.getByRole('link', { name: 'My recipes' }).focus()
  await expect(page.getByRole('link', { name: 'My recipes' })).toBeFocused()
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: 'Close Mori' }).focus()
  await page.keyboard.press('Escape')
  await expect(chooser).toHaveCount(0)
  await expect(moriBookmark).toBeFocused()
  await page.getByRole('navigation', { name: 'Journal sections' }).getByRole('link', { name: 'AI Chef' }).click()
  await expect(page).toHaveURL(`${origin}app/chef`)
  await expect(page.getByRole('heading', { name: 'What’s in your pantry?' })).toBeVisible()

  // The pantry input must retain a usable width even on a narrow journal leaf.
  for (const width of [1440, 1100, 768, 400, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await settleJournalLayout(page)
    const dimensions = await page.locator('.mm-ai-chef__ingredient-entry').evaluate((entry) => {
      const input = entry.querySelector('input').getBoundingClientRect()
      return { row: entry.clientWidth, input: input.width }
    })
    assert.ok(dimensions.input >= Math.min(140, dimensions.row - 2), `Pantry input collapsed at ${width}px: ${JSON.stringify(dimensions)}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
  const pantryInput = page.getByRole('textbox', { name: 'Pantry ingredient' })
  await expect(page.getByText('No ingredients yet.')).toBeVisible()
  await expect(page.getByText('Add what you have; Mori will suggest a recipe for you to review.')).toHaveCount(0)
  const referenceItems = ['Vinegar', 'Garlic', 'Onion', 'Bay Leaves', 'Rice', 'Eggs', 'Tomatoes', 'Olive Oil', 'Salt', 'Pepper', 'Sugar', 'Flour']
  await pantryInput.fill(referenceItems.join(', '))
  await pantryInput.press('Enter')
  const board = page.getByRole('region', { name: 'Pantry list, 12 items' })
  const firstCards = board.getByRole('listitem')
  await expect(firstCards).toHaveCount(12)
  await expect(page.getByRole('region', { name: 'AI Chef page 1 of 2' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Pantry board pages' })).toHaveCount(0)
  await settleJournalLayout(page)
  const cardBoxes = await firstCards.evaluateAll((cards) => cards.map((card) => {
    const { left, top, bottom } = card.getBoundingClientRect()
    return { left, top, bottom }
  }))
  const footer = await page.getByRole('button', { name: 'Ask Mori for a recipe' }).boundingBox()
  assert.ok(footer && cardBoxes.every((box) => box.bottom < footer.y), 'Pantry cards must stay above the action')
  assert.equal(new Set(cardBoxes.map(({ left }) => left)).size, 3)
  assert.equal(new Set(cardBoxes.map(({ top }) => top)).size, 4)
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollHeight <= globalThis.innerHeight + 1), 'The pantry must fit the viewport')
  const pantryLayout = await page.evaluate(() => {
    const bounds = (selector) => globalThis.document.querySelector(selector).getBoundingClientRect()
    return {
      progressTop: bounds('.mm-ai-chef__mixing-sticker').top,
      headingTop: bounds('.mm-ai-chef__heading').top,
      boardBottom: bounds('.mm-ai-chef__pantry-list:not(.mm-ai-chef__measure)').bottom,
      footerTop: bounds('.mm-journal-page-footer').top,
    }
  })
  assert.ok(Math.abs(pantryLayout.progressTop - pantryLayout.headingTop) <= 32, 'Progress and ingredient entry begin together across the spread')
  assert.ok(pantryLayout.footerTop - pantryLayout.boardBottom <= 24, 'The pantry board uses the available height above the anchored action')

  await page.screenshot({ path: path.join(os.tmpdir(), 'moris-pantry-board-1440.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1586, height: 992 })
  await settleJournalLayout(page)
  await page.screenshot({ path: path.join(os.tmpdir(), 'moris-pantry-board-1586.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)

  const sort = page.getByRole('combobox', { name: 'Sort pantry ingredients' })
  await sort.selectOption('ascending')
  await expect(firstCards.first()).toContainText('Bay Leaves')
  await sort.selectOption('descending')
  await expect(firstCards.first()).toContainText('Vinegar')
  await sort.selectOption('added')
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
  assert.equal(await firstCards.evaluateAll((cards) => new Set(cards.map((card) => card.getBoundingClientRect().left)).size), 1)
  await page.getByRole('button', { name: 'Grid view' }).click()
  await expect(firstCards).toHaveCount(12)

  await page.getByRole('button', { name: 'Remove Garlic' }).click()
  const garlic = page.getByRole('button', { name: 'garlic', exact: true })
  await expect(garlic).toBeEnabled()
  await pantryInput.fill('unsent ingredient')
  await garlic.click()
  await expect(garlic).toBeDisabled()
  await expect(pantryInput).toHaveValue('unsent ingredient')
  await expect(pantryInput).toBeFocused()
  await pantryInput.clear()

  await page.setViewportSize({ width: 1100, height: 700 })
  await settleJournalLayout(page)
  await expect(page.getByRole('navigation', { name: 'Pantry board pages' })).toBeVisible()
  assert.ok(await board.evaluate((element) =>
    element.getBoundingClientRect().bottom < element.closest('.mm-journal-page').querySelector('.mm-journal-page-footer').getBoundingClientRect().top
  ), 'The compact desktop board, including its pager, stays above the journal footer')
  await pantryInput.fill('a'.repeat(101))
  await pantryInput.press('Enter')
  await expect(page.getByRole('alert')).toContainText('100 characters or fewer')
  assert.ok(await board.evaluate((element) =>
    element.closest('.mm-ai-chef__page').getBoundingClientRect().bottom < element.closest('.mm-journal-page')
      .querySelector('.mm-journal-page-footer').getBoundingClientRect().top
  ), 'Validation stays within the bounded pantry workspace on compact desktop')
  await pantryInput.clear()
  await page.setViewportSize({ width: 375, height: 800 })
  await settleJournalLayout(page)
  await expect(firstCards).toHaveCount(1)
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
  await expect(firstCards).toHaveCount(12)

  const longIngredient = 'W'.repeat(100)
  await pantryInput.fill(longIngredient)
  await pantryInput.press('Enter')
  const nextIngredients = page.getByRole('button', { name: 'Next ingredients' })
  await expect(nextIngredients).toBeEnabled()
  await nextIngredients.click()
  const longCard = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Remove ' + longIngredient }) })
  await expect(longCard).toBeVisible()
  await expect(longCard.locator('img')).toHaveAttribute('src', '/twemoji/svg/1f37d.svg')
  assert.ok(await longCard.evaluate((card) => card.scrollWidth <= card.clientWidth))
  await pantryInput.fill('  VINEGAR  ')
  await pantryInput.press('Enter')
  const expandedBoard = page.getByRole('region', { name: 'Pantry list, 13 items' })
  const duplicateCard = expandedBoard.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Remove Vinegar', exact: true }) })
  await expect(duplicateCard).toHaveAttribute('data-duplicate', 'true')
  await expect(pantryInput).toBeFocused()
  await expect(expandedBoard).toHaveAccessibleName('Pantry list, 13 items')
  await nextIngredients.click()
  await expect(longCard).toBeVisible()
  await longCard.getByRole('button').click()
  await expect(page.getByRole('navigation', { name: 'Pantry board pages' })).toHaveCount(0)
  await expect(firstCards).toHaveCount(12)

  await sort.selectOption('ascending')
  const longBulkItems = ['A', 'B', 'C'].map((letter) => letter.repeat(96) + ' oil')
  await pantryInput.fill([...longBulkItems, 'OLIVE OIL'].join(', '))
  await pantryInput.press('Enter')
  const mixedBoard = page.getByRole('region', { name: 'Pantry list, 15 items' })
  await expect(mixedBoard.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Remove Olive Oil', exact: true }) })).toHaveAttribute('data-duplicate', 'true')
  await expect(pantryInput).toBeFocused()
  const previousIngredients = page.getByRole('button', { name: 'Previous ingredients' })
  await previousIngredients.click()
  await expect(pantryInput).not.toBeFocused()
  while (await previousIngredients.isEnabled()) await previousIngredients.click()
  for (const name of longBulkItems) await page.getByRole('button', { name: 'Remove ' + name, exact: true }).click()
  await sort.selectOption('added')
  await expect(firstCards).toHaveCount(12)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.locator('[data-journal-page-turn][data-phase="animating"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Cooking preferences/ })).toBeVisible()
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Previous page', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Bay Leaves' })).toBeVisible()

  for (const item of referenceItems) await page.getByRole('button', { name: new RegExp('^Remove ' + item + '$', 'i') }).click()
  await expect(page.getByText('No ingredients yet.')).toBeVisible()

  const ingredientsAtLimit = Array.from({ length: 100 }, (_, index) => `Ingredient ${index + 1}`)
  await pantryInput.evaluate((input, entries) => {
    const clipboardData = new globalThis.DataTransfer()
    clipboardData.setData('text/plain', entries.join(',\n'))
    input.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, ingredientsAtLimit)
  const fullBoard = page.getByRole('region', { name: 'Pantry list, 100 items' })
  await expect(fullBoard).toBeVisible()
  const seen = []
  do {
    seen.push(...await fullBoard.locator('.mm-ai-chef__ingredient-name').allTextContents())
    if (!await nextIngredients.isEnabled()) break
    await nextIngredients.click()
  } while (seen.length < 100)
  assert.deepEqual(seen, ingredientsAtLimit)
  await pantryInput.fill('Ingredient 101')
  await pantryInput.press('Enter')
  await expect(page.getByRole('alert')).toContainText('You can add up to 100 pantry items.')
  await page.evaluate((key) => globalThis.sessionStorage.removeItem(key), `moris-mix:ai-chef:v1:${userId}`)
  await page.reload()
  await expect(page.getByText('No ingredients yet.')).toBeVisible()

  await pantryInput.fill('rice')
  await pantryInput.press('Enter')
  await pantryInput.fill('eggs')
  await pantryInput.press('Enter')
  await pantryInput.fill('RICE')
  await pantryInput.press('Enter')
  await expect(page.getByRole('status')).toContainText('already in your pantry list')
  await expect(page.getByRole('region', { name: 'Pantry list, 2 items' })).toContainText('rice')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  const preferences = page.getByRole('textbox', { name: /^Cooking preferences/ })
  await expect(preferences).toBeVisible()
  assert.ok(await preferences.evaluate((field) => field.clientWidth >= field.closest('fieldset').clientWidth - 2), 'Preferences collapsed on their own leaf')
  await preferences.fill('quick, no frying')
  await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()

  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  await page.goto(`${origin}app/chef`)
  const resume = page.getByRole('complementary', { name: 'Unsaved AI Chef recipe' })
  const resumeLink = resume.getByRole('link', { name: 'Return to recipe review' })
  for (const [width, height] of [[1440, 900], [1100, 640], [375, 800]]) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    const notice = await resume.evaluate((element) => {
      const copy = element.firstElementChild.getBoundingClientRect()
      const footer = element.closest('.mm-journal-page').querySelector('.mm-journal-page-footer').getBoundingClientRect()
      return { copyWidth: copy.width, noticeBottom: element.getBoundingClientRect().bottom, footerTop: footer.top }
    })
    assert.ok(notice.copyWidth >= 120, `Resume copy collapsed at ${width}×${height}: ${JSON.stringify(notice)}`)
    assert.ok(notice.noticeBottom <= notice.footerTop + 1, `Resume notice crossed the footer at ${width}×${height}: ${JSON.stringify(notice)}`)
    await resumeLink.click({ trial: true })
    await resume.getByRole('button', { name: 'Discard preview' }).click({ trial: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
  await resumeLink.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const generation = requests.find((request) => request.path === '/functions/v1/generate-recipe')
  assert.ok(generation, 'AI Chef did not call the authenticated generation endpoint')
  assert.equal(generation.authorization, `Bearer ${session.access_token}`)
  assert.deepEqual(generation.body, { pantryItems: ['rice', 'eggs'], preferences: 'quick, no frying' })
  assert.equal(recipeWrites.length, 0, 'Generation saved a recipe before review')
  const reviewLeaf = page.locator('.mm-writing-leaf').filter({ has: page.getByRole('region', { name: 'AI Chef generation details' }) })
  const recipeTitle = page.getByRole('textbox', { name: 'Recipe title', exact: true })
  const save = page.getByRole('button', { name: 'Save recipe', exact: true })
  const back = page.getByRole('button', { name: 'Back to AI Chef' })
  const reviewPages = page.locator('.mm-writing-leaf')
  for (const [width, height] of [[1366, 768], [1536, 864], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    await expect(recipeTitle).toBeInViewport({ ratio: 1 })
    const titleBounds = await recipeTitle.boundingBox()
    const progressTop = (await page.getByText('Review idea', { exact: true }).boundingBox()).y
    assert.ok(titleBounds.y + titleBounds.height <= progressTop, 'The editable recipe title should sit above the review progress')
    await expect(save).toBeInViewport({ ratio: 1 })
    await expect(back).toBeInViewport({ ratio: 1 })
    await expect(reviewLeaf.getByRole('heading', { name: 'Mori’s optional flavor estimates' })).toBeInViewport({ ratio: 1 })
    const bounds = await reviewPages.evaluateAll((leaves) => leaves.map((leaf) => ({
      height: leaf.clientHeight,
      scrollHeight: leaf.scrollHeight,
      side: leaf.closest('.mm-journal-page') ? 'right' : 'left',
    })))
    assert.deepEqual(bounds.map(({ side }) => side).sort(), ['left', 'right'])
    assert.ok(bounds.every(({ height, scrollHeight }) => scrollHeight <= height + 1),
      `Review leaves should fit at ${width}×${height}: ${JSON.stringify(bounds)}`)
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollHeight <= globalThis.innerHeight + 1),
      `Review should fit the viewport at ${width}×${height}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
  await assertJournalSemantics(page, 'AI Chef recipe review')
  await expect(recipeTitle).toHaveValue('Egg and rice skillet')
  await expect(reviewLeaf.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Ingredients in this suggestion' })).toContainText('rice')
  await expect(reviewLeaf.getByText('2.5 out of 5', { exact: true })).toHaveCount(1)

  const substitutions = reviewLeaf.getByRole('button', { name: 'Suggested substitutions' })
  await substitutions.press('Enter')
  const substitutionDialog = page.getByRole('dialog', { name: 'Suggested substitutions' })
  await expect(substitutionDialog).toContainText('firm tofu')
  await page.keyboard.press('Escape')
  await expect(substitutionDialog).toBeHidden()
  await expect(substitutions).toBeFocused()

  await reviewLeaf.getByRole('button', { name: 'Full request' }).click()
  const requestDialog = page.getByRole('dialog', { name: 'Your request' })
  await expect(requestDialog.getByRole('listitem')).toHaveText(['rice', 'eggs'])
  await expect(requestDialog).toContainText('quick, no frying')
  await requestDialog.getByRole('button', { name: 'Done' }).click()

  const longTitle = 'Crispy egg and rice skillet with garlic, summer tomatoes, toasted sesame seeds, and fresh spring onions'
  const longNotes = 'Chill the rice overnight.\nFold the eggs in after the pan is hot.\n'.repeat(10)
  await page.getByRole('button', { name: 'Expand recipe title' }).click()
  const titleDialog = page.getByRole('dialog', { name: 'Recipe title' })
  await titleDialog.getByRole('textbox', { name: 'Full recipe title' }).fill(longTitle)
  await titleDialog.getByRole('button', { name: 'Done' }).click()
  await expect(recipeTitle).toHaveValue(longTitle)
  const expandNotes = page.getByRole('button', { name: 'Expand notes' })
  await expandNotes.click()
  await page.getByRole('dialog', { name: 'Notes' }).getByRole('textbox', { name: 'Full notes' }).fill(longNotes)
  await page.keyboard.press('Escape')
  await expect(expandNotes).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(longNotes)
  await page.getByLabel('Cooked date').fill('2026-10-19')
  await page.getByRole('combobox', { name: 'Rating' }).selectOption('4')
  await expect(reviewLeaf.getByRole('heading', { name: 'Recipe inspiration' })).toBeInViewport({ ratio: 1 })
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
  assert.equal(recipeWrites[0].body.title, longTitle)
  assert.equal(recipeWrites[0].body.notes, longNotes)
  assert.equal(recipeWrites[0].body.cooked_at, '2026-10-19')
  assert.equal(recipeWrites[0].body.star_rating, 4)
  assert.equal('flavor_scores' in recipeWrites[0].body, false)
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
  process.stdout.write('AI Chef browser acceptance Scenario E passed: lost lineage response reconciled through GET without a duplicate POST.\n')
  await page.evaluate(() => globalThis.sessionStorage.clear())
  resetScenario('generation-failure')
  await page.goto(`${origin}app/chef`)
  await page.getByRole('textbox', { name: 'Pantry ingredient' }).fill('rice')
  await page.getByRole('textbox', { name: 'Pantry ingredient' }).press('Enter')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('textbox', { name: /^Cooking preferences/ }).fill('keep this preference')
  await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
  await expect(page.getByRole('alert')).toContainText('rate-limited')
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: /^Cooking preferences/ })).toHaveValue('keep this preference')
  await page.getByRole('button', { name: 'Previous page', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Pantry list, 1 item' })).toContainText('rice')
  await expect(page.getByText('private provider detail')).toHaveCount(0)
  assert.equal(recipeWrites.length, 0)
  activeScenario = 'success'
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const attempts = requests.filter((request) => request.path === '/functions/v1/generate-recipe')
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[0].body, attempts[1].body)
  assert.equal(recipeWrites.length, 0)
  process.stdout.write('FE-13 generation failure: server cooldown, retained inputs, same-request retry and unsaved preview passed.\n')
  await page.setViewportSize({ width: 1366, height: 768 })
  await beginScenario(page, origin, 'expanded-review')
  const allIngredients = page.getByRole('button', { name: 'All suggested ingredients (7)' })
  await allIngredients.click()
  const ingredientDialog = page.getByRole('dialog', { name: 'Ingredients in this suggestion' })
  await expect(ingredientDialog.getByRole('listitem')).toHaveText(expandedSuggestion.recipe.ingredients.map(({ name }) => name))
  await ingredientDialog.getByRole('button', { name: 'Done' }).click()
  await expect(allIngredients).toBeFocused()

  const journalChooser = page.getByRole('button', { name: 'Choose journal recipes (3)' })
  await journalChooser.click()
  const journalDialog = page.getByRole('dialog', { name: 'From your journal' })
  await expect(journalDialog.getByRole('checkbox')).toHaveCount(3)
  await journalDialog.getByRole('checkbox', { name: new RegExp(extraParent.title) }).check()
  await page.keyboard.press('Escape')
  await expect(journalChooser).toBeFocused()
  await expect(page.getByText('1 of 10 parent recipes selected.')).toBeVisible()
  await journalChooser.click()
  await expect(journalDialog.getByRole('checkbox', { name: new RegExp(extraParent.title) })).toBeChecked()
  await journalDialog.getByRole('button', { name: 'Done' }).click()
  assert.equal(recipeWrites.length, 0, 'Opening the review dialogs saved a recipe')
  assert.equal(lineageWrites.length, 0, 'Selecting a parent created lineage before Save')

  await back.click()
  await page.getByRole('alertdialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Discard Changes' }).click()
  await expect(page).toHaveURL(`${origin}app/chef`)
  process.stdout.write('AI Chef overflow review passed: complete detail lists, selection, and return to the pantry.\n')
  assert.deepEqual(errors, [])
  await context.close()
} finally {
  await browser?.close()
  await server?.close()
  if (apiServer?.listening) await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
}
