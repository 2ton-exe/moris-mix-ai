// Companion acceptance through the signed-in app with isolated API responses.
// This journey never contacts hosted Supabase or performs recipe mutations.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiOrigin = 'https://mori-dialogue.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId, notes: 'A local browser fixture.' }
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'moris-ui01-dialogue-'))
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-dialogue-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
})
let browser
let appOrigin

async function createJournal(width, { reducedMotion = false, empty = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const errors = []
  const apiRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === appOrigin || url.protocol === 'data:') return route.continue()
    assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
    apiRequests.push({ method: route.request().method(), path: url.pathname })
    assert.equal(route.request().method(), 'GET', `Unexpected write or mutation request: ${route.request().method()} ${url.pathname}`)
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'mori@example.test' } })
    if (url.pathname === '/functions/v1/recipes') {
      const recipes = empty ? [] : [{ id: recipe.id, title: recipe.title, user_id: userId, star_rating: recipe.star_rating, cooked_at: recipe.cooked_at }]
      return route.fulfill({ json: { recipes, has_more: false, next_cursor: null } })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request.' } } })
  })
  await page.addInitScript(({ id }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const user = { id, aud: 'authenticated', email: 'mori@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: id, exp: expires_at }))}.test-signature`
    globalThis.localStorage.setItem('sb-mori-dialogue-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { id: userId })
  return { context, page, errors, apiRequests }
}

async function reachable(page, locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `Companion control must remain reachable: ${JSON.stringify(box)}`)
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const width of [1440, 768, 375, 320]) {
    const { context, page, errors, apiRequests } = await createJournal(width)
    await page.goto(`${origin}app/recipes?view=index`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Talk to Mori', exact: true })
    const handle = page.getByRole('button', { name: /Move Mori.*arrow keys/ })
    await reachable(page, trigger)
    const requestsBefore = apiRequests.length
    await trigger.focus()
    await page.keyboard.press('Enter')
    const panel = page.getByRole('region', { name: 'Mori', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Mori', exact: true })).toBeFocused()
    await reachable(page, panel)
    await assertJournalSemantics(page, `${width}px open companion`)
    await page.screenshot({ path: path.join(outputDir, `${width}-companion.png`) })
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(trigger).toBeFocused()
    const before = await handle.boundingBox()
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    if (width > 520) await expect.poll(async () => (await handle.boundingBox()).x).toBeLessThan(before.x)
    await reachable(page, handle)
    await trigger.click()
    await panel.locator('summary').click()
    await panel.getByRole('button', { name: 'Move up', exact: true }).click()
    await reachable(page, panel)
    await panel.getByRole('button', { name: 'Reset position', exact: true }).click()
    await page.keyboard.press('Escape')
    const grip = await handle.boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(0, 0, { steps: 8 })
    await page.mouse.up()
    await reachable(page, handle)
    await expect(panel).toHaveCount(0)
    await trigger.click()
    await reachable(page, panel)
    await panel.getByRole('button', { name: 'Hide Mori', exact: true }).click()
    await expect(trigger).toHaveCount(0)
    const show = page.getByRole('button', { name: 'Show Mori', exact: true })
    await expect(show).toBeFocused()
    assert.equal(apiRequests.length, requestsBefore, 'Companion interactions must not initiate API requests')
    await page.reload()
    await expect(show).toBeVisible()
    await expect(trigger).toHaveCount(0)
    await show.click()
    await expect(trigger).toBeVisible()
    await reachable(page, trigger)
    await trigger.click()
    await panel.getByRole('button', { name: 'Reset position', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 320, height: 480 })
    await settleJournalLayout(page)
    await reachable(page, trigger)
    await trigger.click()
    await reachable(page, panel)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
    await page.keyboard.press('Escape')
    await page.goto(`${origin}app/recipes/new`)
    await expect(page.getByRole('heading', { name: 'New recipe', exact: true })).toBeVisible()
    await expect(trigger).toBeVisible()
    await page.goto(`${origin}home`)
    await expect(trigger).toHaveCount(0)
    assert.deepEqual(errors, [])
    await context.close()
    process.stdout.write(`${width}px: companion keyboard, drag, hide/restore, persistence, route scope and viewport passed.\n`)
  }

  const emptyApp = await createJournal(390, { empty: true })
  await emptyApp.page.goto(`${origin}app/recipes`)
  await expect(emptyApp.page.getByRole('heading', { name: 'A fresh page for your next favorite.' })).toBeVisible()
  await emptyApp.page.getByRole('button', { name: 'Talk to Mori', exact: true }).click()
  const emptyPanel = emptyApp.page.getByRole('region', { name: 'Mori', exact: true })
  await emptyPanel.getByRole('button', { name: 'Write your first recipe' }).click()
  await expect(emptyApp.page).toHaveURL(`${origin}app/recipes/new`)
  assert.deepEqual(emptyApp.errors, [])
  await emptyApp.context.close()

  const { context, page, errors } = await createJournal(1440, { reducedMotion: true })
  await page.goto(`${origin}app/recipes`)
  const trigger = page.getByRole('button', { name: 'Talk to Mori', exact: true })
  await trigger.click()
  await expect(page.getByRole('region', { name: 'Mori', exact: true })).toBeVisible()
  const animated = await trigger.locator('svg').evaluate((svg) => [svg, ...svg.querySelectorAll('*')].filter((element) =>
    globalThis.getComputedStyle(element).animationName !== 'none').length)
  assert.equal(animated, 0, 'Reduced motion must disable character animation')
  await page.setViewportSize({ width: 720, height: 450 })
  const panel = page.getByRole('region', { name: 'Mori', exact: true })
  await expect.poll(async () => { const box = await panel.boundingBox(); return Boolean(box && box.y + box.height <= 450) }).toBe(true)
  await reachable(page, panel)
  await page.screenshot({ path: path.join(outputDir, 'reduced-motion-reflow.png') })
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write(`Empty guidance and reduced motion passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
