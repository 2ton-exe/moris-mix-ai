// Real reading routes, intercepted authoritative responses; no service writes.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalGeometry, settleJournalLayout } from './journal-geometry.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'
import { settleReadingPages } from './reading-pages.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'test-results/ui01-step3a')
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const user = { id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
const ingredient = (index) => ({ name: `Ingredient ${index + 1} ${'whole fresh tomatoes '.repeat(2)}`, quantity: null, unit: null, inferred: false })
const instruction = (index) => ({ step: index + 1, text: `Step ${index + 1}. ${'Stir gently and taste before serving. '.repeat(4)}` })
const cases = [
  { ...fixture, title: 'Short recipe', ingredients: [ingredient(0)], instructions: [{ step: 1, text: 'Serve.' }], notes: null, flavor_scores: null },
  { ...fixture, title: 'Many ingredients', ingredients: Array.from({ length: 36 }, (_, i) => ingredient(i)) },
  { ...fixture, title: 'Many steps', instructions: Array.from({ length: 25 }, (_, i) => instruction(i)).reverse() },
  { ...fixture, title: 'One enormous instruction', instructions: [{ step: 7, text: `${'An unusually long step stays complete. '.repeat(350)}END OF LONG STEP` }] },
  { ...fixture, title: 'Paragraph notes', notes: Array.from({ length: 21 }, (_, i) => `Note ${i + 1}. ${'Taste as you go. '.repeat(12)}\n\n`).join('') + 'Note 22. Keep the final Windows line ending.\r\n' },
  { ...fixture, title: 'Optional fields', ingredients: [], instructions: [], star_rating: null, cooked_at: null, flavor_scores: null },
  { ...fixture, title: 'A long family recipe title '.repeat(35), notes: 'Complete notes.' },
  { ...fixture, title: 'Mixed content', ingredients: Array.from({ length: 21 }, (_, i) => ingredient(i)), instructions: Array.from({ length: 12 }, (_, i) => instruction(i)), notes: `First paragraph.\n\n${'unbrokennotes'.repeat(400)}\n\nLast paragraph.`, star_rating: 1 },
].map((recipe, index) => ({ ...recipe, id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`, user_id: user.id }))
const apiOrigin = 'https://step3a-journal.example.test'
const server = await createServer({ root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error', define: {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-step3a-key'),
  'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
  'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
}, server: { host: '127.0.0.1', port: 0 } })
let browser
let nativeContext
const measurements = []
const errors = []
let demo = { ...fixture, ingredients: cases[1].ingredients, instructions: cases[2].instructions }
let failDemo = false
const requests = []

async function waitForPageTurn(page) {
  if (await page.evaluate(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)) return
  const layer = page.locator('[data-journal-page-turn]')
  await layer.waitFor({ state: 'attached' })
  await layer.waitFor({ state: 'detached' })
}

async function prepare(context, origin, authenticated = true) {
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === new URL(origin).origin) return route.continue()
    assert.equal(url.origin, apiOrigin)
    requests.push(url.pathname)
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
    if (url.pathname === '/functions/v1/demo-recipe') return failDemo ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { recipe: demo } })
    if (url.pathname === '/functions/v1/recipes') return route.fulfill({ json: { recipes: cases, has_more: false, next_cursor: null } })
    return route.fulfill({ json: { recipe: cases.find((recipe) => url.pathname.endsWith(recipe.id)) ?? cases[0] } })
  })
  if (authenticated) await context.addInitScript(({ user, appOrigin }) => {
    if (globalThis.location.origin !== appOrigin) return
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.test`
    globalThis.localStorage.setItem('sb-step3a-journal-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { user, appOrigin: new URL(origin).origin })
}

async function readRecipe(page, recipe, label, isDemo = false) {
  await settleJournalLayout(page)
  await settleReadingPages(page)
  const scrollingFallback = await page.locator('.mm-continuation.is-fallback').count() > 0
  const viewport = await page.evaluate(() => ({ width: globalThis.innerWidth, height: globalThis.innerHeight, dpr: globalThis.devicePixelRatio, windowWidth: globalThis.outerWidth }))
  await expect(page.getByRole('button', { name: 'Previous Page', exact: true })).toBeDisabled()
  const observed = []
  const dataRequestsBefore = requests.filter((pathname) => pathname.startsWith('/functions/v1/')).length
  let turns = 0
  let fallbacks = 0
  for (; turns < 200; turns++) {
    await assertJournalSemantics(page, `${label} turn ${turns}`)
    const bounds = await page.evaluate(() => {
      const bodies = [...globalThis.document.querySelectorAll('.mm-continuation-body')].filter((body) => body.getBoundingClientRect().height > 0)
      return {
        documentWidth: globalThis.document.documentElement.scrollWidth, width: globalThis.innerWidth,
        bodies: bodies.map((body) => ({ height: body.clientHeight, content: body.scrollHeight, identity: !!body.querySelector('.mm-reading-identity') })),
        footer: globalThis.document.querySelector('.mm-journal-page-footer').getBoundingClientRect().toJSON(),
        book: globalThis.document.querySelector('.mm-journal-book').getBoundingClientRect().toJSON(),
      }
    })
    assert.ok(bounds.documentWidth <= bounds.width, `${label}: horizontal overflow`)
    for (const body of bounds.bodies) if (!body.identity && !scrollingFallback) assert.ok(body.content <= body.height + 2, `${label}: unneeded body scrolling ${JSON.stringify(bounds)}`)
    if (scrollingFallback) {
      await expect(page.getByText('Page space is limited. Scroll this paper to continue reading.')).toBeVisible()
      const body = page.locator('.mm-recipe-reading-body')
      await body.focus()
      assert.ok(await body.evaluate((element) => element.clientHeight > 0))
      await page.keyboard.press('End')
      await expect.poll(() => body.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true)
    }
    if (scrollingFallback && bounds.footer.bottom > bounds.book.bottom + 1) {
      await page.locator('.mm-journal-page-footer').scrollIntoViewIfNeeded()
      const footer = await page.locator('.mm-journal-page-footer').boundingBox()
      assert.ok(footer.y + footer.height <= bounds.book.bottom + 1, `${label}: fallback footer is unreachable`)
    } else assert.ok(bounds.footer.bottom <= bounds.book.bottom + 1, `${label}: footer outside book`)
    observed.push(...await page.locator('.mm-continuation-body [data-unit]').evaluateAll((nodes) => nodes.map((node) => ({ id: node.dataset.unit, text: node.querySelector('.mm-unit-content').textContent }))))
    const regions = page.locator('.mm-continuation-body .mm-unit-fallback .mm-unit-content')
    for (let i = 0; i < await regions.count(); i++) {
      fallbacks++
      const region = regions.nth(i)
      await region.focus()
      await expect(region).toHaveCSS('overflow-y', 'auto')
      await page.keyboard.press('End')
      await expect.poll(() => region.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1), { message: `${label}: fallback end inaccessible by keyboard` }).toBe(true)
    }
    if (turns === 0) await captureReading(page, `${label}-first`)
    const next = page.getByRole('button', { name: 'Next Page', exact: true })
    if (await next.isDisabled()) break
    const previousIndicator = await page.locator('.mm-reading-indicator').textContent()
    await next.click()
    await page.waitForFunction((previous) => globalThis.document.querySelector('.mm-reading-indicator').textContent !== previous, previousIndicator)
    await waitForPageTurn(page)
    if (turns === 0) await captureReading(page, `${label}-continuation`)
  }
  assert.ok(turns < 200)
  assert.equal(new Set(observed.map((unit) => unit.id)).size, observed.length, `${label}: repeated semantic entries`)
  assert.deepEqual(observed.filter((unit) => unit.id.startsWith('ingredient-')).map((unit) => unit.text), recipe.ingredients.map((item) => {
    const amount = item.quantityText ?? [item.quantity, item.unit].filter((part) => part !== null).join(' ')
    return amount ? `${amount} ${item.name}` : item.name
  }), `${label}: complete ordered ingredients`)
  assert.deepEqual(observed.filter((unit) => unit.id.startsWith('instruction-')).map((unit) => unit.text), [...recipe.instructions].sort((a, b) => a.step - b.step).map((step) => `${step.step}${step.text}`), `${label}: complete ordered steps`)
  if (!isDemo && recipe.notes) assert.equal(observed.filter((unit) => unit.id.startsWith('note-')).map((unit) => unit.text).join(''), recipe.notes, `${label}: lossless notes`)
  if (recipe.flavor_scores) for (const [name, score] of Object.entries(recipe.flavor_scores)) assert.ok(observed.find((unit) => unit.id === 'flavors')?.text.includes(`${name}${score} / 5`))
  measurements.push({ label, viewport, turns: turns + 1, units: observed.length, fallbacks, scrollingFallback })
  assert.equal(requests.filter((pathname) => pathname.startsWith('/functions/v1/')).length, dataRequestsBefore, `${label}: reading turns must not fetch backend cursors or recipes`)
}

async function captureReading(page, name) {
  if (await page.evaluate(() => globalThis.devicePixelRatio) !== 2) return page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true })
  const cdp = await page.context().newCDPSession(page)
  const { contentSize } = await cdp.send('Page.getLayoutMetrics')
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...contentSize, scale: 1 } })
  await writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64'))
  await cdp.detach()
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of process.env.READING_WIDTHS?.split(',').map(Number).filter((width) => width > 0) ?? [1440, 1280, 1024, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await prepare(context, origin)
    const page = await context.newPage()
    let testedCases = 0
    for (const [index, recipe] of cases.entries()) {
      if (process.env.READING_CASES && !process.env.READING_CASES.split(',').map(Number).includes(index)) continue
      await page.goto(`${origin}app/recipes/${recipe.id}`)
      await expect(page.getByRole('heading', { name: recipe.title, level: 1 })).toBeVisible()
      await readRecipe(page, recipe, `${width}-case-${index}`)
      await assertJournalGeometry(page, `${width} case ${index}`)
      testedCases++
    }
    // URL anchor, native history, reload, responsive regrouping, and return state.
    await page.goto(`${origin}app/recipes?view=collection&entry=2`)
    await page.getByRole('link', { name: `Open recipe ${cases[2].title}` }).click()
    await page.locator('.mm-continuation.is-measured').waitFor()
    await page.getByRole('button', { name: 'Next Page', exact: true }).click()
    await waitForPageTurn(page)
    const readingUrl = page.url()
    const anchor = new URL(readingUrl).searchParams.get('read')
    await page.goBack()
    await expect(page.getByRole('button', { name: 'Previous Page', exact: true })).toBeDisabled()
    await page.goForward()
    await expect(page.locator(`.mm-continuation-body [data-unit="${anchor}"]`)).toBeVisible()
    await page.reload()
    await page.locator('.mm-continuation.is-measured').waitFor()
    await expect(page.locator(`.mm-continuation-body [data-unit="${anchor}"]`)).toBeVisible()
    await page.setViewportSize({ width: width < 1100 ? 1440 : 390, height: 900 })
    await settleJournalLayout(page)
    await expect(page.locator(`.mm-continuation-body [data-unit="${anchor}"]`)).toBeVisible()
    await page.setViewportSize({ width, height: 900 })
    await settleJournalLayout(page)
    await settleReadingPages(page)
    await expect(page.locator(`.mm-continuation-body [data-unit="${anchor}"]`)).toBeVisible()
    await page.locator('.mm-recipe-reading-body').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForURL((url) => url.href !== readingUrl)
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL(readingUrl)
    await page.getByRole('link', { name: 'Back to recipes', exact: true }).click()
    await expect(page.getByRole('link', { name: `Open recipe ${cases[2].title}` })).toBeFocused()
    await page.goBack()
    await page.locator('.mm-continuation.is-measured').waitFor()
    await expect(page.locator(`.mm-continuation-body [data-unit="${anchor}"]`)).toBeVisible()
    await context.close()
    process.stdout.write(`${width}px: ${testedCases} content cases, complete ordering, bounds, focus, history, reload, anchor resize and collection restoration passed.\n`)
  }
  // Force the observed paper capacity below the pagination threshold while
  // retaining a facing spread, so both boundary keys must scroll the paper.
  const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await prepare(fallbackContext, origin)
  const fallbackPage = await fallbackContext.newPage()
  await fallbackPage.goto(`${origin}app/recipes/${cases[7].id}`)
  await fallbackPage.addStyleTag({ content: '.mm-continuation-body { height: 140px !important; min-height: 140px !important; max-height: 140px !important; }' })
  await fallbackPage.locator('.mm-continuation.is-fallback[data-reading-ready="true"]').waitFor()
  await expect(fallbackPage.getByRole('button', { name: 'Previous Page', exact: true })).toBeDisabled()
  await expect(fallbackPage.getByRole('button', { name: 'Next Page', exact: true })).toBeDisabled()
  const fallbackBody = fallbackPage.locator('.mm-recipe-reading-body')
  await fallbackBody.focus()
  const fallbackUrl = fallbackPage.url()
  await fallbackPage.keyboard.press('PageDown')
  await expect.poll(() => fallbackBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const afterPageDown = await fallbackBody.evaluate((element) => element.scrollTop)
  await fallbackPage.keyboard.press('PageUp')
  await expect.poll(() => fallbackBody.evaluate((element) => element.scrollTop)).toBeLessThan(afterPageDown)
  await expect(fallbackBody).toBeFocused()
  await expect(fallbackPage).toHaveURL(fallbackUrl)
  await fallbackContext.close()
  process.stdout.write('Fallback paper: PageDown/PageUp scroll at both boundaries without navigation or focus loss.\n')

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 900 } })
  await prepare(publicContext, origin, false)
  const publicPage = await publicContext.newPage()
  failDemo = true
  await publicPage.goto(`${origin}demo-recipe`)
  await expect(publicPage.getByRole('alert')).toBeVisible()
  failDemo = false
  await publicPage.getByRole('button', { name: 'Try again' }).click()
  await readRecipe(publicPage, demo, 'public-demo', true)
  await publicPage.getByRole('link', { name: 'Back home', exact: true }).click()
  await expect(publicPage).toHaveURL(`${origin}home`)
  await publicContext.close()

  // Native browser zoom, not CSS zoom or an emulated device scale factor.
  const profile = await mkdtemp(path.join(os.tmpdir(), 'moris-step3a-zoom-'))
  await mkdir(path.join(profile, 'Default'))
  await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }))
  nativeContext = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: null, args: ['--window-size=1440,900', '--force-device-scale-factor=1'] })
  await prepare(nativeContext, origin)
  const zoomPage = await nativeContext.newPage()
  const zoomCdp = await nativeContext.newCDPSession(zoomPage)
  const { windowId } = await zoomCdp.send('Browser.getWindowForTarget')
  // The last two native windows produce 390px and 320px CSS reading widths.
  for (const windowWidth of [1440, 1280, 1024, 796, 656]) {
    await zoomCdp.send('Browser.setWindowBounds', { windowId, bounds: { width: windowWidth, height: 900 } })
    await zoomPage.goto(`${origin}app/recipes/${cases[7].id}`)
    assert.equal(await zoomPage.evaluate(() => globalThis.devicePixelRatio), 2)
    await readRecipe(zoomPage, cases[7], `native-200-${windowWidth}-mixed`)
    await zoomPage.goto(`${origin}demo-recipe`)
    await readRecipe(zoomPage, demo, `native-200-${windowWidth}-demo`, true)
  }
  await zoomCdp.detach()
  assert.ok(requests.includes('/functions/v1/demo-recipe'))
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2))
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI-01 Step 3A reading evidence</title><style>body{font:16px/1.6 system-ui;background:#eee4ce;color:#382a21;margin:24px}section{margin:32px 0}article{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}img{width:100%;height:auto}figure{margin:0}a{color:inherit}</style><h1>Physical recipe continuation</h1><p>Actual Chromium captures of production routes, with isolated sessions and intercepted recipe responses. Native 200% uses browser zoom and unscaled CDP captures. No fixture data is shipped in the app.</p>${measurements.map((entry) => `<section><h2>${entry.label}</h2><p>${entry.turns} reading views; ${entry.units} complete semantic entries; ${entry.scrollingFallback ? 'limited-height paper scrolling fallback' : `${entry.fallbacks} oversized-entry fallbacks`}.</p><article>${['first', ...(entry.turns > 1 ? ['continuation'] : [])].map((view) => `<figure><figcaption>${view}</figcaption><a href="${entry.label}-${view}.png"><img loading="lazy" src="${entry.label}-${view}.png" alt="${entry.label}, ${view}"></a></figure>`).join('')}</article></section>`).join('')}</html>`)
  process.stdout.write('Public demo retry/return and native 200% complete reading passed.\n')
} finally {
  await nativeContext?.close()
  await browser?.close()
  await server.close()
}
