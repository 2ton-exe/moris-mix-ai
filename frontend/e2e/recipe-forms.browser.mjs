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
  await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeVisible()
  await assertJournalSemantics(page, 'create recipe form')
  await expect(page.getByLabel('Recipe title')).toBeVisible()
  await expect(page.getByRole('form', { name: 'Create recipe' })).toBeVisible()
  await expect(page.locator('.mm-journal-flyleaf .mm-form-identity')).toBeVisible()
  await expect(page.locator('.mm-journal-page .mm-form-recipe')).toBeVisible()
  assert.equal(await page.locator('form').count(), 1)
  assert.equal(await page.locator('[id]').evaluateAll((nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length), true, 'Form controls must not duplicate IDs')
  assert.equal(await page.locator('.mm-writing-leaf').count(), 2, 'Desktop shows coordinated facing pages')
  await page.screenshot({ path: path.join(outputDir, 'create-form-1440.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('alert')).toContainText('Please check the highlighted fields')
  await expect(page.getByLabel('Recipe title')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Recipe title')).toBeFocused()
  await assertJournalSemantics(page, 'create validation errors')

  await page.getByLabel('Recipe title').fill('Mori’s tomato supper')
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  await page.getByLabel('Ingredient 1 name').fill('Tomatoes')
  await page.getByLabel('Ingredient 1 quantity').fill('some')
  await page.getByLabel('Ingredient 1 unit').fill('pieces')
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  await page.getByLabel('Ingredient 2 name').fill('Olive oil')
  await page.getByLabel('Ingredient 2 quantity').fill('a few')
  await page.getByLabel('Ingredient 2 unit').fill('tbsp')
  await page.getByRole('button', { name: 'Add ingredient' }).click()
  await page.getByLabel('Ingredient 3 name').fill('Basil')
  await page.getByLabel('Ingredient 3 quantity').fill('some')
  await page.getByLabel('Ingredient 3 unit').fill('leaves')
  await expect(page.getByRole('alertdialog')).toHaveCount(0, 'Page turns stay within the draft and do not trigger the route guard')
  const readsBeforePageTurns = recipeReadRequests.length
  await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Tomatoes')
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByLabel('Ingredient 1 quantity')).toBeFocused()
  await expect(page.getByLabel('Ingredient 1 quantity')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: /another recipe page with errors/i })).toContainText('1 other page has errors')
  await page.getByRole('button', { name: /another recipe page with errors/i }).click()
  await page.locator('[data-journal-page-turn]').waitFor({ state: 'attached' })
  await page.locator('[data-journal-page-turn]').waitFor({ state: 'detached' })
  await expect(page.getByLabel('Ingredient 3 quantity')).toBeFocused()
  await expect(page.getByLabel('Ingredient 3 quantity')).toHaveAttribute('aria-invalid', 'true')
  assert.equal(recipeReadRequests.length, readsBeforePageTurns, 'Page navigation must not make recipe API requests')
  await page.getByLabel('Ingredient 3 quantity').fill('1')
  await page.getByRole('button', { name: 'Remove ingredient 3' }).click()
  await page.getByLabel('Ingredient 1 quantity').fill('3')
  await page.getByLabel('Ingredient 2 quantity').fill('2')
  await page.getByRole('button', { name: 'Move ingredient 1 down' }).click()
  await expect(page.getByLabel('Ingredient 2 name')).toHaveValue('Tomatoes')
  await expect(page.getByLabel('Ingredient 2 name')).toBeFocused()
  await page.getByRole('button', { name: 'Remove ingredient 2' }).click()
  await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Olive oil')
  await expect(page.getByLabel('Ingredient 1 quantity')).toHaveValue('2')
  await expect(page.getByLabel('Ingredient 1 unit')).toHaveValue('tbsp')

  await turnPage(page, page.getByRole('button', { name: 'Next Pages' }))
  await page.getByRole('button', { name: 'Add cooking step' }).click()
  await page.getByLabel('Step 1 description').fill('Chop the tomatoes.')
  await page.getByRole('button', { name: 'Add cooking step' }).click()
  await page.getByLabel('Step 2 description').fill('Warm the olive oil.')
  await page.getByRole('button', { name: 'Move step 1 down' }).click()
  await expect(page.getByLabel('Step 1 description')).toHaveValue('Warm the olive oil.')
  await expect(page.getByLabel('Step 2 description')).toHaveValue('Chop the tomatoes.')
  await page.getByRole('button', { name: 'Remove step 2' }).click()
  await expect(page.getByLabel('Step 1 description')).toHaveValue('Warm the olive oil.')

  await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  await page.getByLabel('Cooked date').fill('2026-10-30')
  await page.getByLabel('Rating').selectOption('5')
  await page.getByRole('textbox', { name: 'Notes' }).fill('A little olive oil made the edges sweet.')
  await page.screenshot({ path: path.join(outputDir, 'create-draft-first-spread-1440.png'), fullPage: true })
  await turnPage(page, page.getByRole('button', { name: 'Next Pages' }))
  saveFailures = 1
  saveGate = gate()
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saving your recipe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  assert.equal(saveRequests.length, 1)
  saveGate.release()
  await expect(page.getByRole('alert')).toContainText('Could not save your recipe')
  await expect(page.getByText('private save payload')).toHaveCount(0)
  await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  await expect(page.getByLabel('Recipe title')).toHaveValue('Mori’s tomato supper')
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('A little olive oil made the edges sweet.')
  await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Olive oil')
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
  await page.getByLabel('Recipe title').fill('A favorite revisited')
  saveFailures = 1
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save your recipe')
  await expect(page.getByLabel('Recipe title')).toHaveValue('A favorite revisited')
  assert.equal(saveRequests.at(-1).method, 'PATCH')
  await turnPage(page, page.getByRole('button', { name: 'Next Pages' }))
  await expect(page.getByLabel('Ingredient 3 name')).toHaveValue('garlic')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Recipe saved.')).toBeVisible()
  assert.equal(saveRequests.at(-1).method, 'PATCH')
  assert.equal(saveRequests.at(-1).id, initialRecipe.id)
  assert.equal(saveRequests.at(-1).body.title, 'A favorite revisited')
  await page.goto(detailUrl(initialRecipe.id))
  await expect(page.getByRole('heading', { name: 'A favorite revisited', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Edit recipe' }).click()
  await page.getByRole('link', { name: 'Back to journal', exact: true }).click()
  await expect(page).toHaveURL(new URL('app/recipes', origin).toString())
  process.stdout.write('Edit: existing values, PATCH failure/retry/success, and detail-to-edit route behavior passed.\n')

  // Long content becomes sequential writing pages at wide sizes and one page at narrow sizes.
  await page.goto(editUrl(longRecipe.id))
  await expect(page.getByLabel('Recipe title')).toHaveValue(longRecipe.title)
  await page.evaluate(() => globalThis.document.fonts.ready)
  await page.screenshot({ path: path.join(outputDir, 'long-form-1440.png'), fullPage: true })
  async function collectVisibleRows() {
    const ingredients = await page.locator('input[name^="ingredients."][name$=".name"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))
    const steps = await page.locator('textarea[name^="instructions."][name$=".text"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))
    return { ingredients, steps }
  }
  async function collectRowsAcrossPages() {
    const ingredients = new Set()
    const steps = new Set()
    const turns = []
    for (;;) {
      const visible = await collectVisibleRows()
      turns.push({ page: await page.locator('.mm-writing-pages').getAttribute('data-form-page'), ...visible })
      visible.ingredients.forEach((label) => ingredients.add(label))
      visible.steps.forEach((label) => steps.add(label))
      const next = page.locator('.mm-writing-turns button').last()
      if (!(await next.isEnabled())) break
      await turnPage(page, next)
    }
    return { ingredients, steps, turns }
  }
  assert.equal(await page.locator('.mm-writing-leaf').count(), 2)
  const allPages = await collectRowsAcrossPages()
  assert.equal(allPages.ingredients.size, 18, `All ingredient rows must be reachable on physical pages: ${JSON.stringify(allPages.turns)}`)
  assert.equal(allPages.steps.size, 14, 'All instruction steps must be reachable on physical pages')

  // Move ingredient 6 down across a desktop spread boundary and keep focus on its stable row.
  while (Number(await page.locator('.mm-writing-pages').getAttribute('data-form-page')) > 1) {
    await turnPage(page, page.getByRole('button', { name: 'Previous Pages' }))
  }
  await expect(page.getByLabel('Ingredient 6 name')).toBeVisible()
  const movedValue = await page.getByLabel('Ingredient 6 name').inputValue()
  await page.getByRole('button', { name: 'Move ingredient 6 down' }).click()
  await expect(page.getByLabel('Ingredient 7 name')).toHaveValue(movedValue)
  await expect(page.getByLabel('Ingredient 7 name')).toBeFocused()
  while (Number(await page.locator('.mm-writing-pages').getAttribute('data-form-page')) < 5) {
    await turnPage(page, page.getByRole('button', { name: 'Next Pages' }))
  }
  await expect(page.getByLabel('Step 4 description')).toBeVisible()
  const movedStep = await page.getByLabel('Step 4 description').inputValue()
  await page.getByRole('button', { name: 'Move step 4 down' }).click()
  await expect(page.getByLabel('Step 5 description')).toHaveValue(movedStep)
  await expect(page.getByLabel('Step 5 description')).toBeFocused()

  // The responsive matrix exposes two coordinated leaves on desktop and one on narrow views.
  for (const width of [1440, 1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
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
    const next = page.locator('.mm-writing-turns button').last()
    if (!(await next.isEnabled())) break
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
