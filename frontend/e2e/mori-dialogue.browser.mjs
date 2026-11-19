// Companion acceptance through the signed-in app with isolated API responses.
// This journey never contacts hosted Supabase or performs recipe mutations.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, firefox, webkit, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { settleJournalLayout } from './journal-geometry.mjs'
import { settleReadingPages } from './reading-pages.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiOrigin = 'https://mori-dialogue.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId, notes: 'A local browser fixture.' }
const chefResponse = {
  recipe: {
    title: 'Rice and egg supper',
    ingredients: [{ name: 'rice', quantity: null, unit: null, inferred: false }, { name: 'egg', quantity: 1, unit: null, inferred: false }],
    instructions: [{ step: 1, text: 'Warm the rice, then fold in the egg.' }],
  },
  substitutions: [], parents: [], candidate_token: null,
  context: { status: 'NO_SAVED_RECIPES', matchedCandidateCount: 0, totalCandidateCount: 0 },
}
const extractionResponse = {
  recipe: {
    title: 'Tomato rice',
    ingredients: [{ name: 'rice', quantity: null, unit: null, inferred: false }],
    instructions: [{ step: 1, text: 'Simmer the rice with tomatoes.' }],
  },
}
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
const measurements = { contactSamples: 0, maxContactPx: 0, maxSpineDriftPx: 0, maxBindingPx: 0 }

