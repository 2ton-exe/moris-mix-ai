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
const measurements = { contactSamples: 0, maxContactPx: 0, desktopContactSamples: 0, maxDesktopContactPx: 0, maxSpineDriftPx: 0, maxBindingPx: 0 }

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

async function verifySpatialMoriTurn(layer, direction, screenshot) {
  await expect(layer.locator('[data-mori-paper-actor] > :is(svg, img):visible')).toBeVisible()
  const { width, samples } = await layer.evaluate((node) => {
    const book = node.closest('.mm-journal-book')
    const actor = node.querySelector('[data-mori-paper-actor]')
    const foot = actor.querySelector('[data-mori-foot]')
    const grip = actor.querySelector('[data-mori-hand]')
    const corner = node.querySelector('[data-page-corner]')
    const live = book.querySelector(':scope > .mm-journal-spread')
    const left = live.querySelector(':scope > .mm-journal-flyleaf').getBoundingClientRect()
    const right = live.querySelector(':scope > .mm-journal-page').getBoundingClientRect()
    const ringElements = [...book.querySelectorAll('.mm-journal-ring')]
    const rings = ringElements.map((ring) => ring.getBoundingClientRect())
    const bindingAlignment = (flipped) => {
      const ring = rings[0]
      const surface = node.querySelector(flipped ? '.mm-turn-face--back' : '.mm-turn-face--front')
      const hole = [...surface.querySelectorAll('.mm-journal-hole')].map((element) => element.getBoundingClientRect()).find((box) => box.width > 0)
      const rightEndpoint = flipped ? node.dataset.direction === 'backward' : node.dataset.direction === 'forward'
      return hole ? Math.hypot(hole.x + hole.width / 2 - (rightEndpoint ? ring.right : ring.left), hole.y + hole.height / 2 - (ring.y + ring.height / 2)) : Infinity
    }
    const contains = (rect, x, y) => x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1
    const samples = Array.from({ length: 200 }, (_, index) => {
      const progress = index / 200
      node.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: progress }))
      const { x, y } = foot.getBoundingClientRect()
      const { x: cornerX, y: cornerY } = corner.getBoundingClientRect()
      const gripping = actor.hasAttribute('data-mori-gripping')
      const ring = ringElements[0].getBoundingClientRect()
      const point = gripping ? new globalThis.DOMPoint(grip.cx.baseVal.value, grip.cy.baseVal.value).matrixTransform(grip.getScreenCTM()) : null
      return {
        progress, motion: actor.dataset.moriMotion, facing: actor.dataset.moriFacing, x, y, cornerX, cornerY, gripping,
        travel: Number(node.dataset.travel),
        spineDrift: Math.max(Math.abs(ring.x - rings[0].x), Math.abs(ring.y - rings[0].y)),
        bindingAlignment: index === 0 || index === 199 ? bindingAlignment(index === 199) : null,
        separation: point && Math.hypot(point.x - cornerX, point.y - cornerY),
        paper: contains(left, x, y) ? 'left' : contains(right, x, y) ? 'right' : null,
        inGutter: x >= left.right && x <= right.left && y >= left.top && y <= left.bottom,
        onRing: rings.some((ring) => contains(ring, x, y)),
      }
    })
    return { width: globalThis.innerWidth, samples }
  })

  const label = `${width}px ${direction}`
  const motion = samples.filter((sample, index) => sample.motion !== samples[index - 1]?.motion).map((sample) => sample.motion)
  assert.deepEqual(motion, ['approach', 'align', 'grab', 'turn', 'release', 'recover'], `${label}: takes one approach-to-recovery sequence`)
  const initial = samples[0]
  const alignment = samples.find((sample) => sample.motion === 'align')
  const recovery = samples.findLast((sample) => sample.motion === 'recover')
  assert.equal(alignment.paper, direction === 'forward' ? 'right' : 'left', `${label}: approaches the outgoing leaf`)
  assert.ok(Math.hypot(alignment.x - initial.x, alignment.y - initial.y) > 12, `${label}: feet move to reach the paper`)
  assert.equal(alignment.facing, direction === 'forward' ? 'E' : 'W', `${label}: faces the outgoing edge`)
  assert.ok(recovery.paper && Math.hypot(recovery.x - initial.x, recovery.y - initial.y) <= 1, `${label}: returns to his resting point on paper`)

  const directions = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
  let movingGrip = 0
  for (const [index, sample] of samples.entries()) {
    assert.ok((sample.paper || sample.inGutter) && !sample.onRing, `${label}: foot leaves the book or crosses a ring ${JSON.stringify(sample)}`)
    if (['approach', 'align', 'grab'].includes(sample.motion)) {
      assert.equal(sample.travel, 0, `${label}: paper waits for contact`)
      assert.ok(Math.hypot(sample.cornerX - initial.cornerX, sample.cornerY - initial.cornerY) <= .5, `${label}: outgoing paper remains stationary`)
    }
    measurements.maxSpineDriftPx = Math.max(measurements.maxSpineDriftPx, sample.spineDrift)
    assert.ok(sample.spineDrift <= 1, `${label}: spine stays fixed`)
    if (sample.bindingAlignment !== null) {
      measurements.maxBindingPx = Math.max(measurements.maxBindingPx, sample.bindingAlignment)
      assert.ok(sample.bindingAlignment <= 1, `${label}: page holes align with the loop endpoints`)
    }
    if (sample.gripping) {
      assert.ok(Math.hypot(sample.x - alignment.x, sample.y - alignment.y) <= 1, `${label}: mitt tracks the paper with feet planted`)
      measurements.contactSamples++
      measurements.maxContactPx = Math.max(measurements.maxContactPx, sample.separation)
      measurements.desktopContactSamples++
      measurements.maxDesktopContactPx = Math.max(measurements.maxDesktopContactPx, sample.separation)
      assert.ok(sample.separation <= 2, `${label}: mitt separates from paper by ${sample.separation}px`)
      if (sample.travel > 0) movingGrip++
    }
    if (sample.motion === 'recover') assert.equal(sample.gripping, false, `${label}: releases the paper before walking`)

    const previous = samples[index - 1]
    if (!previous || !['approach', 'recover'].includes(sample.motion) || previous.motion !== sample.motion || previous.facing !== sample.facing) continue
    const dx = sample.x - previous.x
    const dy = sample.y - previous.y
    if (Math.hypot(dx, dy) < 1) continue
    const sector = Math.atan2(dy, dx) / (Math.PI / 4)
    if (Math.abs(sector - Math.round(sector)) > .48) continue
    assert.equal(sample.facing, directions[(Math.round(sector) + 8) % 8], `${label}: faces in the direction of travel`)
  }
  assert.ok(movingGrip > 1, `${label}: Mori keeps contact as the paper begins to move`)

  for (const stage of motion) {
    const frames = samples.filter((sample) => sample.motion === stage)
    const sample = frames[Math.floor(frames.length / 2)]
    await layer.evaluate((node, progress) => node.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: progress })), sample.progress)
    await screenshot(stage)
  }
  await layer.evaluate((node, progress) => node.dispatchEvent(new globalThis.CustomEvent('mm-journal-turn-sample', { detail: progress })), samples.at(-1).progress)
}

