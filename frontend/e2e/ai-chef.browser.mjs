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
import { readAllRecipePages } from './reading-pages.mjs'

const desktopOnly = process.env.MORI_DESKTOP_ONLY === 'true'

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
const fixtureUpdatedAt = '2026-11-27T00:00:00.000Z'
const exactNote = 'Change olive oil from 1 teaspoon to 2 teaspoons while keeping rice and tomato unchanged.'
const revisionOriginal = {
  id: generated.parents[0].id, user_id: userId, title: 'Synthetic tomato rice original',
  notes: exactNote, cooked_at: '2026-11-27', updated_at: fixtureUpdatedAt,
  star_rating: null, flavor_scores: null,
  ingredients: [
    { name: 'rice', quantity: 1, unit: 'cup', inferred: false },
    { name: 'tomato', quantity: 1, unit: 'piece', inferred: false },
    { name: 'olive oil', quantity: 1, unit: 'tsp', inferred: false },
  ],
  instructions: [
    { step: 1, text: 'Warm the olive oil and tomato.' },
    { step: 2, text: 'Stir in the cooked rice.' },
  ],
}
const revisionSuggestion = {
  ...generated,
  recipe: {
    title: 'Synthetic olive oil revision', flavor_scores: generated.recipe.flavor_scores,
    ingredients: revisionOriginal.ingredients.map((item) => item.name === 'olive oil' ? { ...item, quantity: 2 } : { ...item }),
    instructions: revisionOriginal.instructions,
  },
  substitutions: [], parents: [{ ...generated.parents[0], title: revisionOriginal.title }],
  revision: {
    noteExcerpt: exactNote, ingredient: 'olive oil', ingredientIndex: 2,
    before: { quantity: 1, unit: 'tsp' }, after: { quantity: 2, unit: 'tsp' },
    reason: 'Use two teaspoons of olive oil as requested.',
  },
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
  revision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
    sendJson(request, response, 200, { recipes: activeScenario === 'revision' ? [revisionOriginal] : [], has_more: false, next_cursor: null })
    return
  }
  if (url.pathname === '/functions/v1/generate-recipe' && request.method === 'POST') {
    if (activeScenario === 'revision') {
      assert.equal(body.sourceRecipeId, revisionOriginal.id)
      assert.equal(body.noteExcerpt, exactNote)
      sendJson(request, response, 200, revisionSuggestion)
      return
    }
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
  if (url.pathname === '/functions/v1/recipes/lineage-authorization' && request.method === 'POST') {
    assert.ok(body.parent_recipe_ids.length > 0)
    const preview = activeScenario === 'expanded-review' ? expandedSuggestion : generated
    assert.equal(body.candidate_token, preview.candidate_token)
    sendJson(request, response, 200, { candidate_token: preview.candidate_token })
    return
  }
  if (url.pathname === '/functions/v1/recipes' && request.method === 'POST') {
    recipeWrites.push({ body, authorization: request.headers.authorization })
    sendJson(request, response, 201, { recipe: {
      id: scenarioRecipeIds[activeScenario], user_id: userId, ...body, updated_at: fixtureUpdatedAt, flavor_scores: null,
    } })
    return
  }
  const recipeRoute = /^\/functions\/v1\/recipes\/([^/]+)$/.exec(url.pathname)
  if (recipeRoute && request.method === 'GET') {
    const recipeId = decodeURIComponent(recipeRoute[1])
    if (activeScenario === 'revision' && recipeId === revisionOriginal.id) {
      sendJson(request, response, 200, { recipe: revisionOriginal })
      return
    }
    const saved = recipeWrites.at(-1)
    if (!saved || recipeId !== scenarioRecipeIds[activeScenario]) {
      sendJson(request, response, 404, { error: { code: 'NOT_FOUND' } })
      return
    }
    sendJson(request, response, 200, { recipe: {
      id: recipeId, user_id: userId, ...saved.body, updated_at: fixtureUpdatedAt, flavor_scores: null,
    } })
    return
  }
  if (recipeRoute && request.method === 'PATCH') {
    const recipeId = decodeURIComponent(recipeRoute[1])
    recipeUpdates.push({ recipeId, body, authorization: request.headers.authorization })
    sendJson(request, response, 200, { recipe: {
      id: recipeId, user_id: userId, ...body, updated_at: fixtureUpdatedAt, flavor_scores: null,
    } })
    return
  }
  const lineageRoute = /^\/functions\/v1\/recipes\/([^/]+)\/lineage$/.exec(url.pathname)
  if (lineageRoute && request.method === 'POST') {
    const childRecipeId = decodeURIComponent(lineageRoute[1])
    lineageWrites.push({ childRecipeId, body, authorization: request.headers.authorization })
    if (activeScenario === 'expired' && lineageWrites.length === 1) {
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
  await advanceChefReviewToSave(page)
  const generation = requests.find((request) => request.path === '/functions/v1/generate-recipe')
  assert.ok(generation, 'AI Chef did not call the authenticated generation endpoint in ' + name)
  assert.equal(generation.authorization, 'Bearer ' + session.access_token)
}

async function advanceChefReviewToSave(page, saveName = 'Save recipe') {
  const next = page.getByRole('button', { name: /^Next:/ })
  const progress = page.locator('.mm-review-progress')
  const save = page.getByRole('button', { name: saveName, exact: true })
  const method = page.locator('textarea[name="instructions.0.text"]:not([disabled])')
  const saveAlreadyAvailable = await save.isVisible()
  if (saveName === 'Save changes' && saveAlreadyAvailable) return
  let sawMethod = await method.isVisible()
  while (await next.isVisible()) {
    await expect(save).toHaveCount(0)
    const current = await progress.innerText()
    await next.click()
    await expect(progress).not.toHaveText(current)
    sawMethod ||= await method.isVisible()
  }
  if (!saveAlreadyAvailable) assert.ok(sawMethod, 'The cooking method was not presented before the final Save action')
  await expect(save).toBeVisible()
}

async function returnChefReviewToTitle(page) {
  const editSaved = page.getByRole('button', { name: 'Edit saved recipe', exact: true })
  if (await editSaved.isVisible()) await editSaved.click()
  const title = page.getByRole('textbox', { name: 'Recipe title', exact: true })
  const previous = page.getByRole('navigation', { name: 'Previous Recipe writing pages', exact: true })
    .getByRole('button', { name: /^Previous:/ })
  while (!await title.isVisible()) {
    const current = await page.locator('.mm-review-progress').innerText()
    await previous.click()
    await expect(page.locator('.mm-review-progress')).not.toHaveText(current)
  }
  return title
}

async function returnChefReviewToMethod(page) {
  const method = page.locator('textarea[name="instructions.0.text"]:not([disabled])')
  const previous = page.getByRole('navigation', { name: 'Previous Recipe writing pages', exact: true })
    .getByRole('button', { name: /^Previous:/ })
  while (!await method.isVisible()) {
    const current = await page.locator('.mm-review-progress').innerText()
    await previous.click()
    await expect(page.locator('.mm-review-progress')).not.toHaveText(current)
  }
  return method
}

async function verifyRevisionSave(page, origin, width, height) {
  resetScenario('revision')
  await page.evaluate(() => globalThis.sessionStorage.clear())
  await page.setViewportSize({ width, height })
  const originalSnapshot = globalThis.structuredClone(revisionOriginal)
  await page.goto(origin + 'app/recipes/' + revisionOriginal.id)
  await settleJournalLayout(page)
  await page.getByRole('button', { name: 'Revise with Mori', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Make a version for next time' })
  await dialog.getByRole('radio', { name: exactNote, exact: true }).check()
  await dialog.getByRole('button', { name: 'Ask Mori for a revision', exact: true }).click()
  await expect(page.getByRole('heading', { name: "Review Mori's recipe.", exact: true })).toBeVisible()
  const proposal = page.getByRole('region', { name: 'Mori’s proposed change' }).first()
  await expect(proposal).toContainText(exactNote)
  await expect(proposal).toContainText('2 tsp')
  await page.getByRole('button', { name: 'Edit proposed amount', exact: true }).click()
  const quantity = page.getByRole('textbox', { name: 'Ingredient 3 quantity', exact: true })
  await expect(quantity).toHaveValue('2')
  await quantity.fill('2.5')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await advanceChefReviewToSave(page, 'Save new version')
  const title = await returnChefReviewToTitle(page)
  await title.fill('Edited olive oil revision')
  await advanceChefReviewToSave(page, 'Save new version')
  assert.equal(recipeWrites.length, 0, 'Editing a revision must not write before Save')
  assert.equal(lineageWrites.length, 0)
  // Save after the final review turn without waiting for journal geometry to settle.
  await page.getByRole('button', { name: 'Save new version', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.', exact: true })).toBeVisible()
  await expect(page.getByText('Recipe and selected parent links saved.', { exact: true })).toBeVisible()
  assert.equal(recipeWrites.length, 1)
  assert.equal(lineageWrites.length, 1)
  assert.deepEqual(lineageWrites[0].body.parent_recipe_ids, [revisionOriginal.id])
  assert.equal(recipeWrites[0].body.title, 'Edited olive oil revision')
  assert.equal(recipeWrites[0].body.ingredients[2].quantity, 2.5)
  assert.deepEqual(recipeWrites[0].body.ingredients.slice(0, 2), revisionOriginal.ingredients.slice(0, 2))
  await page.getByRole('link', { name: 'Open saved version', exact: true }).first().click()
  await expect(page).toHaveURL(origin + 'app/recipes/' + scenarioRecipeIds.revision)
  await settleJournalLayout(page)
  const savedText = (await readAllRecipePages(page)).map(({ text }) => text).join('\n')
  const savedContent = savedText.replace(/\s+/g, '')
  assert.ok(savedContent.includes('2½tspoliveoil'), savedText)
  assert.ok(savedContent.includes('1cuprice') && savedContent.includes('1piecetomato'), savedText)
  await page.goto(origin + 'app/recipes/' + revisionOriginal.id)
  await settleJournalLayout(page)
  const originalText = (await readAllRecipePages(page)).map(({ text }) => text).join('\n')
  const originalContent = originalText.replace(/\s+/g, '')
  assert.ok(originalContent.includes('1tspoliveoil') && originalContent.includes(exactNote.replace(/\s+/g, '')), originalText)
  assert.equal(recipeUpdates.length, 0, 'Linked-copy save must not PATCH the original or its notes')
  assert.equal(recipeWrites.length, 1, 'Receipt/reopen must not duplicate the recipe')
  assert.deepEqual(revisionOriginal, originalSnapshot)
  process.stdout.write(`Revision save regression passed at ${width}×${height}: edited preview, immediate save, lineage, actual copy/original reopen, no duplicate or original PATCH.\n`)
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
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Maximum update depth')) errors.push(message.text())
  })
  const storageKey = `sb-${new URL(apiOrigin).hostname.split('.')[0]}-auth-token`
  await page.addInitScript(({ session, storageKey }) => globalThis.localStorage.setItem(storageKey, JSON.stringify(session)), { session, storageKey })
  await context.route('**/*', continueLocalRequest)

  await page.goto(`${origin}app`)
  for (const [width, height] of [[1440, 900], [1100, 640]]) await verifyRevisionSave(page, origin, width, height)
  resetScenario('success')
  await page.setViewportSize({ width: 1440, height: 900 })
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
  for (const width of [1440, 1100, 768, 400, 375, 320].filter(width => !desktopOnly || width >= 1100)) {
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
      entry: bounds('.mm-ai-chef__entry-panel').toJSON(),
      progress: bounds('.mm-ai-chef__journey').toJSON(),
      heading: bounds('.mm-ai-chef__heading').toJSON(),
      boardBottom: bounds('.mm-ai-chef__pantry-list:not(.mm-ai-chef__measure)').bottom,
      footerTop: bounds('.mm-journal-page-footer').top,
    }
  })
  assert.ok(pantryLayout.progress.bottom <= pantryLayout.entry.top && pantryLayout.entry.right < pantryLayout.heading.left, 'Progress and pantry entry stay on the left leaf beside the ingredient board')
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

  const quickAdd = page.locator('.mm-ai-chef__quick-add')
  assert.equal(await quickAdd.evaluate((details) => details.open), false, 'Common ingredient suggestions start collapsed')
  await quickAdd.locator('summary').click()
  await page.getByRole('button', { name: 'Remove Garlic' }).click()
  const garlic = page.getByRole('button', { name: 'garlic', exact: true })
  await expect(garlic).toBeEnabled()
  await pantryInput.fill('unsent ingredient')
  await garlic.click()
  await expect(garlic).toBeDisabled()
  await expect(pantryInput).toHaveValue('unsent ingredient')
  await expect(pantryInput).toBeFocused()
  await pantryInput.clear()

  await page.setViewportSize({ width: 1100, height: 640 })
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
  if (!desktopOnly) {
    await page.setViewportSize({ width: 375, height: 800 })
    await settleJournalLayout(page)
    await expect(firstCards).toHaveCount(1)
  }
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
  const feedback = page.getByRole('status', { name: 'Mori says' })
  await expect(feedback).toBeVisible()
  await expect(feedback).toContainText('Vinegar')
  await expect(page.getByRole('region', { name: 'Mori', exact: true })).toBeHidden()
  const feedbackBounds = await feedback.boundingBox()
  const companionBounds = await page.getByRole('group', { name: 'Mori companion' }).boundingBox()
  const feedbackViewport = page.viewportSize()
  assert.ok(feedbackBounds && companionBounds && feedbackViewport)
  assert.ok(feedbackBounds.x >= 0 && feedbackBounds.y >= 0 && feedbackBounds.x + feedbackBounds.width <= feedbackViewport.width && feedbackBounds.y + feedbackBounds.height <= feedbackViewport.height, 'Closed-chat speech stays in the viewport')
  assert.ok(feedbackBounds.x + feedbackBounds.width <= companionBounds.x || feedbackBounds.x >= companionBounds.x + companionBounds.width || feedbackBounds.y + feedbackBounds.height <= companionBounds.y || feedbackBounds.y >= companionBounds.y + companionBounds.height, 'Speech stays beside Mori')
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
  await page.getByRole('button', { name: /^Next page/ }).click()
  await expect(page.locator('[data-journal-page-turn][data-phase="animating"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Cooking preferences/ })).toBeVisible()
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: /^Previous page/ }).click()
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
  await expect(page.getByRole('status').filter({ hasText: 'That ingredient is already in your pantry list.' })).toContainText('already in your pantry list')
  await expect(page.getByRole('region', { name: 'Pantry list, 2 items' })).toContainText('rice')
  await page.getByRole('button', { name: /^Next page/ }).click()
  const preferences = page.getByRole('textbox', { name: /^Cooking preferences/ })
  await expect(preferences).toBeVisible()
  assert.ok(await preferences.evaluate((field) => field.clientWidth >= field.closest('fieldset').clientWidth - 2), 'Preferences collapsed on their own leaf')
  await preferences.fill('quick, no frying')
  await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()

  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  await page.goto(`${origin}app/chef`)
  const resume = page.getByRole('complementary', { name: 'Unsaved AI Chef recipe' })
  const resumeLink = resume.getByRole('link', { name: 'Return to recipe review' })
  for (const [width, height] of [[1440, 900], [1100, 640], [375, 800]].filter(([width]) => !desktopOnly || width >= 1100)) {
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
  const recipeLinksHelp = page.getByText('What are recipe links?', { exact: true })
  const recipeLinksAnswer = page.getByText(/Choose recipes from your journal to link as inspiration/)
  await expect(recipeLinksAnswer).toBeHidden()
  await recipeLinksHelp.press('Enter')
  await expect(recipeLinksAnswer).toBeVisible()
  await recipeLinksHelp.press('Space')
  await expect(recipeLinksAnswer).toBeHidden()
  const generation = requests.find((request) => request.path === '/functions/v1/generate-recipe')
  assert.ok(generation, 'AI Chef did not call the authenticated generation endpoint')
  assert.equal(generation.authorization, `Bearer ${session.access_token}`)
  assert.deepEqual(generation.body, { pantryItems: ['rice', 'eggs'], preferences: 'quick, no frying' })
  assert.equal(recipeWrites.length, 0, 'Generation saved a recipe before review')
  const recipeTitle = page.getByRole('textbox', { name: 'Recipe title', exact: true })
  const save = page.getByRole('button', { name: 'Save recipe', exact: true })
  await expect(recipeTitle).toBeVisible()
  await expect(recipeTitle).toHaveValue('Egg and rice skillet')
  await expect(save).toHaveCount(0)
  await advanceChefReviewToSave(page)
  const initialMethod = await returnChefReviewToMethod(page)
  await expect(initialMethod).toHaveValue('Warm the rice, then fold in the eggs.')
  const cookingMethod = page.getByRole('region', { name: 'Instructions', exact: true })
  await expect(cookingMethod.getByText('Ready', { exact: true })).toBeHidden()
  await expect(cookingMethod.getByRole('button', { name: /^Add (?:cooking )?step$/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Instructions.*Step/ })).toBeVisible()
  await advanceChefReviewToSave(page)
  await expect(save).toBeVisible()
  const reviewLeaf = page.locator('.mm-writing-leaf').filter({ has: page.getByRole('region', { name: 'AI Chef generation details' }) })
  const back = page.getByRole('button', { name: 'Back to AI Chef' })
  const reviewPages = page.locator('.mm-writing-leaf')
  for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]].filter(([width]) => !desktopOnly || width >= 1100)) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    await advanceChefReviewToSave(page)
    await expect(save).toBeInViewport({ ratio: 1 })
    await expect(back).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('heading', { name: 'What will be saved' })).toBeVisible()
    const optionalSummary = reviewLeaf.locator('summary').first()
    await optionalSummary.scrollIntoViewIfNeeded()
    await expect(optionalSummary).toBeInViewport({ ratio: 1 })
    await expect(save).toBeInViewport({ ratio: 1 })
    const bounds = await reviewPages.evaluateAll((leaves) => leaves.map((leaf) => ({
      height: leaf.clientHeight,
      scrollHeight: leaf.scrollHeight,
      overflowY: globalThis.getComputedStyle(leaf).overflowY,
      side: leaf.closest('.mm-journal-page') ? 'right' : 'left',
    })))
    assert.ok(bounds.length > 0 && bounds.every(({ side }) => side === 'left' || side === 'right'))
    assert.ok(bounds.every(({ height: leafHeight, scrollHeight, overflowY }) => scrollHeight <= leafHeight + 1 || overflowY === 'auto'),
      `Review content must fit or have its own scroll area at ${width}×${height}: ${JSON.stringify(bounds)}`)
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollHeight <= globalThis.innerHeight + 1),
      `Review should fit the viewport at ${width}×${height}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
  await advanceChefReviewToSave(page)
  await assertJournalSemantics(page, 'AI Chef recipe review')
  await expect(reviewLeaf.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Ingredients in this suggestion' })).toContainText('rice')
  await expect(reviewLeaf.getByText('2.5 out of 5', { exact: true })).toHaveCount(1)
  const optionalDetails = reviewLeaf.getByText('Optional details from Mori')
  if (await optionalDetails.isVisible()) {
    await optionalDetails.click()
  } else {
    for (const label of ['Your request', 'Suggested substitutions', 'Mori’s optional flavor estimates']) {
      const detail = reviewLeaf.locator('summary').filter({ hasText: label })
      if (await detail.isVisible()) await detail.click()
    }
  }
  await expect(reviewLeaf.getByRole('region', { name: 'Suggested substitutions' }).first()).toContainText('firm tofu')
  const request = reviewLeaf.getByRole('region', { name: 'Your request' })
  await expect(request.getByRole('listitem')).toHaveText(['rice', 'eggs'])
  await expect(request).toContainText('quick, no frying')

  const longTitle = 'Crispy egg and rice skillet with garlic, summer tomatoes, toasted sesame seeds, and fresh spring onions'
  const longNotes = 'Chill the rice overnight.\nFold the eggs in after the pan is hot.\n'.repeat(10)
  await returnChefReviewToTitle(page)
  await page.getByRole('button', { name: 'Expand recipe title' }).click()
  const titleDialog = page.getByRole('dialog', { name: 'Recipe title' })
  await titleDialog.getByRole('textbox', { name: 'Full recipe title' }).fill(longTitle)
  await page.screenshot({ path: path.join(os.tmpdir(), 'moris-fe10-title-dialog-1440.png') })
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
  await advanceChefReviewToSave(page)
  await expect(reviewLeaf.getByRole('heading', { name: 'Recipe inspiration' })).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.mm-journal-page .mm-review-leaf')).toBeVisible()
  await expect(page.locator('.mm-writing-blank-page')).toHaveCount(0)
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

  const instruction = await returnChefReviewToMethod(page)
  await expect(instruction).toHaveValue('Warm the rice, then fold in the eggs.')
  if (await save.isVisible()) await expect(instruction).toBeInViewport()
  await instruction.fill('Warm the rice first, then fold in the eggs.')
  assert.equal(recipeWrites.length, 0, 'Editing the review saved a recipe before explicit confirmation')
  assert.equal(lineageWrites.length, 0, 'Editing the review saved lineage before explicit confirmation')
  await advanceChefReviewToSave(page)

  for (const [width, height] of [[1280, 720], [1440, 900], [768, 1024], [390, 844], [375, 800], [320, 900]].filter(([width]) => !desktopOnly || width >= 1100)) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    await advanceChefReviewToSave(page)
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
  const repeatPantry = page.getByRole('button', { name: 'Use this pantry again', exact: true })
  for (const [width, height] of [[1280, 720], [390, 844]].filter(([width]) => !desktopOnly || width >= 1100)) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    await repeatPantry.scrollIntoViewIfNeeded()
    await expect(repeatPantry).toBeVisible()
    await expect(repeatPantry).toBeInViewport({ ratio: 1 })
    const buttonLayout = await repeatPantry.evaluate((button) => ({
      right: button.getBoundingClientRect().right,
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
      scrollHeight: button.scrollHeight,
      clientHeight: button.clientHeight,
    }))
    assert.ok(buttonLayout.right <= width + 1 && buttonLayout.scrollWidth <= buttonLayout.clientWidth && buttonLayout.scrollHeight <= buttonLayout.clientHeight,
      `Repeat-pantry action must fit at ${width}×${height}: ${JSON.stringify(buttonLayout)}`)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true,
      `AI Chef review horizontal overflow after save at ${width}px`)
    await page.screenshot({ path: path.join(os.tmpdir(), `moris-fe10-saved-review-repeat-pantry-${width}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await settleJournalLayout(page)
  await repeatPantry.click()
  await expect(page.getByRole('heading', { name: 'What’s in your pantry?' })).toBeVisible()
  const reusedPantry = page.getByRole('region', { name: 'Pantry list, 2 items' })
  await expect(reusedPantry).toContainText('rice')
  await expect(reusedPantry).toContainText('eggs')
  await page.getByRole('button', { name: 'Next page: Cooking preferences' }).click()
  await expect(page.getByRole('textbox', { name: /^Cooking preferences/ })).toHaveValue('quick, no frying')
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
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

  await returnChefReviewToTitle(page)
  await page.getByLabel('Recipe title').fill('Edited after storage recovered')
  await advanceChefReviewToSave(page, 'Save changes')
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
  await page.getByRole('button', { name: 'Edit saved recipe', exact: true }).click()
  await expect(page).toHaveURL(`${origin}app/recipes/${partialChildId}/edit`)
  await page.getByLabel('Recipe title').fill('Edited after recovery')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.', { exact: true })).toBeVisible()
  assert.equal(recipeUpdates.length, 1, 'Editing a recovered recipe did not use its existing ID')
  assert.equal(recipeUpdates[0].recipeId, partialChildId)
  assert.equal(recipeUpdates[0].body.title, 'Edited after recovery')
  assert.equal(recipeWrites.length, 1, 'Editing a recovered recipe created another child')
  await page.goto(`${origin}app/chef/review`)
  await expect(page.getByText('Recipe saved. Parent links still need attention.')).toBeVisible()
  await page.getByRole('button', { name: 'Retry recipe links' }).click()
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
  await expect(page.getByRole('button', { name: 'Retry recipe links' })).toBeVisible()
  assert.equal(recipeWrites.length, 1)
  assert.equal(lineageWrites.length, 1)
  assert.equal(requests.filter((request) => request.path.endsWith('/lineage') && request.method === 'GET').length, 0)
  assert.equal(requests.filter((request) => request.path === '/functions/v1/generate-recipe').length, 1)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Expired-token recovery created a second recipe')
  await page.getByRole('button', { name: 'Retry recipe links' }).click()
  await expect(page.getByRole('button', { name: 'Retry recipe links' })).toHaveCount(0)
  await expect(page.getByText('Recipe and selected parent links saved.')).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Authorization renewal created a second recipe')
  assert.equal(lineageWrites.length, 2)
  assert.equal(lineageWrites[1].childRecipeId, scenarioRecipeIds.expired)
  assert.equal(requests.filter((request) => request.path === '/functions/v1/generate-recipe').length, 1)
  process.stdout.write('AI Chef browser acceptance Scenario D passed: expired authorization renews links on the same saved recipe without regeneration.\n')

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
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}app/chef`)
  await page.getByRole('textbox', { name: 'Pantry ingredient' }).fill('rice')
  await page.getByRole('textbox', { name: 'Pantry ingredient' }).press('Enter')
  await settleJournalLayout(page)
  await page.locator('.mm-ai-chef__quick-add summary').click()
  await expect(page.locator('.mm-ai-chef__quick-add')).toHaveAttribute('open', '')
  await page.getByRole('button', { name: 'eggs', exact: true }).click({ trial: true })
  assert.ok(await page.locator('.mm-ai-chef__entry-panel').evaluate((panel) =>
    panel.getBoundingClientRect().bottom <= panel.closest('.mm-journal-flyleaf').querySelector('.mm-pagination-slot--left').getBoundingClientRect().top
  ), 'Expanded pantry suggestions stay above the left page-turn control')
  await page.screenshot({ path: path.join(os.tmpdir(), 'moris-pantry-expanded-1280.png'), animations: 'disabled' })
  const preferencesJump = page.getByRole('button', { name: /^Next page/ })
  await expect(preferencesJump).toBeInViewport({ ratio: 1 })
  await expect(preferencesJump).toContainText('Cooking preferences')
  await preferencesJump.press('Enter')
  await expect(preferences).toBeFocused()
  await preferences.fill('keep this preference')
  await page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
  await expect(page.getByRole('alert')).toContainText('rate-limited')
  await expect(page.getByRole('button', { name: 'Please wait to retry', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: /^Cooking preferences/ })).toHaveValue('keep this preference')
  await page.getByRole('button', { name: /^Previous page/ }).click()
  await expect(page.getByRole('region', { name: 'Pantry list, 1 item' })).toContainText('rice')
  await expect(page.getByText('private provider detail')).toHaveCount(0)
  assert.equal(recipeWrites.length, 0)
  activeScenario = 'success'
  await expect(page.getByRole('button', { name: 'Retry recipe suggestion', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Retry recipe suggestion', exact: true }).click()
  await expect(page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
  const attempts = requests.filter((request) => request.path === '/functions/v1/generate-recipe')
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[0].body, attempts[1].body)
  assert.equal(recipeWrites.length, 0)
  process.stdout.write('FE-13 generation failure: server cooldown, retained inputs, same-request retry and unsaved preview passed.\n')
  resetScenario('generation-failure')
  const fallbackPage = await context.newPage()
  fallbackPage.on('pageerror', (error) => errors.push(error.message))
  await fallbackPage.goto(`${origin}app/chef`)
  const fallbackPantry = fallbackPage.getByRole('textbox', { name: 'Pantry ingredient' })
  await fallbackPantry.fill('rice')
  await fallbackPantry.press('Enter')
  await fallbackPage.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
  await expect(fallbackPage.getByRole('alert')).toContainText('rate-limited')
  await fallbackPage.getByRole('link', { name: 'Write recipe manually' }).click()
  await expect(fallbackPage).toHaveURL(`${origin}app/recipes/new`)
  const manualForm = fallbackPage.getByRole('form', { name: 'Create recipe' })
  await expect(manualForm.getByRole('button', { name: 'Edit ingredient 1: rice' })).toBeVisible()
  const manualBack = fallbackPage.getByRole('button', { name: 'Back to AI Chef' })
  await expect(manualBack).toBeVisible()
  assert.equal(await manualBack.evaluate(button => button.form?.getAttribute('aria-label')), 'Create recipe', 'The persistent notebook footer must retain native form ownership')
  assert.equal(recipeWrites.length, 0, 'Continuing manually saved a recipe without confirmation')
  await fallbackPage.close()
  process.stdout.write('AI Chef recovery passed: manual continuation carried pantry items into the editable recipe form.\n')
  await page.setViewportSize({ width: 1366, height: 768 })
  await beginScenario(page, origin, 'expanded-review')
  const allIngredients = page.getByRole('button', { name: 'All suggested ingredients (7)' })
  await allIngredients.click()
  const ingredientDialog = page.getByRole('dialog', { name: 'Ingredients in this suggestion' })
  await ingredientDialog.waitFor()
  await page.screenshot({ path: path.join(os.tmpdir(), 'moris-fe10-ingredients-dialog-1366.png') })
  await expect(ingredientDialog.getByRole('listitem')).toHaveText(expandedSuggestion.recipe.ingredients.map(({ name }) => name))
  await ingredientDialog.getByRole('button', { name: 'Done' }).click()
  await expect(allIngredients).toBeFocused()

  const journalChooser = page.getByRole('button', { name: 'Choose journal recipes (3)' })
  await journalChooser.click()
  const journalDialog = page.getByRole('dialog', { name: 'From your journal' })
  await journalDialog.waitFor()
  await page.screenshot({ path: path.join(os.tmpdir(), 'moris-fe10-journal-dialog-1366.png') })
  await expect(journalDialog.getByRole('checkbox')).toHaveCount(3)
  await journalDialog.getByRole('checkbox', { name: new RegExp(extraParent.title) }).check()
  await page.keyboard.press('Escape')
  await expect(journalChooser).toBeFocused()
  await expect(page.getByText('1 selected · up to 10 recipes.')).toBeVisible()
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