async function createJournal(width, { reducedMotion = false, empty = false, chef = false, collection = false, recordVideo = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(recordVideo ? { recordVideo: { dir: path.join(outputDir, 'videos'), size: { width, height: 900 } } } : {}), reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const errors = []
  const apiRequests = []
  let releaseCursor
  let releaseExtraction
  const extractionReady = new Promise((resolve) => { releaseExtraction = resolve })
  let failCursor = false
  const cursorReady = new Promise((resolve) => { releaseCursor = resolve })
  const readingRecipe = { ...recipe, ingredients: Array.from({ length: 60 }, (_, i) => ({ name: `Ingredient ${i + 1}`, quantity: 1, unit: 'cup', inferred: false })) }
  const entries = Array.from({ length: 6 }, (_, i) => ({ id: `collection-${i}`, title: `Saved recipe ${i + 1}`, user_id: userId, star_rating: 4, cooked_at: recipe.cooked_at }))
  page.on('pageerror', (error) => errors.push(error.message))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === appOrigin || url.protocol === 'data:') return route.continue()
    assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
    apiRequests.push({ method: route.request().method(), path: url.pathname })
    if (chef && route.request().method() === 'POST' && url.pathname === '/functions/v1/extract-recipe') {
      assert.deepEqual(JSON.parse(route.request().postData()), { notes: 'I simmered rice with tomatoes until soft.' })
      await extractionReady
      return route.fulfill({ json: extractionResponse })
    }
    if (chef && route.request().method() === 'POST' && url.pathname === '/functions/v1/generate-recipe') {
      assert.deepEqual(JSON.parse(route.request().postData()), { pantryItems: ['rice'], preferences: 'quick dinner' })
      return route.fulfill({ json: chefResponse })
    }
    assert.equal(route.request().method(), 'GET', `Unexpected write or mutation request: ${route.request().method()} ${url.pathname}`)
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'mori@example.test' } })
    if (url.pathname === `/functions/v1/recipes/${recipe.id}`) return route.fulfill({ json: { recipe: readingRecipe } })
    if (url.pathname === '/functions/v1/demo-recipe') return route.fulfill({ json: { recipe: readingRecipe } })
    if (url.pathname === '/functions/v1/recipes') {
      if (collection) {
        if (url.searchParams.has('cursor')) {
          await cursorReady
          if (failCursor) { return route.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Local test failure' } } }) }
          return route.fulfill({ json: { recipes: entries.slice(width < 600 ? 1 : 2), has_more: false, next_cursor: null } })
        }
        return route.fulfill({ json: { recipes: entries.slice(0, width < 600 ? 1 : 2), has_more: true, next_cursor: 'second-batch' } })
      }
      const recipes = empty ? [] : [{ id: recipe.id, title: recipe.title, user_id: userId, star_rating: recipe.star_rating, cooked_at: recipe.cooked_at }]
      return route.fulfill({ json: { recipes, has_more: false, next_cursor: null } })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request.' } } })
  })
  await page.addInitScript(({ id }) => {
    globalThis.__moriSampleTurns = true
    new globalThis.MutationObserver(() => {
      const layer = globalThis.document.querySelector('[data-journal-page-turn][data-phase="animating"]')
      if (globalThis.__moriSampleTurns && layer && !layer.dataset.samplePaused) {
        layer.dataset.samplePaused = 'true'
        layer.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: 0 }))
      }
    }).observe(globalThis.document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const user = { id, aud: 'authenticated', email: 'mori@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: id, exp: expires_at }))}.test-signature`
    globalThis.localStorage.setItem('sb-mori-dialogue-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { id: userId })
  return { context, page, errors, apiRequests, releaseCursor, releaseExtraction: () => releaseExtraction(), failNextCursor: () => { failCursor = true }, allowCursor: () => { failCursor = false } }
}

async function reachable(page, locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `Companion control must remain reachable: ${JSON.stringify(box)}`)
}

async function verifyMoriPageTurn(page, character, direction) {
  await expect(page.locator('[data-journal-page-turn]')).toBeVisible()
  await expect(character).toHaveAttribute('data-turn-direction', direction)
  const layer = page.locator('[data-journal-page-turn]')
  const spine = await page.locator('.mm-journal-ring').first().boundingBox()
  const width = page.viewportSize().width
  const journey = new URL(page.url()).pathname.split('/').at(-1)
  const points = [...new Set([.1, .22, .32, .54, .68, .85, .95, ...Array.from({ length: 29 }, (_, i) => Number((.26 + i * .02).toFixed(2)))])].sort((a, b) => a - b)
  for (const progress of points) {
    const contact = await layer.evaluate((node, progress) => {
      node.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: progress }))
      const hand = globalThis.document.querySelector('[data-mori-hand]')
      const point = new globalThis.DOMPoint(Number(hand.getAttribute('cx')), Number(hand.getAttribute('cy'))).matrixTransform(hand.getScreenCTM())
      const corner = node.querySelector('[data-page-corner]').getBoundingClientRect()
      const ring = globalThis.document.querySelector('.mm-journal-ring').getBoundingClientRect()
      const surface = node.querySelector(progress < .54 ? '.mm-turn-face--front' : '.mm-turn-face--back')
      const hole = [...surface.querySelectorAll('.mm-journal-hole')].map((element) => element.getBoundingClientRect()).find((box) => box.width > 0)
      const rightEndpoint = node.dataset.layout === 'single' || (progress < .54 ? node.dataset.direction === 'forward' : node.dataset.direction === 'backward')
      const alignment = hole ? Math.hypot(hole.x + hole.width / 2 - (rightEndpoint ? ring.right : ring.left), hole.y + hole.height / 2 - (ring.y + ring.height / 2)) : null
      return { alignment, connected: node.isConnected, phase: node.dataset.phase, progress: node.dataset.progress, leaf: node.querySelector('.mm-turn-leaf').getBoundingClientRect().toJSON(), distance: Math.hypot(point.x - corner.x, point.y - corner.y), hand: { x: point.x, y: point.y }, corner: { x: corner.x, y: corner.y }, ring: { x: ring.x, y: ring.y } }
    }, progress)
    if (progress >= .26 && progress <= .82) { measurements.contactSamples++; measurements.maxContactPx = Math.max(measurements.maxContactPx, contact.distance) }
    measurements.maxSpineDriftPx = Math.max(measurements.maxSpineDriftPx, Math.abs(contact.ring.x - spine.x), Math.abs(contact.ring.y - spine.y))
    if ([.1, .95].includes(progress)) measurements.maxBindingPx = Math.max(measurements.maxBindingPx, contact.alignment ?? Infinity)
    if (progress >= .26 && progress <= .82) assert.ok(contact.distance <= 2, `${width}px ${direction} p=${progress}: detached mitt ${JSON.stringify(contact)}`)
    if ([.1, .95].includes(progress)) assert.ok(contact.alignment !== null && contact.alignment <= 1, `Hole and loop endpoint must align: ${JSON.stringify(contact)}`)
    if (progress >= .26 && progress <= .82 && contact.corner.x >= 0 && contact.corner.x <= width && contact.corner.y >= 0) assert.ok(contact.hand.x >= -2 && contact.hand.x <= width + 2 && contact.hand.y >= -2, 'Attached mitt stays within the viewport when the page corner is visible')
    assert.ok(Math.abs(contact.ring.x - spine.x) <= 1 && Math.abs(contact.ring.y - spine.y) <= 1, 'Spine stays fixed')
    if ([.1, .22, .32, .54, .68, .85, .95].includes(progress)) await page.screenshot({ path: path.join(outputDir, `${journey}-${width}-${direction}-${progress}.png`) })
  }
  const destinationPositions = await layer.evaluate((node) => {
    const selectors = node.dataset.layout === 'single' ? ['.mm-turn-face--back'] : node.dataset.direction === 'forward' ? ['.mm-turn-face--back', '.mm-turn-under--right'] : ['.mm-turn-face--back', '.mm-turn-under--left']
    return selectors.flatMap((selector) => [...node.querySelector(selector).querySelectorAll('[data-recipe-id], [data-unit], .mm-pagination-number, .mm-pagination-left-number')]).flatMap((element) => {
      const box = element.getBoundingClientRect()
      if (!box.width || !box.height || box.x < 0 || box.x >= globalThis.innerWidth || box.bottom <= 0 || box.y >= globalThis.innerHeight) return []
      return [{ key: element.dataset.recipeId ? `recipe:${element.dataset.recipeId}` : element.dataset.unit ? `unit:${element.dataset.unit}` : element.classList.contains('mm-pagination-left-number') ? 'footer:left' : 'footer:right', x: box.x, y: box.y }]
    })
  })
  assert.ok(destinationPositions.some((position) => position.key === 'footer:right'), 'Prepared paper must retain a visible pagination footer')
  await layer.evaluate((node) => node.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: 1 })))
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
  await expect(character).not.toHaveAttribute('data-turn-direction', direction)
  const handoff = await page.locator('.mm-journal-book > .mm-journal-spread').evaluate((node, expected) => expected.map((position) => {
    const [kind, id] = position.key.split(':')
    const candidates = [...node.querySelectorAll(kind === 'recipe' ? '[data-recipe-id]' : kind === 'unit' ? '[data-unit]' : id === 'left' ? '.mm-pagination-left-number' : '.mm-pagination-number')]
    const target = candidates.find((element) => (kind === 'recipe' ? element.dataset.recipeId === id : kind === 'unit' ? element.dataset.unit === id : true) && element.getBoundingClientRect().width > 0)
    const box = target?.getBoundingClientRect()
    return { key: position.key, delta: box ? Math.hypot(box.x - position.x, box.y - position.y) : Infinity }
  }), destinationPositions)
  const footer = await page.locator('.mm-journal-book > .mm-journal-spread .mm-pagination-number').boundingBox()
  assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= page.viewportSize().height, 'Settled footer stays inside the visible paper')
  assert.ok(handoff.every((position) => position.delta <= 2), `Destination moves at handoff: ${JSON.stringify(handoff)}`)
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  const engine = process.env.MORI_BROWSER ?? 'chromium'
  browser = await ({ chromium, firefox, webkit })[engine].launch({ ...(engine === 'chromium' ? { channel: 'chrome' } : {}), headless: true })

  for (const width of (process.env.MORI_EXTENDED_ONLY ? [] : [1440, 768, 375, 320])) {
    const { context, page, errors, apiRequests } = await createJournal(width)
    await page.goto(`${origin}app/recipes?view=index`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    await expect(page.locator('.mm-journal-book .mm-mori')).toHaveCount(0)
    await expect(page.locator('.mori-pet-root .mm-mori')).toHaveCount(1)
    const trigger = page.getByRole('button', { name: 'Talk to Mori', exact: true })
    const character = page.getByRole('group', { name: 'Mori companion' })
    await reachable(page, trigger)
    const requestsBefore = apiRequests.length
    await trigger.focus()
    await page.keyboard.press('Enter')
    const panel = page.getByRole('region', { name: 'Mori', exact: true })
    await expect(panel).toBeVisible()
    await expect(page.locator('.mori-pet-bubble')).toHaveCSS('opacity', '1')
    await expect(panel.getByRole('heading', { name: 'Mori', exact: true })).toBeFocused()
    await expect(panel.getByRole('button', { name: 'Close Mori', exact: true })).toBeVisible()
    await expect(trigger.locator('svg')).toHaveAttribute('data-mood', 'talk')
    await reachable(page, panel)
    await assertJournalSemantics(page, `${width}px open companion`)
    const chatGeometry = await panel.evaluate((element) => {
      const panel = element.getBoundingClientRect()
      const composer = element.querySelector('.mori-chat-composer').getBoundingClientRect()
      return { fits: composer.top >= panel.top && composer.bottom <= panel.bottom, height: panel.height, overflow: element.ownerDocument.defaultView.getComputedStyle(element).overflowY }
    })
    assert.equal(chatGeometry.fits, true, 'Composer must remain inside the panel')
    if (width === 1440) assert.equal(chatGeometry.height, 460, 'Desktop chat must use its full available height')
    assert.equal(chatGeometry.overflow, 'hidden', 'The transcript owns vertical scrolling')
    if (width === 1440) {
      const shortcutsFit = await panel.locator('.mori-chat-shortcuts').evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return [...element.querySelectorAll('button')].every((button) => {
          const rect = button.getBoundingClientRect()
          return rect.left >= bounds.left && rect.right <= bounds.right && rect.bottom <= bounds.bottom
        })
      })
      assert.equal(shortcutsFit, true, 'Every desktop shortcut must fit without horizontal scrolling')
    }
    await page.screenshot({ path: path.join(outputDir, `${width}-companion.png`) })
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(trigger).toBeFocused()
    const before = await character.boundingBox()
    await trigger.focus()
    await page.keyboard.press('ArrowLeft')
    if (width > 520) await expect.poll(async () => (await character.boundingBox()).x).toBeLessThan(before.x)
    await reachable(page, trigger)
    await trigger.click()
    await reachable(page, panel)
    const bubble = page.locator('.mori-pet-bubble')
    const bubbleBox = await bubble.boundingBox()
    const characterBox = await character.boundingBox()
    const placement = await bubble.getAttribute('data-placement')
    assert.ok(bubbleBox && characterBox && ['left', 'right', 'top', 'bottom'].includes(placement), 'Mori speaks from a bubble attached to the character')
    if (placement === 'left') assert.ok(bubbleBox.x + bubbleBox.width <= characterBox.x, 'Left-side bubble stays beside Mori')
    if (placement === 'right') assert.ok(characterBox.x + characterBox.width <= bubbleBox.x, 'Right-side bubble stays beside Mori')
    await page.keyboard.press('Escape')
    const model = await trigger.locator('svg').boundingBox()
    assert.ok(model, "Mori's character is available to drag")
    await page.mouse.move(model.x + model.width / 2, model.y + model.height / 2)
    await page.mouse.down()
    await page.mouse.move(0, 0, { steps: 8 })
    await page.mouse.up()
    await reachable(page, trigger)
    await expect(panel).toHaveCount(0)
    const savedPosition = await character.boundingBox()
    assert.equal(apiRequests.length, requestsBefore, 'Companion interactions must not initiate API requests')
    await page.reload()
    await expect(trigger).toBeVisible()
    await expect.poll(async () => {
      const restoredPosition = await character.boundingBox()
      return Boolean(savedPosition && restoredPosition && Math.abs(savedPosition.x - restoredPosition.x) < 1 && Math.abs(savedPosition.y - restoredPosition.y) < 1)
    }).toBe(true)
    await reachable(page, trigger)
    await trigger.click()
    const preferencesPanel = page.getByRole('region', { name: 'Mori', exact: true })
    await expect(preferencesPanel.getByRole('button', { name: 'Reset position' })).toHaveCount(0)
    await expect(preferencesPanel.getByRole('button', { name: 'Hide Mori' })).toHaveCount(0)
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Mori', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 320, height: 480 })
    await settleJournalLayout(page)
    await reachable(page, trigger)
    await trigger.click()
    await reachable(page, panel)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${origin}app/recipes/new`)
    await expect(page.getByRole('heading', { name: 'New recipe', exact: true })).toBeVisible()
    await expect(trigger).toBeVisible()
    await page.getByRole('button', { name: /^Next Pages?$/ }).click()
    await verifyMoriPageTurn(page, character, 'forward')
    await page.getByRole('button', { name: /^Previous Pages?$/ }).click()
    await verifyMoriPageTurn(page, character, 'backward')

    const chefApp = await createJournal(width, { chef: true })
    await chefApp.page.goto(`${origin}app/chef`)
    await expect(chefApp.page.getByRole('heading', { name: 'What’s in your pantry?' })).toBeVisible()
    await expect(chefApp.page.locator('.mm-ai-chef__journey li[aria-current="step"]')).toContainText('Pantry')
    await expect(chefApp.page.locator('.mm-journal-book .mm-mori')).toHaveCount(0)
    await expect(chefApp.page.locator('.mori-pet-caption')).toHaveCount(0)
    await expect(chefApp.page.locator('.mori-pet-character')).toHaveCount(1)
    const chefTrigger = chefApp.page.getByRole('button', { name: 'Talk to Mori', exact: true })
    await chefTrigger.click()
    const chefPanel = chefApp.page.getByRole('region', { name: 'Mori', exact: true })
    await expect(chefPanel.locator('.mori-chat-task')).toHaveText('How can I help?')
    await chefPanel.getByRole('button', { name: 'Cooking notes' }).click()
    await expect(chefApp.page).toHaveURL(`${origin}app/quick-entry`)
    const notesInput = chefApp.page.getByRole('textbox', { name: 'Cooking notes' })
    await expect(notesInput).toBeFocused()
    await expect(chefPanel).toBeVisible()
    await chefPanel.getByRole('button', { name: 'Pantry' }).click()
    await expect(chefApp.page).toHaveURL(`${origin}app/chef`)
    const pantryInput = chefApp.page.getByRole('textbox', { name: 'Pantry ingredient' })
    await expect(pantryInput).toBeFocused()
    await chefPanel.getByRole('button', { name: 'Cooking idea' }).click()
    await chefPanel.getByRole('textbox', { name: 'Message Mori' }).fill('rice; quick dinner')
    await chefPanel.getByRole('button', { name: 'Send' }).click()
    await chefPanel.getByRole('button', { name: 'Review recipe' }).waitFor()
    await chefPanel.getByRole('button', { name: 'Review recipe' }).click()
    await expect(chefApp.page).toHaveURL(`${origin}app/chef/review`)
    await expect(chefApp.page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
    await expect.poll(async () => chefApp.page.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('celebrating')
    const chefDraft = await chefApp.page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:ai-chef:v1:${userId}`)
    assert.equal(chefDraft.handoff.saved, false, 'Reviewing the pantry idea must leave it unsaved')
    assert.deepEqual(chefApp.apiRequests.filter(({ method }) => method !== 'GET').map(({ method, path }) => ({ method, path })), [
      { method: 'POST', path: '/functions/v1/generate-recipe' },
    ])
    await chefApp.page.screenshot({ path: path.join(outputDir, `${width}-ai-chef.png`) })
    assert.deepEqual(chefApp.errors, [])
    await chefApp.context.close()

    await page.goto(`${origin}home`)
    await expect(trigger).toHaveCount(0)
    assert.deepEqual(errors, [])
    await context.close()
    process.stdout.write(`${width}px: companion, AI Chef handoff, and page-turn journey passed.\n`)
  }

  const quickApp = await createJournal(1440, { chef: true })
  await quickApp.page.goto(`${origin}app/quick-entry`)
  await quickApp.page.getByRole('button', { name: 'Talk to Mori', exact: true }).click()
  const quickPanel = quickApp.page.getByRole('region', { name: 'Mori', exact: true })
  await quickPanel.getByRole('button', { name: 'Create recipe' }).click()
  await quickPanel.getByRole('textbox', { name: 'Message Mori' }).fill('I simmered rice with tomatoes until soft.')
  await quickPanel.getByRole('button', { name: 'Send' }).click()
  await quickPanel.getByRole('status').filter({ hasText: 'Mori is working on your request.' }).waitFor()
  assert.equal(await quickPanel.getByRole('status').count(), 1, 'A pending chat request must have only one live status announcement')
  quickApp.releaseExtraction()
  await quickPanel.getByRole('button', { name: 'Review draft' }).waitFor()
  await quickPanel.getByRole('button', { name: 'Review draft' }).click()
  await expect(quickApp.page).toHaveURL(`${origin}app/quick-entry/review`)
  await expect(quickApp.page.getByRole('heading', { name: 'Review your recipe' })).toBeVisible()
  const quickDraft = await quickApp.page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:quick-ai-entry:v1:${userId}`)
  assert.equal(quickDraft.handoff.saved, false, 'Reviewing the extraction must leave it unsaved')
  assert.deepEqual(quickApp.apiRequests.filter(({ method }) => method !== 'GET').map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/functions/v1/extract-recipe' },
  ])
  assert.deepEqual(quickApp.errors, [])
  await quickApp.context.close()


  for (const [width, height] of [[1440, 300], [320, 568]]) {
    const { context, page } = await createJournal(width, { reducedMotion: true })
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}app/recipes?view=index`)
    await page.getByRole('heading', { name: 'Saved recipes (1)' }).waitFor()
    await page.getByRole('button', { name: 'Talk to Mori', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Mori', exact: true })
    assert.ok((await panel.getByRole('log').boundingBox()).height >= 70, 'Short windows must preserve readable messages')
    for (const button of await panel.locator('.mori-chat-shortcuts button').all()) {
      await button.scrollIntoViewIfNeeded()
      const box = await button.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width, 'Shortcuts must fit without sideways scrolling')
    }
    await panel.getByRole('textbox', { name: 'Message Mori' }).scrollIntoViewIfNeeded()
    await expect(panel.getByRole('textbox', { name: 'Message Mori' })).toBeInViewport()
    await page.screenshot({ path: path.join(outputDir, `${width}x${height}-adapted-chat.png`) })
    await context.close()
  }
  if (process.env.MORI_CHAT_ONLY) {
    process.stdout.write(`Mori chat and companion acceptance passed. Screenshots: ${outputDir}\n`)
  } else {
  for (const width of (process.env.MORI_RETRY_ONLY ? [] : [1440, 768, 375, 320])) {
    const app = await createJournal(width, { collection: true, recordVideo: width === 1440 || width === 375 })
    const { page } = app
    await page.goto(`${origin}app/recipes`)
    await expect(page.getByRole('link', { name: 'Open recipe Saved recipe 1' })).toBeVisible()
    await settleJournalLayout(page)
    await page.getByRole('link', { name: 'Next page →' }).click()
    await expect(page.locator('[data-journal-page-turn]')).toHaveAttribute('data-phase', 'preparing')
    assert.ok(!new URL(page.url()).searchParams.has('leaf'), 'Preparation must not commit the route')
    assert.ok(await page.locator('[data-journal-page-turn]').textContent().then((text) => text.includes('Saved recipe 1')), 'Outgoing collection stays visible')
    await page.locator('.mm-journal-spread a[aria-disabled="true"]').first().evaluate((node) => node.click())
    app.releaseCursor()
    const character = page.getByRole('group', { name: 'Mori companion' })
    await verifyMoriPageTurn(page, character, 'forward')
    await expect(page).toHaveURL(/entry=[1-9]/)
    await page.getByRole('link', { name: '← Previous page' }).click()
    await verifyMoriPageTurn(page, character, 'backward')
    await page.goto(`${origin}app/recipes/${recipe.id}`)
    await settleReadingPages(page)
    await page.getByRole('button', { name: 'Talk to Mori', exact: true }).hover()
    await page.getByRole('button', { name: 'Next Page', exact: true }).focus()
    await page.keyboard.press('Enter')
    await verifyMoriPageTurn(page, character, 'forward')
    await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
    await verifyMoriPageTurn(page, character, 'backward')
    await expect(page.getByRole('region', { name: width >= 1100 ? 'Left recipe page' : 'Recipe ingredients, instructions and notes', exact: true })).toBeFocused()
    // Exercise uninterrupted 900 ms playback, including a slower browser rendering cycle.
    await page.evaluate(() => { globalThis.__moriSampleTurns = false })
    let cdp
    if ((process.env.MORI_BROWSER ?? 'chromium') === 'chromium') {
      cdp = await app.context.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    }
    await page.getByRole('button', { name: 'Next Page', exact: true }).click()
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    // Interrupt an accepted turn by resizing, then by changing motion preference.
    await page.getByRole('button', { name: 'Next Page', exact: true }).click()
    await expect(character).toHaveAttribute('data-turn-direction', 'forward')
    await page.setViewportSize({ width: 720, height: 450 })
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    await settleReadingPages(page)
    await page.screenshot({ path: path.join(outputDir, `${width}-short-landscape.png`) })
    await page.setViewportSize({ width, height: 900 })
    await settleReadingPages(page)
    await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    assert.deepEqual(app.errors, [])
    await app.context.close()
    process.stdout.write(`${width}px: delayed collection, both reading directions, ${cdp ? '4× CPU throttling, ' : ''}resize and motion interruption passed.\n`)
  }
  const landscape = await createJournal(720, { collection: true })
  await landscape.page.setViewportSize({ width: 720, height: 450 })
  landscape.releaseCursor()
  const landscapeCharacter = landscape.page.getByRole('group', { name: 'Mori companion' })
  for (const [route, next, previous] of [
    ['app/recipes', { role: 'link', name: 'Next page →' }, { role: 'link', name: '← Previous page' }],
    [`app/recipes/${recipe.id}`, { role: 'button', name: 'Next Page' }, { role: 'button', name: 'Previous Page' }],
    ['app/recipes/new', { role: 'button', name: 'Next Page' }, { role: 'button', name: 'Previous Page' }],
  ]) {
    await landscape.page.goto(`${origin}${route}`)
    if (route.endsWith(recipe.id)) {
      await settleReadingPages(landscape.page)
      await expect(landscape.page.getByRole(next.role, { name: next.name, exact: true })).toBeVisible()
    }
    await landscape.page.getByRole(next.role, { name: next.name, exact: true }).click()
    await verifyMoriPageTurn(landscape.page, landscapeCharacter, 'forward')
    await landscape.page.getByRole(previous.role, { name: previous.name, exact: true }).click()
    await verifyMoriPageTurn(landscape.page, landscapeCharacter, 'backward')
  }
  assert.deepEqual(landscape.errors, [])
  await landscape.context.close()
  process.stdout.write('720×450: collection, reading and writing turns, contact, binding and handoff passed.\n')

  const failed = await createJournal(1440, { collection: true })
  await failed.page.goto(`${origin}app/recipes`)
  await failed.page.getByRole('link', { name: 'Next page →' }).click()
  failed.failNextCursor()
  failed.releaseCursor()
  await expect(failed.page.getByRole('button', { name: 'Retry loading more' })).toBeVisible()
  await expect(failed.page.locator('[data-journal-page-turn]')).toHaveCount(0)
  assert.ok(!new URL(failed.page.url()).searchParams.has('leaf'), 'Failed preparation must retain the route')
  failed.allowCursor()
  await failed.page.getByRole('button', { name: 'Retry loading more' }).click()
  await expect(failed.page.getByRole('button', { name: 'Retry loading more' })).toHaveCount(0)
  await failed.page.getByRole('link', { name: 'Next page →' }).click()
  await verifyMoriPageTurn(failed.page, failed.page.getByRole('group', { name: 'Mori companion' }), 'forward')
  assert.deepEqual(failed.errors, [])
  await failed.context.close()

  for (const width of [1440, 375]) {
    const recording = await createJournal(width, { recordVideo: true })
    await recording.page.goto(`${origin}app/recipes/new`)
    await expect(recording.page.getByRole('heading', { name: 'New recipe', exact: true })).toBeVisible()
    await recording.page.getByLabel('Recipe title').fill('Persistent cookbook draft')
    await recording.page.evaluate(() => { globalThis.__moriSampleTurns = false })
    for (const name of [/^Next Pages?$/, /^Previous Pages?$/]) {
      await recording.page.getByRole('button', { name }).click()
      await recording.page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    }
    await expect(recording.page.getByLabel('Recipe title')).toHaveValue('Persistent cookbook draft')
    const video = recording.page.video()
    await recording.context.close()
    await video.saveAs(path.join(outputDir, `${width}-real-speed.webm`))
  }

  for (const width of [1440, 375]) {
    const demo = await createJournal(width)
    await demo.page.goto(`${origin}demo-recipe`)
    await settleReadingPages(demo.page)
    await expect(demo.page.locator('.mori-pet-character')).toHaveCount(0)
    for (const [name, direction] of [['Next Page', 'forward'], ['Previous Page', 'backward']]) {
      await demo.page.getByRole('button', { name, exact: true }).click()
      const layer = demo.page.locator('[data-journal-page-turn]')
      await expect(layer).toHaveAttribute('data-phase', 'animating')
      for (const progress of [.1, .22, .32, .54, .68, .85, .95, 1]) {
        await layer.evaluate((node, progress) => node.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: progress })), progress)
        if (progress === .54) await demo.page.screenshot({ path: path.join(outputDir, `${width}-public-${direction}.png`) })
      }
      await expect(layer).toHaveCount(0)
    }
    assert.deepEqual(demo.errors, [])
    await demo.context.close()
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
  await expect.poll(async () => { const box = await panel.boundingBox(); return Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 720 && box.y + box.height <= 450) }).toBe(true)
  await reachable(page, panel)
  await page.screenshot({ path: path.join(outputDir, 'reduced-motion-reflow.png') })
  await page.goto(`${origin}app/recipes/new`)
  await page.getByRole('button', { name: /^Next Pages?$/ }).click()
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await expect(page.locator('.mori-pet-character')).not.toHaveAttribute('data-turn-direction', 'forward')
  assert.deepEqual(errors, [])
  await context.close()
  await writeFile(path.join(outputDir, 'measurements.json'), JSON.stringify({ browser: process.env.MORI_BROWSER ?? 'chromium', ...measurements }, null, 2))
  process.stdout.write(`Empty guidance and reduced motion passed. Screenshots: ${outputDir}\n`)
  }
} finally {
  await browser?.close()
  await server.close()
}
