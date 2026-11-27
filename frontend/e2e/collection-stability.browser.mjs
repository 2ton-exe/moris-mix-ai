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
import { settleJournalLayout } from './journal-geometry.mjs'

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
    let releaseMori
    const moriReady = new Promise(resolve => { releaseMori = resolve })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) {
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
        return route.continue()
      }
      assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'browser-test@example.test' } })
      if (url.pathname === '/functions/v1/generate-recipe') {
        await moriReady
        return route.fulfill({ status: 503, json: { error: { code: 'AI_DISABLED', message: 'Isolated AI unavailable' } } })
      }
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
    await page.screenshot({ path: path.join(output, `${width}-loading.png`) })
    const loadingGeometry = await loadingCard.evaluate(e => e.getBoundingClientRect().toJSON())
    const loadingArt = await loadingCard.locator('.mm-recipe-artwork').evaluate(e => e.getBoundingClientRect().toJSON())
    releaseRecipes()
    await page.getByRole('heading', { name: 'Saved recipes (5)' }).waitFor()
    await page.waitForTimeout(1000)
    const loadedCard = page.locator('.mm-journal-page .mm-collection-entry').first()
    const loadedGeometry = await loadedCard.evaluate(e => e.getBoundingClientRect().toJSON())
    const loadedArt = await loadedCard.locator('.mm-recipe-artwork').evaluate(e => e.getBoundingClientRect().toJSON())
    await page.screenshot({ path: path.join(output, `${width}-loaded.png`) })
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
    await expect.poll(() => page.evaluate(() => {
      const mori = globalThis.document.querySelector('.mori-pet-trigger')?.getBoundingClientRect()
      return !mori || [...globalThis.document.querySelectorAll('.mm-journal-spread .mm-collection-entry')].every(art => {
        const photo = art.getBoundingClientRect()
        return mori.right <= photo.left || mori.left >= photo.right || mori.bottom <= photo.top || mori.top >= photo.bottom
      })
    })).toBe(true)
    const corner = page.getByRole('link', { name: /^Next page/ })
    if (await corner.count()) {
      await corner.hover()
      await expect.poll(() => corner.locator('..').locator('.mm-paper-corner__arrow').evaluate(element => globalThis.getComputedStyle(element).opacity)).toBe('1')
      await page.screenshot({ path: path.join(output, `${width}-corner-hover.png`) })
    }
    const hover = []
    for (const card of await page.locator('.mm-journal-page .mm-collection-body > .mm-collection-entries .mm-collection-entry').all()) {
      await card.hover()
      await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
      hover.push(await card.evaluate(element => globalThis.getComputedStyle(element).borderColor))
    }
    assert.equal(new Set(hover).size, 1, 'Recipe scraps share one hover treatment')

    const seen = new Set()
    for (let turn = 0; turn < recipes.length; turn++) {
      const lists = page.locator('.mm-collection-body > .mm-collection-entries')
      if (turn === 0) {
        await expect(page.locator('.mm-journal-flyleaf .mm-bookplate')).toBeVisible()
        await expect(page.locator('.mm-journal-flyleaf .mm-collection-entry')).toHaveCount(0)
        await expect(lists).toHaveCount(1)
        await expect(page.getByRole('heading', { name: 'My recipes', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Search saved recipes' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Refresh recipes' })).toBeVisible()
      } else {
        await expect(page.locator('.mm-journal-flyleaf .mm-bookplate')).toBeHidden()
        await expect(lists).toHaveCount(2)
        await expect(page.locator('.mm-journal-spread .mm-collection-heading')).toHaveCount(0)
        await expect(page.getByRole('link', { name: 'Search saved recipes' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Refresh recipes' })).toHaveCount(0)
      }
      await page.screenshot({ path: path.join(output, `${width}-spread-${turn}.png`) })
      for (const list of await lists.all()) {
        const remaining = recipes.length - seen.size
        assert.equal(await list.locator(':scope > li').count(), Math.min(2, remaining), 'Each desktop leaf must fit multiple ordinary recipes')
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
      await page.evaluate(() => {
        globalThis.__paperFrameTimes = []
        const sample = now => {
          globalThis.__paperFrameTimes.push(now)
          globalThis.__paperFrame = globalThis.requestAnimationFrame(sample)
        }
        globalThis.__paperFrame = globalThis.requestAnimationFrame(sample)
      })
      await next.click()
      const leaf = page.locator('.mm-turn-leaf')
      await leaf.waitFor()
      assert.ok(await leaf.evaluate(element => element.getAnimations().length > 0), 'Desktop paper motion must use the browser animation timeline')
      await page.waitForURL(new URL(target, origin).href)
      await expect(page.locator('[data-journal-page-turn="true"]')).toHaveCount(0)
      const timing = await page.evaluate(() => {
        globalThis.cancelAnimationFrame(globalThis.__paperFrame)
        const times = globalThis.__paperFrameTimes
        const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b)
        return { elapsed: times.at(-1) - times[0], frames: times.length, mainThreadRafP95: gaps[Math.floor(gaps.length * .95)] }
      })
      globalThis.console.log(`${width}x${height}: paper timing ${JSON.stringify(timing)}`)
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
    if (width === 1470) {
      await page.screenshot({ path: path.join(output, 'mori-idle.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Talk to Mori' }).click()
      const chat = page.getByRole('region', { name: 'Mori', exact: true })
      const resize = page.getByRole('button', { name: 'Resize Mori chat' })
      await expect(chat).toBeVisible()
      await expect(page.locator('.mori-pet-bubble')).toHaveCSS('opacity', '1')
      const initial = await chat.boundingBox()
      await page.screenshot({ path: path.join(output, 'mori-chat-default.png'), animations: 'disabled' })
      assert.ok(await chat.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Default chat must fit its controls without scrolling')
      await chat.getByRole('textbox', { name: 'Message Mori' }).focus()
      await chat.getByRole('button', { name: 'Close Mori' }).click()
      await expect(chat).toBeHidden()
      await expect(page.getByRole('button', { name: 'Talk to Mori' })).toBeFocused()
      await page.getByRole('button', { name: 'Talk to Mori' }).press('Enter')
      await expect(chat).toBeVisible()
      await expect(page.locator('.mori-pet-bubble')).toHaveCSS('opacity', '1')
      for (const [chatWidth, chatHeight] of [[1470, 803], [1280, 720], [1100, 640]]) {
        await page.setViewportSize({ width: chatWidth, height: chatHeight })
        await settleJournalLayout(page)
        const before = await chat.boundingBox()
        const grip = await resize.boundingBox()
        await page.mouse.move(grip.x + 22, grip.y + 22)
        await page.mouse.down()
        await page.mouse.move(grip.x + 37, Math.max(10, grip.y - 180), { steps: 12 })
        await page.mouse.up()
        await settleJournalLayout(page)
        await page.screenshot({ path: path.join(output, `${chatWidth}-mori-empty-resized.png`), animations: 'disabled' })
        const after = await chat.boundingBox()
        const hint = await chat.locator('.mori-chat-hint').boundingBox()
        const composer = await chat.locator('.mori-chat-composer').boundingBox()
        assert.ok(after.height > before.height + 60, 'Dragging an empty chat upward expands it')
        assert.ok(Math.abs(after.y + after.height - before.y - before.height) < 1, 'Empty chat resize anchors the bottom edge')
        assert.ok(after.y + after.height - hint.y - hint.height <= 25, 'Empty chat keeps its composer and tools at the bottom when enlarged')
        assert.ok(composer.y > after.y + after.height / 2, 'An enlarged empty chat places writing below the greeting area')
        assert.ok(await chat.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Enlarged empty chat fits without panel scrolling')
        if (chatWidth === 1470) {
          await chat.getByRole('button', { name: 'Write cooking notes', exact: true }).click()
          const example = await chat.locator('.mori-chat-example').boundingBox()
          const writing = await chat.locator('.mori-chat-composer').boundingBox()
          assert.ok(writing.y - example.y - example.height <= 10, 'Prompt examples stay next to the composer in an enlarged empty chat')
          await chat.getByRole('textbox', { name: 'Message Mori' }).fill('')
          await chat.getByRole('button', { name: 'Find a saved recipe', exact: true }).click()
          await chat.getByRole('textbox', { name: 'Message Mori' }).fill('')
        }
        await resize.press('Enter')
        await settleJournalLayout(page)
        assert.ok((await chat.boundingBox()).height < before.height + 2, `Reset returns empty chat to its natural compact height (${before.height} → ${(await chat.boundingBox()).height})`)
      }
      await page.setViewportSize({ width, height })
      await settleJournalLayout(page)
      await chat.getByRole('textbox', { name: 'Message Mori' }).fill('Hello')
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(chat.locator('.mori-chat-message')).toHaveCount(2)
      const conversation = await chat.boundingBox()
      assert.equal(conversation.width, initial.width, 'Starting a conversation must not widen the bubble')
      assert.ok(conversation.height < 480, 'A short conversation stays compact until the user expands it')
      await expect(chat.getByRole('navigation', { name: 'Open a journal page' })).toBeVisible()
      await page.evaluate(() => {
        globalThis.__moriDisclosureFrames = []
        const sample = () => {
          const panel = globalThis.document.querySelector('.mori-pet-panel').getBoundingClientRect()
          globalThis.__moriDisclosureFrames.push({ top: panel.top, bottom: panel.bottom })
          if (globalThis.__moriDisclosureFrames.length < 16) globalThis.requestAnimationFrame(sample)
        }
        globalThis.requestAnimationFrame(sample)
      })
      await chat.getByRole('button', { name: 'Suggested prompts', exact: true }).click()
      await page.waitForFunction(() => globalThis.__moriDisclosureFrames.length === 16)
      assert.ok(await page.evaluate(() => globalThis.__moriDisclosureFrames.every(frame => frame.top >= 0 && frame.bottom <= globalThis.innerHeight)), 'Disclosure growth stays inside the viewport on every rendered frame')
      await expect(chat.getByRole('button', { name: 'Open recipe editor' })).toBeVisible()
      assert.ok((await chat.getByRole('log').boundingBox()).height >= 128, 'Open suggestions must preserve a readable conversation')
      await page.screenshot({ path: path.join(output, 'mori-chat-open-shortcuts.png'), animations: 'disabled' })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const [chatWidth, chatHeight] of [[1470, 803], [1280, 720], [1100, 640]]) {
        await page.setViewportSize({ width: chatWidth, height: chatHeight })
        await settleJournalLayout(page)
        const closeControl = await chat.getByRole('button', { name: 'Close Mori' }).boundingBox()
        const resizeControl = await resize.boundingBox()
        assert.ok(Math.abs(closeControl.y + closeControl.height / 2 - resizeControl.y - resizeControl.height / 2) < 1, 'Close and resize controls share the header row')
        assert.ok(closeControl.x + closeControl.width <= resizeControl.x + 1, 'Close and resize keep separate click areas')
        assert.ok(await chat.locator('.mori-chat-tools').evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'The compact toolbar keeps navigation visible without scrolling')
        const promptToggle = chat.getByRole('button', { name: 'Suggested prompts', exact: true })
        const promptBounds = await promptToggle.boundingBox()
        const writing = await chat.locator('.mori-chat-composer').boundingBox()
        const tools = await chat.locator('.mori-chat-tools').boundingBox()
        const thread = await chat.getByRole('log').boundingBox()
        assert.ok(thread.y + thread.height <= tools.y + 1, 'Suggestions reserve their own space below the chat thread')
        assert.ok(tools.y + tools.height <= writing.y + 1, 'Suggestions stay above the input without covering it')
        const navButtons = chat.getByRole('navigation', { name: 'Open a journal page' }).getByRole('button')
        assert.equal(await navButtons.count(), 4)
        await promptToggle.focus()
        for (const destination of await navButtons.all()) {
          await page.keyboard.press('Tab')
          await expect(destination).toBeFocused()
          const button = await destination.boundingBox()
          assert.ok(Math.abs(button.y - promptBounds.y) < 1 && Math.abs(button.height - promptBounds.height) < 1, 'Navigation shares the Suggested prompts row and height')
          await expect(destination.locator('.mori-chat-shortcut-label')).toHaveCSS('opacity', '1')
          const label = await destination.locator('.mori-chat-shortcut-label').boundingBox()
          const panel = await chat.boundingBox()
          assert.ok(label.x >= panel.x && label.y >= panel.y && label.x + label.width <= panel.x + panel.width, 'Keyboard destination labels remain within the bubble')
        }
        await page.keyboard.press('Tab')
        await expect(chat.getByRole('button', { name: 'See more', exact: true })).toBeFocused()
        const beforePointer = await chat.boundingBox()
        const pointerGrip = await resize.boundingBox()
        await page.mouse.move(pointerGrip.x + 22, pointerGrip.y + 22)
        await page.mouse.down()
        await page.mouse.move(pointerGrip.x + 37, Math.max(10, pointerGrip.y - 130), { steps: 12 })
        await page.mouse.up()
        await settleJournalLayout(page)
        const afterPointer = await chat.boundingBox()
        assert.ok(Math.abs(afterPointer.y + afterPointer.height - beforePointer.y - beforePointer.height) < 1, 'Fast pointer resizing from natural dialogue keeps the opposite bottom edge anchored')
        assert.ok((await chat.getByRole('log').boundingBox()).height >= 128, 'Pointer resizing preserves readable history')
        await page.screenshot({ path: path.join(output, `${chatWidth}-mori-chat-pointer.png`), animations: 'disabled' })
        await resize.press('Enter')
      }
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await settleJournalLayout(page)
      await chat.getByRole('button', { name: 'Suggested prompts', exact: true }).click()
      assert.ok(await chat.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Conversation history must scroll inside the log without pushing the composer out')
      await page.screenshot({ path: path.join(output, 'mori-chat-conversation.png'), animations: 'disabled' })
      await chat.getByRole('textbox', { name: 'Message Mori' }).fill('Hello Mori, I am planning supper for my family. '.repeat(35))
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(chat.locator('.mori-chat-message')).toHaveCount(4)
      const history = chat.locator('.mori-chat-history')
      await expect(history).toBeVisible()
      if (await history.textContent() === 'Latest reply') await history.click()
      await chat.getByRole('button', { name: 'Earlier conversation' }).click()
      assert.equal(await chat.getByRole('log').evaluate(element => element.scrollTop), 0)
      await page.screenshot({ path: path.join(output, 'mori-chat-long-history.png'), animations: 'disabled' })
      await expect(chat.getByRole('button', { name: 'Latest reply' })).toBeVisible()
      await chat.getByRole('button', { name: 'Latest reply' }).click()
      await chat.getByRole('textbox', { name: 'Message Mori' }).fill('A cooking note kept while resizing.')
      await resize.focus()
      await settleJournalLayout(page)
      const beforeResize = await chat.boundingBox()
      const beforeLog = await chat.getByRole('log').boundingBox()
      for (let step = 0; step < 6; step++) await resize.press('ArrowUp')
      await page.screenshot({ path: path.join(output, 'mori-chat-expanded.png'), animations: 'disabled' })
      const bounds = await chat.boundingBox()
      assert.ok(bounds.height > beforeResize.height + 20, 'ArrowUp expands the actual conversation panel')
      assert.ok((await chat.getByRole('log').boundingBox()).height > beforeLog.height + 20, 'Extra height goes to the conversation')
      assert.ok(Math.abs(bounds.y + bounds.height - beforeResize.y - beforeResize.height) < 2, `Upward resizing preserves the bottom edge (${beforeResize.y + beforeResize.height} → ${bounds.y + bounds.height})`)
      const grip = await resize.boundingBox()
      assert.ok(grip.x + grip.width >= bounds.x + bounds.width - 12, 'The resize grip belongs in the top-right corner')
      assert.ok(await chat.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Expanded chat must keep its controls visible')
      await resize.press('ArrowRight')
      const wider = await chat.boundingBox()
      assert.equal(wider.x, bounds.x, 'Resizing from the top right keeps the left edge anchored')
      assert.ok(wider.width > bounds.width, 'ArrowRight widens the chat')
      const dragGrip = await resize.boundingBox()
      await page.mouse.move(dragGrip.x + 22, dragGrip.y + 22)
      await page.mouse.down()
      await page.mouse.move(dragGrip.x + 52, dragGrip.y - 2, { steps: 4 })
      await page.mouse.up()
      const dragged = await chat.boundingBox()
      assert.ok(dragged.width > wider.width, 'The corner grip resizes the dialogue width')
      assert.ok(Math.abs(dragged.x - wider.x) < 1 && dragged.height > beforeResize.height + 20, 'Manual sizing preserves the anchored edge and grows beyond the natural height')
      await resize.click()
      assert.equal((await chat.boundingBox()).width, dragged.width, 'A pointer click on the grip does not expand or collapse chat')
      await resize.press('Enter')
      assert.equal((await chat.boundingBox()).width, initial.width, 'Keyboard reset restores the original width')
      await expect.poll(async () => (await chat.boundingBox()).height).toBeLessThanOrEqual(560)
      await expect(chat.getByRole('textbox', { name: 'Message Mori' })).toHaveValue('A cooking note kept while resizing.')
      for (let step = 0; step < 6; step++) { await resize.press('ArrowLeft'); await resize.press('ArrowDown') }
      assert.ok(await chat.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'The smallest desktop chat must keep its controls visible')
      await page.screenshot({ path: path.join(output, 'mori-chat-smallest.png'), animations: 'disabled' })
      await resize.press('Enter')
      await chat.getByRole('textbox', { name: 'Message Mori' }).fill('What can I cook with rice and eggs; quick and spicy')
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(chat.getByRole('status')).toContainText('Mori is working')
      await page.screenshot({ path: path.join(output, 'mori-chat-thinking.png'), animations: 'disabled' })
      releaseMori()
      await expect(chat.getByRole('button', { name: 'Retry same request' })).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: path.join(output, 'mori-chat-error.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Close Mori' }).click()
      const mori = page.getByRole('button', { name: 'Talk to Mori' })
      const actor = await mori.boundingBox()
      await page.mouse.move(actor.x + actor.width / 2, actor.y + 24)
      await page.mouse.down()
      await page.mouse.move(80, 500, { steps: 8 })
      await page.mouse.up()
      await mori.click()
      await expect(page.locator('.mori-pet-bubble')).toHaveAttribute('data-placement', 'right')
      await resize.focus()
      for (let step = 0; step < 6; step++) { await resize.press('ArrowRight'); await resize.press('ArrowUp') }
      for (const [chatWidth, chatHeight] of [[1470, 803], [1280, 720], [1100, 640]]) {
        await page.setViewportSize({ width: chatWidth, height: chatHeight })
        await expect.poll(async () => {
          const panel = await chat.boundingBox()
          return panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= chatWidth && panel.y + panel.height <= chatHeight
        }, { message: `Resized chat must stay within ${chatWidth}×${chatHeight}` }).toBe(true)
        await page.screenshot({ path: path.join(output, `${chatWidth}-mori-chat-resized.png`), animations: 'disabled' })
      }
      await page.getByRole('button', { name: 'Close Mori' }).click()
    }
    await context.close()
  }
  globalThis.console.log(`Screenshots: ${output}`)
} finally { await browser?.close(); await server.close() }
