// Companion acceptance through a signed-in app with isolated API responses.
// This journey never contacts hosted Supabase or performs recipe mutations.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiOrigin = 'https://mori-dialogue.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId, notes: 'A local browser fixture.' }
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

function corsHeaders() {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info',
    'access-control-max-age': '600',
  }
}

async function createJournal(width, { reducedMotion = false, empty = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const errors = []
  const apiRequests = []
  const chatRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url())
    if (url.origin === appOrigin || url.protocol === 'data:') return route.continue()
    assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
    const method = route.request().method()
    apiRequests.push({ method, path: url.pathname })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders() })
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'mori@example.test' }, headers: corsHeaders() })
    }
    if (url.pathname === '/functions/v1/recipes' && method === 'GET') {
      const recipes = empty ? [] : [{ id: recipe.id, title: recipe.title, user_id: userId, star_rating: recipe.star_rating, cooked_at: recipe.cooked_at }]
      return route.fulfill({ json: { recipes, has_more: false, next_cursor: null }, headers: corsHeaders() })
    }
    if (url.pathname === '/functions/v1/mori-chat' && method === 'POST') {
      const request = route.request().postDataJSON()
      chatRequests.push(request)
      await new Promise((resolve) => globalThis.setTimeout(resolve, 180))
      return route.fulfill({ json: { reply: 'Try a simple rice bowl with garlic and a little oil.' }, headers: corsHeaders() })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request.' } }, headers: corsHeaders() })
  })
  await page.addInitScript(({ id }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const user = { id, aud: 'authenticated', email: 'mori@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: id, exp: expires_at }))}.test-signature`
    globalThis.localStorage.setItem('sb-mori-dialogue-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { id: userId })
  return { context, page, errors, apiRequests, chatRequests }
}

async function reachable(page, locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  const geometry = await locator.evaluate((element) => {
    const character = element.closest('.mori-pet-character')
    return {
      character: character?.getAttribute('style'),
      characterRect: character?.getBoundingClientRect().toJSON(),
      triggerRect: element.getBoundingClientRect().toJSON(),
      mobile: globalThis.matchMedia('(max-width: 600px)').matches,
      innerWidth: globalThis.innerWidth,
    }
  })
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `Companion control must remain reachable: ${JSON.stringify({ box, viewport, geometry })}`)
}

async function assertNavigationIsClear(page, panel) {
  const panelBox = await panel.boundingBox()
  assert.ok(panelBox)
  for (const selector of ['.mm-desk-toolbar', '.mm-bookmarks']) {
    const controlBox = await page.locator(selector).boundingBox()
    if (!controlBox) continue
    const overlapWidth = Math.max(0, Math.min(panelBox.x + panelBox.width, controlBox.x + controlBox.width) - Math.max(panelBox.x, controlBox.x))
    const overlapHeight = Math.max(0, Math.min(panelBox.y + panelBox.height, controlBox.y + controlBox.height) - Math.max(panelBox.y, controlBox.y))
    assert.equal(overlapWidth * overlapHeight, 0, `Chat should not cover ${selector}: ${JSON.stringify({ panelBox, controlBox })}`)
  }
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  appOrigin = new globalThis.URL(origin).origin
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const width of [1440, 768, 375, 320]) {
    const { context, page, errors, apiRequests, chatRequests } = await createJournal(width)
    await page.goto(`${origin}app/recipes?view=index`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Talk to Mori', exact: true })
    await reachable(page, trigger)
    assert.equal(await page.locator('.mori-pet-caption').count(), 0, 'Mori has no permanent caption beneath the artwork')
    const beforeChat = apiRequests.length
    await trigger.click()
    const panel = page.getByRole('dialog', { name: 'Mori', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('aria-modal', 'false')
    await assertNavigationIsClear(page, panel)
    await expect(panel.getByText('What are we cooking today?')).toBeVisible()
    await expect(panel.locator('.mori-chat-message--assistant .mori-chat-message-speaker')).toHaveCount(0)
    await expect(panel.getByRole('textbox', { name: 'Message Mori' })).toBeFocused()
    const initialPanel = await panel.boundingBox()
    assert.ok(initialPanel && initialPanel.height < 350, `Initial chat should stay compact: ${JSON.stringify(initialPanel)}`)
    const composerField = panel.locator('.mori-chat-composer-field')
    const composer = panel.getByRole('textbox', { name: 'Message Mori' })
    const send = panel.getByRole('button', { name: 'Send message to Mori' })
    await expect(send).toBeDisabled()
    await composer.fill('   ')
    await expect(send).toBeDisabled()
    await composer.fill('x')
    await expect(send).toBeEnabled()
    await composer.fill('')
    const inputBox = await composer.boundingBox()
    const sendBox = await send.boundingBox()
    assert.ok(inputBox && sendBox && sendBox.width >= 40 && sendBox.height >= 40)
    assert.ok(Math.abs((inputBox.y + inputBox.height / 2) - (sendBox.y + sendBox.height / 2)) <= 4, 'Send icon stays vertically centered beside a single-line input')
    assert.equal(await composerField.evaluate((element) => globalThis.getComputedStyle(element).borderTopWidth), '1px')
    assert.equal(await composer.evaluate((element) => globalThis.getComputedStyle(element).borderTopWidth), '0px')
    assert.equal(await page.getByRole('button', { name: 'Mori settings' }).count(), 1, 'Settings are available in the chat header')
    await assertJournalSemantics(page, `${width}px open companion`)
    await page.screenshot({ path: path.join(outputDir, `${width}-companion.png`) })

    await panel.getByRole('button', { name: 'Find a dinner idea' }).click()
    await expect(panel.getByRole('status')).toContainText('thinking', { timeout: 1000 })
    await expect(panel.getByText('Try a simple rice bowl with garlic and a little oil.')).toBeVisible()
    assert.deepEqual(chatRequests[0], {
      messages: [{ role: 'user', content: 'Suggest something I can cook with ingredients I have.' }], page: 'recipes',
    })

    await composer.fill('I have rice')
    await composer.press('Shift+Enter')
    await composer.type('and eggs')
    await expect(composer).toHaveValue('I have rice\nand eggs')
    assert.equal(chatRequests.length, 1, 'Shift+Enter must not submit the message')
    await composer.press('Enter')
    await expect(panel.getByText('Try a simple rice bowl with garlic and a little oil.')).toHaveCount(2)
    assert.deepEqual(chatRequests[1], {
      messages: [
        { role: 'user', content: 'Suggest something I can cook with ingredients I have.' },
        { role: 'assistant', content: 'Try a simple rice bowl with garlic and a little oil.' },
        { role: 'user', content: 'I have rice\nand eggs' },
      ], page: 'recipes',
    })
    if (width === 1440) {
      for (let turn = 0; turn < 5; turn += 1) {
        await composer.fill(`Give me another cooking tip ${turn + 1}`)
        await composer.press('Enter')
        await expect(panel.getByText('Try a simple rice bowl with garlic and a little oil.')).toHaveCount(turn + 3)
      }
      const expandedPanel = await panel.boundingBox()
      const log = await panel.getByRole('log').evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
      const composerBox = await panel.locator('.mori-chat-composer').boundingBox()
      assert.ok(expandedPanel && expandedPanel.height > initialPanel.height && expandedPanel.height <= 480)
      assert.ok(log.scrollHeight > log.clientHeight, 'Only the conversation history scrolls when it grows')
      assert.ok(composerBox && composerBox.y + composerBox.height <= expandedPanel.y + expandedPanel.height)
    }
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(panel.getByText('I have rice\nand eggs')).toBeVisible()
    await reachable(page, panel)
    await panel.getByRole('button', { name: 'Close Mori chat' }).click()

    const original = await trigger.boundingBox()
    await trigger.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await trigger.boundingBox()).x).toBeLessThan(original.x)
    const dragged = await trigger.boundingBox()
    await page.mouse.move(dragged.x + dragged.width / 2, dragged.y + dragged.height / 2)
    await page.mouse.down()
    await page.mouse.move(Math.max(0, dragged.x - 80), Math.max(0, dragged.y - 80), { steps: 6 })
    await page.mouse.up()
    await expect(panel).toHaveCount(0)
    await reachable(page, trigger)

    await trigger.click()
    await expect(panel).toBeVisible()
    const settingsButton = panel.getByRole('button', { name: 'Mori settings' })
    await settingsButton.focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('button', { name: 'Hide Mori' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(settingsButton).toBeFocused()
    await settingsButton.click()
    await page.getByRole('button', { name: 'Hide Mori' }).click()
    const show = page.getByRole('button', { name: 'Show Mori' })
    await expect(show).toBeFocused()
    await page.reload()
    await expect(show).toBeVisible()
    await show.click()
    await expect(trigger).toBeVisible()
    await reachable(page, trigger)
    assert.equal(chatRequests.length, width === 1440 ? 7 : 2)
    assert.ok(apiRequests.slice(beforeChat).some(({ method, path }) => method === 'POST' && path === '/functions/v1/mori-chat'))

    if (width <= 375) {
      await page.setViewportSize({ width, height: 480 })
      await trigger.click()
      await reachable(page, panel)
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
      await page.screenshot({ path: path.join(outputDir, `${width}-mobile-sheet.png`) })
      await page.keyboard.press('Escape')
    }
    await page.goto(`${origin}app/recipes/new`)
    await expect(page.getByRole('heading', { name: 'New recipe', exact: true })).toBeVisible()
    await expect(trigger).toBeVisible()
    await page.goto(`${origin}home`)
    await expect(trigger).toHaveCount(0)
    assert.deepEqual(errors, [])
    await context.close()
    process.stdout.write(`${width}px: conversational API, retry-safe history, direct drag, keyboard, settings and route behavior passed.\n`)
  }

  const emptyApp = await createJournal(390, { empty: true })
  await emptyApp.page.goto(`${origin}app/recipes`)
  await expect(emptyApp.page.getByRole('heading', { name: 'A fresh page for your next favorite.' })).toBeVisible()
  await emptyApp.page.getByRole('button', { name: 'Talk to Mori', exact: true }).click()
  const emptyPanel = emptyApp.page.getByRole('dialog', { name: 'Mori', exact: true })
  await expect(emptyPanel.getByRole('button', { name: 'Find one of my recipes' })).toBeVisible()
  assert.deepEqual(emptyApp.errors, [])
  await emptyApp.context.close()

  const { context, page, errors } = await createJournal(1440, { reducedMotion: true })
  await page.goto(`${origin}app/recipes`)
  const trigger = page.getByRole('button', { name: 'Talk to Mori', exact: true })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Mori', exact: true })
  await expect(panel).toBeVisible()
  const animated = await trigger.locator('svg').evaluate((svg) => [svg, ...svg.querySelectorAll('*')].filter((element) =>
    globalThis.getComputedStyle(element).animationName !== 'none').length)
  assert.equal(animated, 0, 'Reduced motion must disable character animation')
  await page.setViewportSize({ width: 720, height: 450 })
  await expect.poll(async () => { const box = await panel.boundingBox(); return Boolean(box && box.y + box.height <= 450) }).toBe(true)
  await expect.poll(async () => {
    const panelBox = await panel.boundingBox()
    const controlBoxes = await Promise.all(['.mm-desk-toolbar', '.mm-bookmarks'].map((selector) => page.locator(selector).boundingBox()))
    return Boolean(panelBox && controlBoxes.every((controlBox) => !controlBox ||
      Math.max(0, Math.min(panelBox.x + panelBox.width, controlBox.x + controlBox.width) - Math.max(panelBox.x, controlBox.x)) *
      Math.max(0, Math.min(panelBox.y + panelBox.height, controlBox.y + controlBox.height) - Math.max(panelBox.y, controlBox.y)) === 0))
  }).toBe(true)
  await assertNavigationIsClear(page, panel)
  await reachable(page, panel)
  await page.screenshot({ path: path.join(outputDir, 'reduced-motion-reflow.png') })
  assert.deepEqual(errors, [])
  await context.close()
  process.stdout.write(`Compact greeting and reduced motion passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
