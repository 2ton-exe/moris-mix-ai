// Companion acceptance through the signed-in app with isolated API responses.
// This journey never contacts hosted Supabase or performs recipe mutations.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { settleJournalLayout } from './journal-geometry.mjs'
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

async function createJournal(width, { reducedMotion = false, empty = false, chef = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const errors = []
  const apiRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === appOrigin || url.protocol === 'data:') return route.continue()
    assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
    apiRequests.push({ method: route.request().method(), path: url.pathname })
    if (chef && route.request().method() === 'POST' && url.pathname === '/functions/v1/generate-recipe') {
      assert.deepEqual(JSON.parse(route.request().postData()), { pantryItems: ['rice'], preferences: 'quick dinner' })
      return route.fulfill({ json: chefResponse })
    }
    assert.equal(route.request().method(), 'GET', `Unexpected write or mutation request: ${route.request().method()} ${url.pathname}`)
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'mori@example.test' } })
    if (url.pathname === '/functions/v1/recipes') {
      const recipes = empty ? [] : [{ id: recipe.id, title: recipe.title, user_id: userId, star_rating: recipe.star_rating, cooked_at: recipe.cooked_at }]
      return route.fulfill({ json: { recipes, has_more: false, next_cursor: null } })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request.' } } })
  })
  await page.addInitScript(({ id }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const user = { id, aud: 'authenticated', email: 'mori@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: id, exp: expires_at }))}.test-signature`
    globalThis.localStorage.setItem('sb-mori-dialogue-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { id: userId })
  return { context, page, errors, apiRequests }
}

async function reachable(page, locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `Companion control must remain reachable: ${JSON.stringify(box)}`)
}

async function verifyMoriPageRun(page, character, direction) {
  await expect(page.locator('[data-journal-page-turn]')).toBeVisible()
  await expect(character).toHaveAttribute('data-turn-direction', direction)
  const pageRun = await character.evaluate((node) => {
    const animation = node.getAnimations()[0]
    if (!animation) return null
    animation.pause()
    animation.currentTime = Number.parseFloat(globalThis.getComputedStyle(node).animationDuration) * 500
    return {
      name: globalThis.getComputedStyle(node).animationName,
      delta: Math.abs(node.getBoundingClientRect().x - Number.parseFloat(node.style.left)),
      mood: node.querySelector('.mm-mori')?.getAttribute('data-mood'),
    }
  })
  assert.equal(pageRun?.name, 'mori-pet-page-run')
  assert.equal(pageRun?.mood, 'turn')
  assert.ok((pageRun?.delta ?? 0) > 40, 'Mori runs across the book while turning a page')
  await expect(page.locator('.mm-journal-book .mm-mori')).toHaveCount(0)
  await expect(page.locator('.mori-pet-root .mm-mori')).toHaveCount(1)
  await character.evaluate((node) => node.getAnimations().forEach((animation) => animation.play()))
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'))
  await expect(character).not.toHaveAttribute('data-turn-direction', direction)
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const width of [1440, 768, 375, 320]) {
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
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 320, height: 480 })
    await settleJournalLayout(page)
    await reachable(page, trigger)
    await trigger.click()
    await reachable(page, panel)
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
    await page.keyboard.press('Escape')
    await page.goto(`${origin}app/recipes/new`)
    await expect(page.getByRole('heading', { name: 'New recipe', exact: true })).toBeVisible()
    await expect(trigger).toBeVisible()
    await page.getByRole('button', { name: /^Next Pages?$/ }).click()
    await verifyMoriPageRun(page, character, 'forward')
    await page.getByRole('button', { name: /^Previous Pages?$/ }).click()
    await verifyMoriPageRun(page, character, 'backward')

    const chefApp = await createJournal(width, { chef: true })
    await chefApp.page.goto(`${origin}app/chef`)
    await expect(chefApp.page.getByRole('heading', { name: 'What’s in your pantry?' })).toBeVisible()
    await expect(chefApp.page.locator('.mm-ai-chef__journey li[aria-current="step"]')).toContainText('Pantry')
    await expect(chefApp.page.locator('.mm-journal-book .mm-mori')).toHaveCount(0)
    await expect(chefApp.page.locator('.mori-pet-caption')).toHaveCount(0)
    await expect(chefApp.page.locator('.mori-pet-character')).toHaveCount(1)
    const chefTrigger = chefApp.page.getByRole('button', { name: 'Talk to Mori', exact: true })
    const chefRequestsBeforeTalk = chefApp.apiRequests.length
    await chefTrigger.click()
    const chefPanel = chefApp.page.getByRole('region', { name: 'Mori', exact: true })
    await expect(chefPanel.locator('.mori-pet-context')).toHaveText('AI Chef')
    await expect(chefPanel.locator('.mori-pet-message')).toContainText('Tell me what you have')
    await expect(chefPanel.locator('nav')).toHaveCount(0)
    await chefPanel.getByRole('button', { name: 'Add ingredients' }).click()
    const pantryInput = chefApp.page.getByRole('textbox', { name: 'Pantry ingredient' })
    await expect(pantryInput).toBeFocused()
    await expect(chefApp.page.getByRole('region', { name: 'Pantry list, 0 items' })).toContainText('No ingredients yet.')
    await chefApp.page.keyboard.press('Escape')
    await pantryInput.fill('rice')
    await pantryInput.press('Enter')
    await expect(chefApp.page.getByRole('region', { name: 'Pantry list, 1 item' })).toContainText('rice')
    await expect(chefApp.page.getByRole('button', { name: 'Remove rice' })).toBeVisible()
    await chefApp.page.getByRole('textbox', { name: /Cooking preferences/ }).fill('quick dinner')
    assert.equal(chefApp.apiRequests.length, chefRequestsBeforeTalk, 'Companion and pantry edits must stay local')
    await chefApp.page.getByRole('button', { name: 'Ask Mori for a recipe' }).click()
    await expect(chefApp.page.getByRole('heading', { name: "Review Mori's recipe." })).toBeVisible()
    await expect.poll(async () => chefApp.page.getByRole('group', { name: 'Mori companion' }).getAttribute('data-activity')).toBe('celebrating')
    await chefTrigger.click()
    await expect(chefApp.page.locator('.mori-pet-context')).toHaveText('Recipe review')
    await expect(chefApp.page.locator('.mori-pet-message')).toHaveText('Your recipe idea is ready for review.')
    assert.deepEqual(chefApp.apiRequests.map(({ method, path }) => ({ method, path })), [
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
  await expect.poll(async () => { const box = await panel.boundingBox(); return Boolean(box && box.y + box.height <= 450) }).toBe(true)
  await reachable(page, panel)
  await page.screenshot({ path: path.join(outputDir, 'reduced-motion-reflow.png') })
  await page.goto(`${origin}app/recipes/new`)
  await page.getByRole('button', { name: /^Next Pages?$/ }).click()
  await expect(page.locator('[data-journal-page-turn]')).toHaveCount(0)
  await expect(page.locator('.mori-pet-character')).not.toHaveAttribute('data-turn-direction', 'forward')
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write(`Empty guidance and reduced motion passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
