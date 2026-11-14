// Compare the unmodified local Make app and production routes at identical
// viewports. Prototype storage is confined to the reference browser context.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { chromium, expect as baseExpect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalGeometry, settleJournalLayout } from './journal-geometry.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'
import { assertReferencePrerequisites } from './reference-prerequisites.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const referenceRoot = path.resolve(root, '../../figma-make-reference')
await assertReferencePrerequisites(referenceRoot)
const phase = process.argv[2] ?? 'after'
assert.ok(['before', 'after'].includes(phase))
const output = path.join(root, 'test-results/ui01-step1')
await mkdir(path.join(output, phase), { recursive: true })
await mkdir(path.join(output, 'reference'), { recursive: true })
const expect = baseExpect.configure({ timeout: 30_000 })
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const user = { id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
const recipe = { ...fixture, user_id: user.id }
const referenceRecipe = {
  id: recipe.id, ownerId: user.id, title: recipe.title,
  ingredients: recipe.ingredients.map((item) => `${item.name} ${item.quantity_text ?? item.quantity ?? ''} ${item.unit ?? ''}`.trim()),
  steps: recipe.instructions.map((step) => typeof step === 'string' ? step : step.text),
  rating: recipe.star_rating ?? null, cookedOn: recipe.cooked_at ?? '', notes: recipe.notes ?? '', photo: null,
  createdAt: recipe.created_at ?? user.created_at, updatedAt: recipe.updated_at ?? user.created_at,
}
const apiOrigin = 'https://step1-journal.example.test'
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-step1-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  }, server: { host: '127.0.0.1', port: 0 },
})
// The archive lacks Make's managed .figma config. Supply only the original
// React/Tailwind build plugins; no source file or layout style is modified.
const referenceImport = (name) => import(pathToFileURL(path.join(referenceRoot, `node_modules/${name}`)).href)
const [{ createServer: createReferenceServer }, { default: referenceReact }, { default: tailwind }] = await Promise.all([
  referenceImport('vite/dist/node/index.js'), referenceImport('@vitejs/plugin-react/dist/index.js'), referenceImport('@tailwindcss/vite/dist/index.mjs'),
])
const referenceServer = await createReferenceServer({ root: referenceRoot, configFile: false, plugins: [referenceReact(), tailwind()], logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })

async function measure(page, reference = false) {
  return page.evaluate((reference) => {
    const select = (production, original) => globalThis.document.querySelector(reference ? original : production)
    const rect = (element) => {
      if (!element || globalThis.getComputedStyle(element).display === 'none') return null
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    const book = select('.mm-journal-book', '.book-stage')
    const spread = select('.mm-journal-spread', '.spread-frame')
    const left = select('.mm-journal-flyleaf', '.page--left')
    const right = select('.mm-journal-page', '.page--right, .page--single')
    const paper = reference ? right : (globalThis.getComputedStyle(spread).display === 'grid' ? right : spread)
    const paperRect = rect(paper)
    const single = reference ? !!globalThis.document.querySelector('.page--single') : globalThis.getComputedStyle(spread).display !== 'grid'
    const nav = select('.mm-bookmarks', '.bookmarks')
    const style = (element) => {
      const css = globalThis.getComputedStyle(element)
      return { zIndex: css.zIndex, position: css.position, transform: css.transform, fontFamily: css.fontFamily, fontSize: css.fontSize, padding: css.padding, backgroundColor: css.backgroundColor, textDecoration: css.textDecorationLine, overflowY: css.overflowY }
    }
    const tabs = [...nav.querySelectorAll('a, button')].map((tab) => {
      const box = rect(tab)
      const rootPoint = single ? { x: box.x + box.width / 2, y: paperRect.y + 4 } : { x: box.x + 4, y: box.y + box.height / 2 }
      const exposedPoint = single ? { x: box.x + box.width / 2, y: paperRect.y - 12 } : { x: box.right - 16, y: box.y + box.height / 2 }
      const hit = (point) => {
        const target = globalThis.document.elementFromPoint(point.x, point.y)
        return { ...point, target: target?.className?.baseVal ?? target?.className ?? null, tabHit: target === tab || tab.contains(target), paperHit: target === paper || paper.contains(target) }
      }
      return { label: tab.getAttribute('aria-label') ?? tab.textContent, active: tab.getAttribute('aria-current') === 'page', ...box, ...style(tab), rootOffset: single ? box.bottom - paperRect.y : paperRect.right - box.x, protrusion: single ? paperRect.y - box.y : box.right - paperRect.right, root: hit(rootPoint), exposed: hit(exposedPoint) }
    })
    return {
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight, dpr: globalThis.devicePixelRatio },
      layout: single ? 'single' : 'spread', book: rect(book), left: rect(left), right: rect(right), paper: paperRect,
      paperRatio: paperRect.width / paperRect.height,
      spine: rect(single ? select('.mm-journal-ring', '.ring') : select('.mm-journal-ring-plate', '.ring-plate')),
      stacks: [...globalThis.document.querySelectorAll(reference ? '.stack' : '.mm-journal-stack')].map((element) => ({ ...rect(element), ...style(element) })),
      paperStyle: style(paper), leafStyle: style(right), bookmarkStyle: style(nav), tabs,
      ringStyle: style(select('.mm-journal-rings', '.rings') ?? select('.mm-journal-binding', '.rings')),
      ring: { ...rect(select('.mm-journal-ring', '.ring')), shadow: globalThis.getComputedStyle(select('.mm-journal-ring', '.ring')).boxShadow },
      documentWidth: globalThis.document.documentElement.scrollWidth,
    }
  }, reference)
}

