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
import { settleJournalLayout } from './journal-geometry.mjs'

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
const recipeWrites = []

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
  if (url.pathname === '/functions/v1/recipes' && request.method === 'POST') {
    recipeWrites.push({ body, authorization: request.headers.authorization })
    sendJson(request, response, 201, { recipe: {
      id: 'review-save-id', user_id: userId, ...body, flavor_scores: null,
    } })
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
  if (extractionMode === 'shared-capacity') {
    sendJson(request, response, 429, { error: { code: 'AI_CAPACITY_EXCEEDED' } }, { retryAfter: '90000' })
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
  await expect(page.getByRole('button', { name: 'Talk to Mori' })).toBeVisible()

  extractionMode = 'shared-capacity'
  const sharedCapacityPage = await context.newPage()
  sharedCapacityPage.on('pageerror', (error) => errors.push(error.message))
  await sharedCapacityPage.goto(`${origin}app/quick-entry`)
  const sharedCapacityNotes = sharedCapacityPage.getByRole('textbox', { name: 'Cooking notes' })
  await sharedCapacityNotes.fill('keep these notes until shared AI capacity returns')
  await sharedCapacityPage.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(sharedCapacityPage.getByRole('alert')).toContainText(/shared AI capacity.*25 hours/)
  await expect(sharedCapacityPage.getByRole('button', { name: 'Please wait to retry' })).toBeDisabled()
  await expect(sharedCapacityNotes).toHaveValue('keep these notes until shared AI capacity returns')
  await expect(sharedCapacityNotes).toBeEditable()
  await sharedCapacityPage.close()

  extractionMode = 'provider'
  const storageFailurePage = await context.newPage()
  storageFailurePage.on('pageerror', (error) => errors.push(error.message))
  await storageFailurePage.addInitScript(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('blocked') },
    })
  })
  await storageFailurePage.goto(`${origin}app`)
  await storageFailurePage.getByRole('link', { name: 'Quick AI Entry', exact: true }).click()
  const storageFailureNotes = storageFailurePage.getByRole('textbox', { name: 'Cooking notes' })
  const lostNotes = 'notes stay in the editor when session storage is blocked'
  await storageFailureNotes.fill(lostNotes)
  const storageWarning = storageFailurePage.locator('.mm-quick-ai__storage-warning')
  await expect(storageWarning).toContainText('a reload or closing the tab may erase them')
  await storageFailurePage.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(storageFailurePage.locator('.mm-quick-ai__error')).toContainText('Mori could not organize those notes just now')
  await expect(storageFailureNotes).toHaveValue(lostNotes)

  const logoutCountBeforeWarning = requests.filter((request) => request.path === '/auth/v1/logout').length
  await storageFailurePage.getByRole('button', { name: 'Log out' }).click()
  const logoutDialog = storageFailurePage.getByRole('alertdialog', { name: 'Leave without saving your notes?' })
  await expect(logoutDialog).toBeVisible()
  await expect(logoutDialog).toContainText('Copy your notes before leaving')
  assert.equal(requests.filter((request) => request.path === '/auth/v1/logout').length, logoutCountBeforeWarning, 'Log out ran before the user confirmed leaving')
  await logoutDialog.getByRole('button', { name: 'Keep Editing' }).click()
  await expect(storageFailureNotes).toHaveValue(lostNotes)

  for (const width of [1440, 375, 320]) {
    await storageFailurePage.setViewportSize({ width, height: 900 })
    await settleJournalLayout(storageFailurePage)
    await expect(storageWarning).toBeVisible()
    assert.equal(await storageFailurePage.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Storage warning overflow at ${width}px`)
    assert.equal(await storageWarning.evaluate((element) => element.getBoundingClientRect().right <= globalThis.innerWidth), true, `Storage warning extends beyond ${width}px viewport`)
    await storageFailurePage.getByRole('link', { name: 'Back to journal' }).click()
    const warningDialog = storageFailurePage.getByRole('alertdialog', { name: 'Leave without saving your notes?' })
    await expect(warningDialog).toBeVisible()
    assert.equal(await warningDialog.evaluate((element) => {
      const { left, right } = element.getBoundingClientRect()
      return left >= 0 && right <= globalThis.innerWidth
    }), true, `Navigation dialog extends beyond ${width}px viewport`)
    await warningDialog.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(storageFailureNotes).toHaveValue(lostNotes)
  }

  const unloadDialogs = []
  storageFailurePage.on('dialog', async (dialog) => {
    unloadDialogs.push(dialog.type())
    await dialog.dismiss()
  })
  await storageFailurePage.reload({ timeout: 2000 }).catch((error) => {
    if (!error.message.includes('Timeout')) throw error
  })
  assert.deepEqual(unloadDialogs, ['beforeunload'], 'Expected native beforeunload protection after failed persistence')
  await expect(storageFailureNotes).toHaveValue(lostNotes)

  await storageFailurePage.goBack()
  const leaveDialog = storageFailurePage.getByRole('alertdialog', { name: 'Leave without saving your notes?' })
  await expect(leaveDialog).toBeVisible()
  await expect(leaveDialog.getByRole('button', { name: 'Keep Editing' })).toBeFocused()
  await leaveDialog.getByRole('button', { name: 'Keep Editing' }).click()
  await expect(storageFailureNotes).toHaveValue(lostNotes)

  await storageFailurePage.getByRole('link', { name: 'Back to journal' }).click()
  await expect(storageFailurePage.getByRole('alertdialog', { name: 'Leave without saving your notes?' })).toBeVisible()
  await storageFailurePage.keyboard.press('Escape')
  await expect(storageFailureNotes).toHaveValue(lostNotes)

  await storageFailurePage.getByRole('link', { name: 'My recipes' }).click()
  await expect(storageFailurePage.getByRole('alertdialog', { name: 'Leave without saving your notes?' })).toBeVisible()
  await storageFailurePage.getByRole('button', { name: 'Leave Anyway' }).click()
  await expect(storageFailurePage).toHaveURL(`${origin}app/recipes`)
  await storageFailurePage.close()
  extractionMode = 'success'

  const sourceNotes = 'rice, two eggs\nsoy sauce and garlic; fry the eggs first'
  await notes.fill(sourceNotes)
  await notes.press('End')
  await notes.press('Enter')
  assert.ok((await notes.inputValue()).includes('\n'))
  await notes.fill(sourceNotes)
  await page.screenshot({ path: path.join(outputDir, 'desktop-empty-notes.png'), fullPage: true })

  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeFocused()
  await expect(page.getByText('Unsaved preview')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review recipe draft' })).toBeVisible()
  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await expect(notes).toHaveValue(sourceNotes)
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeFocused()
  assert.ok(requests.some((request) => request.path === '/functions/v1/extract-recipe' && request.authorization === 'Bearer quick-ai-test-access'))
  assert.deepEqual(requests.find((request) => request.path === '/functions/v1/extract-recipe' && request.body?.notes === sourceNotes)?.body, { notes: sourceNotes })
  assert.equal(requests.filter((request) => request.path === '/functions/v1/recipes' && request.method !== 'GET').length, 0)
  await page.screenshot({ path: path.join(outputDir, 'desktop-unsaved-preview.png'), fullPage: true })

  const extractionCount = requests.filter((request) => request.path === '/functions/v1/extract-recipe').length
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review recipe draft' })).toBeVisible()
  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect(notes).toHaveValue(sourceNotes)
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to journal' }).click()
  await page.getByRole('link', { name: 'Quick AI Entry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect(notes).toHaveValue(sourceNotes)
  await page.getByRole('button', { name: 'Next page' }).click()
  assert.equal(requests.filter((request) => request.path === '/functions/v1/extract-recipe').length, extractionCount)

  await page.getByRole('link', { name: 'Review recipe draft' }).click()
  await expect(page).toHaveURL(`${origin}app/quick-entry/review`)
  await expect(page.getByRole('heading', { name: 'Review your recipe' })).toBeVisible()
  await expect(page.getByLabel('Recipe title')).toHaveValue('Garlic soy chicken')
  const draftHelp = page.getByText('Where is my draft kept?', { exact: true })
  const draftAnswer = page.getByText(/Return to this tab with the same account/)
  await expect(draftAnswer).toBeHidden()
  await draftHelp.press('Enter')
  await expect(draftAnswer).toBeVisible()
  await draftHelp.press('Space')
  await expect(draftAnswer).toBeHidden()
  await page.setViewportSize({ width: 1280, height: 720 })
  await settleJournalLayout(page)
  const reviewIngredient = page.getByRole('group', { name: 'Ingredient 1', exact: true })
  const name = reviewIngredient.getByText('chicken', { exact: true })
  const lineCount = await name.evaluate((element) => {
    const text = element.ownerDocument.createRange()
    text.selectNodeContents(element)
    return text.getClientRects().length
  })
  assert.equal(lineCount, 1, 'A short ingredient name must fit on one line beside the review controls')
  await expect(reviewIngredient.getByRole('button', { name: 'Mark as reviewed: ingredient 1' })).toBeInViewport()
  await page.screenshot({ path: path.join(outputDir, 'desktop-extracted-review-1280.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await settleJournalLayout(page)
  await page.getByRole('button', { name: /^Edit ingredient 1:/ }).click()
  await expect(page.getByLabel('Ingredient 1 amount description (optional)')).toHaveValue('some')
  const quantity = await page.getByLabel('Ingredient 1 quantity').boundingBox()
  const unit = await page.getByLabel('Ingredient 1 unit').boundingBox()
  assert.ok(quantity && unit && Math.abs(quantity.y - unit.y) < 1 && Math.abs(quantity.width - unit.width) < 1,
    `Quantity and unit fields share a row and use equal widths: ${JSON.stringify({ quantity, unit })}`)
  await expect(page.getByText('AI suggested · Needs review')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save recipe' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Rating' }).getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(page.getByLabel('Cooked date')).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('')
  assert.equal(recipeWrites.length, 0, 'Opening the extracted preview created a recipe')
  await expect(page.getByRole('button', { name: 'Next: Instructions' })).toBeInViewport()
  await page.screenshot({ path: path.join(outputDir, 'desktop-extracted-recipe-review.png'), fullPage: true })

  await page.getByRole('button', { name: 'Next: Instructions' }).click()
  const turningSheet = page.locator('[data-journal-page-turn]')
  await expect(turningSheet).toHaveAttribute('data-direction', 'forward')
  await expect(turningSheet.locator('[data-mori-paper-actor] > :is(svg, img):visible')).toBeVisible()
  await expect(turningSheet).toHaveCount(0)
  await expect(page.locator('textarea[name="instructions.0.text"]:not([disabled])')).toHaveValue('Boil the chicken with garlic.')
  await expect(page.getByRole('heading', { name: 'Original cooking notes' })).toBeVisible()
  await expect(page.locator('blockquote')).toHaveText(sourceNotes)
  await page.getByText("Flavor estimates", { exact: true }).click()
  await expect(page.getByText(/preview only/)).toBeVisible()
  const lastFlavor = page.getByText('spicy', { exact: true })
  await lastFlavor.scrollIntoViewIfNeeded()
  await expect(lastFlavor).toBeInViewport()
  await page.getByRole('button', { name: 'Previous: Recipe details and Ingredients' }).click()
  await expect(page.locator('[data-journal-turn-snapshot]')).toHaveCount(0)
  await page.getByLabel('Recipe title').fill('Garlic soy chicken, corrected')
  await page.getByLabel('Ingredient 1 quantity').fill('1.5')
  assert.equal(recipeWrites.length, 0, 'Editing the extracted preview created a recipe')

  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await settleJournalLayout(page)
    await expect(page.getByLabel('Ingredient 1 quantity')).toHaveValue('1.5')
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Recipe review horizontal overflow at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `recipe-review-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 720, height: 450 })
  await settleJournalLayout(page)
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, 'Recipe review horizontal overflow at 200% equivalent reflow')
  await page.reload()
  await expect(page.getByLabel('Recipe title')).toHaveValue('Garlic soy chicken, corrected')
  await page.getByRole('button', { name: 'Next: Ingredients' }).click()
  await expect(page.locator('[data-journal-turn-snapshot]')).toHaveCount(0)
  await expect(page.locator('input[name="ingredients.0.quantity"]:not([disabled])')).toHaveValue('1.5')
  assert.equal(recipeWrites.length, 0, 'Reloading the review created a recipe')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Mark as reviewed: ingredient 1' }).click()
  await expect(page.getByLabel('Ingredient 1 name')).toBeFocused()
  await page.getByRole('button', { name: 'Next: Instructions' }).click()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your recipe is saved.' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Saved recipe', exact: true })
    .getByRole('link', { name: 'Open saved recipe' })).toBeVisible()
  assert.equal(recipeWrites.length, 1, 'Explicit Save did not create exactly one recipe')
  assert.equal(recipeWrites[0].authorization, 'Bearer quick-ai-test-access')
  assert.equal(recipeWrites[0].body.title, 'Garlic soy chicken, corrected')
  assert.equal(recipeWrites[0].body.star_rating, null)
  assert.equal(recipeWrites[0].body.cooked_at, null)
  assert.equal(recipeWrites[0].body.notes, '')
  assert.equal(recipeWrites[0].body.ingredients[0].quantity, 1.5)
  assert.equal(recipeWrites[0].body.ingredients[0].quantityText, 'some')
  assert.equal(recipeWrites[0].body.ingredients[0].inferred, false)
  const accountDraftKey = `moris-mix:quick-ai-entry:v1:${userId}`
  const consumedDraft = await page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), accountDraftKey)
  assert.equal(consumedDraft.handoff, null, 'Successful Save did not consume the unsaved handoff')
  assert.equal(consumedDraft.notes, sourceNotes, 'Successful Save cleared the original cooking notes')
  const repeatNotes = page.getByRole('button', { name: 'Use these notes again', exact: true })
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    await repeatNotes.scrollIntoViewIfNeeded()
    await expect(repeatNotes).toBeVisible()
    await expect(repeatNotes).toBeInViewport({ ratio: 1 })
    const buttonLayout = await repeatNotes.evaluate((button) => ({
      right: button.getBoundingClientRect().right,
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
      scrollHeight: button.scrollHeight,
      clientHeight: button.clientHeight,
    }))
    assert.ok(buttonLayout.right <= width + 1 && buttonLayout.scrollWidth <= buttonLayout.clientWidth && buttonLayout.scrollHeight <= buttonLayout.clientHeight,
      `Repeat-notes action must fit at ${width}×${height}: ${JSON.stringify(buttonLayout)}`)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true,
      `Recipe review horizontal overflow after save at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `saved-review-repeat-notes-${width}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await settleJournalLayout(page)
  await repeatNotes.click()
  const returnedNotes = page.getByRole('textbox', { name: 'Cooking notes' })
  await expect(returnedNotes).toHaveValue(sourceNotes)

  extractionMode = 'network'
  await returnedNotes.fill('beans, cumin, lemon, a splash of water')
  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('alert')).toContainText('Mori could not reach the kitchen')
  await expect(returnedNotes).toHaveValue('beans, cumin, lemon, a splash of water')
  extractionMode = 'success'
  await settleJournalLayout(page)
  const retryLayout = await page.evaluate(() => {
    const retry = globalThis.document.querySelector('.mm-quick-ai__actions button')
    const footer = globalThis.document.querySelector('.mm-journal-page-footer')
    return {
      retryBottom: retry.getBoundingClientRect().bottom,
      cardBottom: globalThis.document.querySelector('.mm-quick-ai__sheet').getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
    }
  })
  assert.ok(retryLayout.retryBottom <= retryLayout.cardBottom + 1,
    `Retry action must stay inside its paper at a short viewport: ${JSON.stringify(retryLayout)}`)
  assert.ok(retryLayout.retryBottom <= retryLayout.footerTop + 1,
    `Retry action must stay above the page controls at a short viewport: ${JSON.stringify(retryLayout)}`)
  await page.getByRole('button', { name: 'Retry extraction' }).click()
  await expect(page.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  assert.deepEqual(requests.filter((request) => request.path === '/functions/v1/extract-recipe').slice(-2).map((request) => request.body), [
    { notes: 'beans, cumin, lemon, a splash of water' }, { notes: 'beans, cumin, lemon, a splash of water' },
  ])

  extractionMode = 'provider'
  await page.getByRole('button', { name: 'Previous page' }).click()
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
  await providerPage.getByRole('link', { name: 'Write manually with these notes' }).click()
  await expect(providerPage).toHaveURL(`${origin}app/recipes/new`)
  await expect(providerPage.getByRole('textbox', { name: 'Notes' })).toHaveValue('keep these notes while the provider cools down')
  await expect(providerPage.getByRole('button', { name: 'Back to cooking notes' })).toBeVisible()
  await providerPage.close()

  extractionMode = 'invalid'
  await notes.fill('notes that receive a malformed result')
  await page.getByRole('button', { name: 'Organize my notes' }).click()
  await expect(page.getByRole('alert')).toContainText("Mori couldn't validate the recipe")
  await expect(notes).toHaveValue('notes that receive a malformed result')
  for (const [width, height] of [[1440, 900], [1280, 720]]) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    const error = page.getByRole('alert')
    const retry = page.getByRole('button', { name: 'Retry extraction' })
    await expect(error).toBeInViewport({ ratio: 1 })
    await expect(retry).toBeInViewport({ ratio: 1 })
    const messageBox = await error.boundingBox()
    const buttonBox = await retry.boundingBox()
    assert.ok(messageBox.y + messageBox.height <= buttonBox.y, `Error and retry must fit in reading order at ${width}×${height}`)
    await retry.click({ trial: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
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
    await settleJournalLayout(page)
    await expect(page.getByRole('textbox', { name: 'Cooking notes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Please wait to retry' })).toBeVisible()
    const overflowElements = await page.evaluate(() => Array.from(globalThis.document.querySelectorAll('body *'))
      .filter((element) => element.getBoundingClientRect().right > globalThis.innerWidth + 1 || element.getBoundingClientRect().left < -1)
      .map((element) => ({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', text: element.textContent?.slice(0, 60), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
      .slice(0, 12))
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Horizontal overflow at ${width}px: ${JSON.stringify(overflowElements)}`)
    assert.equal(await notes.evaluate((element) => element.scrollWidth <= element.clientWidth), true, `Textarea overflow at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `quick-entry-${width}.png`), fullPage: true })
  }

  // A 720px CSS viewport is the app's established 200% zoom-equivalent reflow check.
  await page.setViewportSize({ width: 720, height: 450 })
  await settleJournalLayout(page)
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
  await expect(fallbackPage.getByRole('alert')).toContainText('temporarily busy')
  await expect(fallbackPage.getByRole('button', { name: 'Retry extraction' })).toBeEnabled()
  await expect(fallbackPage.getByRole('button', { name: 'Please wait to retry' })).toHaveCount(0)
  await expect(fallbackNotes).toHaveValue('keep these notes when the cooldown header is not exposed')
  await fallbackPage.close()
  const reducedMotionPage = await context.newPage()
  reducedMotionPage.on('pageerror', (error) => errors.push(error.message))
  await reducedMotionPage.emulateMedia({ reducedMotion: 'reduce' })
  await reducedMotionPage.goto(`${origin}app/quick-entry`)
  await reducedMotionPage.getByRole('textbox', { name: 'Cooking notes' }).fill('notes prepared with reduced motion enabled')
  extractionMode = 'slow-success'
  await reducedMotionPage.getByRole('button', { name: 'Organize my notes' }).click()
  const loadingMori = reducedMotionPage.getByRole('group', { name: 'Mori companion' })
  await expect(loadingMori).toHaveAttribute('data-activity', 'working')
  await expect(loadingMori).toBeVisible()
  await expect(loadingMori.locator('.mm-mori')).not.toHaveAttribute('data-animated', 'true')
  await expect(reducedMotionPage.getByRole('heading', { name: 'Garlic soy chicken' })).toBeVisible()
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write(`Quick AI Entry and FE-09 authenticated extraction/review, validation, refresh recovery, explicit-save-only persistence, consumed-handoff clearing, notes/flavor metadata, failure recovery, keyboard focus, page turns, reduced motion, 320/375/768/1440px layouts, and 200% equivalent reflow passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server?.close()
  await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
}
