// Isolated Phase D browser acceptance: synthetic auth and intercepted recipe REST.
// No hosted Supabase project or production recipe store is contacted.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { settleJournalLayout } from './journal-geometry.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'
import { readAllRecipePages } from './reading-pages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiOrigin = 'https://recipe-journal.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId, notes: 'Toast the garlic gently. Add the basil at the end so it stays bright.' }
const secondRecipe = { ...recipe, id: '33333333-3333-4333-8333-333333333333', title: 'A Sunday soup for sharing', star_rating: 5, cooked_at: '2026-10-18' }
const longRecipe = {
  ...recipe,
  id: '44444444-4444-4444-8444-444444444444',
  title: 'A very long recipe title for the family notebook that wraps naturally',
  ingredients: Array.from({ length: 34 }, (_, index) => ({
    name: index === 0 ? 'longingredientnamewithnospaces'.repeat(3) : `Ingredient ${index + 1} for the long family recipe`,
    quantity: null, unit: null, inferred: false,
  })),
  instructions: Array.from({ length: 22 }, (_, index) => ({
    step: index + 1,
    text: `Step ${index + 1}: ${'Stir, check the heat, and let everything settle into the sauce. '.repeat(4)}`,
  })),
  notes: `A long personal note from the margin. ${'Keep the heat low and taste before adding more salt. '.repeat(24)}${'unbrokennote'.repeat(12)}`,
}
const retryRecipe = { ...recipe, id: '55555555-5555-4555-8555-555555555555', title: 'A recipe that needs one retry', star_rating: null, cooked_at: null }
const recipes = [recipe, secondRecipe, longRecipe, retryRecipe]
const recipeById = new Map(recipes.map((entry) => [entry.id, entry]))
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'moris-ui01-recipes-'))
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-recipe-ui-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
})
let browser
let appOrigin