async function compareButtons(page, reference) {
  return page.evaluate((reference) => {
    const host = globalThis.document.createElement('div')
    host.className = reference ? '' : 'mm-desk'
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;width:1200px;min-height:0;padding:20px;background:#f8f1e1;display:flex;align-items:flex-start;gap:12px;font:400 16px/1.5 Figtree'
    const variants = [
      ['small', 'btn btn-paper btn-sm', 'button button-secondary mm-button--small', 'Edit'],
      ['standard', 'btn btn-ink', 'button button-primary', 'Save recipe'],
      ['large', 'btn btn-ink btn-lg', 'button button-primary mm-button--large', 'Log in'],
      ['ghost', 'btn btn-ghost btn-sm', 'button mm-button--ghost mm-button--small', 'Remove'],
      ['page-turn', 'dog-ear', 'button mm-button--page-turn', 'Next page →'],
      ['icon', 'icon-btn', 'button mm-button--icon', '×'],
      ['danger', 'btn btn-danger', 'button button-danger', 'Delete'],
      ['sage', 'btn btn-sage', 'mm-button mm-button--sage', 'Save'],
    ]
    globalThis.document.body.append(host)
    const result = variants.map(([name, original, production, text]) => {
      const button = globalThis.document.createElement('button')
      button.className = reference ? original : production
      button.textContent = text
      host.append(button)
      const { width, height } = button.getBoundingClientRect()
      const css = globalThis.getComputedStyle(button)
      return { name, width, height, fontSize: css.fontSize, lineHeight: css.lineHeight, borderRadius: css.borderRadius, padding: css.padding, color: css.color, background: css.backgroundColor, backgroundImage: css.backgroundImage !== 'none', boxShadow: css.boxShadow }
    })
    host.remove()
    return result
  }, reference)
}

