// Isolated browser acceptance: synthetic auth and intercepted REST responses.
// This script never contacts a hosted Supabase project.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const apiOrigin = 'https://fe07.example.test'
const userId = '11111111-1111-4111-8111-111111111111'
const server = await createServer({
  root: await realpath(process.env.MORI_LOADING_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')),
  configFile: false,
  envDir: false,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'react-router'] },
  cacheDir: path.resolve(`frontend/node_modules/.vite-loading-${process.env.MORI_LOADING_PHASE || 'after'}`),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('browser-test-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
    'import.meta.env.VITE_RECIPE_IMAGES': JSON.stringify('true'),
  },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [await realpath(process.env.MORI_LOADING_ROOT || '.'), process.cwd()] } },
  logLevel: 'error',
})
const phase = process.env.MORI_LOADING_PHASE || 'after'
const output = path.resolve('output/playwright/loading-audit', phase)
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile(new URL('../../fixtures/demo-recipe.json', import.meta.url), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId, notes: 'A handwritten cooking note.' }
const recipes = Array.from({ length: 5 }, (_, i) => ({ ...recipe, id: i ? `recipe-${i}` : recipe.id, title: i ? `Tomato rice ${i}` : recipe.title }))
const results = []
let browser
const scenarios = [
  ['collection', '/app', '.mm-journal-page .mm-skeleton-card', '.mm-journal-page .mm-collection-entry:not(.mm-skeleton-card)'],
  ['index', '/app?view=index', '.mm-journal-page .mm-skeleton-card', '.mm-journal-page .mm-index-card:not(.mm-skeleton-card)'],
  ['reading', `/app/recipes/${recipe.id}`, '.mm-reading-skeleton', '.journal-recipe:not(.mm-reading-skeleton)'],
  ['editor', `/app/recipes/${recipe.id}/edit`, '[role="status"]', 'textarea[name="title"]'],
  ['demo', '/demo-recipe', '.mm-reading-skeleton', '.journal-recipe:not(.mm-reading-skeleton)'],
]
async function preparePage(page) {
  await page.addInitScript(({ userId }) => {
        const expires_at = Math.floor(Date.now() / 1000) + 3600
        const user = { id: userId, aud: 'authenticated', email: 'browser-test@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
        const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
        globalThis.localStorage.setItem('sb-fe07-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
        globalThis.__layoutShifts = []
        new globalThis.PerformanceObserver(list => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__layoutShifts.push(entry.value)
        }).observe({ type: 'layout-shift', buffered: true })
      }, { userId })
}
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  globalThis.console.log(`Serving ${phase}: ${origin}`)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const [width, height, motion] of (process.env.MORI_COLD_ONLY === 'true' ? [] : [[1470, 803, 'no-preference'], [1854, 930, 'no-preference'], [1470, 803, 'reduce']])) {
    for (const [name, routePath, pendingSelector, loadedSelector] of scenarios) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion })
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      let release
      let releasePhoto
      let failure = false
      let hold = new Promise(resolve => { release = resolve })
      const photoHold = new Promise(resolve => { releasePhoto = resolve })
      await context.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.origin === new URL(origin).origin) return route.continue()
        assert.equal(url.origin, apiOrigin, 'Only synthetic API requests are allowed')
        if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'browser-test@example.test' } })
        if (url.pathname.endsWith('/recipe-image-download-url')) {
          await photoHold
          return route.fulfill({ status: 404, json: { error: { code: 'IMAGE_NOT_FOUND', message: 'No photo' } } })
        }
        await hold
        if (failure) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Test missing recipe' } } })
        return route.fulfill({ json: url.pathname.endsWith('/recipes') ? { recipes, has_more: false, next_cursor: null } : { recipe } })
      })
      await preparePage(page)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      globalThis.console.log(`Opening ${width}-${motion}-${name}`)
      await page.goto(new URL(routePath, origin).href)
      await page.locator(pendingSelector).first().waitFor({ state: 'attached' }).catch(async error => { await page.screenshot({ path: path.join(output, 'failure.png') }); globalThis.console.log(await page.locator('body').innerText(), errors); throw error })
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 512 * 1024, uploadThroughput: 128 * 1024 })
      await page.evaluate(() => globalThis.document.fonts.ready)
      await page.waitForTimeout(1000)
      await page.evaluate(() => { globalThis.__loadingBook = globalThis.document.querySelector('.mm-journal-book'); globalThis.__layoutShifts = [] })
      const stamp = `${width}-${motion}-${name}`
      await page.screenshot({ path: path.join(output, `${stamp}-loading.png`) })
      if (phase === 'after') {
        const skeleton = page.locator('.mm-journal-spread .mm-skeleton-line').first()
        await expect(skeleton).toBeVisible()
        if (motion === 'reduce') assert.equal(await skeleton.evaluate(e => globalThis.getComputedStyle(e, '::after').animationName), 'none')
        else await expect.poll(() => skeleton.evaluate(e => globalThis.getComputedStyle(e, '::after').animationDuration)).toBe('2.2s')
      }
      release()
      await page.locator(loadedSelector).first().waitFor()
      if (name === 'editor' && motion === 'no-preference') {
        await page.getByText('Loading current recipe image…', { exact: true }).waitFor()
        await page.screenshot({ path: path.join(output, `${stamp}-photo-loading.png`) })
      }
      releasePhoto()
      await page.waitForTimeout(650)
      await page.screenshot({ path: path.join(output, `${stamp}-loaded.png`) })
      const metrics = await page.evaluate(() => ({
        sameBook: globalThis.__loadingBook === globalThis.document.querySelector('.mm-journal-book'),
        cls: globalThis.__layoutShifts.reduce((sum, value) => sum + value, 0),
        overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth || globalThis.document.documentElement.scrollHeight > globalThis.innerHeight + 2,
        actors: globalThis.document.querySelectorAll('[data-mori-paper-actor]').length,
        turning: globalThis.document.querySelectorAll('[data-journal-page-turn="true"]').length,
      }))
      if (phase === 'after') {
        assert.equal(metrics.sameBook, true, `${name}: loading must preserve the shell`)
        assert.equal(metrics.overflow, false, `${name}: document must fit desktop`)
        assert.equal(metrics.actors, 0)
        assert.equal(metrics.turning, 0)
        assert.ok(metrics.cls < .1, `${name}: loading CLS ${metrics.cls}`)
      }
      assert.deepEqual(errors, [])
      results.push({ width, height, motion, name, ...metrics })
      if (name === 'collection' && motion === 'no-preference') {
        hold = new Promise(resolve => { release = resolve })
        const card = page.locator(loadedSelector).first()
        await page.getByRole('button', { name: 'Refresh recipes' }).first().click()
        await expect(card).toBeVisible()
        await expect(page.locator('.mm-skeleton-card')).toHaveCount(0)
        release()
        await page.getByRole('button', { name: 'Refresh recipes' }).first().waitFor()
        // Chapter travel and route commit must not wait for another data request.
        await page.getByRole('link', { name: 'Quick AI Entry', exact: true }).click()
        await expect(page).toHaveURL(/\/app\/quick-entry$/)
        await expect(page.getByRole('heading', { name: 'Quick AI Entry', exact: true }).first()).toBeVisible()
        await expect(page.locator('[data-mori-paper-actor]')).toHaveCount(0)
        await page.getByRole('link', { name: 'My recipes', exact: true }).click()
        await expect(page.locator('.mm-skeleton-card')).toHaveCount(0)
        await expect(card).toBeVisible()
      }
      if (name === 'reading' && motion === 'no-preference') {
        // An interrupted request cannot replace a newer destination.
        hold = new Promise(resolve => { release = resolve })
        globalThis.console.log('Interrupting reading')
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
        await page.goto(new URL('/app/recipes/interrupted', origin).href)
        await page.locator('.mm-reading-skeleton').waitFor()
        globalThis.console.log('Leaving reading')
        await page.getByRole('link', { name: 'AI Chef', exact: true }).click()
        release()
        await expect(page).toHaveURL(/\/app\/chef$/)
        await expect(page.getByRole('heading', { name: 'What’s in your pantry?' })).toBeVisible()
        await expect(page.locator('.mm-reading-skeleton')).toHaveCount(0)
        failure = true
        globalThis.console.log('Checking missing recipe')
        await page.goto(new URL('/app/recipes/missing', origin).href)
        await expect(page.getByRole('alert').first()).toContainText('could not be found')
        await expect(page.locator('.mm-reading-skeleton')).toHaveCount(0)
        await page.screenshot({ path: path.join(output, `${stamp}-missing.png`), animations: 'disabled' })
      }
      release(); releasePhoto()
      await context.close()
      globalThis.console.log(`${stamp}: ${JSON.stringify(metrics)}`)
    }
  }
  if (phase === 'after') {
    const coldRoutes = [
      ['collection', '/app', 'pages/RecipeDashboardPage.tsx'],
      ['home', '/home', 'pages/PublicJournalPages.tsx'],
      ['about', '/about', 'pages/PublicJournalPages.tsx'],
      ['login', '/login', 'pages/AuthPage.tsx'],
      ['signup', '/signup', 'pages/AuthPage.tsx'],
      ['verification', '/verify-email', 'pages/EmailVerificationPage.tsx'],
      ['callback', '/auth/callback', 'pages/EmailVerificationPage.tsx'],
      ['new', '/app/recipes/new', 'pages/CreateRecipePage.tsx'],
      ['notes', '/app/quick-entry', 'quick-ai/QuickAiEntryPage.tsx'],
      ['chef', '/app/chef', 'ai-chef/AIChefPage.tsx'],
      ['notes-review', '/app/quick-entry/review', 'quick-ai/ExtractedRecipeReviewPage.tsx'],
      ['chef-review', '/app/chef/review', 'ai-chef/ChefRecipeReviewPage.tsx'],
      ['revision-sample', '/demo-recipe/try-a-revision', 'pages/RecipeRevisionSamplePage.tsx'],
      ['missing-page', '/missing-page', 'pages/PublicJournalPages.tsx'],
    ]
    for (const [width, height] of [[1470, 803], [1280, 720], [1100, 640]]) {
      for (const [name, routePath, modulePath] of coldRoutes.filter(([name]) => !process.env.MORI_COLD_ROUTES || process.env.MORI_COLD_ROUTES.split(',').includes(name))) {
        const context = await browser.newContext({ viewport: { width, height } })
        const stamp = width === 1470 ? `cold-${name}` : `cold-${name}-${width}`
        const page = await context.newPage()
        if (routePath.startsWith('/app')) await preparePage(page)
        if (name === 'notes-review') await page.addInitScript(({ userId, recipe }) => {
          const notes = 'A handwritten cooking note.'
          globalThis.sessionStorage.setItem(`moris-mix:quick-ai-entry:v1:${userId}`, JSON.stringify({
            notes, blockedUntil: null, blockedReason: null, handoff: { sourceNotes: notes, recipe, saved: false }, reviewDraft: null,
          }))
        }, { userId, recipe: fixture })
        let collectionState = 'populated'
        let releaseModule
        const moduleHold = new Promise(resolve => { releaseModule = resolve })
        let seenModule
        const requested = new Promise(resolve => { seenModule = resolve })
        await context.route('**/*', async route => {
          const url = new URL(route.request().url())
          if (url.origin === new URL(origin).origin) {
            if (url.pathname === '/src/' + modulePath) { seenModule(); await moduleHold }
            return route.continue()
          }
          assert.equal(url.origin, apiOrigin)
          if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'browser-test@example.test' } })
          if (url.pathname.endsWith('/recipe-image-download-url')) return route.fulfill({ status: 404, json: { error: { code: 'IMAGE_NOT_FOUND', message: 'No photo' } } })
          if (name === 'collection' && url.pathname.endsWith('/recipes') && collectionState === 'error') return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Test collection failure' } } })
          return route.fulfill({ json: { recipes: collectionState === 'empty' ? [] : recipes, recipe, has_more: false, next_cursor: null } })
        })
        await page.goto(new URL(routePath, origin).href)
        await requested
        await page.locator('.mm-skeleton-line, .mm-skeleton-block').first().waitFor()
        await page.evaluate(() => globalThis.document.fonts.ready)
        await page.waitForTimeout(200)
        await page.evaluate(() => { globalThis.__coldBook = globalThis.document.querySelector('.mm-journal-book') })
        const measureWritingLayout = (kind) => Object.fromEntries((kind === 'chef' ? [
          ['journey', '.mm-ai-chef__journey'], ['entry', '.mm-ai-chef__entry-panel'], ['input', '.mm-ai-chef__ingredient-entry input'],
          ['quickAdd', '.mm-ai-chef__quick-add summary'], ['heading', '.mm-ai-chef__heading'], ['pantry', '.mm-ai-chef__pantry-list'],
          ['actions', '.mm-ai-chef__footer-actions'],
        ] : kind === 'notes' ? [
          ['guide', '.mm-quick-ai__support'], ['journey', '.mm-quick-ai__journey'], ['example', '.mm-quick-ai__example'],
          ['heading', '.mm-quick-ai-intro--task'], ['back', '.mm-quick-ai__back'], ['sheet', '.mm-quick-ai__sheet'],
          ['notes', '.mm-quick-ai__textarea'], ['metadata', '.mm-quick-ai__field-meta'], ['actions', '.mm-quick-ai__actions'],
        ] : [
          ['title', '.mm-form-identity [name="title"]'], ['date', '.mm-form-identity input[type="date"]'],
          ['rating', '.mm-form-identity .mm-recipe-star-rating__stars'], ['notes', '.mm-form-identity textarea[name="notes"]'],
          ['ingredients', '.mm-form-recipe h2'], ['information', '.mm-form-identity h3'], ['add', '.mm-form-recipe .mm-row-add'],
        ]).map(([name, selector]) => {
          const e = globalThis.document.querySelector(selector)
          return [name, e?.getBoundingClientRect().toJSON()]
        }))
        const loadingWriting = ['new', 'notes', 'chef'].includes(name) ? await page.evaluate(measureWritingLayout, name) : null
        if (name === 'new') {
          await expect(page.locator('.mm-form-identity')).toHaveAttribute('inert', '')
          await expect(page.locator('.mm-form-identity')).toHaveAttribute('aria-hidden', 'true')
          assert.ok(await page.locator('.mm-form-identity textarea').evaluateAll(fields => fields.length === 2 && fields.every(field =>
            globalThis.getComputedStyle(field).animationName.includes('mm-paper-field-light'))), `${stamp}: native field placeholders use the paper shimmer`)
          await page.emulateMedia({ reducedMotion: 'reduce' })
          assert.ok(await page.locator('.mm-form-identity textarea').evaluateAll(fields => fields.every(field =>
            !globalThis.getComputedStyle(field).animationName.includes('mm-paper-field-light'))), `${stamp}: reduced motion disables the paper shimmer`)
          if (width === 1100) await page.screenshot({ path: path.join(output, `${stamp}-loading-reduced.png`), animations: 'disabled' })
          await page.emulateMedia({ reducedMotion: 'no-preference' })
        }
        if (name === 'notes') {
          await expect(page.locator('.mm-quick-ai')).toHaveAttribute('inert', '')
          await expect(page.locator('.mm-quick-ai')).toHaveAttribute('aria-hidden', 'true')
          await expect(page.locator('.mm-quick-ai')).toHaveAttribute('aria-busy', 'true')
          await expect(page.locator('.mm-quick-ai__support').locator('..')).toHaveAttribute('inert', '')
          assert.ok(await page.locator('.mm-quick-ai__sheet').evaluate(e => e.scrollHeight <= e.clientHeight + 1), `${stamp}: empty notes skeleton fits without scrolling`)
        }
        if (name === 'chef') {
          await expect(page.locator('.mm-ai-chef')).toHaveAttribute('inert', '')
          await expect(page.locator('.mm-ai-chef')).toHaveAttribute('aria-hidden', 'true')
          await expect(page.locator('.mm-ai-chef')).toHaveAttribute('aria-busy', 'true')
          await expect(page.locator('.mm-ai-chef__journey').locator('..')).toHaveAttribute('inert', '')
        }
        let loadingReference
        if (name === 'notes-review') {
          const reference = page.locator('.mm-extraction-notes--facing')
          await expect(reference).toHaveAttribute('inert', '')
          await expect(reference).toHaveAttribute('aria-hidden', 'true')
          loadingReference = await reference.boundingBox()
        }
        await page.screenshot({ path: path.join(output, `${stamp}-loading.png`) })
        if (name === 'collection') {
          await page.getByRole('button', { name: 'Talk to Mori' }).click()
          await page.keyboard.press('Escape')
        }
        releaseModule()
        await expect(page.locator('.mm-skeleton-line, .mm-skeleton-block')).toHaveCount(0)
        await page.waitForTimeout(200)
        await page.screenshot({ path: path.join(output, `${stamp}-loaded.png`) })
        if (loadingWriting) {
          const loadedWriting = await page.evaluate(measureWritingLayout, name)
          for (const [field, loading] of Object.entries(loadingWriting)) {
            const loaded = loadedWriting[field]
            for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(loading[dimension] - loaded[dimension]) <= 2, `${stamp}: ${field} ${dimension} shifts when loading completes`)
          }
          if (name === 'new') await expect(page.locator('.mm-form-identity .mm-recipe-star-rating__stars')).toBeVisible()
          if (name === 'notes') assert.ok(await page.locator('.mm-quick-ai__sheet').evaluate(e => e.scrollHeight <= e.clientHeight + 1), `${stamp}: loaded empty notes fit without scrolling`)
        }
        if (loadingReference) {
          const loadedReference = await page.locator('.mm-extraction-notes--facing').boundingBox()
          assert.ok(Math.abs(loadingReference.y - loadedReference.y) <= 2 && Math.abs(loadingReference.height - loadedReference.height) <= 2,
            `${stamp}: loading references must reserve the loaded reference geometry`)
        }
        if (name === 'collection') await expect(page.getByRole('button', { name: 'Talk to Mori' })).toBeFocused()
        if (name === 'collection') {
          collectionState = 'empty'
          await page.getByRole('button', { name: 'Refresh recipes' }).first().click()
          await expect(page.getByRole('heading', { name: 'A fresh page for your next favorite.' })).toBeVisible()
          await page.screenshot({ path: path.join(output, `${stamp}-empty.png`), animations: 'disabled' })
          collectionState = 'error'
          await page.getByRole('button', { name: 'Refresh recipes' }).first().click()
          await expect(page.getByRole('alert').first()).toBeVisible()
          await expect(page.getByRole('heading', { name: 'A fresh page for your next favorite.' })).toHaveCount(0)
          assert.ok(await page.locator('.mm-journal-page .mm-collection-body').evaluate(element => element.scrollHeight <= element.clientHeight + 2), `${stamp}: retry state overflows the paper`)
          await page.screenshot({ path: path.join(output, `${stamp}-error.png`), animations: 'disabled' })
          collectionState = 'populated'
          await page.getByRole('button', { name: 'Try again', exact: true }).click()
          await expect(page.locator('.mm-journal-page .mm-collection-entry').first()).toBeVisible()
        }
        if (name === 'new') {
          assert.ok(await page.locator('.mm-form-identity').evaluate(element => {
            const notes = element.querySelector('textarea[name="notes"]')
            return notes.getBoundingClientRect().top + 25 <= element.getBoundingClientRect().bottom
          }), `${stamp}: notes must show a writing line before the inner scroll boundary`)
        }
        const sameBook = await page.evaluate(() => !globalThis.__coldBook || globalThis.__coldBook === globalThis.document.querySelector('.mm-journal-book'))
        assert.equal(sameBook, true, `${name}: route module loading replaced the notebook`)
        if (name === 'chef') {
          const labels = await page.locator('.mm-ai-chef__journey li').evaluateAll(items => items.map(item => {
            const label = item.lastElementChild
            return { text: label.textContent, display: globalThis.getComputedStyle(item).display, columns: globalThis.getComputedStyle(item).gridTemplateColumns, item: item.getBoundingClientRect().toJSON(), label: label.getBoundingClientRect().toJSON() }
          }))
          await writeFile(path.join(output, `${stamp}-stepper.json`), JSON.stringify(labels, null, 2))
          for (const item of labels) assert.ok(item.label.left >= item.item.left && item.label.right <= item.item.right, `${stamp}: step label overflows: ${item.text}`)
        }
        const geometry = await page.evaluate(() => ({ documentWidth: globalThis.document.documentElement.scrollWidth, documentHeight: globalThis.document.documentElement.scrollHeight }))
        assert.ok(geometry.documentWidth <= width + 2, `${name}: horizontal overflow at ${width}`)
        assert.ok(geometry.documentHeight <= height + 2, `${name}: document overflow at ${width}×${height}: ${geometry.documentHeight}`)
        if (name === 'home' || name === 'about') await assertJournalSemantics(page, name)
        results.push({ name, width, height, coldRoute: routePath, sameBook, ...geometry })
        await context.close()
        globalThis.console.log(`${stamp}: preserved shell`)
      }
    }
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  globalThis.console.log(`Screenshots and metrics: ${output}`)
} finally { await browser?.close(); await server.close() }
