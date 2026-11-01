// Phase G browser acceptance: synthetic session and intercepted GET requests only.
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

async function revealThenAdvance(note) {
  const textStatus = note.locator('.visually-hidden[role="status"]')
  const before = await textStatus.count() ? await textStatus.textContent() : null
  await note.getByRole('button', { name: /^(Show full message|Continue)$/ }).click()
  const after = await textStatus.count() ? await textStatus.textContent() : null
  // If the click revealed text, Continue is still available; if the typewriter
  // finished first, the same click already advanced the line or completed it.
  if (before === after) await note.getByRole('button', { name: 'Continue' }).click()
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const width of [1440, 768, 375, 320]) {
    const app = await createJournal(width)
    const { context, page, errors, apiRequests } = app
    await page.goto(`${origin}app/recipes?view=index`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Open a note from Mori' })
    await expect(trigger).toBeVisible()
    await expect(page.getByLabel('Search recipes')).toBeVisible()
    await trigger.focus()
    await page.keyboard.press('Enter')
    const note = page.getByRole('region', { name: 'Mori' })
    await expect(note).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Mori' })).toBeFocused()
    assert.equal(await note.getAttribute('aria-modal'), null)
    await assertJournalSemantics(page, `${width}px open Mori note`)
    if (width === 1440 || width === 320) {
      await page.waitForTimeout(260)
      await page.screenshot({ path: path.join(outputDir, `${width}-open-note.png`) })
    }
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Show me the collection' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Write another recipe' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(note.getByRole('button', { name: /^(Show full message|Continue)$/ })).toBeFocused()
    await revealThenAdvance(note)
    await revealThenAdvance(note)
    await expect(note.getByText('Whenever you are ready, your journal is here.')).toBeVisible()
    await page.getByRole('button', { name: "Close Mori's note" }).click()
    await expect(note).toHaveCount(0)
    await expect(trigger).toBeFocused()

    await trigger.click()
    await page.keyboard.press('Escape')
    await expect(note).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    // Choice controls remain available while typewriter text is still revealing.
    await page.getByRole('button', { name: 'Write another recipe' }).click()
    await expect(page).toHaveURL(`${origin}app/recipes/new`)
    await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeVisible()
    await expect(note).toHaveCount(0)
    await page.waitForTimeout(80)
    assert.deepEqual(errors, [], `${width}px route change during dialogue: ${errors.join('; ')}`)
    assert.ok(apiRequests.every(({ method, path }) => method === 'GET' && ['/auth/v1/user', '/functions/v1/recipes'].includes(path)))
    await page.goto(`${origin}app/recipes`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(note).toBeVisible()
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth), true, `${width}px overflow with Mori's note`)
    const noteBox = await note.boundingBox()
    const bookBox = await page.locator('.mm-journal-book').boundingBox()
    assert.ok(noteBox && bookBox && noteBox.y >= bookBox.y + bookBox.height, `${width}px note must remain in normal document flow beside the journal without crowding its pages`)
    if (width === 320) {
      await note.locator('.mm-mori-dialogue__text').evaluate((element) => { element.textContent = 'Long journal note '.repeat(110) })
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth), true, 'Long note should wrap at 320px')
    }
    await context.close()
    process.stdout.write(`${width}px: optional dialogue, keyboard, focus recovery, route unmount, no network writes, and no obstruction passed.\n`)
  }

  const emptyApp = await createJournal(390, { empty: true })
  await emptyApp.page.goto(`${origin}app/recipes`)
  await expect(emptyApp.page.getByRole('heading', { name: 'A fresh page for your next favorite.' })).toBeVisible()
  await emptyApp.page.getByRole('button', { name: 'Open a note from Mori' }).click()
  await expect(emptyApp.page.getByText(/fresh page is ready for a recipe you love/)).toBeVisible()
  await emptyApp.page.getByRole('button', { name: 'Write your first recipe' }).click()
  await expect(emptyApp.page).toHaveURL(`${origin}app/recipes/new`)
  assert.ok(emptyApp.apiRequests.every(({ method, path }) => method === 'GET' && ['/auth/v1/user', '/functions/v1/recipes'].includes(path)))
  assert.deepEqual(emptyApp.errors, [])
  await emptyApp.context.close()

  const reducedApp = await createJournal(1440, { reducedMotion: true })
  await reducedApp.page.goto(`${origin}app/recipes`)
  await expect(reducedApp.page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
  await reducedApp.page.getByRole('button', { name: 'Open a note from Mori' }).click()
  await expect(reducedApp.page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(reducedApp.page.getByRole('button', { name: 'Show full message' })).toHaveCount(0)
  const reducedMotionName = await reducedApp.page.locator('.mm-mori-dialogue').evaluate((element) => globalThis.getComputedStyle(element).animationName)
  assert.equal(reducedMotionName, 'none')
  // Reflow equivalent to 200%; native zoom is covered by journal-zoom.browser.mjs.
  await reducedApp.page.setViewportSize({ width: 720, height: 450 })
  await settleJournalLayout(reducedApp.page)
  await reducedApp.page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
  assert.equal(await reducedApp.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth), true, '200% zoom should not cause horizontal overflow')
  await reducedApp.page.getByRole('button', { name: "Close Mori's note" }).click()
  assert.deepEqual(reducedApp.errors, [])
  assert.ok(reducedApp.apiRequests.every(({ method, path }) => method === 'GET' && ['/auth/v1/user', '/functions/v1/recipes'].includes(path)))
  await reducedApp.context.close()
  process.stdout.write(`Empty guidance, reduced motion, and 200% zoom passed. All observed API calls were read-only auth/recipe GETs. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