async function verifyCompactMoriTurn({ page, character, layer, direction, width, screenshot }) {
  const spine = await page.locator('.mm-journal-ring').first().boundingBox()
  await expect(character).toHaveAttribute('data-turn-direction', direction)
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
    if ([.1, .22, .32, .54, .68, .85, .95].includes(progress)) await screenshot(progress)
  }
}

async function verifyMoriPageTurn(page, character, direction) {
  const layer = page.locator('[data-journal-page-turn]')
  await expect(layer).toHaveAttribute('data-phase', 'animating')
  await expect(layer).toHaveAttribute('data-direction', direction)
  const before = page.url()
  const spatial = await layer.getAttribute('data-layout') === 'spread'
  const width = page.viewportSize().width
  const journey = new URL(page.url()).pathname.split('/').at(-1)
  const screenshot = (stage) => page.screenshot({ path: path.join(outputDir, `${journey}-${width}-${direction}-${stage}.png`) })
  if (spatial) {
    await expect(character.getByRole('button', { name: 'Talk to Mori' })).toHaveAttribute('tabindex', '-1')
    await verifySpatialMoriTurn(layer, direction, screenshot)
  } else await verifyCompactMoriTurn({ page, character, layer, direction, width, screenshot })
  await expect(page).toHaveURL(before)
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

  for (const width of [1440, 375]) {
    const { context, page, errors } = await createJournal(width)
    await page.goto(`${origin}app/recipes?view=index`)
    await page.getByRole('heading', { name: 'Saved recipes (1)' }).waitFor()
    await page.getByRole('button', { name: 'Talk to Mori' }).click()
    const chat = page.getByRole('region', { name: 'Mori', exact: true })
    await expect(page.locator('.mori-pet-bubble')).toHaveCSS('opacity', '1')
    const editor = chat.getByRole('button', { name: 'Open recipe editor' })
    const tap = page.locator('.mori-navigation-tap')

    // Freeze the brief gesture at contact while checking the route and its actual geometry.
    const pinTap = () => tap.evaluate((element) => {
      const observer = new globalThis.MutationObserver(() => {
        const animation = element.getAnimations()[0]
        if (!animation) return
        observer.disconnect()
        animation.pause()
        animation.currentTime = Number(animation.effect.getTiming().duration) * .55
      })
      observer.observe(element, { attributes: true, attributeFilter: ['hidden'] })
    })
    await pinTap()
    await editor.focus()
    await page.keyboard.press('Enter')
    await expect(tap).toHaveCSS('opacity', '1')
    await expect(editor).toHaveAttribute('data-mori-tap-target', '')
    await expect(page).toHaveURL(`${origin}app/recipes?view=index`)
    await expect(chat.getByRole('log')).toContainText('Opening a new recipe.')
    await expect(chat.getByRole('log')).toBeFocused()
    const [tapBounds, editorBounds] = await Promise.all([tap.boundingBox(), editor.boundingBox()])
    assert.ok(tapBounds && editorBounds)
    const gap = Math.min(Math.abs(tapBounds.x + tapBounds.width - editorBounds.x), Math.abs(editorBounds.x + editorBounds.width - tapBounds.x))
    assert.ok(gap <= 12, `Mori must tap beside the activated control (gap ${gap}px)`)
    await page.screenshot({ path: path.join(outputDir, `${width}-mori-navigation-tap.png`) })
    await tap.evaluate((element) => element.getAnimations()[0].play())
    await expect(page).toHaveURL(`${origin}app/recipes/new`)
    await expect(chat).toBeVisible()
    const editorHeading = page.getByRole('heading', { name: 'New recipe', exact: true })
    await expect(editorHeading).toBeFocused()
    await editor.press('Enter')
    await expect(editorHeading).toBeFocused()
    const title = page.getByRole('textbox', { name: 'Recipe title' })
    await title.fill('Unsaved soup')

    const collection = chat.getByRole('button', { name: 'Open recipes' })
    await collection.click()
    const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    await expect(dialog).toBeVisible()
    await expect(tap).toBeHidden()
    await expect(page).toHaveURL(`${origin}app/recipes/new`)
    await dialog.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(dialog).toBeHidden()
    await expect(collection).toBeFocused()
    await expect(title).toHaveValue('Unsaved soup')

    await collection.click()
    await expect(dialog).toBeVisible()
    await page.evaluate(() => globalThis.history.back())
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(`${origin}app/recipes/new`)
    await expect(title).toHaveValue('Unsaved soup')

    await collection.click()
    await dialog.getByRole('button', { name: 'Discard Changes' }).click()
    await expect(tap).toBeVisible()
    await expect(page).toHaveURL(`${origin}app/recipes`)
    await expect(chat).toBeVisible()
    const collectionHeading = page.getByRole('heading', { name: 'Your cooking journal', exact: true })
    await expect(collectionHeading).toBeFocused()
    await collection.press('Enter')
    await expect(collectionHeading).toBeFocused()

    const composer = chat.getByRole('textbox', { name: 'Message Mori' })
    const send = chat.getByRole('button', { name: 'Send' })
    await composer.fill('Open Cooking Notes')
    await Promise.all([
      expect(chat.getByText('Opening the cooking notes field.').locator('..')).toHaveAttribute('data-mori-tap-target', ''),
      send.click(),
    ])
    await expect(page.getByRole('textbox', { name: 'Cooking notes' })).toBeFocused()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await composer.fill('Open Pantry')
    await send.click()
    await expect(page.getByRole('textbox', { name: 'Pantry ingredient' })).toBeFocused()
    await expect(tap).toBeHidden()
    assert.deepEqual(errors, [])
    await context.close()
    process.stdout.write(`${width}px: Mori navigation gesture and unsaved-changes journey passed. Captures in ${outputDir}\n`)
  }

  for (const width of (process.env.MORI_EXTENDED_ONLY ? [] : [1440, 768, 375, 320])) {
    const { context, page, errors, apiRequests } = await createJournal(width)
    await page.goto(`${origin}app/recipes?view=index`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    await settleJournalLayout(page)
    await expect(page.locator('.mm-journal-book .mm-mori')).toHaveCount(0)
    await expect(page.locator('.mori-pet-character .mm-mori')).toHaveCount(1)
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
      return { fits: composer.top >= panel.top && composer.bottom <= panel.bottom, height: panel.height, panelScrolls: element.scrollHeight - element.clientHeight > 1 }
    })
    if (width > 600) assert.equal(chatGeometry.fits, true, 'Composer must remain inside the panel')
    else {
      await panel.getByRole('textbox', { name: 'Message Mori' }).scrollIntoViewIfNeeded()
      await expect(panel.getByRole('textbox', { name: 'Message Mori' })).toBeInViewport()
    }
    if (width === 1440) assert.equal(chatGeometry.height, 560, 'Desktop chat must use its full available height')
    if (width > 600) assert.equal(chatGeometry.panelScrolls, false, 'A roomy desktop panel keeps the composer in place')
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
    await panel.getByRole('button', { name: 'See more', exact: true }).click()
    await panel.getByRole('textbox', { name: 'Message Mori' }).scrollIntoViewIfNeeded()
    await expect(panel.getByRole('textbox', { name: 'Message Mori' })).toBeInViewport()
    await panel.getByRole('button', { name: 'See less', exact: true }).click()

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
    await chefPanel.getByRole('button', { name: 'Open cooking notes' }).click()
    await expect(chefApp.page).toHaveURL(`${origin}app/quick-entry`)
    const notesInput = chefApp.page.getByRole('textbox', { name: 'Cooking notes' })
    await expect(notesInput).toBeFocused()
    await expect(chefPanel).toBeVisible()
    await chefPanel.getByRole('button', { name: 'Open pantry' }).click()
    await expect(chefApp.page).toHaveURL(`${origin}app/chef`)
    const pantryInput = chefApp.page.getByRole('textbox', { name: 'Pantry ingredient' })
    await expect(pantryInput).toBeFocused()
    await chefPanel.getByRole('button', { name: 'See more', exact: true }).click()
    await chefPanel.getByRole('button', { name: 'Use my ingredients', exact: true }).click()
    await chefPanel.getByRole('textbox', { name: 'Message Mori' }).fill('rice; quick dinner')
    await chefPanel.getByRole('button', { name: 'Send' }).click()
    const reviewRecipe = chefPanel.getByRole('button', { name: 'Review recipe' })
    const draftTitle = chefPanel.getByRole('heading', { name: 'Rice and egg supper' })
    await expect(draftTitle).toBeVisible()
    if (width === 1440) {
      await reviewRecipe.scrollIntoViewIfNeeded()
      await expect(draftTitle).toBeInViewport({ ratio: 1 })
      await expect(reviewRecipe).toBeInViewport({ ratio: 1 })
      await chefApp.page.screenshot({ path: path.join(outputDir, '1440-mori-recipe-suggestion.png') })
    }
    await reviewRecipe.click()
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
  await quickPanel.getByRole('button', { name: 'See more', exact: true }).click()
  await quickPanel.getByRole('button', { name: 'Record a recipe', exact: true }).click()
  await quickPanel.getByRole('textbox', { name: 'Message Mori' }).fill('I simmered rice with tomatoes until soft.')
  await quickPanel.getByRole('button', { name: 'Send' }).click()
  await quickPanel.getByRole('status').filter({ hasText: 'Mori is working on your request.' }).waitFor()
  assert.equal(await quickPanel.getByRole('status').count(), 1, 'A pending chat request must have only one live status announcement')
  const pendingFits = await quickPanel.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return [...element.querySelectorAll('.mori-chat-composer, .mori-chat-shortcuts, .mori-chat-pending, .mori-chat-hint')].every(child => {
      const rect = child.getBoundingClientRect()
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom
    })
  })
  assert.equal(pendingFits, true, 'Composer, navigation, Cancel and hint must fit while a request is pending')
  assert.ok((await quickPanel.getByRole('log').boundingBox()).height >= 44, 'Pending requests must retain a readable transcript')
  quickApp.releaseExtraction()
  const draftReview = quickPanel.getByRole('button', { name: 'Review draft' })
  await Promise.all([
    expect(draftReview).toHaveAttribute('data-mori-tap-target', ''),
    draftReview.click(),
  ])
  await expect(quickApp.page).toHaveURL(`${origin}app/quick-entry/review`)
  const reviewHeading = quickApp.page.getByRole('heading', { name: 'Review your recipe' })
  await expect(reviewHeading).toBeFocused()
  const reviewComposer = quickPanel.getByRole('textbox', { name: 'Message Mori' })
  await reviewComposer.fill('Review the Tomato Rice draft')
  await Promise.all([
    expect(quickPanel.getByText('I’ll open the draft for review.').last().locator('..')).toHaveAttribute('data-mori-tap-target', ''),
    reviewComposer.press('Control+Enter'),
  ])
  await expect(reviewHeading).toBeFocused()
  const quickDraft = await quickApp.page.evaluate((key) => JSON.parse(globalThis.sessionStorage.getItem(key)), `moris-mix:quick-ai-entry:v1:${userId}`)
  assert.equal(quickDraft.handoff.saved, false, 'Reviewing the extraction must leave it unsaved')
  assert.deepEqual(quickApp.apiRequests.filter(({ method }) => method !== 'GET').map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/functions/v1/extract-recipe' },
  ])
  await reviewComposer.fill('What can I cook with rice; quick dinner')
  await quickPanel.getByRole('button', { name: 'Send', exact: true }).click()
  const pantryReview = quickPanel.getByRole('button', { name: 'Review recipe' })
  await pantryReview.click()
  const reviewGuard = quickApp.page.getByRole('alertdialog', { name: 'Leave without saving?' })
  await expect(reviewGuard).toBeVisible()
  await Promise.all([
    expect(pantryReview).toHaveAttribute('data-mori-tap-target', ''),
    reviewGuard.getByRole('button', { name: 'Discard Changes' }).click(),
  ])
  await expect(quickApp.page).toHaveURL(`${origin}app/chef/review`)
  await expect(quickApp.page.getByRole('heading', { name: "Review Mori's recipe." })).toBeFocused()
  assert.deepEqual(quickApp.apiRequests.filter(({ method }) => method !== 'GET').map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/functions/v1/extract-recipe' },
    { method: 'POST', path: '/functions/v1/generate-recipe' },
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
    await panel.getByRole('textbox', { name: 'Message Mori' }).fill('Hello Mori')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
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

  for (const width of [1440, 375]) {
    for (const demo of [false, true]) {
      const app = await createJournal(width, { reducedMotion: true })
      let releaseRecipe
      const recipeReady = new Promise(resolve => { releaseRecipe = resolve })
      await app.context.route(demo ? '**/functions/v1/demo-recipe' : `**/functions/v1/recipes/${recipe.id}`, async route => {
        await recipeReady
        await route.fulfill({ json: { recipe } })
      })
      await app.page.goto(`${origin}${demo ? 'demo-recipe' : 'app/recipes/' + recipe.id}`)
      const loading = app.page.locator('.mm-reading-skeleton')
      await loading.waitFor()
      await app.page.evaluate(() => globalThis.document.fonts.ready)
      const identity = () => app.page.locator(width < 1100 ? '.mm-journal-page .mm-reading-identity' : '.mm-journal-flyleaf .mm-reading-identity').first()
      const loadingArt = await identity().locator('.mm-recipe-artwork').boundingBox()
      const loadingHeading = await identity().locator('.mm-recipe-detail__summary').boundingBox()
      const back = app.page.getByRole('link', { name: demo ? 'Back home' : 'Back to recipes', exact: false }).filter({ visible: true })
      await expect(back).toBeVisible()
      await app.page.screenshot({ path: path.join(outputDir, `${width}-${demo ? 'demo' : 'detail'}-loading.png`) })
      releaseRecipe()
      await expect(loading).toHaveCount(0)
      await settleReadingPages(app.page)
      const loadedArt = await identity().locator('.mm-recipe-artwork').boundingBox()
      const loadedHeading = await identity().locator('.mm-recipe-detail__summary').boundingBox()
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(loadingArt[key] - loadedArt[key]) <= 2, `Reading artwork ${key} shifts: ${loadingArt[key]} → ${loadedArt[key]}`)
      for (const key of ['x', 'y', 'width']) assert.ok(Math.abs(loadingHeading[key] - loadedHeading[key]) <= 2, `Reading summary ${key} shifts`)
      assert.deepEqual(app.errors, [])
      await app.context.close()
    }
  }
  const searchApp = await createJournal(1440, { reducedMotion: true })
  const ownedAdobo = { id: recipe.id, title: 'Adobo', user_id: userId, cooked_at: '2026-11-02' }
  let holdAdobo = false
  let releaseAdobo
  const adoboReady = new Promise(resolve => { releaseAdobo = resolve })
  const otherAdobo = { ...ownedAdobo, id: '55555555-5555-4555-8555-555555555555', title: 'Pork adobo' }
  const firstSoup = { ...ownedAdobo, id: '33333333-3333-4333-8333-333333333333', title: 'Soup' }
  const secondSoup = { ...ownedAdobo, id: '44444444-4444-4444-8444-444444444444', title: 'Soup', cooked_at: '2026-11-03' }
  let releaseAdoboDetail
  const adoboDetailReady = new Promise(resolve => { releaseAdoboDetail = resolve })
  await searchApp.context.route(`**/functions/v1/recipes/${recipe.id}`, async route => {
    await adoboDetailReady
    return route.fulfill({ json: { recipe: { ...recipe, title: ownedAdobo.title } } })
  })
  await searchApp.context.route(`**/functions/v1/recipes/${secondSoup.id}`, route =>
    route.fulfill({ json: { recipe: { ...recipe, ...secondSoup } } }))
  await searchApp.context.route('**/functions/v1/recipes?*', async route => {
    const url = new URL(route.request().url())
    const search = url.searchParams.get('search')
    if (!search) return route.fallback()
    assert.equal(route.request().method(), 'GET')
    assert.match(route.request().headers().authorization, /^Bearer /)
    assert.equal(url.searchParams.get('searchMode'), 'title')
    if (search === 'broken') {
      return route.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Local test failure' } } })
    }
    if (search === 'soup' && !url.searchParams.has('cursor')) {
      return route.fulfill({ json: { recipes: [firstSoup], has_more: true, next_cursor: 'second-soup' } })
    }
    if (holdAdobo && search === 'adobo') await adoboReady
    const matches = search === 'adobo' ? [otherAdobo, ownedAdobo]
      : search === 'ado' ? [ownedAdobo]
      : search === 'soup' && url.searchParams.get('cursor') === 'second-soup' ? [secondSoup]
      : search === 'private' ? [{ ...ownedAdobo, title: 'Private', user_id: '99999999-9999-4999-8999-999999999999' }]
      : []
    return route.fulfill({ json: { recipes: matches, has_more: false, next_cursor: null } })
  })
  await searchApp.page.goto(`${origin}app/recipes`)
  await searchApp.page.getByRole('button', { name: 'Talk to Mori', exact: true }).click()
  const searchPanel = searchApp.page.getByRole('region', { name: 'Mori', exact: true })
  async function searchChat(prompt) {
    await searchPanel.getByRole('textbox', { name: 'Message Mori' }).fill(prompt)
    await searchPanel.getByRole('button', { name: 'Send', exact: true }).click()
  }
  await searchChat('find my adobo')
  await expect(searchApp.page).toHaveURL(new RegExp(`/app/recipes/${recipe.id}$`), { timeout: 3000 })
  await expect(searchPanel.getByText('I’ll open “Adobo”.')).toBeVisible()
  await expect(searchApp.page.locator('.mm-reading-skeleton')).toBeVisible()
  releaseAdoboDetail()
  const adoboHeading = searchApp.page.getByRole('heading', { name: 'Adobo', exact: true })
  await expect(adoboHeading).toBeFocused()
  await searchChat('find my adobo')
  await expect(adoboHeading).toBeFocused()

  const recipeUrl = searchApp.page.url()
  await searchChat('find my ado')
  await expect(searchPanel.getByRole('group', { name: 'Matching saved recipes' }).getByRole('button', { name: /Adobo/ })).toBeVisible()
  await expect(searchApp.page).toHaveURL(recipeUrl)

  await searchChat('find my missing')
  await expect(searchPanel.getByText('I couldn’t find a saved recipe matching “missing”.')).toBeVisible()
  await expect(searchApp.page).toHaveURL(recipeUrl)

  await searchChat('find my broken')
  const searchError = searchPanel.getByText('I couldn’t search your saved recipes. Try again in a moment.')
  await expect(searchError).toHaveCount(1)
  await expect(searchApp.page).toHaveURL(recipeUrl)

  await searchChat('find my private')
  await expect(searchError).toHaveCount(2)
  await expect(searchPanel.getByRole('button', { name: /Private/ })).toHaveCount(0)
  await expect(searchApp.page).toHaveURL(recipeUrl)

  await searchChat('find my soup')
  await expect(searchPanel.getByRole('button', { name: /Soup · match 1/ })).toBeVisible()
  await expect(searchApp.page).toHaveURL(recipeUrl)
  const secondSoupChoice = searchPanel.getByRole('button', { name: /Soup · match 2/ })
  await secondSoupChoice.scrollIntoViewIfNeeded()
  await searchApp.page.screenshot({ path: path.join(outputDir, 'mori-recipe-matches.png') })
  await secondSoupChoice.click()
  await expect(searchApp.page).toHaveURL(new RegExp(`/app/recipes/${secondSoup.id}$`))
  await expect(searchApp.page.getByRole('heading', { name: 'Soup', exact: true })).toBeVisible()
  holdAdobo = true
  await searchChat('find my adobo')
  await expect(searchPanel.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await searchApp.page.getByRole('link', { name: 'Back to recipes', exact: true }).click()
  await expect(searchApp.page).toHaveURL(/\/app\/recipes$/)
  await searchApp.page.getByRole('button', { name: 'Talk to Mori', exact: true }).click()
  releaseAdobo()
  await expect(searchPanel.getByRole('group', { name: 'Matching saved recipes' }).getByRole('button', { name: /Adobo/ })).toHaveCount(2)
  await expect(searchApp.page).toHaveURL(/\/app\/recipes$/)
  assert.deepEqual(searchApp.errors, [])
  await searchApp.context.close()

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
    // Exercise uninterrupted playback, including a slower browser rendering cycle.
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
    await expect(page.locator('[data-journal-page-turn]')).toHaveAttribute('data-phase', 'animating')
    await page.setViewportSize({ width: 720, height: 450 })
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    await settleReadingPages(page)
    await page.screenshot({ path: path.join(outputDir, `${width}-short-landscape.png`) })
    await page.setViewportSize({ width, height: 900 })
    await settleReadingPages(page)
    await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.setViewportSize({ width: 1180, height: 780 })
      await settleReadingPages(page)
      await page.evaluate(() => { globalThis.__moriSampleTurns = true })
      const layer = page.locator('[data-journal-page-turn]')
      const actor = layer.locator('[data-mori-paper-actor] > :is(svg, img):visible')
      await page.getByRole('button', { name: 'Next Page', exact: true }).click()
      await expect(actor).toBeVisible()
      const turnId = await layer.getAttribute('data-turn-id')
      await page.locator('.mm-journal-spread .mm-button--page-turn').evaluateAll((buttons) => buttons.forEach((button) => button.click()))
      await expect(layer).toHaveAttribute('data-turn-id', turnId)
      await verifyMoriPageTurn(page, character, 'forward')
      await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
      await expect(actor).toBeVisible()
      await page.locator('.mm-desk-brand').click()
      await expect(page).toHaveURL(`${origin}app/recipes`)
      await expect(layer).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Talk to Mori', exact: true })).toBeEnabled()
    }
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
  await emptyPanel.getByRole('button', { name: 'Open recipe editor' }).click()
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