async function newJournalContext(width, { empty = false, holdList = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const pageErrors = []
  let listHeld = holdList
  let releaseList
  let listFailures = 0
  const detailFailures = new Map()
  const recipeRequests = []
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
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'recipe-journal@example.test' } })
    if (url.pathname === '/functions/v1/recipes' && route.request().method() === 'GET') {
      recipeRequests.push(url.search)
      if (listHeld) await new Promise((resolve) => { releaseList = resolve })
      if (listFailures > 0) {
        listFailures--
        return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'private list detail' } } })
      }
      const list = empty ? [] : recipes.map(({ id, title, user_id, star_rating, cooked_at }) => ({ id, title, user_id, star_rating, cooked_at }))
      return route.fulfill({ json: { recipes: list, has_more: false, next_cursor: null } })
    }
    const detailPrefix = '/functions/v1/recipes/'
    if (url.pathname.startsWith(detailPrefix) && route.request().method() === 'GET') {
      const id = decodeURIComponent(url.pathname.slice(detailPrefix.length))
      const remainingFailures = detailFailures.get(id) ?? 0
      if (remainingFailures > 0) {
        detailFailures.set(id, remainingFailures - 1)
        return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'private detail failure' } } })
      }
      const found = recipeById.get(id)
      return found
        ? route.fulfill({ json: { recipe: found } })
        : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found' } } })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request' } } })
  })
  await page.addInitScript(({ userId }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const user = { id: userId, aud: 'authenticated', email: 'recipe-journal@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
    globalThis.localStorage.setItem('sb-recipe-journal-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { userId })
  return {
    context, page, pageErrors, recipeRequests, brokenResources,
    releaseList: () => { listHeld = false; releaseList?.() },
    failNextLists: (count) => { listFailures = count },
    failNextDetails: (id, count) => detailFailures.set(id, count),
  }
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1440, 768, 390, 320]) {
    const app = await newJournalContext(width, { holdList: width === 1440 })
    const { context, page } = app
    await page.goto(`${origin}app/recipes`)
    if (width === 1440) {
      await expect(page.getByRole('status')).toContainText('Loading your recipes')
      assert.equal(await page.getByRole('heading', { name: 'A fresh page for your next favorite.' }).count(), 0)
      app.releaseList()
    }
    await expect(page.getByRole('heading', { name: 'Saved recipes (4)' })).toBeVisible()
    await assertJournalSemantics(page, `${width}px dashboard`)
    await expect(page.locator('.recipe-grid > li')).toHaveCount(width < 600 ? 1 : 2)
    const firstCard = page.getByRole('link', { name: `Open recipe ${recipe.title}` })
    await expect(firstCard).toBeVisible()
    await expect(firstCard.getByRole('img', { name: /no recipe photo is available/ })).toBeVisible()
    await expect(firstCard.getByText('Oct 13, 2026')).toBeVisible()
    await expect(firstCard.getByText('4 / 5')).toBeVisible()
    assert.equal(await firstCard.locator('img').count(), 0)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Dashboard overflow at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `${width}-dashboard.png`), fullPage: true })

    await firstCard.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: recipe.title, level: 1 })).toBeVisible()
    await assertJournalSemantics(page, `${width}px recipe detail`)
    const title = page.getByRole('heading', { name: recipe.title, level: 1 })
    await expect(title).toBeFocused()
    if (width >= 1100) await expect(page.getByLabel('Scrap number 1')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit recipe' })).toBeVisible()
    const deleteButton = page.getByRole('button', { name: 'Delete recipe', exact: true })
    await expect(deleteButton).toBeVisible()
    await deleteButton.scrollIntoViewIfNeeded()
    const deleteBox = await deleteButton.boundingBox()
    assert.ok(deleteBox && deleteBox.width > 0 && deleteBox.height === 38 && deleteBox.x >= 0 && deleteBox.x + deleteBox.width <= width + 1)
    await expect(deleteButton).toHaveCSS('font-size', '13.5px')
    await expect(deleteButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await deleteButton.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await assertJournalSemantics(page, `${width}px delete dialog`)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(deleteButton).toBeFocused()
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Detail overflow at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `${width}-detail.png`), fullPage: true })

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
    await expect(firstCard).toBeFocused()
    await page.goForward()
    await expect(page.getByRole('heading', { name: recipe.title, level: 1 })).toBeFocused()
    const shortUnits = await readAllRecipePages(page)
    assert.ok(shortUnits.some((unit) => unit.text.includes('spaghetti')))
    assert.ok(shortUnits.some((unit) => unit.text.includes('Boil pasta in salted water.')))
    assert.ok(shortUnits.some((unit) => unit.text.includes('Toast the garlic gently')))
    assert.ok(shortUnits.some((unit) => unit.id === 'flavors'))

    await page.goto(`${origin}app/recipes/${longRecipe.id}`)
    await expect(page.getByRole('heading', { name: longRecipe.title, level: 1 })).toBeVisible()
    const longUnits = await readAllRecipePages(page)
    assert.equal(longUnits.filter((unit) => unit.id.startsWith('ingredient-')).length, 34)
    assert.equal(longUnits.filter((unit) => unit.id.startsWith('instruction-')).length, 22)
    assert.ok(longUnits.some((unit) => unit.text.includes('long personal note from the margin')))
    assert.ok(longUnits.some((unit) => unit.text.includes('unbrokennote')))
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Long detail overflow at ${width}px`)
    const frameBeforeScroll = await page.locator('.mm-journal-book').boundingBox()
    const bindingBeforeScroll = await page.locator('.mm-journal-binding').boundingBox()
    const note = page.locator('.mm-continuation-body').getByText(/unbrokennote/)
    if (await note.count()) { await note.scrollIntoViewIfNeeded(); await expect(note).toBeInViewport() }
    if (width >= 1000) {
      assert.deepEqual(await page.locator('.mm-journal-book').boundingBox(), frameBeforeScroll, 'Reading scroll moved the cover')
      assert.deepEqual(await page.locator('.mm-journal-binding').boundingBox(), bindingBeforeScroll, 'Reading scroll moved the binding')
    }
    await page.screenshot({ path: path.join(outputDir, `${width}-long-detail.png`), fullPage: true })

    if (width === 1440) {
      await page.goto(`${origin}app/recipes`)
      // Half-size CSS viewport verifies reflow; the native zoom suite verifies
      // real browser zoom instead of scaling the document with CSS.
      await page.setViewportSize({ width: 720, height: 450 })
      await settleJournalLayout(page)
      await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, 'Dashboard overflow at 200% equivalent reflow')
      await page.screenshot({ path: path.join(outputDir, '200-percent-dashboard.png'), fullPage: true })
      await page.setViewportSize({ width, height: 900 })

      await settleJournalLayout(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const reducedCardMotion = await page.locator('.mm-collection-entry').first().evaluate((element) => {
        const style = globalThis.getComputedStyle(element)
        return { transition: style.transitionProperty, transform: style.transform }
      })
      assert.equal(reducedCardMotion.transition, 'none', 'Recipe cards should not transition with reduced motion enabled')
      assert.equal(reducedCardMotion.transform, 'none', 'Recipe cards should not tilt with reduced motion enabled')
      await page.emulateMedia({ reducedMotion: 'no-preference' })

      // Offline direct-detail navigation pauses visibly; restoring connectivity resumes the same route.
      await context.setOffline(true)
      await page.getByRole('link', { name: `Open recipe ${secondRecipe.title}` }).click()
      await expect(page.getByRole('status').filter({ hasText: 'offline' })).toBeVisible()
      await context.setOffline(false)
      await expect(page.getByRole('heading', { name: secondRecipe.title, level: 1 })).toBeVisible()

      // Retryable server failures remain safe and recover on the existing retry control.
      app.failNextDetails(retryRecipe.id, 3)
      await page.goto(`${origin}app/recipes/${retryRecipe.id}`)
      await expect(page.getByRole('alert')).toContainText('Could not load this recipe')
      assert.equal(await page.getByText('private detail failure').count(), 0)
      app.failNextDetails(retryRecipe.id, 0)
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByRole('heading', { name: retryRecipe.title, level: 1 })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(`${origin}login`)
    assert.deepEqual(app.pageErrors, [])
    assert.deepEqual(app.brokenResources, [])
    await context.close()
    process.stdout.write(`${width}px: populated index, illustrated cards, detail/notes, long content, focus/history, edit/delete controls and no horizontal overflow passed.\n`)
  }

  const empty = await newJournalContext(390, { empty: true })
  await empty.page.goto(`${origin}app/recipes`)
  await expect(empty.page.getByRole('heading', { name: 'A fresh page for your next favorite.' })).toBeVisible()
  await expect(empty.page.locator('.recipe-grid > li')).toHaveCount(0)
  const add = empty.page.getByRole('link', { name: 'Add Your First Scrap' })
  await expect(add).toHaveAttribute('href', '/app/recipes/new')
  await add.click()
  await expect(empty.page).toHaveURL(`${origin}app/recipes/new`)
  await expect(empty.page.getByRole('heading', { name: 'A recipe of your own.' })).toBeVisible()
  assert.deepEqual(empty.pageErrors, [])
  await empty.context.close()
  process.stdout.write(`Empty journal to create route passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
