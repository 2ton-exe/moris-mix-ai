// Real route compositions; isolated synthetic sessions and existing API fixtures.
// Prototype storage and schema mapping belong exclusively to the reference app.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { chromium, expect as baseExpect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalGeometry, settleJournalLayout } from './journal-geometry.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const referenceRoot = path.resolve(root, '../../figma-make-reference')
const output = path.join(root, 'test-results/ui01-step2')
const phase = process.argv[2] ?? 'after'
assert.ok(['before', 'after'].includes(phase))
await mkdir(path.join(output, phase), { recursive: true })
await mkdir(path.join(output, 'reference'), { recursive: true })
const expect = baseExpect.configure({ timeout: 20_000 })
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const user = { id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: { name: 'Cook' }, created_at: '2026-10-25T00:00:00Z' }
// Repeated copies of the real fixture exercise density. Never shipped as app data.
const recipes = Array.from({ length: 6 }, (_, i) => ({ ...fixture, id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`, user_id: user.id, created_at: `2026-10-${String(30 - i).padStart(2, '0')}T00:00:00Z` }))
const originalRecipes = recipes.map((recipe) => ({
  id: recipe.id, ownerId: user.id, title: recipe.title,
  ingredients: recipe.ingredients.map((item) => [item.quantity_text ?? item.quantity, item.unit, item.name].filter((v) => v != null).join(' ')),
  steps: recipe.instructions.map((step) => typeof step === 'string' ? step : step.text),
  rating: recipe.star_rating, cookedOn: recipe.cooked_at, notes: recipe.notes ?? '', photo: null,
  createdAt: recipe.created_at, updatedAt: recipe.created_at,
}))
const apiOrigin = 'https://step2-journal.example.test'
const server = await createServer({ root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error', define: {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-step2-public-key'),
  'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
  'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
}, server: { host: '127.0.0.1', port: 0 } })
const referenceImport = (name) => import(pathToFileURL(path.join(referenceRoot, `node_modules/${name}`)).href)
const [{ createServer: createOriginalServer }, { default: originalReact }, { default: tailwind }] = await Promise.all([
  referenceImport('vite/dist/node/index.js'), referenceImport('@vitejs/plugin-react/dist/index.js'), referenceImport('@tailwindcss/vite/dist/index.mjs'),
])
const referenceServer = await createOriginalServer({ root: referenceRoot, configFile: false, plugins: [originalReact(), tailwind()], logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
const measurements = []
let browser
try {
  await server.listen()
  await referenceServer.listen()
  const origin = server.resolvedUrls.local[0]
  const referenceOrigin = referenceServer.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1440, 1280, 1024, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const referenceContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const requests = []
    let cursorMode = false
    let failCursorOnce = true
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) return route.continue()
      assert.equal(url.origin, apiOrigin)
      requests.push(url.pathname + url.search)
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
      if (url.pathname === '/functions/v1/demo-recipe') return route.fulfill({ json: { recipe: fixture } })
      if (url.pathname === '/functions/v1/recipes') {
        if (cursorMode) {
          const cursor = url.searchParams.get('cursor')
          if (cursor === 'fixture-cursor-1' && failCursorOnce) {
            failCursorOnce = false
            return route.fulfill({ status: 422, json: { error: { code: 'TEST_CURSOR_FAILURE', message: 'Isolated cursor failure' } } })
          }
          const offset = cursor === 'fixture-cursor-2' ? 4 : cursor === 'fixture-cursor-1' ? 2 : 0
          return route.fulfill({ json: { recipes: recipes.slice(offset, offset + 2), has_more: offset < 4, next_cursor: offset < 4 ? `fixture-cursor-${offset / 2 + 1}` : null } })
        }
        return route.fulfill({ json: { recipes, has_more: false, next_cursor: null } })
      }
      const record = recipes.find((recipe) => url.pathname === `/functions/v1/recipes/${recipe.id}`)
      if (record) return route.fulfill({ json: { recipe: record } })
      return route.fulfill({ status: 404, json: {} })
    })
    await referenceContext.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if ([new URL(referenceOrigin).origin, new URL(origin).origin].includes(url.origin)) return route.continue()
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: ['Figtree', 'Fraunces', 'Caveat'].map((family) => `@font-face{font-family:'${family}';font-weight:300 800;src:url('${origin}src/assets/journal/fonts/${family.toLowerCase()}-latin.woff2') format('woff2')}`).join('\n') })
      return route.abort()
    })
    await context.addInitScript(({ user }) => {
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.signature`
      globalThis.localStorage.setItem('sb-step2-journal-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { user })
    await referenceContext.addInitScript(({ user, recipes }) => {
      globalThis.localStorage.setItem('pans-scraps:db:v3', JSON.stringify({ version: 3, users: [{ id: user.id, name: 'Cook', email: user.email, verified: true, createdAt: user.created_at, password: 'reference-only' }], recipes, tokens: [], mail: [], sessionUserId: user.id }))
    }, { user, recipes: originalRecipes })
    const page = await context.newPage()
    const original = await referenceContext.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const scenes = [
      ['collection-first', 'app/recipes', 'journal/scraps'],
      ['collection-next', `app/recipes?leaf=${width < 600 && phase === 'before' ? 2 : 3}`, 'journal/scraps'],
      ['detail', `app/recipes/${recipes[0].id}`, `journal/scraps/${recipes[0].id}`],
      ['create', 'app/recipes/new', 'journal/scraps/new'],
      ['edit', `app/recipes/${recipes[0].id}/edit`, `journal/scraps/${recipes[0].id}/edit`],
      ['index', 'app/recipes?view=index', 'journal/index'],
      // Make has no equivalent public reading route: use its detail composition
      // with the same fixture, explicitly labelled as a composition reference.
      ['demo', 'demo-recipe', `journal/scraps/${recipes[0].id}`],
    ]
    for (const [name, route, referenceRoute] of scenes) {
      await page.goto(origin + route)
      await original.goto(referenceOrigin + referenceRoute)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expect(original.locator('.book')).toHaveAttribute('data-cover', 'open')
      if (name === 'create' || name === 'edit') await expect(page.getByLabel('Recipe title', { exact: true })).toBeVisible()
      else await expect(page.locator('[data-recipe-id], .mm-recipe-artwork').first()).toBeVisible()
      if (name === 'collection-next') {
        await original.getByRole('button', { name: 'Turn to older scraps' }).click()
        if (width < 1100) await original.getByRole('button', { name: 'Turn to older scraps' }).click()
        await expect(original.locator('.collection-page')).toHaveCount(width >= 1100 ? 2 : 1)
      }
      await Promise.all([page.evaluate(() => globalThis.document.fonts.ready), original.evaluate(() => globalThis.document.fonts.ready)])
      await page.screenshot({ path: path.join(output, phase, `${width}-${name}.png`), fullPage: true, animations: 'disabled' })
      await original.screenshot({ path: path.join(output, 'reference', `${width}-${name}.png`), fullPage: true, animations: 'disabled' })
      if (phase === 'after') {
        const geometry = await assertJournalGeometry(page, `${width} ${name}`)
        await assertJournalSemantics(page, `${width} ${name}`)
        const composition = await page.evaluate(() => ({
          leftEntries: globalThis.document.querySelectorAll('.mm-journal-flyleaf [data-recipe-id]').length,
          rightEntries: globalThis.document.querySelectorAll('.mm-journal-page [data-recipe-id]').length,
          leaves: [...globalThis.document.querySelectorAll('.mm-journal-flyleaf, .mm-journal-page')].map((e) => ({ height: e.clientHeight, content: e.scrollHeight, overflow: globalThis.getComputedStyle(e).overflowY })),
          scrollRegions: [...globalThis.document.querySelectorAll('.mm-page-body')].map((e) => ({ height: e.clientHeight, content: e.scrollHeight, overflow: globalThis.getComputedStyle(e).overflowY })),
        }))
        measurements.push({ width, name, geometry, composition })
        if (name === 'collection-first' && width >= 1100) {
          assert.equal(composition.leftEntries, 0)
          assert.equal(composition.rightEntries, 2)
          await expect(page.locator('.mm-bookplate')).toBeVisible()
        }
        if (name === 'collection-next' && width >= 1100) {
          assert.equal(composition.leftEntries, 2)
          assert.equal(composition.rightEntries, 2)
        }
        if (name === 'create' || name === 'edit') {
          assert.equal(await page.locator('form.recipe-form').count(), 1)
          const identityPage = width < 1100 ? '.mm-journal-page' : '.mm-journal-flyleaf'
          for (const label of ['Recipe title', 'Cooked date', 'Rating', 'Notes']) {
            assert.equal(await page.getByLabel(label, { exact: true }).evaluate((e, selector) => !!e.closest(selector) && e.form === globalThis.document.querySelector('form.recipe-form'), identityPage), true)
          }
          await expect(page.getByRole('button', { name: name === 'create' ? 'Save recipe' : 'Save changes', exact: true })).toBeInViewport()
        }
      }
    }
    if (phase === 'after' && width === 1440) {
      cursorMode = true
      await page.goto(origin + 'app/recipes?view=collection&q=pasta&sort=rating')
      await expect(page.locator('[data-recipe-id]')).toHaveCount(2)
      await page.getByRole('link', { name: 'Next page →' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Could not load more recipes' })).toBeVisible()
      await page.getByRole('link', { name: '← Previous page' }).click()
      await expect(page.locator(`[data-recipe-id="${recipes[0].id}"]`)).toBeVisible()
      await page.getByRole('link', { name: 'Next page →' }).click()
      await page.getByRole('button', { name: 'Retry loading more' }).click()
      await expect(page.locator(`[data-recipe-id="${recipes[5].id}"]`)).toBeVisible()
      await expect(page.locator('[data-recipe-id]')).toHaveCount(4)
      const selected = page.locator(`[data-recipe-id="${recipes[3].id}"]`)
      await selected.click()
      await expect(page.getByRole('heading', { level: 1, name: fixture.title })).toBeVisible()
      await page.goBack()
      await expect(selected).toBeFocused()
      const returnURL = page.url()
      await page.reload()
      await expect(selected).toBeVisible()
      assert.equal(page.url(), returnURL, 'direct unloaded spread keeps its URL')
      await page.getByRole('link', { name: 'Search & index' }).click()
      await expect(page.getByRole('searchbox')).toHaveValue('pasta')
      await expect(page.getByRole('combobox', { name: 'Sort recipes' })).toHaveValue('rating')
      await page.getByRole('link', { name: 'My scraps', exact: true }).click()
      await page.setViewportSize({ width: 390, height: 900 })
      await settleJournalLayout(page)
      await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
      await expect(page.locator('[data-recipe-id]')).toHaveCount(1)
      await expect(selected).toBeVisible()
      assert.equal(page.url(), returnURL, 'resize keeps the recipe anchor and criteria')
      await assertJournalGeometry(page, 'collection cursor return at 390')
      await page.setViewportSize({ width: 1440, height: 900 })
      await settleJournalLayout(page)
      await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
      await page.getByRole('link', { name: 'Search & index' }).click()
      const lastIndexCard = page.locator(`[data-recipe-id="${recipes[5].id}"]`)
      await lastIndexCard.click()
      await page.goBack()
      await expect(lastIndexCard).toBeFocused()
      await page.reload()
      await expect(lastIndexCard).toBeFocused()
      await expect(lastIndexCard).toBeInViewport()
      await expect(page.getByRole('searchbox')).toHaveValue('pasta')
      await expect(page.getByRole('combobox', { name: 'Sort recipes' })).toHaveValue('rating')
      assert.ok(requests.filter((url) => url.includes('cursor=fixture-cursor-1')).length >= 3, 'cursor failure, retry and direct reload are exercised')
      process.stdout.write('Collection/index cursor retry, unloaded anchors, selected-card history/reload, criteria and responsive anchor passed.\n')
    }
    assert.deepEqual(errors, [])
    assert.ok(requests.includes('/functions/v1/demo-recipe'), 'public demo still uses its endpoint')
    await context.close()
    await referenceContext.close()
  }
  await writeFile(path.join(output, phase, 'measurements.json'), JSON.stringify(measurements, null, 2))
  const gallery = `<!doctype html><meta charset="utf-8"><title>UI-01 Step 2 comparisons</title><style>body{font:15px system-ui;background:#29251f;color:#f6eedb;margin:24px}section{margin:32px 0}article{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}img{width:100%}a{color:inherit}figure{margin:0}figcaption{padding:10px 0}</style><h1>MORI'S MIX — Step 2 page compositions</h1><p>Original Make / incoming Step 1 / corrected. Same fixture content, viewport and 100% zoom. Repeated fixture copies test collection density only. Demo uses Make's detail as its reading composition reference; Make has no equivalent public route. Production retains authoritative structured fields and flavor scores.</p>${[1440,1280,1024,390].flatMap((w) => ['collection-first','collection-next','detail','create','edit','index','demo'].map((scene) => `<section><h2>${w} × 900 — ${scene}</h2><article>${['reference','before','after'].map((kind) => `<figure><figcaption>${kind}</figcaption><a href="${kind}/${w}-${scene}.png"><img loading="lazy" src="${kind}/${w}-${scene}.png"></a></figure>`).join('')}</article></section>`)).join('')}`
  await writeFile(path.join(output, 'comparison.html'), gallery)
  process.stdout.write(`Step 2 ${phase}: matching scenes captured at all four widths.\n`)
} finally {
  await browser?.close()
  await server.close()
  await referenceServer.close()
}
