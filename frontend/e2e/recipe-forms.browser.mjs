// Isolated Phase E acceptance. Auth and recipe REST calls are synthetic or
// intercepted here; this script cannot write to a hosted Supabase project.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalGeometry, settleJournalLayout } from './journal-geometry.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiOrigin = 'https://recipe-journal.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const longRecipe = {
  ...fixture,
  id: 'long-form-recipe',
  user_id: userId,
  title: 'A very long title for testing form wrapping without losing the recipe draft',
  ingredients: Array.from({ length: 18 }, (_, index) => ({
    name: index === 0 ? 'unbrokeningredientname'.repeat(3) : `Ingredient ${index + 1} for the long family recipe`,
    quantity: index + 1, unit: 'cups', inferred: false,
  })),
  instructions: Array.from({ length: 14 }, (_, index) => ({
    step: index + 1,
    text: `Step ${index + 1}: ${'Stir slowly, check the heat, and taste the sauce before continuing. '.repeat(2)}`,
  })),
  notes: `A long note kept in the margin. ${'Keep the heat low and taste before adding more salt. '.repeat(14)}${'unbrokennote'.repeat(8)}`,
}
const initialRecipe = { ...fixture, user_id: userId, notes: 'A note from the original recipe.' }
const recipes = new Map([[initialRecipe.id, initialRecipe], [longRecipe.id, longRecipe]])
const newRecipeId = 'created-recipe-from-browser'
const saveRequests = []
const recipeReadRequests = []
const deleteRequests = []
let saveFailures = 0
let deleteFailures = 0
let saveGate = null
let deleteGate = null
let appOrigin
let browser

function gate() {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release }
}

async function turnPage(page, button) {
  await button.click()
  if (await page.evaluate(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)) return
  const layer = page.locator('[data-journal-page-turn]')
  await layer.waitFor({ state: 'attached' })
  await layer.waitFor({ state: 'detached' })
}

async function installKeyboardAudit(page) {
  await page.evaluate(() => {
    globalThis.__mmKeyboardEvents = []
    globalThis.addEventListener('keydown', (event) => {
      globalThis.__mmKeyboardEvents.push({ key: event.key, defaultPrevented: event.defaultPrevented })
    })
  })
}

async function keyboardWasPrevented(page, key) {
  return page.evaluate((lastKey) => globalThis.__mmKeyboardEvents.filter((event) => event.key === lastKey).at(-1)?.defaultPrevented, key)
}

async function waitForKeyboardTurn(page, expectedPage) {
  await expect(page.locator('.mm-writing-pages').first()).toHaveAttribute('data-form-page', String(expectedPage))
  if (await page.evaluate(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)) return
  const layer = page.locator('[data-journal-page-turn]')
  await layer.waitFor({ state: 'attached' })
  await layer.waitFor({ state: 'detached' })
}

