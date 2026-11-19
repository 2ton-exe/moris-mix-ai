// Isolated browser acceptance: synthetic auth and intercepted REST responses.
// This script never contacts a hosted Supabase project.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const apiOrigin = 'https://fe07.example.test'
const userId = '11111111-1111-4111-8111-111111111111'
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
    'import.meta.env.VITE_RECIPE_IMAGES': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
})
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const [width, height] of [[1854, 930], [1440, 1050]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    const recipes = Array.from({ length: 5 }, (_, index) => ({
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      user_id: userId, title: `Recipe ${index + 1}`,
      star_rating: index === 0 ? 5 : null, cooked_at: index === 0 ? '2026-10-25' : null,
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
      return route.fulfill({ json: { recipes, has_more: false, next_cursor: null } })
    })
    await page.addInitScript(({ userId }) => {
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const user = { id: userId, aud: 'authenticated', email: 'browser-test@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
      globalThis.localStorage.setItem('sb-fe07-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { userId })
    await page.goto(`${origin}app?entry=1`)
    await page.getByRole('heading', { name: 'Saved recipes (5)' }).waitFor()
    await page.waitForTimeout(1000)
    const states = await page.evaluate(async () => {
      const samples = []
      for (let i=0;i<120;i++) {
        samples.push(JSON.stringify({heading: !!globalThis.document.querySelector('.mm-journal-page .mm-collection-heading'), height: globalThis.document.querySelector('.mm-journal-page .mm-collection-body')?.clientHeight, lists: [...globalThis.document.querySelectorAll('.mm-collection-body > .mm-collection-entries')].map(e => e.children.length)}))
        await new Promise(globalThis.requestAnimationFrame)
      }
      return [...new Set(samples)]
    })
    assert.equal(states.length, 1, 'Collection must settle instead of stuttering between page layouts')
    const body = page.locator('.mm-journal-page .mm-collection-body')
    assert.ok(await body.evaluate(e => e.scrollHeight <= e.clientHeight + 2), 'Cards must fit the paper')
    await page.goto(`${origin}app?entry=0`)
    await page.getByRole('heading', { name: 'Saved recipes (5)' }).waitFor()
    await page.waitForTimeout(500)
    await expect(page.locator('.mm-journal-page .mm-collection-body > .mm-collection-entries > li')).toHaveCount(2)
    const seen = new Set()
    for (let turn = 0; turn < recipes.length; turn++) {
      const lists = page.locator('.mm-collection-body > .mm-collection-entries')
      for (const list of await lists.all()) {
        const remaining = recipes.length - seen.size
        assert.equal(await list.locator(':scope > li').count(), Math.min(2, remaining), 'Each desktop leaf must fit two ordinary recipes')
        assert.ok(await list.evaluate(e => e.getBoundingClientRect().bottom <= e.parentElement.getBoundingClientRect().bottom + 2), 'Cards must stay above the footer')
        for (const href of await list.locator('a').evaluateAll(elements => elements.map(e => e.getAttribute('href')))) {
          assert.ok(!seen.has(href), `Recipe repeated across pages: ${href}`)
          seen.add(href)
        }
      }
      const next = page.getByRole('link', { name: 'Next page' })
      if (!await next.count()) break
      const target = await next.getAttribute('href')
      await next.click()
      await page.waitForURL(new URL(target, origin).href)
      await expect(page.locator('[data-journal-page-turn="true"]')).toHaveCount(0)
    }
    assert.equal(seen.size, recipes.length, 'Every recipe must remain reachable exactly once')
    globalThis.console.log(`${width}x${height}: stable layout; all five recipes reached exactly once`)
    await context.close()
  }
} finally { await browser?.close(); await server.close() }
