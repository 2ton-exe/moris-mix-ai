// Isolated browser acceptance: synthetic auth and intercepted REST responses.
// This script never contacts a hosted Supabase project.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
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
const output = await mkdtemp(path.join(os.tmpdir(), 'mori-collection-layout-'))
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const [width, height] of [[1470, 803], [1633, 892], [1854, 930], [1440, 1050]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    const recipes = Array.from({ length: 5 }, (_, index) => ({
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      user_id: userId, title: index === 2 ? 'Slow roasted tomatoes with garlic and herbs for a weekend family dinner' : `Recipe ${index + 1}`,
      star_rating: index === 0 ? 5 : null, cooked_at: index === 0 ? '2026-10-25' : null,
    }))
    let releaseRecipes
    const recipesReady = new Promise(resolve => { releaseRecipes = resolve })
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
      await recipesReady
      return route.fulfill({ json: { recipes, has_more: false, next_cursor: null } })
    })
    await page.addInitScript(({ userId }) => {
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const user = { id: userId, aud: 'authenticated', email: 'browser-test@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
      globalThis.localStorage.setItem('sb-fe07-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { userId })
    await page.goto(`${origin}app?entry=1`)
    const loadingCard = page.locator('.mm-journal-page .mm-skeleton-card').first()
    await loadingCard.waitFor()
    await page.evaluate(() => globalThis.document.fonts.ready)
    await expect.poll(() => page.locator('.mm-journal-page .recipe-loading ul').evaluate(element => element.getBoundingClientRect().bottom <= element.closest('.mm-page-body').getBoundingClientRect().bottom + 2)).toBe(true)
    const loadingGeometry = await loadingCard.boundingBox()
    const loadingArt = await loadingCard.locator('.mm-recipe-artwork').boundingBox()
    await page.screenshot({ path: path.join(output, `${width}-loading.png`) })
    releaseRecipes()
    await page.getByRole('heading', { name: 'Saved recipes (5)' }).waitFor()
    await page.waitForTimeout(1000)
    const loadedCard = page.locator('.mm-journal-page .mm-collection-entry').first()
    const loadedGeometry = await loadedCard.boundingBox()
    const loadedArt = await loadedCard.locator('.mm-recipe-artwork').boundingBox()
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(loadingGeometry[key] - loadedGeometry[key]) <= 2, `Card ${key} shifts during loading: ${loadingGeometry[key]} → ${loadedGeometry[key]}`)
      assert.ok(Math.abs(loadingArt[key] - loadedArt[key]) <= 2, `Thumbnail ${key} shifts during loading: ${loadingArt[key]} → ${loadedArt[key]}`)
    }

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
    assert.ok(await page.locator('.mm-journal-page .mm-collection-body > .mm-collection-entries > li').count() >= 2, 'Desktop paper must use available height for compact recipes')
    await page.screenshot({ path: path.join(output, `${width}-collection.png`) })
    const corner = page.getByRole('link', { name: /^Next page/ })
    if (await corner.count()) {
      await corner.hover()
      await expect.poll(() => corner.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1')
      await page.screenshot({ path: path.join(output, `${width}-corner-hover.png`) })
    }
    const hover = []
    for (const card of await page.locator('.mm-journal-page .mm-collection-body > .mm-collection-entries .mm-collection-entry').all()) {
      await card.hover()
      await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
      hover.push(await card.evaluate(element => getComputedStyle(element).borderColor))
    }
    assert.equal(new Set(hover).size, 1, 'Recipe scraps share one hover treatment')

    const seen = new Set()
    for (let turn = 0; turn < recipes.length; turn++) {
      const lists = page.locator('.mm-collection-body > .mm-collection-entries')
      for (const list of await lists.all()) {
        const remaining = recipes.length - seen.size
        assert.ok(await list.locator(':scope > li').count() >= Math.min(2, remaining), 'Each desktop leaf must fit multiple ordinary recipes')
        assert.ok(await list.evaluate(e => e.getBoundingClientRect().bottom <= e.parentElement.getBoundingClientRect().bottom + 2), 'Cards must stay above the footer')
        for (const href of await list.locator('a').evaluateAll(elements => elements.map(e => e.getAttribute('href')))) {
          assert.ok(!seen.has(href), `Recipe repeated across pages: ${href}`)
          seen.add(href)
        }
      }
      const next = page.getByRole('link', { name: 'Next page' })
      if (!await next.count()) break
      const target = await next.getAttribute('href')
      await page.evaluate(() => {
        globalThis.__moriSpriteMounts = 0
        globalThis.__moriSpriteObserver = new globalThis.MutationObserver(entries => {
          for (const entry of entries) {
            if (!entry.target.matches?.('[data-mori-paper-actor]')) continue
            globalThis.__moriSpriteMounts += [...entry.addedNodes].filter(node => node.nodeName === 'IMG').length
          }
        })
        globalThis.__moriSpriteObserver.observe(globalThis.document.body, { childList: true, subtree: true })
      })
      await next.click()
      await page.waitForURL(new URL(target, origin).href)
      await expect(page.locator('[data-journal-page-turn="true"]')).toHaveCount(0)
      const spriteMounts = await page.evaluate(() => { globalThis.__moriSpriteObserver.disconnect(); return globalThis.__moriSpriteMounts })
      assert.equal(spriteMounts, 0, 'Pagination must not mount a paper-turning mascot')
    }
    assert.equal(seen.size, recipes.length, 'Every recipe must remain reachable exactly once')
    const visibleLists = page.locator('.mm-collection-body > .mm-collection-entries')
    if (await visibleLists.count() === 2) {
      const tops = await visibleLists.evaluateAll(lists => lists.map(list => list.getBoundingClientRect().top))
      assert.ok(Math.abs(tops[0] - tops[1]) < 2, 'Facing recipe rows must share a baseline')
    }
    globalThis.console.log(`${width}x${height}: stable layout; all five recipes reached exactly once`)
    await context.close()
  }
  globalThis.console.log(`Screenshots: ${output}`)
} finally { await browser?.close(); await server.close() }
