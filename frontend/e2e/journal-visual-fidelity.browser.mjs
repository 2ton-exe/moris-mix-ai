// Screenshot evidence from the real React application, with synthetic auth and
// intercepted fixture responses. No production service or account is contacted.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect as baseExpect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expect = baseExpect.configure({ timeout: 30_000 })
const phase = process.argv[2] ?? 'after'
assert.ok(['before', 'after'].includes(phase), 'Use before or after')
const outputDir = path.join(root, 'test-results', 'visual-fidelity', phase)
await mkdir(outputDir, { recursive: true })
const apiOrigin = 'https://visual-journal.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const recipe = { ...fixture, user_id: userId }
const user = { id: userId, aud: 'authenticated', email: 'cook@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T00:00:00Z' }
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-visual-ui-public-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
})
let browser
const measurements = []
async function assertPaperControls(page, label) {
  // Scroll the real regions to prove controls below a physical page boundary
  // remain reachable, and that no control extends into the binding.
  const controls = page.locator('.mm-journal-flyleaf :is(button, a, input, select, textarea), .mm-journal-page :is(button, a, input, select, textarea)')
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue
    await control.scrollIntoViewIfNeeded()
    const geometry = await control.evaluate((element) => {
      const paper = element.closest('.mm-journal-flyleaf, .mm-journal-page').getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      return { name: element.getAttribute('aria-label') || element.textContent || element.tagName, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, paperLeft: paper.left, paperRight: paper.right, viewportHeight: globalThis.innerHeight }
    })
    assert.ok(geometry.left >= geometry.paperLeft && geometry.right <= geometry.paperRight, `${label}: control overlaps paper edge/binding ${JSON.stringify(geometry)}`)
    assert.ok(geometry.bottom > 0 && geometry.top < geometry.viewportHeight, `${label}: control cannot be scrolled into view ${JSON.stringify(geometry)}`)
  }
}

async function assertNoOverflow(page, label, width) {
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `${label}: overflow at ${width}px`)
}