const outputDir = path.join(root, 'test-results', 'ui01-step3b', 'after')
await mkdir(outputDir, { recursive: true })
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-recipe-form-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
})

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const pageErrors = []
  const brokenResources = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.url().startsWith(appOrigin) && response.status() >= 400) brokenResources.push(response.url())
  })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === appOrigin) return route.continue()
    assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'recipe-forms@example.test' } })

    const recipesPath = '/functions/v1/recipes'
    if (url.pathname === recipesPath && route.request().method() === 'GET') {
      recipeReadRequests.push('collection')
      const summaries = [...recipes.values()].map(({ id, title, user_id, star_rating, cooked_at }) => ({ id, title, user_id, star_rating, cooked_at }))
      return route.fulfill({ json: { recipes: summaries, has_more: false, next_cursor: null } })
    }
    if (url.pathname === recipesPath && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      saveRequests.push({ method: 'POST', body })
      if (saveGate) await saveGate.promise
      if (saveGate) saveGate = null
      if (saveFailures > 0) {
        saveFailures--
        return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'private save payload' } } })
      }
      const record = { ...initialRecipe, ...body, id: newRecipeId, user_id: userId }
      recipes.set(record.id, record)
      return route.fulfill({ status: 201, json: { recipe: record } })
    }
    const itemPath = `${recipesPath}/`
    if (url.pathname.startsWith(itemPath)) {
      const id = decodeURIComponent(url.pathname.slice(itemPath.length))
      const method = route.request().method()
      if (method === 'GET') {
        recipeReadRequests.push(id)
        const record = recipes.get(id)
        return record
          ? route.fulfill({ json: { recipe: record } })
          : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found' } } })
      }
      if (method === 'PATCH') {
        const body = route.request().postDataJSON()
        saveRequests.push({ method: 'PATCH', id, body })
        if (saveGate) await saveGate.promise
        if (saveGate) saveGate = null
        if (saveFailures > 0) {
          saveFailures--
          return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'private update payload' } } })
        }
        const record = { ...recipes.get(id), ...body, id, user_id: userId }
        recipes.set(id, record)
        return route.fulfill({ status: 200, json: { recipe: record } })
      }
      if (method === 'DELETE') {
        deleteRequests.push(id)
        if (deleteGate) await deleteGate.promise
        if (deleteGate) deleteGate = null
        if (deleteFailures > 0) {
          deleteFailures--
          return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'private deletion payload' } } })
        }
        recipes.delete(id)
        return route.fulfill({ status: 204 })
      }
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request' } } })
  })
  await page.addInitScript(({ userId }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const user = { id: userId, aud: 'authenticated', email: 'recipe-forms@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
    globalThis.localStorage.setItem('sb-recipe-journal-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { userId })

  const dashboardUrl = new URL('app/recipes', origin).toString()
  const createUrl = new URL('app/recipes/new', origin).toString()
  const detailUrl = (id) => new URL(`app/recipes/${encodeURIComponent(id)}`, origin).toString()
  const editUrl = (id) => new URL(`app/recipes/${encodeURIComponent(id)}/edit`, origin).toString()

  // Invalid form feedback, dynamic fields, ordering, pending, failure, retry, and create.
  await page.goto(createUrl)
  await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible()
  await assertJournalSemantics(page, 'create recipe form')
  await expect(page.getByLabel('Recipe title')).toBeVisible()
  await expect(page.getByRole('form', { name: 'Create recipe' })).toBeVisible()
  await expect(page.locator('.mm-journal-flyleaf .mm-form-identity')).toBeVisible()
  await expect(page.locator('.mm-journal-page .mm-form-recipe')).toBeVisible()
  assert.equal(await page.getByRole('form', { name: 'Create recipe' }).count(), 1)
  assert.equal(await page.locator('[id]').evaluateAll((nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length), true, 'Form controls must not duplicate IDs')
  assert.equal(await page.locator('.mm-writing-leaf').count(), 2, 'Desktop shows coordinated facing pages')
  const createEditorStyle = await page.getByRole('heading', { name: 'New recipe' }).evaluate((heading) => {
    const title = globalThis.document.querySelector('textarea[name="title"]')
    const save = globalThis.document.querySelector('.recipe-form-actions [type="submit"]')
    return {
      heading: [globalThis.getComputedStyle(heading).fontFamily, globalThis.getComputedStyle(heading).fontSize],
      title: [globalThis.getComputedStyle(title).borderRadius, globalThis.getComputedStyle(title).backgroundColor],
      saveHeight: globalThis.getComputedStyle(save).height,
    }
  })
  for (const name of ['Clear rating', 'Expand notes']) {
    const target = await page.getByRole('button', { name }).boundingBox()
    assert.ok(target && target.width >= 44 && target.height >= 44, `${name} must have a visible 44px target`)
  }
  await page.screenshot({ path: path.join(outputDir, 'create-form-1440.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('alert')).toContainText('Recipe title: Enter a recipe title.')
  await expect(page.getByLabel('Recipe title')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Recipe title')).toBeFocused()
  await assertJournalSemantics(page, 'create validation errors')

  await page.getByLabel('Recipe title').fill('Mori’s tomato supper')
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  for (const [width, height] of [[1366, 768], [1536, 864], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    await expect(page.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 })
    const amountFieldBounds = await Promise.all(['quantity', 'unit', 'amount description'].map((field) =>
      page.getByLabel(`Ingredient 1 ${field}`).boundingBox()))
    const topEdges = amountFieldBounds.map(({ y }) => y)
    assert.ok(Math.max(...topEdges) - Math.min(...topEdges) <= 1,
      `Ingredient amount inputs must align at ${width}×${height}: ${topEdges.join(', ')}`)
    const labelGap = await page.locator('.recipe-ingredient-edit-step .recipe-ingredient-fields').evaluate((fields) => {
      const name = fields.querySelector('.recipe-form-field:first-child input')
      const quantityLabel = fields.querySelector('.recipe-amount-row .recipe-form-field:first-child label')
      return quantityLabel.getBoundingClientRect().top - name.getBoundingClientRect().bottom
    })
    assert.ok(labelGap >= 8, `Ingredient labels must clear the name focus ring at ${width}×${height}: ${labelGap}px`)
    await page.getByRole('button', { name: 'Done' }).click({ trial: true })
    const leaves = await page.locator('.mm-writing-leaf').evaluateAll((pages) =>
      pages.map((leaf) => ({ client: leaf.clientHeight, scroll: leaf.scrollHeight })))
    assert.equal(leaves.length, 2)
    assert.ok(leaves.every(({ client, scroll }) => scroll <= client + 1), `New Recipe must fit at ${width}×${height}: ${JSON.stringify(leaves)}`)
  }
  await page.setViewportSize({ width: 1100, height: 640 })
  await settleJournalLayout(page)
  await page.getByRole('button', { name: 'Done' }).click({ trial: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByLabel('Ingredient 1 name').fill('Tomatoes')
  await page.getByLabel('Ingredient 1 quantity').fill('some')
  await page.getByLabel('Ingredient 1 unit').fill('pieces')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  await page.getByLabel('Ingredient 2 name').fill('Olive oil')
  await page.getByLabel('Ingredient 2 quantity').fill('a few')
  await page.getByLabel('Ingredient 2 unit').fill('tbsp')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  await page.getByLabel('Ingredient 3 name').fill('Basil')
  await page.getByLabel('Ingredient 3 quantity').fill('some')
  await page.getByLabel('Ingredient 3 unit').fill('leaves')
  await page.getByRole('button', { name: 'Done' }).click()
  assert.equal(await page.locator('[data-writing-leaf-key^="ingredients"]').count(), 1, 'Desktop keeps all ingredients on one leaf')
  await expect(page.getByRole('alertdialog')).toHaveCount(0, 'Page turns stay within the draft and do not trigger the route guard')
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByLabel('Ingredient 1 quantity')).toBeFocused()
  await expect(page.getByLabel('Ingredient 1 quantity')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: /another recipe page with errors/i })).toHaveCount(0)
  await page.getByLabel('Ingredient 1 quantity').fill('3')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /^Edit ingredient 2:/ }).click()
  await page.getByLabel('Ingredient 2 quantity').fill('2')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /^Edit ingredient 1:/ }).click()
  await page.getByLabel('Ingredient 1 amount description (optional)').fill('about three')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Remove ingredient 3' }).click()
  const tomatoHandle = page.getByRole('button', { name: 'Move ingredient 1: Tomatoes' })
  const sourceGrip = await tomatoHandle.boundingBox()
  const destinationGrip = await page.getByRole('button', { name: 'Move ingredient 2: Olive oil' }).boundingBox()
  assert(sourceGrip && destinationGrip)
  assert.equal(await tomatoHandle.evaluate((element) => globalThis.getComputedStyle(element).cursor), 'grab')
  const createSpread = await page.locator('.mm-writing-pages').getAttribute('data-form-page')
  const savesBeforeDrag = saveRequests.length
  const x = sourceGrip.x + sourceGrip.width / 2
  const y = sourceGrip.y + sourceGrip.height / 2
  const destinationY = destinationGrip.y + destinationGrip.height / 2
  await page.locator('.recipe-ingredient-card').evaluateAll(cards => Promise.all(cards.flatMap(card => card.getAnimations().map(animation => animation.finished))))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, destinationY, { steps: 8 })
  await expect(page.locator('.recipe-ingredient-card:popover-open')).toHaveCount(1)
  await expect(page.locator('[data-ingredient-drop]')).toHaveCount(1)
  const liftedGrip = await tomatoHandle.boundingBox()
  assert(liftedGrip && Math.abs(liftedGrip.y + liftedGrip.height / 2 - destinationY) < 5, 'The lifted grip tracks the pointer')
  await expect(page.locator('.mm-writing-pages')).toHaveAttribute('data-form-page', createSpread)
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await page.locator('[data-ingredient-drop] > fieldset').evaluate((card) => Promise.all(card.getAnimations().map((animation) => animation.finished)))
  await page.screenshot({ path: path.join(outputDir, 'ingredient-drag-1440.png') })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.recipe-ingredient-card:popover-open')).toHaveCount(0)
  await expect(page.locator('[data-ingredient-slot="0"] .recipe-ingredient-summary__name')).toHaveText('Tomatoes')
  await expect(page.getByRole('dialog', { name: 'Move ingredient' })).toHaveCount(0)

  await page.locator('.recipe-ingredient-card').evaluateAll(cards => Promise.all(cards.flatMap(card => card.getAnimations().map(animation => animation.finished))))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, destinationY, { steps: 8 })
  await expect(page.locator('.recipe-ingredient-card:popover-open')).toHaveCount(1)
  await expect(page.locator('[data-ingredient-drop]')).toHaveCount(1)
  await page.mouse.up()
  const movedTomato = page.getByRole('button', { name: 'Move ingredient 2: Tomatoes' })
  await expect(page.locator('[data-ingredient-slot="1"] .recipe-ingredient-summary__name')).toHaveText('Tomatoes')
  await expect(movedTomato).toBeFocused()
  await page.getByRole('button', { name: 'Edit ingredient 2: Tomatoes' }).click()
  await expect(page.getByLabel('Ingredient 2 name')).toHaveValue('Tomatoes')
  await expect(page.getByLabel('Ingredient 2 quantity')).toHaveValue('3')
  await expect(page.getByLabel('Ingredient 2 unit')).toHaveValue('pieces')
  await expect(page.getByLabel('Ingredient 2 amount description (optional)')).toHaveValue('about three')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog', { name: 'Move ingredient' })).toHaveCount(0)
  assert.equal(saveRequests.length, savesBeforeDrag, 'A drop must not save the draft')
  await expect(page.getByRole('button', { name: /Move ingredient \d (up|down)/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove ingredient 2' }).press('Enter')
  await expect(page.locator('[data-ingredient-slot="0"] .recipe-ingredient-summary__name')).toHaveText('Olive oil')
  await page.getByRole('button', { name: 'Edit ingredient 1: Olive oil' }).click()
  await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Olive oil')
  await expect(page.getByLabel('Ingredient 1 quantity')).toHaveValue('2')
  await expect(page.getByLabel('Ingredient 1 unit')).toHaveValue('tbsp')
  await page.getByRole('button', { name: 'Done' }).click()

  const readsBeforePageTurns = recipeReadRequests.length
  const paperTexture = await page.locator('.mm-journal-spread > .mm-journal-page').evaluate((paper) => globalThis.getComputedStyle(paper).backgroundImage)
  const saveShadow = await page.getByRole('button', { name: 'Save recipe' }).evaluate((button) => globalThis.getComputedStyle(button).boxShadow)
  assert.notEqual(saveShadow, 'none')
  await page.getByRole('button', { name: /^Next(?::| Pages?$)/ }).click()
  const turn = page.locator('[data-journal-page-turn]')
  const turningPaper = turn.locator('.mm-turn-face--front .mm-journal-page')
  await expect(turningPaper).toHaveCSS('background-image', paperTexture)
  await expect(turningPaper.locator('button').filter({ hasText: 'Save recipe' })).toHaveCSS('box-shadow', saveShadow)
  const midpoint = await turn.evaluate((layer) => {
    const sample = (progress) => layer.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: progress }))
    let start = 0
    let end = 1
    for (let i = 0; i < 12; i++) {
      const progress = (start + end) / 2
      sample(progress)
      if (Number(layer.dataset.travel) < .5) start = progress
      else end = progress
    }
    const revealedPage = layer.querySelector('.mm-turn-under--right .mm-journal-page')
    const footer = revealedPage.querySelector('.mm-journal-page-footer')
    return {
      paper: globalThis.getComputedStyle(revealedPage).backgroundImage,
      opacity: globalThis.getComputedStyle(footer).opacity,
      hasSave: [...footer.querySelectorAll('button')].some((button) => button.textContent.includes('Save recipe')),
    }
  })
  assert.equal(midpoint.opacity, '1', 'The exposed recipe footer stays visible as the sheet crosses the spine')
  assert.ok(midpoint.hasSave, 'The revealed footer contains its controls')
  assert.equal(midpoint.paper, paperTexture, 'The cooking-method spread keeps the recipe paper during the turn')
  await page.screenshot({ path: path.join(outputDir, 'new-recipe-mid-turn.png') })
  await turn.evaluate((layer) => layer.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: 1 })))
  await turn.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Add cooking step' }).click()
  await page.getByLabel('Step 1 description').fill('Chop the tomatoes.')
  await page.getByRole('button', { name: 'Add cooking step' }).click()
  await page.getByLabel('Step 2 description').fill('Warm the olive oil.')
  const firstStepGrip = page.getByRole('button', { name: 'Move step 1', exact: true })
  const secondStepGrip = page.getByRole('button', { name: 'Move step 2', exact: true })
  await firstStepGrip.press('Enter')
  const moveStepDialog = page.getByRole('dialog', { name: 'Move step' })
  await moveStepDialog.getByLabel('Move to position').fill('2')
  await moveStepDialog.getByLabel('Move to position').press('Enter')
  await expect(page.getByLabel('Step 1 description')).toHaveValue('Warm the olive oil.')
  await expect(secondStepGrip).toBeFocused()

  const from = await secondStepGrip.boundingBox()
  const to = await firstStepGrip.boundingBox()
  assert.ok(from && to, 'Both step grips must be visible for drag reordering')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByLabel('Step 1 description')).toHaveValue('Chop the tomatoes.')

  await firstStepGrip.press('Enter')
  await moveStepDialog.getByLabel('Move to position').fill('2')
  await moveStepDialog.getByLabel('Move to position').press('Enter')
  await expect(page.getByLabel('Step 1 description')).toHaveValue('Warm the olive oil.')
  assert.equal(recipeReadRequests.length, readsBeforePageTurns, 'Page navigation must not make recipe API requests')
  await expect(page.getByLabel('Step 2 description')).toHaveValue('Chop the tomatoes.')
  await page.getByRole('button', { name: 'Remove step 2' }).click()
  await expect(page.getByLabel('Step 1 description')).toHaveValue('Warm the olive oil.')

  await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  await page.getByLabel('Cooked date').fill('2026-10-30')
  const rating = page.getByRole('group', { name: 'Rating', exact: true })
  await expect(rating.getByRole('radio', { checked: true })).toHaveCount(0)
  await rating.getByRole('radio', { name: '3 stars' }).press('Space')
  await page.keyboard.press('ArrowRight')
  await expect(rating.getByRole('radio', { name: '4 stars' })).toBeChecked()
  await rating.getByRole('button', { name: 'Clear rating' }).click()
  await expect(rating.getByRole('radio', { checked: true })).toHaveCount(0)
  await rating.getByRole('radio', { name: '5 stars' }).press('Space')
  const notes = page.getByRole('textbox', { name: 'Notes', exact: true })
  const expandedNotes = page.getByRole('dialog', { name: 'Notes' })
  await page.getByRole('button', { name: 'Expand notes' }).click()
  const longNotes = 'A little olive oil made the edges sweet. '.repeat(30)
  await expandedNotes.getByRole('textbox', { name: 'Full notes' }).fill(longNotes)
  await expandedNotes.getByRole('button', { name: 'Done' }).click()
  await expect(notes).toHaveValue(longNotes)
  const inlineNotesHeight = await notes.evaluate((field) => field.offsetHeight)
  await notes.fill(longNotes + 'Serve warm.')
  assert.equal(await notes.evaluate((field) => field.offsetHeight), inlineNotesHeight, 'Long notes keep the inline editor bounded')
  await expect(page.getByRole('heading', { name: 'Ingredients', exact: true })).toBeInViewport()
  await notes.fill('A little olive oil made the edges sweet.')
  await page.screenshot({ path: path.join(outputDir, 'create-draft-first-spread-1440.png'), fullPage: true })
  await turnPage(page, page.getByRole('button', { name: /^Next(?::| Pages?$)/ }))
  saveFailures = 1
  saveGate = gate()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saving your recipe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  assert.equal(saveRequests.length, 1)
  saveGate.release()
  await expect(page.getByRole('alert')).toContainText('Could not confirm whether your recipe was saved')
  await expect(page.getByText('private save payload')).toHaveCount(0)
  await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  await expect(page.getByLabel('Recipe title')).toHaveValue('Mori’s tomato supper')
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('A little olive oil made the edges sweet.')
  await expect(page.locator('[data-ingredient-slot="0"] .recipe-ingredient-summary__name')).toHaveText('Olive oil')
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  assert.equal(saveRequests.length, 2)
  assert.deepEqual(saveRequests[1].body, {
    title: 'Mori’s tomato supper',
    ingredients: [{ name: 'Olive oil', quantity: 2, unit: 'tbsp', inferred: false }],
    instructions: [{ step: 1, text: 'Warm the olive oil.' }],
    star_rating: 5,
    cooked_at: '2026-10-30',
    notes: 'A little olive oil made the edges sweet.',
  })
  process.stdout.write('Create: validation, dynamic rows/order, pending, safe failure, retry, and confirmed save passed.\n')

  // The only in-app blocker displays the journal note and retains the form until the cook chooses.
  await page.goto(createUrl)
  await page.getByLabel('Recipe title').fill('Keep this handwritten draft')
  const recipesBookmark = page.getByRole('navigation', { name: 'Journal sections' }).getByRole('link', { name: 'My recipes' })
  await recipesBookmark.click()
  let leaveDialog = page.getByRole('alertdialog', { name: 'Leave without saving?' })
  await expect(leaveDialog).toBeVisible()
  await assertJournalSemantics(page, 'unsaved changes dialog')
  await expect(leaveDialog).toContainText('You have unsaved changes. Leave this page without saving?')
  const keepEditing = leaveDialog.getByRole('button', { name: 'Keep Editing' })
  const discardChanges = leaveDialog.getByRole('button', { name: 'Discard Changes' })
  await expect(keepEditing).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(discardChanges).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(keepEditing).toBeFocused()
  await page.screenshot({ path: path.join(outputDir, 'unsaved-note.png'), fullPage: true })
  await keepEditing.click()
  await expect(page).toHaveURL(createUrl)
  await expect(page.getByLabel('Recipe title')).toHaveValue('Keep this handwritten draft')
  await expect(recipesBookmark).toBeFocused()
  await recipesBookmark.click()
  leaveDialog = page.getByRole('alertdialog', { name: 'Leave without saving?' })
  await expect(leaveDialog).toBeVisible()
  await leaveDialog.getByRole('button', { name: 'Discard Changes' }).click()
  await expect(page).toHaveURL(dashboardUrl)
  await expect(page.getByLabel('Recipe title')).toHaveCount(0)
  process.stdout.write('Unsaved changes: modal focus trap, Keep Editing, and confirmed discard passed.\n')

  // Edit is populated from the existing detail route and preserves the normal return route.
  await page.goto(detailUrl(initialRecipe.id))
  await expect(page.getByRole('heading', { name: initialRecipe.title, level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Edit recipe' }).click()
  await expect(page).toHaveURL(editUrl(initialRecipe.id))
  await expect(page.getByLabel('Recipe title')).toHaveValue(initialRecipe.title)
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(initialRecipe.notes)
  const editSave = page.getByRole('button', { name: 'Save changes' })
  await expect(editSave).toHaveAccessibleDescription('No unsaved changes')
  await expect(page.getByText('Use the pencil to edit an ingredient.', { exact: false })).toBeVisible()
  const editEditorStyle = await page.getByRole('heading', { name: 'Edit recipe', exact: true }).evaluate((heading) => {
    const title = globalThis.document.querySelector('textarea[name="title"]')
    const save = globalThis.document.querySelector('.recipe-form-actions [type="submit"]')
    return {
      heading: [globalThis.getComputedStyle(heading).fontFamily, globalThis.getComputedStyle(heading).fontSize],
      title: [globalThis.getComputedStyle(title).borderRadius, globalThis.getComputedStyle(title).backgroundColor],
      saveHeight: globalThis.getComputedStyle(save).height,
    }
  })
  assert.deepEqual(editEditorStyle, createEditorStyle, 'Create and edit share their heading, title field, and action styles')
  const editRating = page.getByRole('group', { name: 'Rating', exact: true })
  await expect(editRating).toBeVisible()
  for (const name of ['Clear rating', 'Expand notes']) {
    const target = await page.getByRole('button', { name }).boundingBox()
    assert.ok(target && target.width >= 44 && target.height >= 44, `Edit ${name} must have a visible 44px target`)
  }
  await expect(page.locator('.mm-scrapbook-form__tape')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand notes' }).click()
  const notesDialog = page.getByRole('dialog', { name: 'Notes' })
  await expect(notesDialog).toBeVisible()
  await expect(notesDialog.getByRole('textbox', { name: 'Full notes' })).toBeVisible()
  await notesDialog.getByRole('button', { name: 'Done' }).click()
  await page.getByLabel('Recipe title').fill('A favorite revisited')
  await expect(editSave).toHaveAccessibleDescription('Unsaved changes')
  saveFailures = 1
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not confirm whether your recipe was saved')
  await expect(page.getByLabel('Recipe title')).toHaveValue('A favorite revisited')
  assert.equal(saveRequests.at(-1).method, 'PATCH')
  await page.getByRole('button', { name: /^Edit ingredient 3:/ }).click()
  await expect(page.getByLabel('Ingredient 3 name')).toHaveValue('garlic')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  assert.equal(saveRequests.at(-1).method, 'PATCH')
  assert.equal(saveRequests.at(-1).id, initialRecipe.id)
  assert.equal(saveRequests.at(-1).body.title, 'A favorite revisited')
  await page.goto(detailUrl(initialRecipe.id))
  await expect(page.getByRole('heading', { name: 'A favorite revisited', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Edit recipe' }).click()
  await page.getByRole('button', { name: 'Back to recipe', exact: true }).click()
  await expect(page).toHaveURL(detailUrl(initialRecipe.id))
  process.stdout.write('Edit: existing values, PATCH failure/retry/success, and detail-to-edit route behavior passed.\n')

  const methodless = { ...initialRecipe, id: 'methodless-recipe', title: 'Recipe without a method', instructions: [] }
  recipes.set(methodless.id, methodless)
  await page.goto(detailUrl(methodless.id) + '?read=instructions-empty')
  const addCookingSteps = page.getByRole('link', { name: 'Add cooking steps' })
  await addCookingSteps.click()
  await expect(page).toHaveURL(editUrl(methodless.id) + '?section=method')
  const addStep = page.getByRole('button', { name: 'Add cooking step' })
  await expect(addStep).toBeFocused()
  await addStep.press('Enter')
  await page.getByRole('textbox', { name: 'Step 1 description' }).fill('Cook until golden.')
  await page.getByRole('button', { name: 'Back to recipe' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard Changes' }).click()
  await expect(page).toHaveURL(detailUrl(methodless.id))
  recipes.delete(methodless.id)

  // Long writing data continues across physical leaves without dropping rows.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(editUrl(longRecipe.id))
  const addFromFirstSpread = page.getByRole('button', { name: 'Add ingredient', exact: true })
  await expect(addFromFirstSpread).toBeInViewport()
  await addFromFirstSpread.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Ingredient 19 name' })).toBeFocused()
  await page.getByRole('button', { name: 'Back to recipe', exact: true }).click()
  await page.getByRole('button', { name: 'Discard Changes' }).click()
  await page.goto(editUrl(longRecipe.id) + '?section=method')
  await expect(page.getByRole('textbox', { name: 'Step 1 description', exact: true })).toBeFocused()
  const addFromFirstMethodSpread = page.getByRole('button', { name: 'Add cooking step', exact: true })
  await expect(addFromFirstMethodSpread).toBeInViewport()
  await addFromFirstMethodSpread.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Step 15 description', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Back to recipe', exact: true }).click()
  await page.getByRole('button', { name: 'Discard Changes' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(editUrl(longRecipe.id))
  await expect(page.getByLabel('Recipe title')).toHaveValue(longRecipe.title)
  await page.evaluate(() => globalThis.document.fonts.ready)
  await page.screenshot({ path: path.join(outputDir, 'long-form-1440.png'), fullPage: true })
  async function collectVisibleRows() {
    const ingredients = await page.locator('[data-ingredient-slot]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ingredient-slot')))
    const steps = await page.locator('textarea[name^="instructions."][name$=".text"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))
    return { ingredients, steps }
  }
  async function collectRowsAcrossPages() {
    const ingredients = new Set()
    const steps = new Set()
    const turns = []
    for (;;) {
      const visible = await collectVisibleRows()
      const overflow = await page.locator('.mm-journal-book > .mm-journal-spread .mm-writing-leaf').evaluateAll((leaves) => leaves
        .filter((leaf) => leaf.scrollHeight > leaf.clientHeight + 2)
        .map((leaf) => [leaf.dataset.writingLeafKey, leaf.scrollHeight, leaf.clientHeight]))
      turns.push({ page: await page.locator('.mm-writing-pages').getAttribute('data-form-page'), ...visible, overflow })
      assert.deepEqual(overflow, [], 'Writing leaves must fit their page without an inner scrolling region')
      if (turns.length === 1) await page.screenshot({ path: path.join(outputDir, 'ingredient-pages-1440.png') })
      visible.ingredients.forEach((label) => ingredients.add(label))
      visible.steps.forEach((label) => steps.add(label))
      const next = page.getByRole('button', { name: /^Next(?::| Pages?$)/ })
      if (!(await next.count()) || !(await next.isEnabled())) break
      await turnPage(page, next)
    }
    return { ingredients, steps, turns }
  }
  assert.equal(await page.locator('.mm-writing-leaf').count(), 2)
  const allPages = await collectRowsAcrossPages()
  assert.equal(allPages.ingredients.size, 18, `All ingredient rows must be reachable on physical pages: ${JSON.stringify(allPages.turns)}`)
  assert.equal(allPages.steps.size, 14, 'All instruction steps must be reachable on physical pages')
  assert.deepEqual([...allPages.ingredients].sort((a, b) => Number(a) - Number(b)), Array.from({ length: 18 }, (_, index) => String(index)), 'All ingredients continue in their original order')
  assert.deepEqual(allPages.turns.flatMap(({ ingredients }) => ingredients).map(Number), Array.from({ length: 18 }, (_, index) => index), 'Physical pages retain ingredient order')
  assert.ok(allPages.turns.filter(({ ingredients }) => ingredients.length > 0).length > 1, 'Large ingredient lists continue to later physical leaves')

  // Use a tall desktop spread that fits four ingredient rows on one leaf.
  await page.setViewportSize({ width: 2600, height: 1400 })
  await settleJournalLayout(page)
  // Reorder within one leaf, then use the position dialog for a row on a later leaf.
  while (Number(await page.locator('.mm-writing-pages').getAttribute('data-form-page')) > 0) {
    await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  }
  while (await page.locator('[data-ingredient-slot]').count() < 2) await turnPage(page, page.getByRole('button', { name: /^Next(?::| Pages?$)/ }))
  const [sourceNumber, targetNumber] = await page.locator('[data-ingredient-slot]').evaluateAll(nodes => nodes.slice(0, 2).map(node => Number(node.dataset.ingredientSlot) + 1))
  const dragPage = await page.locator('.mm-writing-pages').getAttribute('data-form-page')
  const thirdGrip = await page.getByRole('button', { name: new RegExp(`^Move ingredient ${sourceNumber}:`) }).boundingBox()
  const fourthGrip = await page.getByRole('button', { name: new RegExp(`^Move ingredient ${targetNumber}:`) }).boundingBox()
  assert(thirdGrip && fourthGrip)
  const writesBeforeMoves = saveRequests.length
  const ingredientName = (number) => page.locator(`[data-ingredient-slot="${number - 1}"] .recipe-ingredient-summary__name`).textContent()
  const [third, fourth] = await Promise.all([sourceNumber, targetNumber].map(ingredientName))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(thirdGrip.x + thirdGrip.width / 2, thirdGrip.y + thirdGrip.height / 2)
  await page.mouse.down()
  await page.mouse.move(fourthGrip.x + fourthGrip.width / 2, fourthGrip.y + fourthGrip.height / 2, { steps: 12 })
  await expect(page.locator('[data-ingredient-drop]')).toHaveCount(1)
  await expect(page.locator('.mm-writing-pages')).toHaveAttribute('data-form-page', dragPage)
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  assert.equal(await page.locator('.recipe-ingredient-card:popover-open').evaluate((element) => globalThis.getComputedStyle(element).scale), 'none')
  await page.mouse.up()
  await expect(page.locator(`[data-ingredient-slot="${targetNumber - 1}"] .recipe-ingredient-summary__name`)).toHaveText(third)
  assert.deepEqual(await Promise.all([sourceNumber, targetNumber].map(ingredientName)), [fourth, third])
  await expect(page.getByRole('button', { name: `Move ingredient ${targetNumber}: ${third}` })).toBeFocused()
  await page.getByRole('button', { name: `Edit ingredient ${targetNumber}: ${third}` }).click()
  await expect(page.getByLabel(`Ingredient ${targetNumber} name`)).toHaveValue(third)
  await expect(page.getByLabel(`Ingredient ${targetNumber} quantity`)).toHaveValue(String(sourceNumber))
  await page.getByRole('button', { name: 'Done' }).click()
  assert.equal(saveRequests.length, writesBeforeMoves)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const movedValue = await ingredientName(targetNumber)
  const movedHandle = page.getByRole('button', { name: `Move ingredient ${targetNumber}: ${movedValue}` })
  await movedHandle.focus()
  await page.keyboard.press('Enter')
  const moveDialog = page.getByRole('dialog', { name: 'Move ingredient' })
  await expect(moveDialog.getByLabel('Move to position')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(moveDialog).toHaveCount(0)
  await expect(movedHandle).toBeFocused()
  await page.keyboard.press('Space')
  await page.keyboard.press('1')
  await page.keyboard.press('8')
  await expect(moveDialog.getByLabel('Move to position')).toHaveValue('18')
  await page.screenshot({ path: path.join(outputDir, 'ingredient-move-position-1440.png') })
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-ingredient-slot="17"] .recipe-ingredient-summary__name')).toHaveText(movedValue)
  await expect(page.getByRole('button', { name: `Move ingredient 18: ${movedValue}` })).toBeFocused()
  await expect(page.getByText(`${movedValue} moved to position 18 of 18.`)).toHaveCount(1)
  assert.equal(saveRequests.length, writesBeforeMoves, 'Neither drag nor keyboard reordering should save the recipe')
  await page.getByRole('button', { name: `Edit ingredient 18: ${movedValue}` }).click()
  const movedIngredient = page.getByLabel('Ingredient 18 name')
  await movedIngredient.focus()
  await movedIngredient.evaluate((input) => input.setSelectionRange(2, 2))
  await movedIngredient.press('Shift+ArrowRight')
  await movedIngredient.press('Shift+ArrowRight')
  await movedIngredient.press('Shift+ArrowRight')
  assert.deepEqual(await movedIngredient.evaluate((input) => [input.selectionStart, input.selectionEnd]), [2, 5])
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(movedIngredient).toBeFocused()
  assert.deepEqual(await movedIngredient.evaluate((input) => [input.selectionStart, input.selectionEnd]), [2, 5])
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(movedIngredient).toBeFocused()
  await page.setViewportSize({ width: 1024, height: 900 })
  await settleJournalLayout(page)
  const narrowedIngredient = page.getByLabel('Ingredient 18 name')
  await expect(narrowedIngredient).toBeFocused()
  assert.deepEqual(await narrowedIngredient.evaluate((input) => [input.selectionStart, input.selectionEnd]), [2, 5])
  await page.setViewportSize({ width: 1440, height: 900 })
  await settleJournalLayout(page)
  await expect(page.getByLabel('Ingredient 18 name')).toBeFocused()
  await page.getByRole('button', { name: 'Done' }).click()
  const stepFourDescription = page.getByLabel('Step 4 description')
  while (!(await stepFourDescription.isVisible())) {
    const nextPage = page.getByRole('button', { name: /^Next(?::| Pages?$)/ })
    assert(await nextPage.isEnabled(), 'Step 4 must remain reachable after ingredients continue across leaves')
    await turnPage(page, nextPage)
  }
  const movedStep = await stepFourDescription.inputValue()
  await page.getByRole('button', { name: 'Move step 4 down' }).click()
  await expect(page.getByLabel('Step 5 description')).toHaveValue(movedStep)
  await expect(page.getByLabel('Step 5 description')).toBeFocused()

  // The responsive matrix exposes two coordinated leaves on desktop and one on narrow views.
  for (const width of [1440, 1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    // Check the journal's layout from the top of the page at each viewport.
    await page.evaluate(() => globalThis.scrollTo(0, 0))
    await settleJournalLayout(page)
    await assertJournalGeometry(page, `recipe editor ${width}×900`)
    await assertJournalSemantics(page, `recipe editor ${width}×900`)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Long form overflows at ${width}px`)
    assert.equal(await page.locator('.mm-writing-leaf').count(), width < 1100 ? 1 : 2, `Expected ${width < 1100 ? 'one' : 'two'} active writing leaf/leaves at ${width}px`)
    await page.getByRole('button', { name: 'Save changes' }).scrollIntoViewIfNeeded()
    const saveBox = await page.getByRole('button', { name: 'Save changes' }).boundingBox()
    assert.ok(saveBox && saveBox.width > 0 && saveBox.height >= 44 && saveBox.x >= 0 && saveBox.x + saveBox.width <= width + 1, `Save must fit at ${width}px`)
    if (width === 320) await page.screenshot({ path: path.join(outputDir, 'long-form-320.png'), fullPage: true })
  }

  // Real Chromium keyboard regression for physical page turns.
  for (const { width, height } of [{ width: 1440, height: 700 }, { width: 390, height: 640 }, { width: 320, height: 640 }]) {
    await page.setViewportSize({ width, height })
    await page.goto(editUrl(longRecipe.id))
    await expect(page.getByLabel('Recipe title')).toHaveValue(longRecipe.title)
    await settleJournalLayout(page)
    await installKeyboardAudit(page)
    await page.getByLabel('Recipe title').fill('Keyboard page turn draft survives turns')
    const leaf = page.locator('.mm-writing-leaf').first()
    assert.equal(await leaf.getAttribute('data-writing-leaf-key'), 'identity')

    // Inputs keep their native PageDown behavior and do not change pages.
    await page.getByLabel('Recipe title').focus()
    await page.keyboard.press('PageDown')
    assert.equal(await keyboardWasPrevented(page, 'PageDown'), false, `${width}px: PageDown in the title control must remain native`)
    assert.equal(await page.locator('.mm-writing-pages').first().getAttribute('data-form-page'), '0')
    await leaf.focus()
    await page.keyboard.press('PageDown')
    assert.equal(await keyboardWasPrevented(page, 'PageDown'), true, `${width}px: accepted boundary turn consumes PageDown`)
    await waitForKeyboardTurn(page, 1)
    await expect(page.locator('.mm-writing-leaf h2[tabindex="-1"]').first()).toBeFocused()

    await page.keyboard.press('PageUp')
    assert.equal(await keyboardWasPrevented(page, 'PageUp'), true, `${width}px: accepted top-boundary turn consumes PageUp`)
    await waitForKeyboardTurn(page, 0)
    await expect(page.getByLabel('Recipe title')).toHaveValue('Keyboard page turn draft survives turns')
    process.stdout.write(`Keyboard page turns: PageUp/PageDown and boundary behavior passed at ${width}×${height}.\n`)
  }

  // Invalid first/last turns stay native. Arrows, rejected requests, animation,
  // focus, preserved draft data, and reduced motion are checked in Chromium.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(editUrl(longRecipe.id))
  await expect(page.getByLabel('Recipe title')).toHaveValue(longRecipe.title)
  await installKeyboardAudit(page)
  await page.locator('.mm-writing-leaf').first().focus()
  await page.keyboard.press('PageUp')
  assert.equal(await keyboardWasPrevented(page, 'PageUp'), false)
  await page.keyboard.press('ArrowLeft')
  assert.equal(await keyboardWasPrevented(page, 'ArrowLeft'), false)
  assert.equal(await page.locator('.mm-writing-pages').first().getAttribute('data-form-page'), '0')

  await page.keyboard.press('ArrowRight')
  assert.equal(await keyboardWasPrevented(page, 'ArrowRight'), true)
  await expect(page.locator('.mm-writing-pages').first()).toHaveAttribute('data-form-page', '1')
  await page.keyboard.press('ArrowRight')
  assert.equal(await keyboardWasPrevented(page, 'ArrowRight'), false, 'A rejected overlapping turn must leave the key available')
  assert.equal(await page.locator('.mm-writing-pages').first().getAttribute('data-form-page'), '1')
  await page.locator('[data-journal-page-turn]').waitFor({ state: 'attached' })
  await page.locator('[data-journal-page-turn]').waitFor({ state: 'detached' })
  await page.keyboard.press('ArrowLeft')
  assert.equal(await keyboardWasPrevented(page, 'ArrowLeft'), true)
  await waitForKeyboardTurn(page, 0)
  await expect(page.getByLabel('Recipe title')).toHaveValue(longRecipe.title)

  while (await page.getByRole('button', { name: /^Next(?::| Pages?$)/ }).count()) {
    await turnPage(page, page.getByRole('button', { name: /^Next(?::| Pages?$)/ }))
  }
  const finalPage = await page.locator('.mm-writing-pages').first().getAttribute('data-form-page')
  await page.locator('.mm-writing-leaf').last().focus()
  await page.keyboard.press('PageDown')
  assert.equal(await keyboardWasPrevented(page, 'PageDown'), false)
  assert.equal(await page.locator('.mm-writing-pages').first().getAttribute('data-form-page'), finalPage)

  while (await page.getByRole('button', { name: /^Previous Pages?$/ }).count()) {
    await turnPage(page, page.getByRole('button', { name: /^Previous Pages?$/ }))
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.mm-writing-leaf').first().focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await keyboardWasPrevented(page, 'ArrowRight'), true)
  await expect(page.locator('.mm-writing-pages').first()).toHaveAttribute('data-form-page', '1')
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await expect(page.locator('.mm-writing-leaf h2[tabindex="-1"]').first()).toBeFocused()
  process.stdout.write('Keyboard boundaries, arrows, rejected requests, focus, preserved draft data, animation, and reduced motion passed in Chromium.\n')

  // 200% equivalent reflow at 1280×900; native zoom has its own browser suite.
  await page.setViewportSize({ width: 640, height: 450 })
  await settleJournalLayout(page)
  await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, 'Long form overflows at 200% zoom')
  await page.getByRole('button', { name: 'Save changes' }).scrollIntoViewIfNeeded()
  const zoomSaveBox = await page.getByRole('button', { name: 'Save changes' }).boundingBox()
  assert.ok(zoomSaveBox && zoomSaveBox.width > 0 && zoomSaveBox.height >= 44)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedMotion = await page.getByRole('button', { name: 'Save changes', exact: true }).evaluate((element) => globalThis.getComputedStyle(element).animationName)
  assert.equal(reducedMotion, 'none')
  await page.screenshot({ path: path.join(outputDir, 'long-form-zoom-200.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await settleJournalLayout(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (;;) {
    const next = page.getByRole('button', { name: /^Next(?::| Pages?$)/ })
    if (!(await next.count()) || !(await next.isEnabled())) break
    await turnPage(page, next)
  }
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  assert.equal(saveRequests.at(-1).method, 'PATCH')
  assert.equal(saveRequests.at(-1).id, longRecipe.id)
  assert.equal(saveRequests.at(-1).body.ingredients.length, 18)
  assert.equal(saveRequests.at(-1).body.instructions.length, 14)
  process.stdout.write('Long form: all 18 ingredients and 14 steps reachable, cross-spread reordering, 1440/1280/1024/390/320px, 200% reflow, reachable Save, and reduced motion passed.\n')

  // Existing delete state machine: cancel, pending, recoverable failure, retry, and confirmed 204.
  await page.setViewportSize({ width: 1440, height: 960 })
  await settleJournalLayout(page)
  await page.goto(detailUrl(initialRecipe.id))
  await expect(page.getByRole('heading', { name: 'A favorite revisited', level: 1 })).toBeVisible()
  const deleteTrigger = page.getByRole('button', { name: 'Delete recipe', exact: true })
  await deleteTrigger.click()
  let deleteDialog = page.getByRole('alertdialog')
  await expect(deleteDialog).toContainText('A favorite revisited')
  await assertJournalSemantics(page, 'delete dialog')
  await expect(deleteDialog).toContainText('This action cannot be undone')
  await page.screenshot({ path: path.join(outputDir, 'delete-note.png'), fullPage: true })
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(deleteDialog).toHaveCount(0)
  await expect(deleteTrigger).toBeFocused()
  assert.equal(deleteRequests.length, 0, 'Cancel must not send DELETE')

  await deleteTrigger.click()
  deleteFailures = 1
  deleteGate = gate()
  deleteDialog = page.getByRole('alertdialog')
  await deleteDialog.getByRole('button', { name: 'Delete recipe', exact: true }).click()
  await expect(deleteDialog.getByRole('status')).toContainText('Deleting')
  await expect(deleteDialog).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('heading', { name: 'A favorite revisited', level: 1 })).toBeVisible()
  assert.equal(deleteRequests.length, 1)
  assert.ok(recipes.has(initialRecipe.id), 'Recipe should remain while deletion is pending')
  deleteGate.release()
  await expect(deleteDialog.getByRole('alert')).toContainText('could not confirm whether this recipe was deleted')
  await expect(deleteDialog.getByText('private deletion payload')).toHaveCount(0)
  assert.ok(recipes.has(initialRecipe.id), 'Failed deletion must keep the confirmed recipe in the collection')
  await deleteDialog.getByRole('button', { name: 'Try again' }).click()
  await expect(page).toHaveURL(new URL('app/recipes', origin).toString())
  await expect(page.getByRole('heading', { name: /Saved recipes/ })).toBeVisible()
  assert.equal(deleteRequests.length, 2)
  assert.equal(recipes.has(initialRecipe.id), false)
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(brokenResources, [])
  await page.screenshot({ path: path.join(outputDir, 'deleted-collection.png'), fullPage: true })
  await context.close()
  process.stdout.write(`Delete flow: cancellation, focus return, pending, recoverable failure/retry, and 204 success passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