let browser
const measurements = []
try {
  await server.listen()
  await referenceServer.listen()
  const origin = server.resolvedUrls.local[0]
  const referenceOrigin = referenceServer.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  async function prepareContexts(context, referenceContext) {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) return route.continue()
      assert.equal(url.origin, apiOrigin)
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
      if (url.pathname === '/functions/v1/recipes') return route.fulfill({ json: { recipes: [recipe], has_more: false, next_cursor: null } })
      if (url.pathname === `/functions/v1/recipes/${recipe.id}`) return route.fulfill({ json: { recipe } })
      return route.fulfill({ status: 404, json: {} })
    })
    await referenceContext.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if ([new URL(referenceOrigin).origin, new URL(origin).origin].includes(url.origin)) return route.continue()
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: ['Figtree', 'Fraunces', 'Caveat'].map((family) => `@font-face{font-family:'${family}';font-weight:300 800;src:url('${origin}src/assets/journal/fonts/${family.toLowerCase()}-latin.woff2') format('woff2')}`).join('\n') })
      return route.abort()
    })
    await context.addInitScript(({ user }) => {
      if (globalThis.sessionStorage.getItem('anonymous')) return
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.signature`
      globalThis.localStorage.setItem('sb-step1-journal-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { user })
    await referenceContext.addInitScript(({ user, recipe }) => {
      globalThis.localStorage.setItem('pans-scraps:db:v3', JSON.stringify({ version: 3, users: [{ id: user.id, name: 'Cook', email: user.email, verified: true, createdAt: user.created_at, password: 'reference-only' }], recipes: [recipe], tokens: [], mail: [], sessionUserId: globalThis.sessionStorage.getItem('anonymous') ? null : user.id }))
    }, { user, recipe: referenceRecipe })
  }
  for (const width of [1440, 1280, 1024, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const referenceContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const original = await referenceContext.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    original.on('pageerror', (error) => errors.push(`reference: ${error.message}`))
    await prepareContexts(context, referenceContext)
    const scenes = [
      ['index', 'app/recipes?view=index', 'journal/index', 'Saved recipes (1)'],
      ['detail', `app/recipes/${recipe.id}`, `journal/scraps/${recipe.id}`, recipe.title],
      ['create', 'app/recipes/new', 'journal/scraps/new', 'A recipe of your own.'],
      ['login', 'login', 'login', 'Welcome back'],
    ]
    for (const [name, route, referenceRoute, heading] of scenes) {
      if (name === 'login') {
        await page.evaluate(() => { globalThis.localStorage.clear(); globalThis.sessionStorage.setItem('anonymous', 'true') })
        await original.evaluate(() => { globalThis.sessionStorage.setItem('anonymous', 'true') })
      }
      await page.goto(`${origin}${route}`)
      await original.goto(`${referenceOrigin}${referenceRoute}`)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expect(original.locator(name === 'login' ? '.auth-card' : '.page, .folio').first()).toBeVisible()
      await Promise.all([page.evaluate(() => globalThis.document.fonts.ready), original.evaluate(() => globalThis.document.fonts.ready)])
      // Wait for the prototype cover and data load to settle without modifying
      // its animation CSS, so the reference is an actual open book.
      if (name !== 'login') {
        await expect(original.locator('.book')).toHaveAttribute('data-cover', 'open')
        if (name !== 'create') await expect(original.getByText(recipe.title, { exact: true }).first()).toBeVisible()
      }
      await page.screenshot({ path: path.join(output, phase, `${width}-${name}.png`), fullPage: true, animations: 'disabled' })
      await original.screenshot({ path: path.join(output, 'reference', `${width}-${name}.png`), fullPage: true, animations: 'disabled' })
      if (name === 'index') {
        const production = await measure(page)
        const reference = await measure(original, true)
        const buttons = await compareButtons(page, false)
        const referenceButtons = await compareButtons(original, true)
        measurements.push({ width, scene: name, production, reference, buttons, referenceButtons })
        await writeFile(path.join(output, phase, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`)
        if (phase === 'after') {
          await assertJournalGeometry(page, `${width}px Step 1`)
          assert.equal(production.layout, reference.layout)
          assert.equal(production.viewport.dpr, 1, '100% browser zoom / DPR 1')
          assert.ok(Math.abs(production.paper.width - reference.paper.width) < 1, 'Source paper width')
          assert.ok(Math.abs(production.paper.height - reference.paper.height) < 1 || width < 541, 'Source paper height')
          assert.ok(Math.abs(production.book.width - reference.book.width) < 1, 'Source book width')
          if (width >= 541) {
            for (const key of ['x', 'y', 'height']) assert.ok(Math.abs(production.book[key] - reference.book[key]) < 1, `Source book ${key}`)
          }
          for (const tab of production.tabs) {
            assert.equal(tab.root.tabHit, false, `${tab.label}: root must be occluded`)
            assert.equal(tab.root.paperHit, true, `${tab.label}: live paper must cover root`)
            assert.equal(tab.exposed.tabHit, true, `${tab.label}: exposed end must receive clicks`)
          }
          for (const button of buttons) {
            const target = referenceButtons.find((item) => item.name === button.name)
            for (const key of ['height', 'fontSize', 'lineHeight', 'borderRadius', 'padding', 'color', 'background', 'backgroundImage', 'boxShadow']) assert.equal(button[key], target[key], `${button.name}: ${key}`)
            assert.ok(Math.abs(button.width - target.width) < 1, `${button.name}: source button width`)
          }
          const bookmarks = page.getByRole('navigation', { name: 'Journal sections' })
          await bookmarks.screenshot({ path: path.join(output, phase, `${width}-bookmarks.png`), animations: 'disabled' })
          const inactive = bookmarks.getByRole('link', { name: 'New recipe', exact: true })
          await inactive.hover()
          await expect(inactive).toHaveCSS('transform', width >= 1100 ? 'matrix(1, 0, 0, 1, -6, 0)' : 'matrix(1, 0, 0, 1, 0, 4)')
          await assertJournalGeometry(page, `${width}px hover`)
          await bookmarks.screenshot({ path: path.join(output, phase, `${width}-bookmarks-hover.png`), animations: 'disabled' })
          await page.mouse.move(0, 0)
          await expect(inactive).toHaveCSS('transform', width >= 1100 ? 'matrix(1, 0, 0, 1, -14, 0)' : 'matrix(1, 0, 0, 1, 0, 8)')
          // Click the buried portion: paper wins and the route stays unchanged.
          await page.mouse.click(production.tabs[1].root.x, production.tabs[1].root.y)
          await expect(page).toHaveURL(`${origin}${route}`)
          // Click the exposed end, then verify the newly active tab is stationary.
          await page.mouse.click(production.tabs[1].exposed.x, production.tabs[1].exposed.y)
          await expect(page).toHaveURL(`${origin}app/recipes/new`)
          await expect(inactive).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
          await page.goto(`${origin}app/recipes`)
          const first = page.getByRole('navigation', { name: 'Journal sections' }).getByRole('link', { name: 'My recipes', exact: true })
          await first.focus()
          await expect(first).toBeFocused()
          assert.notEqual(await first.evaluate((element) => globalThis.getComputedStyle(element).outlineStyle), 'none')
          const next = page.getByRole('navigation', { name: 'Journal sections' }).getByRole('link', { name: 'New recipe', exact: true })
          await next.focus()
          await page.keyboard.press('Enter')
          await expect(page).toHaveURL(`${origin}app/recipes/new`)
          await page.goto(`${origin}app/recipes`)
          await expect(page.getByRole('heading', { name: 'Saved recipes (1)', exact: true })).toBeVisible()
          if (width === 1024) {
            const boundaries = []
            for (const boundary of [1099, 1100, 1024]) {
              await page.setViewportSize({ width: boundary, height: 900 })
              await settleJournalLayout(page)
              await original.setViewportSize({ width: boundary, height: 900 })
              await settleJournalLayout(original, true)
              await expect(page.locator('.mm-journal-spread')).toHaveCSS('display', boundary < 1100 ? 'block' : 'grid')
              await expect(original.locator('.page--single')).toHaveCount(boundary < 1100 ? 1 : 0)
              await Promise.all([page, original].map((view) => view.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))))
              const actual = await measure(page)
              const target = await measure(original, true)
              assert.equal(actual.layout, target.layout, '1100px breakpoint must match the source')
              await assertJournalGeometry(page, `${boundary}px boundary`)
              for (const key of ['width', 'height']) assert.ok(Math.abs(actual.paper[key] - target.paper[key]) < 1, `${boundary}px source ${key}: production ${JSON.stringify(actual.paper)}, reference ${JSON.stringify(target.paper)}`)
              boundaries.push({ width: boundary, production: actual, reference: target })
            }
            await writeFile(path.join(output, 'breakpoint-measurements.json'), `${JSON.stringify(boundaries, null, 2)}\n`)
          }
        }
        process.stdout.write(`${phase} ${width}: ${JSON.stringify({ book: production.book, paper: production.paper, layout: production.layout })}\n`)
      }
      if (phase === 'after') {
        await assertJournalSemantics(page, `${width}px ${name}`)
        if (name === 'detail') {
          await expect(page.getByRole('link', { name: 'Edit recipe', exact: true })).toHaveCSS('min-height', '38px')
          const remove = page.getByRole('button', { name: 'Delete recipe', exact: true })
          await expect(remove).toHaveCSS('min-height', '38px')
          await expect(remove).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          await remove.click()
          const dialog = page.getByRole('alertdialog')
          const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
          await expect(cancel).toBeFocused()
          assert.equal(await cancel.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            const hit = globalThis.document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return element.contains(hit) && !element.closest('.mm-journal-page, .mm-journal-flyleaf')
          }), true, 'Confirmation must escape live paper stacking and receive clicks')
          await cancel.press('Escape')
          await expect(remove).toBeFocused()
        }
        if (name === 'create') {
          if (width < 1100) await page.locator('.mm-writing-turns button').last().click()
          const add = page.getByRole('button', { name: 'Add ingredient', exact: true })
          await expect(add).toHaveCSS('min-height', '38px')
          await expect(page.getByRole('button', { name: 'Save recipe', exact: true })).toHaveCSS('min-height', '44px')
          await add.click()
          const remove = page.getByRole('button', { name: 'Remove ingredient 1', exact: true })
          await expect(remove).toHaveCSS('width', '40px')
          await expect(remove).toHaveCSS('height', '40px')
          await expect(remove).toHaveCSS('border-radius', '999px')
          await remove.click()
        }
        if (name === 'login') await expect(page.locator('.mm-auth-card .button-primary').first()).toHaveCSS('min-height', '52px')
      }
    }
    assert.deepEqual(errors, [])
    await context.close()
    await referenceContext.close()
  }
  if (phase === 'after') {
    const zoomMeasurements = []
    for (const width of [1440, 1280]) {
      const contexts = []
      try {
        for (const kind of ['production', 'reference']) {
          const profile = await mkdtemp(path.join(os.tmpdir(), `moris-step1-${kind}-zoom-`))
          await mkdir(path.join(profile, 'Default'))
          await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }))
          contexts.push(await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: null, reducedMotion: 'reduce', args: [`--window-size=${width},900`, '--force-device-scale-factor=1'] }))
        }
        await prepareContexts(contexts[0], contexts[1])
        const results = []
        for (const index of [0, 1]) {
          const page = await contexts[index].newPage()
          await page.goto(index === 0 ? `${origin}app/recipes?view=index` : `${referenceOrigin}journal/index`)
          if (index === 0) await expect(page.getByRole('heading', { name: 'Saved recipes (1)', exact: true })).toBeVisible()
          else {
            await expect(page.locator('.book')).toHaveAttribute('data-cover', 'open')
            await expect(page.getByText(recipe.title, { exact: true }).first()).toBeVisible()
          }
          await page.evaluate(() => globalThis.document.fonts.ready)
          const result = await measure(page, index === 1)
          assert.equal(result.viewport.dpr, 2, 'Native 200% DPR')
          assert.ok(result.viewport.width <= width / 2, 'Native zoom must reduce the CSS viewport')
          assert.equal(result.documentWidth, result.viewport.width, 'Native 200% horizontal containment')
          if (index === 0) {
            await assertJournalGeometry(page, `${width} native 200%`)
            await assertJournalSemantics(page, `${width} native 200%`)
          }
          results.push(result)
          // Native zoom screenshot coordinates use device-independent metrics.
          const cdp = await contexts[index].newCDPSession(page)
          const { contentSize } = await cdp.send('Page.getLayoutMetrics')
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...contentSize, scale: 1 } })
          await writeFile(path.join(output, index === 0 ? phase : 'reference', `${width}-native-200-index.png`), Buffer.from(data, 'base64'))
        }
        for (const key of ['width', 'height', 'x', 'y']) assert.ok(Math.abs(results[0].paper[key] - results[1].paper[key]) < 1, `Native 200% source paper ${key}`)
        zoomMeasurements.push({ width, production: results[0], reference: results[1] })
      } finally { for (const context of contexts) await context.close() }
    }
    await writeFile(path.join(output, 'native-zoom-measurements.json'), `${JSON.stringify(zoomMeasurements, null, 2)}\n`)
    process.stdout.write('Native 200% production/reference geometry matched at 1440×900 and 1280×900.\n')
  }
  await writeFile(path.join(output, phase, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`)
  await writeFile(path.join(output, 'comparison.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>UI-01 Step 1 evidence</title><style>body{font:16px system-ui;background:#f8f1e1;color:#2b211b;margin:24px}label{margin-right:24px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}img{width:100%}figure>a{display:block;aspect-ratio:1440/900;overflow:hidden}figure{margin:20px 0}select{font:inherit;padding:8px}a{color:inherit}@media(max-width:800px){main{grid-template-columns:1fr}}</style><h1>UI-01 Step 1 · matching scene comparison</h1><p>Unmodified local Make source and production before/after at the same viewport, with the same single recipe fixture mapped to each app's schema. Reference-only mock storage never enters production. Reference web fonts are served from the same bundled font files for reproducibility. The production detail/editor compositions remain outside Step 1. Images are actual browser renders, not pixel-equivalence claims. Each gallery frame shows the first 900 viewport pixels; linked PNGs retain the full-page capture.</p><label>Width <select id="width">${[1440,1280,1024,390].map((width) => `<option>${width}</option>`).join('')}</select> × 900</label><label>Scene <select id="scene">${['index','detail','create','login'].map((name) => `<option>${name}</option>`).join('')}</select></label><main>${['reference','before','after'].map((phase) => `<figure><figcaption>${phase}</figcaption><a id="${phase}-link"><img id="${phase}" alt="${phase} journal render"></a></figure>`).join('')}</main><p><a href="before/measurements.json">Before measurements</a> · <a href="after/measurements.json">After and source measurements</a></p><script>const width=document.querySelector('#width'),scene=document.querySelector('#scene');function update(){for(const phase of ['reference','before','after']){const src=phase+'/'+width.value+'-'+scene.value+'.png';document.getElementById(phase).src=src;document.getElementById(phase+'-link').href=src;document.getElementById(phase+'-link').style.aspectRatio=width.value+'/900'}}width.onchange=scene.onchange=update;update()</script></html>\n`)
} finally {
  await browser?.close()
  await server.close()
  await referenceServer.close()
}