try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  process.stdout.write(`Isolated visual server: ${origin}\n`)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of [1440, 1280, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const errors = []
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === new URL(origin).origin) return route.continue()
      assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
      if (url.pathname === '/functions/v1/recipes') return route.fulfill({ json: { recipes: [recipe], has_more: false, next_cursor: null } })
      if (url.pathname === `/functions/v1/recipes/${recipe.id}`) return route.fulfill({ json: { recipe } })
      return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: 'Unexpected isolated request' } } })
    })
    await page.addInitScript(({ user, storageKey }) => {
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.test-signature`
      if (!globalThis.localStorage.getItem('visual-logged-out')) globalThis.localStorage.setItem(storageKey, JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
    }, { user, storageKey: 'sb-visual-journal-auth-token' })
    await page.goto(`${origin}app/recipes`)
    await expect(page.getByRole('heading', { name: 'Saved recipes (1)' })).toBeVisible()
    await page.evaluate(() => globalThis.document.fonts.ready)
    await page.screenshot({ path: path.join(outputDir, `${width}-dashboard.png`), fullPage: true })
    const geometry = await page.evaluate(() => {
      const box = (selector) => {
        const element = globalThis.document.querySelector(selector)
        if (!element || globalThis.getComputedStyle(element).display === 'none') return null
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      }
      return { viewport: globalThis.innerWidth, layout: globalThis.innerWidth >= 1100 && globalThis.innerHeight >= 640 ? 'spread' : 'single', documentWidth: globalThis.document.documentElement.scrollWidth, book: box('.mm-journal-book'), left: box('.mm-journal-flyleaf'), right: box('.mm-journal-page'), binding: box('.mm-journal-binding') }
    })
    if (geometry.layout === 'spread' && geometry.left && geometry.right) {
      geometry.pageWidthDifferencePercent = Math.abs(geometry.left.width - geometry.right.width) / Math.max(geometry.left.width, geometry.right.width) * 100
      geometry.spineOffsetPx = Math.abs(geometry.binding.x + geometry.binding.width / 2 - (geometry.book.x + geometry.book.width / 2))
    }
    if (phase === 'after') await assertPaperControls(page, `${width}px dashboard`)
    measurements.push(geometry)
    assert.equal(geometry.documentWidth <= width, true, `Dashboard overflow at ${width}px`)
    if (phase === 'after' && width >= 1280) {
      assert.ok(geometry.left && geometry.right, `Facing pages missing at ${width}px`)
      assert.ok(geometry.pageWidthDifferencePercent <= 5, `Unequal facing pages at ${width}px`)
      assert.ok(geometry.spineOffsetPx <= 1, `Off-center spine at ${width}px`)
      assert.ok(geometry.book.x >= 0 && geometry.book.x + geometry.book.width <= width, `Book cropped at ${width}px`)
      assert.ok(Math.abs(geometry.left.y - geometry.right.y) < 1, `Paper tops misaligned at ${width}px`)
      assert.ok(Math.abs(geometry.left.height - geometry.right.height) < 1, `Paper bottoms misaligned at ${width}px`)
    }
    await page.goto(`${origin}app/recipes/${recipe.id}`)
    await expect(page.getByRole('heading', { name: recipe.title, level: 1 })).toBeVisible()
    await page.screenshot({ path: path.join(outputDir, `${width}-detail.png`), fullPage: true })
    await assertNoOverflow(page, 'Recipe detail', width)
    if (phase === 'after') await assertPaperControls(page, `${width}px recipe detail`)
    await page.goto(`${origin}app/recipes/new`)
    await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeVisible()
    await page.screenshot({ path: path.join(outputDir, `${width}-create.png`), fullPage: true })
    await assertNoOverflow(page, 'Recipe form', width)
    if (phase === 'after') await assertPaperControls(page, `${width}px recipe form`)
    await page.evaluate(() => {
      globalThis.localStorage.clear()
      globalThis.localStorage.setItem('visual-logged-out', 'true')
    })
    await page.goto(`${origin}login`)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await page.evaluate(() => globalThis.document.fonts.ready)
    // The stationery card enters over 420ms. Capture its settled paper surface.
    await expect(page.locator('.mm-auth-card')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: path.join(outputDir, `${width}-login.png`), fullPage: true })
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Login overflow at ${width}px`)
    assert.deepEqual(errors, [])
    await context.close()
    process.stdout.write(`${width}px screenshots captured; geometry ${JSON.stringify(geometry)}\n`)
  }
  await writeFile(path.join(outputDir, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`)
  if (phase === 'after') await writeFile(path.join(outputDir, '../comparison.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MORI'S MIX · Visual correction evidence</title>
<style>
body{margin:0;padding:24px;background:#f8f1e1;color:#2b211b;font:16px/1.5 system-ui,sans-serif}h1{font:600 28px Georgia,serif;margin:0 0 8px}p{max-width:95ch}label{display:inline-flex;gap:8px;align-items:center;margin:0 18px 16px 0}select,a{color:inherit}select{padding:8px;font:inherit;background:#fffcf3;border:1px solid #85725f;border-radius:6px}select:focus-visible,a:focus-visible{outline:3px solid #622031;outline-offset:3px}.comparisons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0;min-width:0}figcaption{font-weight:650;margin-bottom:8px}img{display:block;max-width:100%;height:auto;border:1px solid #85725f}a{font-weight:600}#reference{margin-top:28px;max-width:1440px}@media(max-width:700px){.comparisons{grid-template-columns:1fr}body{padding:16px}}
</style>
<h1>MORI'S MIX · Visual correction evidence</h1>
<p>Actual Chromium screenshots of the React application using intercepted fixture responses and synthetic authentication. Both product captures use the same existing recipe fixture. No production account or service was contacted. The reference is the locally rendered extracted Figma Make source and contains its own prototype data.</p>
<label>Viewport <select id="width"><option>1440</option><option>1280</option><option>768</option><option>390</option><option>320</option></select> px</label>
<label>Screen <select id="screen"><option value="dashboard">Dashboard</option><option value="login">Login</option><option value="detail">Recipe detail</option><option value="create">Create recipe</option></select></label>
<p><a href="after/measurements.json">Final page and spine measurements</a> · <a href="before/measurements.json">Before measurements</a>. Login captures wait for the entrance animation to settle. Historical before images must be retained separately.</p>
<div class="comparisons"><figure><figcaption>Before correction</figcaption><a id="before-link"><img id="before" alt="Application before visual corrections"></a></figure><figure><figcaption>After correction</figcaption><a id="after-link"><img id="after" alt="Application after visual corrections"></a></figure></div>
<figure id="reference"><figcaption>Rendered Figma Make reference · 1440 px</figcaption><p id="reference-note"></p><a id="reference-link"><img id="reference-image" alt="Original Figma Make reference rendered locally"></a></figure>
<script>
const width=document.getElementById('width'),screen=document.getElementById('screen');
function update(){for(const phase of ['before','after']){const src=phase+'/'+width.value+'-'+screen.value+'.png';document.getElementById(phase).src=src;document.getElementById(phase+'-link').href=src;}const reference=screen.value==='login'?'1440-login.png':screen.value==='dashboard'?'1440-index.png':'1440-collection.png';document.getElementById('reference-image').src='reference/'+reference;document.getElementById('reference-link').href='reference/'+reference;document.getElementById('reference-note').textContent=screen.value==='dashboard'?'Reference index: search on the left, results on the right. The production recipe cards also borrow the collection photo treatment.':screen.value==='login'?'Reference login: closed leather cover left and ruled recipe card right. Production retains its existing authentication and demonstration actions.':'Collection reference illustrates shared book geometry and materials; no captured original detail/editor reference is available.';}
width.addEventListener('change',update);screen.addEventListener('change',update);update();
</script></html>\n`)
  process.stdout.write(`Evidence: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
