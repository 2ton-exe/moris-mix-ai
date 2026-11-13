// Isolated UI-01 acceptance: synthetic auth and intercepted REST only.
// No hosted Supabase access or persisted user data.
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
const apiOrigin = 'https://journal-shell.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId, notes: '' }
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'moris-ui01-shell-'))
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-browser-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
})
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1440, 768, 375, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    const brokenResources = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400) brokenResources.push(response.url())
    })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) return route.continue()
      assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: userId, aud: 'authenticated', email: 'journal-test@example.test' } })
      assert.equal(route.request().method(), 'GET')
      if (url.pathname === '/functions/v1/recipes') return route.fulfill({ json: { recipes: [recipe], has_more: false, next_cursor: null } })
      if (url.pathname === `/functions/v1/recipes/${recipe.id}`) return route.fulfill({ json: { recipe } })
      return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Recipe not found.' } } })
    })
    await page.addInitScript(({ userId }) => {
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const user = { id: userId, aud: 'authenticated', email: 'journal-test@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
      globalThis.localStorage.setItem('sb-journal-shell-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { userId })

    const bookmarks = page.getByRole('navigation', { name: 'Journal sections' })
    async function checkShell(label) {
      await expect(page.getByRole('main')).toHaveCount(1)
      await expect(bookmarks).toBeVisible()
      const overflow = await page.evaluate(() => ({
        viewport: globalThis.innerWidth, document: globalThis.document.documentElement.scrollWidth,
        outside: [...globalThis.document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > globalThis.innerWidth + 1).slice(0, 12).map((element) => ({ className: String(element.className), right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })),
      }))
      assert.ok(overflow.document <= overflow.viewport, `${label}: overflow at ${width}px: ${JSON.stringify(overflow)}`)
      for (const link of await bookmarks.getByRole('link').all()) {
        const box = await link.boundingBox()
        assert.ok(box && box.width >= 44 && box.height >= 44)
        await link.focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        const focusState = await link.evaluate((element) => ({
          focused: element === globalThis.document.activeElement,
          focusVisible: element.matches(':focus-visible'),
          outline: globalThis.getComputedStyle(element).outlineStyle,
        }))
        assert.equal(focusState.focused && focusState.outline !== 'none', true, `${width}px ${label} bookmark ${await link.innerText()}: ${JSON.stringify(focusState)}`)
      }
      await page.screenshot({ path: path.join(outputDir, `${width}-${label}.png`) })
    }

    // Dashboard aliases, real links and browser history all use the production router.
    await page.goto(`${origin}app`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    await assertJournalSemantics(page, `${width}px dashboard`)
    await expect(bookmarks.getByRole('link', { name: 'My recipes' })).toHaveAttribute('aria-current', 'page')
    await checkShell('dashboard')
    await page.keyboard.press('Control+Home')
    await page.getByRole('link', { name: 'Skip to journal content' }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('main').evaluate((element) => element === globalThis.document.activeElement), true)
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: recipe.title, exact: true }) }).click()
    await expect(page.getByRole('heading', { name: recipe.title, exact: true })).toBeVisible()
    await expect(page).toHaveURL(`${origin}app/recipes/${recipe.id}`)
    await checkShell('detail')
    // Physical layers and containment must not trap a fixed confirmation dialog.
    const deleteButton = page.getByRole('button', { name: 'Delete recipe', exact: true })
    await deleteButton.click()
    const deleteDialog = page.getByRole('alertdialog')
    await expect(deleteDialog).toBeVisible()
    await assertJournalSemantics(page, `${width}px delete dialog`)
    const backdrop = await page.locator('.delete-dialog-backdrop').boundingBox()
    assert.ok(backdrop && Math.abs(backdrop.x) <= 1 && Math.abs(backdrop.y) <= 1 && Math.abs(backdrop.width - width) <= 1 && Math.abs(backdrop.height - 900) <= 1)
    await page.keyboard.press('Escape')
    await expect(deleteDialog).toHaveCount(0)
    await expect(deleteButton).toBeFocused()
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
    await page.goForward()
    await expect(page.getByRole('heading', { name: recipe.title, exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: recipe.title, exact: true })).toBeVisible()

    // Direct edit loading and new bookmark links retain the editor's dirty guard.
    await page.goto(`${origin}app/recipes/${recipe.id}/edit`)
    await expect(page.getByLabel('Recipe title')).toHaveValue(recipe.title)
    await expect(bookmarks.locator('[aria-current]')).toHaveCount(0)
    await checkShell('edit')
    await bookmarks.getByRole('link', { name: 'New recipe' }).click()
    await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeVisible()
    await expect(bookmarks.getByRole('link', { name: 'New recipe' })).toHaveAttribute('aria-current', 'page')
    await page.getByLabel('Recipe title').fill('Unsaved shell test')
    await bookmarks.getByRole('link', { name: 'My recipes' }).click()
    const leaveNote = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    await expect(leaveNote).toBeVisible()
    const keepEditing = leaveNote.getByRole('button', { name: 'Keep Editing' })
    const discardChanges = leaveNote.getByRole('button', { name: 'Discard Changes' })
    await expect(keepEditing).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(discardChanges).toBeFocused()
    await keepEditing.click()
    await expect(page.getByLabel('Recipe title')).toHaveValue('Unsaved shell test')
    await bookmarks.getByRole('link', { name: 'My recipes' }).click()
    await expect(leaveNote).toBeVisible()
    await leaveNote.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(page.getByLabel('Recipe title')).toHaveValue('Unsaved shell test')
    await bookmarks.getByRole('link', { name: 'My recipes' }).click()
    await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible()
    await page.getByRole('button', { name: 'Discard Changes' }).click()
    await expect(page).toHaveURL(`${origin}app/recipes`)
    await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()

    await page.goto(`${origin}app/recipes/new`)
    await checkShell('create')
    await page.goto(`${origin}app/recipes/missing`)
    await expect(page.getByRole('heading', { name: 'Recipe unavailable' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    await checkShell('error')
    await bookmarks.getByRole('link', { name: 'My recipes' }).click()
    await expect(page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
    await page.evaluate(async () => {
      await Promise.all(['Figtree', 'Fraunces', 'Caveat'].map((font) => globalThis.document.fonts.load(`16px ${font}`)))
      await globalThis.document.fonts.ready
    })
    const materials = await page.evaluate(async () => {
      const urls = ['.mm-desk', '.mm-journal-board--right'].flatMap((selector) => {
        const background = globalThis.getComputedStyle(globalThis.document.querySelector(selector)).backgroundImage
        return [...background.matchAll(/url\("?([^")]+)"?\)/g)].map((match) => match[1]).filter((url) => !url.startsWith('data:'))
      })
      const decoded = await Promise.all(urls.map(async (url) => { const image = new globalThis.Image(); image.src = url; await image.decode(); return image.naturalWidth > 0 }))
      return { urls, decoded, fonts: ['Figtree', 'Fraunces', 'Caveat'].map((font) => globalThis.document.fonts.check(`16px ${font}`)) }
    })
    assert.equal(materials.urls.length, 2)
    assert.ok(materials.decoded.every(Boolean) && materials.fonts.every(Boolean))
    if (width === 1440) {
      // Reflow equivalent to 200% in a 1440×900 viewport. Native browser zoom
      // and DPR are verified separately by journal-zoom.browser.mjs.
      await page.setViewportSize({ width: 720, height: 450 })
      await settleJournalLayout(page)
      await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))))
      await expect(page.getByRole('complementary', { name: 'Journal bookplate' })).toBeHidden()
      await checkShell('zoom-200')
      await page.setViewportSize({ width, height: 900 })
      await settleJournalLayout(page)
    }
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(`${origin}login`)
    await expect(page.locator('.mm-journal-book')).toHaveCount(0)
    assert.deepEqual(errors, [])
    assert.deepEqual(brokenResources, [])
    await context.close()
    process.stdout.write(`${width}px: shell, route aliases, detail/reload, Back/Forward, direct editors, dirty bookmark guard, error recovery, focus, local materials and logout passed.\n`)
  }
  // Public and unauthenticated deep links still follow the original boundaries.
  const guest = await browser.newContext()
  const page = await guest.newPage()
  await page.route(`${apiOrigin}/**`, (route) => route.fulfill({ status: 200, json: { recipe } }))
  for (const route of ['app', 'app/recipes', `app/recipes/${recipe.id}`, 'app/recipes/new', `app/recipes/${recipe.id}/edit`]) {
    await page.goto(`${origin}${route}`)
    await expect(page).toHaveURL(`${origin}login`)
  }
  for (const route of ['home', 'about', 'demo-recipe', 'signup', 'verify-email', 'auth/callback', 'unwritten-route']) {
    await page.goto(`${origin}${route}`)
    await expect(page).toHaveURL(`${origin}${route}`)
    await expect(page.locator('.mm-journal-book')).toHaveCount(['home', 'about', 'demo-recipe', 'unwritten-route'].includes(route) ? 1 : 0)
  }
  await guest.close()
  process.stdout.write(`Guest gates and public routes passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
