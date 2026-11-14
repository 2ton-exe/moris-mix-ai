// Production routes/components, synthetic auth and intercepted fixture responses.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL, URLSearchParams } from 'node:url'
import { chromium, expect as baseExpect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'
import { assertJournalGeometry, settleJournalLayout } from './journal-geometry.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'test-results', 'physical-journal')
await mkdir(output, { recursive: true })
const expect = baseExpect.configure({ timeout: 30_000 })
const apiOrigin = 'https://expanded-journal.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId }
const user = { id: userId, aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-expanded-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  }, server: { host: '127.0.0.1', port: 0 },
})
let browser
const captures = []
const measurements = []
async function checkFlow(page, label) {
  await assertJournalSemantics(page, label)
  const issues = await page.evaluate(() => {
    const problems = []
    if (globalThis.document.documentElement.scrollWidth > globalThis.innerWidth) {
      problems.push('horizontal overflow')
      for (const element of globalThis.document.querySelectorAll('body *')) {
        const rect = element.getBoundingClientRect()
        if (rect.right > globalThis.innerWidth + 1) problems.push(`${element.className}: right=${rect.right}`)
      }
    }
    for (const element of globalThis.document.querySelectorAll('.mm-journal-page, .mm-journal-flyleaf, .mm-expanded-page')) {
      const style = globalThis.getComputedStyle(element)
      if (style.display === 'none') continue
      if (element.matches('.mm-journal-page:has(.mm-writing-pages)')) {
        const leaf = element.querySelector('.mm-writing-leaf')
        if (!leaf || globalThis.getComputedStyle(leaf).overflowY !== 'auto') problems.push('missing bounded recipe writing leaf')
      } else if (['hidden', 'clip'].includes(style.overflowY)) {
        problems.push(`clipped paper: ${element.className}`)
      }
      const parent = element.getBoundingClientRect()
      for (const child of element.querySelectorAll('a, button, input, select, textarea, li, h1, h2, h3')) {
        if (!child.getClientRects().length || globalThis.getComputedStyle(child).visibility === 'hidden') continue
        const rect = child.getBoundingClientRect()
        if (rect.left < parent.left - 2 || rect.right > parent.right + 2) problems.push(`outside paper: ${child.tagName} ${child.textContent?.slice(0, 45)}`)
      }
    }
    return problems
  })
  assert.deepEqual(issues, [], `${label}: ${issues.join('; ')}`)
}
async function capture(page, width, name) {
  await page.evaluate(() => globalThis.document.fonts.ready)
  await checkFlow(page, `${width}px ${name}`)
  if (await page.locator('.mm-journal-book').count()) {
    await page.evaluate(() => { for (const element of globalThis.document.querySelectorAll('.mm-journal-flyleaf, .mm-journal-page, .mm-journal-spread')) element.scrollTop = 0; globalThis.scrollTo(0, 0) })
    measurements.push({ name, ...await assertJournalGeometry(page, `${width} ${name}`) })
  }
  await page.screenshot({ path: path.join(output, `${width}-${name}.png`), fullPage: true })
  captures.push({ width, name })
}
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720], [1024, 768], [390, 844], [320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const errors = []
    const requests = []
    let paginationTest = false
    let releaseDemo
    let demoGate
    let demoFailure = false
    const testEntries = Array.from({ length: 5 }, (_, index) => ({ ...recipe,
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`, title: `Pagination test entry ${index + 1}`,
    }))
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) return route.continue()
      assert.equal(url.origin, apiOrigin)
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
      if (url.pathname === '/functions/v1/demo-recipe') {
        assert.equal(route.request().method(), 'GET')
        if (demoGate) await demoGate
        if (demoFailure) return route.fulfill({ status: 503, json: {} })
        return route.fulfill({ json: { recipe: fixture } })
      }
      if (url.pathname === '/functions/v1/recipes') {
        requests.push(url.search)
        if (paginationTest) return route.fulfill({ json: url.searchParams.has('cursor')
          ? { recipes: testEntries.slice(4), has_more: false, next_cursor: null }
          : { recipes: testEntries.slice(0, 4), has_more: true, next_cursor: 'server-owned-cursor' } })
        return route.fulfill({ json: { recipes: [recipe], has_more: false, next_cursor: null } })
      }
      if (url.pathname.startsWith('/functions/v1/recipes/')) {
        const id = url.pathname.split('/').at(-1)
        return route.fulfill({ json: { recipe: testEntries.find((entry) => entry.id === id) ?? recipe } })
      }
      return route.fulfill({ status: 404, json: {} })
    })
    await page.addInitScript(({ user, key }) => {
      if (globalThis.localStorage.getItem('acceptance-public')) return
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.signature`
      globalThis.localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { user, key: 'sb-expanded-journal-auth-token' })

    await page.goto(`${origin}app/recipes`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    await capture(page, width, 'journal')
    if (width >= 1280) {
      const geometry = await page.evaluate(() => {
        const box = (selector) => globalThis.document.querySelector(selector).getBoundingClientRect().toJSON()
        return { left: box('.mm-journal-flyleaf'), right: box('.mm-journal-page'), binding: box('.mm-journal-binding'), book: box('.mm-journal-book') }
      })
      assert.ok(Math.abs(geometry.left.width - geometry.right.width) < 1)
      assert.ok(Math.abs(geometry.left.height - geometry.right.height) < 1)
      assert.ok(Math.abs(geometry.binding.x + geometry.binding.width / 2 - geometry.book.x - geometry.book.width / 2) < 1)
      measurements.push({ width, ...geometry })
    }
    await page.getByRole('link', { name: `Open recipe ${recipe.title}` }).click()
    await expect(page.getByRole('heading', { name: recipe.title, level: 1 })).toBeFocused()
    await expect(page.locator('.mm-desk--reading .mm-journal-book')).toBeVisible()
    await capture(page, width, 'recipe-sheet')
    await page.getByRole('link', { name: 'Back to recipes' }).click()
    await expect(page.getByRole('link', { name: `Open recipe ${recipe.title}` })).toBeFocused()
    await page.goBack()
    await expect(page.locator('.mm-desk--reading .mm-journal-book')).toBeVisible()
    await page.goForward()
    await expect(page.locator('.mm-journal-book')).toBeVisible()

    await page.getByRole('link', { name: `Open recipe ${recipe.title}` }).click()
    await page.getByRole('link', { name: 'Edit recipe' }).click()
    await expect(page.getByLabel('Recipe title')).toHaveValue(recipe.title)
    await capture(page, width, 'edit-sheet')
    if (width < 1100) await page.getByRole('button', { name: 'Back to journal', exact: true }).click()
    else await page.getByRole('link', { name: 'Back to journal', exact: true }).click()

    await page.getByRole('link', { name: 'Start a recipe' }).click()
    await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeFocused()
    await capture(page, width, 'create-sheet')
    const title = page.getByLabel('Recipe title')
    await title.fill('Keep this draft through layout changes')
    await page.setViewportSize({ width: width === 320 ? 1280 : 320, height })
    await settleJournalLayout(page)
    await expect(title).toHaveValue('Keep this draft through layout changes')
    await page.setViewportSize({ width, height })
    await settleJournalLayout(page)
    if (width < 1100) await page.getByRole('button', { name: 'Back to journal', exact: true }).click()
    else await page.getByRole('link', { name: 'Back to journal', exact: true }).click()
    const guard = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    await expect(guard.getByRole('button', { name: 'Keep Editing' })).toBeFocused()
    await guard.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(title).toHaveValue('Keep this draft through layout changes')
    await page.goBack()
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Discard Changes' }).click()
    await expect(page.locator('.mm-journal-book')).toBeVisible()

    // Public screens use one existing API fixture, without an authenticated session.
    await page.evaluate(() => { globalThis.localStorage.clear(); globalThis.localStorage.setItem('acceptance-public', 'true') })
    for (const [route, name, heading] of [
      ['home', 'home', 'Good meals deserve a page.'],
      ['about', 'about', 'A place for the meals that become yours.'],
      ['demo-recipe', 'demo-sheet', 'Demonstration recipe'],
      ['unwritten-route', 'fallback', 'This page is still unwritten.'],
      ['login', 'login', 'Welcome back'],
      ['signup', 'signup', 'Create your account'],
      ['verify-email', 'verification', 'Check your email'],
      ['auth/callback', 'callback', 'Check your verification link'],
    ]) {
      await page.goto(`${origin}${route}`)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      if (name === 'demo-sheet') await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible()
      await capture(page, width, name)
      assert.equal(await page.locator('.starter-card').count(), 0)
    }

    if (width === 1440) {
      demoGate = new Promise((resolve) => { releaseDemo = resolve })
      await page.goto(`${origin}demo-recipe`)
      await expect(page.getByRole('status')).toContainText('Loading demonstration recipe')
      await capture(page, width, 'demo-loading')
      demoFailure = true
      releaseDemo()
      demoGate = undefined
      await expect(page.getByRole('alert')).toContainText('Could not load')
      await capture(page, width, 'demo-error')
      demoFailure = false
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible()
      await page.evaluate(() => globalThis.localStorage.removeItem('acceptance-public'))
      paginationTest = true
      await page.goto(`${origin}app/recipes?view=collection&q=test&sort=rating`)
      // First spread has two entries. Opening the next spread requires the
      // opaque cursor even though only four server results are loaded so far.
      await expect(page.locator('[data-recipe-id]')).toHaveCount(2)
      await page.getByRole('link', { name: /Next page/ }).click()
      await expect(page.getByRole('heading', { name: 'Saved recipes (5)' })).toBeVisible()
      await expect(page.getByRole('heading', { name: testEntries[4].title })).toBeVisible()
      assert.ok(requests.some((query) => new URLSearchParams(query).get('cursor') === 'server-owned-cursor'))
      await page.getByRole('link', { name: `Open recipe ${testEntries[2].title}` }).click()
      await page.getByRole('link', { name: 'Back to recipes' }).click()
      await expect(page).toHaveURL(/view=collection&q=test&sort=rating&leaf=2&entry=2$/)
      await expect(page.getByRole('link', { name: `Open recipe ${testEntries[2].title}` })).toBeFocused()
      await page.getByRole('link', { name: 'Search & index' }).click()
      await expect(page.getByRole('searchbox')).toHaveValue('test')
      await expect(page.getByRole('combobox', { name: 'Sort recipes' })).toHaveValue('rating')
      await page.goBack()
      await expect(page.getByRole('heading', { name: testEntries[2].title })).toBeVisible()
      await page.goForward()
      await expect(page.getByRole('heading', { name: 'Recipe index' })).toBeVisible()
      // Stress the preview composition without importing synthetic entries into
      // product screenshots. Full titles remain available in expanded sheets.
      await page.goBack()
      await page.locator(':is(.mm-collection-entry, .mm-index-card) h2').evaluateAll((headings) => {
        for (const heading of headings) heading.textContent = 'An exceptionally long family recipe title kept for every gathering and every season of the year'
      })
      await checkFlow(page, 'two long preview titles')
      await page.reload()
      await expect(page.getByRole('heading', { name: testEntries[2].title })).toBeVisible()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page.locator(':is(.mm-collection-entry, .mm-index-card)').first()).toHaveCSS('transition-property', 'none')
      await page.setViewportSize({ width: 720, height: 450 })
      await settleJournalLayout(page)
      await capture(page, '200-percent', 'journal')
      await page.getByRole('link', { name: `Open recipe ${testEntries[2].title}` }).click()
      await capture(page, '200-percent', 'recipe-sheet')
    }
    assert.deepEqual(errors, [])
    await context.close()
    process.stdout.write(`${width}px: journal, bound reading/writing/demo spreads, return/history, guarded draft, public routes passed.\n`)
  }
  await writeFile(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2))
  for (const name of ['journal', 'detail', 'edit', 'create', 'demo']) captures.push({ width: 'native-200', name })
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mori's Mix: physical journal evidence</title><style>body{background:#f4eddd;color:#39251d;font:16px/1.6 system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:24px}img{width:100%;height:auto}figure{margin:0}a{color:inherit}</style><h1>Physical journal at 100% zoom</h1><p>Actual Chromium captures of production routes. Synthetic session and intercepted existing demonstration fixture. Pagination entries appear only in navigation assertions and the zoom capture. Effective 200% reflow is checked at 720 x 450 CSS pixels. Native-200 images come from journal-zoom.browser.mjs with Chrome browser zoom set to 200% in an isolated 1440 x 900 window.</p><main>${captures.map(({ width, name }) => `<figure><figcaption>${width}: ${name}</figcaption><a href="${width}-${name}.png"><img loading="lazy" src="${width}-${name}.png" alt="${name} at ${width}px"></a></figure>`).join('')}</main></html>`)
  process.stdout.write(`Evidence: ${output}\n`)
} finally {
  await browser?.close()
  await server.close()
}
