// Isolated browser acceptance: synthetic auth and intercepted REST responses.
// This script never contacts a hosted Supabase project.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const apiOrigin = 'https://fe07.example.test'
const userId = '11111111-1111-4111-8111-111111111111'
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'moris-fe07-browser-'))
const server = await createServer({
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  configFile: false,
  envDir: false,
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('browser-test-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
})
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1280, 375, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const recipeRequests = []
    let nextAttempts = 0
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const recipes = Array.from({ length: 25 }, (_, index) => ({
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      user_id: userId, title: `Browser test recipe ${index + 1}`,
      star_rating: 4, cooked_at: '2026-10-25',
    }))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) {
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
        return route.continue()
      }
      assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'browser-test@example.test' } })
      assert.equal(url.pathname, '/functions/v1/recipes')
      assert.equal(route.request().method(), 'GET')
      assert.match(route.request().headers().authorization, /^Bearer /)
      assert.equal(url.searchParams.get('limit'), '24')
      assert.deepEqual([...url.searchParams.keys()].sort(), ['limit', 'offset'])
      recipeRequests.push(url.search)
      if (url.searchParams.get('offset') === '0') return route.fulfill({ json: { recipes: recipes.slice(0, 24) } })
      assert.equal(url.searchParams.get('offset'), '24')
      nextAttempts++
      if (nextAttempts === 1) return route.fulfill({ status: 422, json: { error: { code: 'TEST_FAILURE', message: 'Isolated page failure' } } })
      // A shifted offset page overlaps an earlier card; the UI must deduplicate.
      return route.fulfill({ json: { recipes: [recipes[23], recipes[24]] } })
    })
    await page.addInitScript(({ userId }) => {
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const user = { id: userId, aud: 'authenticated', email: 'browser-test@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
      globalThis.localStorage.setItem('sb-fe07-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { userId })
    await page.goto(`${origin}app`)
    await page.getByRole('heading', { name: 'Saved recipes (24)' }).waitFor()
    assert.equal(await page.getByRole('searchbox', { name: 'Search recipes' }).isDisabled(), true)
    assert.equal(await page.getByRole('option', { name: 'Rating (unavailable)' }).evaluate((element) => element.disabled), true)
    await page.getByRole('combobox', { name: 'Sort recipes' }).focus()
    assert.equal(await page.getByRole('combobox', { name: 'Sort recipes' }).evaluate((element) => element === globalThis.document.activeElement), true)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Overflow at ${width}px`)
    await page.screenshot({ path: path.join(outputDir, `${width}-initial.png`) })
    await page.getByRole('button', { name: 'Load more' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'Could not load more' }).waitFor()
    const retryButton = page.getByRole('button', { name: 'Retry loading more' })
    assert.equal(await retryButton.evaluate((element) => element === globalThis.document.activeElement), true)
    assert.equal(await page.locator('.recipe-grid > li').count(), 24)
    await page.keyboard.press('Enter')
    await page.getByText('End of results.', { exact: true }).waitFor()
    assert.equal(await page.getByText('End of results.').evaluate((element) => element === globalThis.document.activeElement), true)
    assert.equal(await page.locator('.recipe-grid > li').count(), 25)
    assert.equal(await page.getByRole('button', { name: 'Load more' }).count(), 0)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
    assert.deepEqual(recipeRequests, ['?limit=24&offset=0', '?limit=24&offset=24', '?limit=24&offset=24'])
    await page.screenshot({ path: path.join(outputDir, `${width}-complete.png`), fullPage: true })
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.waitForURL('**/login')
    assert.equal(await page.locator('.recipe-card').count(), 0)
    assert.deepEqual(pageErrors, [])
    process.stdout.write(`${width}px: layout, unavailable controls, keyboard pagination, failure/retry, deduplication, end state and logout passed.\n`)
    await context.close()
  }
  process.stdout.write(`Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
