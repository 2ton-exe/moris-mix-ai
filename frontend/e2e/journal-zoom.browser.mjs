// Native Chrome 200% browser zoom, using an isolated temporary profile.
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
import { assertJournalGeometry } from './journal-geometry.mjs'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'test-results', 'physical-journal')
const profile = await mkdtemp(path.join(os.tmpdir(), 'moris-native-zoom-'))
await mkdir(path.join(profile, 'Default'))
// Chromium stores the default partition under "x" and zoom as log(factor)/log(1.2).
// https://github.com/chromium/chromium/blob/main/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }))
await mkdir(output, { recursive: true })
const apiOrigin = 'https://native-zoom.example.test'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const user = { id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
const recipe = { ...fixture, user_id: user.id }
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-native-zoom-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  }, server: { host: '127.0.0.1', port: 0 },
})
let context
const measurements = []
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: null, reducedMotion: 'reduce', args: ['--window-size=1440,900', '--force-device-scale-factor=1'] })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === new URL(origin).origin) return route.continue()
    assert.equal(url.origin, apiOrigin)
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
    if (url.pathname === '/functions/v1/recipes') return route.fulfill({ json: { recipes: [recipe], has_more: false, next_cursor: null } })
    return route.fulfill({ json: { recipe } })
  })
  await context.addInitScript(({ user }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.signature`
    globalThis.localStorage.setItem('sb-native-zoom-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { user })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  async function capture(name) {
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready
      for (const element of globalThis.document.querySelectorAll('.mm-journal-spread')) element.scrollTop = 0
      globalThis.scrollTo(0, 0)
    })
    const zoom = await page.evaluate(() => ({ dpr: globalThis.devicePixelRatio, innerWidth: globalThis.innerWidth, outerWidth: globalThis.outerWidth, cssZoom: globalThis.document.documentElement.style.zoom }))
    assert.equal(zoom.dpr, 2)
    assert.ok(zoom.innerWidth <= zoom.outerWidth / 2)
    assert.equal(zoom.cssZoom, '')
    await assertJournalSemantics(page, `native 200% ${name}`)
    measurements.push({ name, zoom, ...await assertJournalGeometry(page, `native 200% ${name}`) })
    // At native browser zoom, CDP's CSS metrics differ from its screenshot
    // coordinates. Use the DIP content bounds to avoid a half-width capture.
    const { contentSize } = await cdp.send('Page.getLayoutMetrics')
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...contentSize, scale: 1 } })
    await writeFile(path.join(output, `native-200-${name}.png`), Buffer.from(data, 'base64'))
  }
  await page.goto(`${origin}app/recipes`)
  await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
  await capture('journal')
  await page.getByRole('link', { name: `Open recipe ${recipe.title}` }).click()
  await expect(page.getByRole('heading', { name: recipe.title, level: 1 })).toBeFocused()
  await capture('detail')
  await page.getByRole('link', { name: 'Edit recipe' }).click()
  await expect(page.getByLabel('Recipe title')).toHaveValue(recipe.title)
  await capture('edit')
  await page.getByRole('link', { name: 'New recipe', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeFocused()
  await capture('create')
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click()
  await expect(page.getByLabel('Recipe title')).toBeFocused()
  await expect(page.getByLabel('Recipe title')).toBeInViewport()
  await page.getByLabel('Recipe title').fill('Zoomed writing')
  await page.locator('.mm-writing-leaf').focus()
  await page.keyboard.press('PageDown')
  await expect(page.locator('[data-writing-leaf-key^="ingredients-empty"] h2')).toBeFocused()
  await page.keyboard.press('PageDown')
  await expect(page.getByText(/No cooking steps added yet/)).toBeVisible()
  await page.keyboard.press('PageUp')
  await expect(page.locator('[data-writing-leaf-key^="ingredients-empty"] h2')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Add ingredient', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click()
  await expect(page.getByLabel('Ingredient 1 name')).toBeFocused()
  await expect(page.getByLabel('Ingredient 1 name')).toBeInViewport()
  await page.getByRole('button', { name: 'Next Page', exact: true }).click()
  await expect(page.getByText(/No cooking steps added yet/)).toBeVisible()
  await expect(page.locator('.mm-writing-leaf')).toHaveCount(1)
  await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
  await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('')
  await expect(page.locator('[data-writing-leaf-key^="ingredients:"] h2')).toBeFocused()
  await page.getByRole('button', { name: 'Previous Page', exact: true }).click()
  await expect(page.getByLabel('Recipe title')).toHaveValue('Zoomed writing')
  await page.getByRole('link', { name: 'My recipes', exact: true }).click()
  const guard = page.getByRole('alertdialog', { name: 'Leave without saving?' })
  await expect(guard.getByRole('button', { name: 'Keep Editing' })).toBeFocused()
  await expect(guard.getByRole('button', { name: 'Discard Changes' })).toBeInViewport()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(guard.getByRole('button', { name: 'Keep Editing' })).toBeFocused()
  await guard.getByRole('button', { name: 'Discard Changes' }).click()
  await page.goto(`${origin}demo-recipe`)
  await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible()
  await capture('demo')
  await page.getByRole('link', { name: 'Back home' }).click()
  await expect(page).toHaveURL(`${origin}home`)
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'native-zoom-measurements.json'), JSON.stringify(measurements, null, 2))
  process.stdout.write('Native Chrome 200%: journal, detail, create/edit, demo, validation focus, dynamic fields, keyboard guard, return and geometry passed.\n')
} finally {
  await context?.close()
  await server.close()
}
