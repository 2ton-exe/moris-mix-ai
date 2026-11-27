// QA-04 private-image UI journey with API responses and image bytes isolated in the browser test.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium, expect, firefox, webkit } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const demoFixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8'))
const apiOrigin = 'https://qa04.example.test'
const r2Origin = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'
const appUserId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const recipeId = '33333333-3333-4333-8333-333333333333'
const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const oldImageUrl = 'https://images.qa04.example.test/old.webp'
const newImageUrl = 'https://images.qa04.example.test/new.webp'
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#52856f"/></svg>'
const browserTypes = { chromium, firefox, webkit }
const selectedBrowser = process.env.QA04_BROWSER
const desktopOnly = process.env.MORI_DESKTOP_ONLY === 'true'
const matrix = selectedBrowser ? { [selectedBrowser]: browserTypes[selectedBrowser] } : browserTypes
if (Object.values(matrix).some((browserType) => !browserType)) throw new Error(`Unsupported QA04_BROWSER: ${selectedBrowser}`)
const server = await createServer({
  root,
  configFile: false,
  envDir: false,
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('qa04-public-test-key'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
    'import.meta.env.VITE_RECIPE_IMAGES': JSON.stringify('true'),
  },
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
})

try {
  await server.listen()
  const appOrigin = new URL(server.resolvedUrls.local[0]).origin
  for (const [browserName, browserType] of Object.entries(matrix)) {
    const browser = await browserType.launch({ headless: true })
    try {
      for (const width of desktopOnly ? [1100, 1280] : [1280, 768, 375, 320]) {
        const height = desktopOnly && width === 1100 ? 640 : 844
        const context = await browser.newContext({ viewport: { width, height } })
        const page = await context.newPage()
        const pageErrors = []
        let attached = false
        let noPhoto = false
        let imageType = ''
        let intentByteSize = 0
        let putAttempts = 0
        page.on('pageerror', (error) => pageErrors.push(error.message))
        await context.route('**/*', async (route) => {
          const request = route.request()
          const url = new URL(request.url())
          if (url.origin === appOrigin) {
            if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
            return route.continue()
          }
          if (url.origin === new URL(oldImageUrl).origin || url.origin === new URL(newImageUrl).origin) {
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageSvg })
          }
          if (url.origin === r2Origin) {
            if (request.method() === 'OPTIONS') {
              return route.fulfill({ status: 204, headers: {
                'Access-Control-Allow-Origin': appOrigin,
                'Access-Control-Allow-Methods': 'PUT',
                'Access-Control-Allow-Headers': 'content-type,if-none-match',
              } })
            }
            assert.equal(request.method(), 'PUT')
            putAttempts++
            assert.equal(request.headers()['content-type'], imageType)
            assert.equal(request.headers()['if-none-match'], '*')
            assert.equal(request.headers().authorization, undefined)
            assert.equal(request.headers().apikey, undefined)
            const body = request.postDataBuffer()
            if (body) assert.equal(body.byteLength, intentByteSize)
            if (putAttempts === 1) return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': appOrigin } })
            return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': appOrigin } })
          }
          assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
          if (url.pathname === '/functions/v1/demo-recipe') return route.fulfill({ json: demoFixture })
          if (url.pathname === '/auth/v1/user') {
            return route.fulfill({ json: { id: appUserId, aud: 'authenticated', email: 'qa04@example.test' } })
          }
          if (url.pathname === '/functions/v1/recipes' && request.method() === 'GET') {
            return route.fulfill({ json: { recipes: [], has_more: false, next_cursor: null } })
          }
          if (url.pathname === `/functions/v1/recipes/${recipeId}` && request.method() === 'GET') {
            return route.fulfill({ json: { recipe: {
              id: recipeId,
              user_id: appUserId,
              title: 'Ginger rice',
              star_rating: null,
              cooked_at: null,
              notes: '',
              ingredients: [{ name: 'rice', quantity: 2, unit: 'cups', inferred: false }],
              instructions: [{ step: 1, text: 'Cook the rice.' }],
            } } })
          }
          if (url.pathname === '/functions/v1/recipe-image-download-url' && request.method() === 'POST') {
            if (noPhoto) return route.fulfill({ status: 404, json: { error: { code: 'IMAGE_NOT_FOUND' } } })
            return route.fulfill({ json: {
              url: attached ? newImageUrl : oldImageUrl,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            } })
          }
          if (url.pathname === '/functions/v1/recipe-image-upload-url' && request.method() === 'POST') {
            const uploadRequest = request.postDataJSON()
            imageType = uploadRequest.content_type
            intentByteSize = uploadRequest.byte_size
            assert.ok(['image/png', 'image/webp'].includes(imageType), `Unexpected prepared image type: ${imageType}`)
            return route.fulfill({ json: { upload: {
              id: uploadId,
              url: `${r2Origin}/qa04-recipe-images/recipe-images/staging/${appUserId}/${recipeId}/${uploadId}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=TESTACCESSKEY%2F20261115%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261115T000000Z&X-Amz-Expires=600&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Signature=${'a'.repeat(64)}`,
              method: 'PUT',
              headers: { 'Content-Type': imageType, 'If-None-Match': '*' },
              byte_size: intentByteSize,
              expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
            } } })
          }
          if (url.pathname === '/functions/v1/recipe-image-attach' && request.method() === 'POST') {
            attached = true
            return route.fulfill({ json: { image: {
              recipe_id: recipeId,
              content_type: imageType,
              byte_size: intentByteSize,
              uploaded_at: new Date().toISOString(),
            } } })
          }
          assert.fail(`Unexpected API request: ${request.method()} ${url.pathname}`)
        })
        await page.addInitScript(({ userId }) => {
          const expires_at = Math.floor(Date.now() / 1000) + 3600
          const user = { id: userId, aud: 'authenticated', email: 'qa04@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
          const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
          globalThis.localStorage.setItem('sb-qa04-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa04-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
        }, { userId: appUserId })

        await page.goto(`${appOrigin}/app/recipes/${recipeId}/edit`)
        await expect(page.getByLabel('Recipe title')).toHaveValue('Ginger rice')
        const imagePanel = page.getByRole('region', { name: 'Recipe image', exact: true })
        if (width >= 1100) {
          await expect(page.locator('.mm-form-identity').getByRole('region', { name: 'Recipe image', exact: true })).toBeVisible()
        }
        await imagePanel.scrollIntoViewIfNeeded()
        await expect(imagePanel.getByRole('img', { name: 'Ginger rice photo' })).toBeVisible()
        await expect(imagePanel.getByLabel('Choose recipe image')).toBeVisible()
        if (width >= 1100) {
          await mkdir(path.join(root, 'test-results'), { recursive: true })
          await page.screenshot({ path: path.join(root, 'test-results', `recipe-edit-${browserName}-${width}.png`) })
        }
        const image = Buffer.from(await page.evaluate(() => {
          const canvas = globalThis.document.createElement('canvas')
          canvas.width = canvas.height = 1
          canvas.getContext('2d')?.fillRect(0, 0, 1, 1)
          return canvas.toDataURL('image/png').split(',')[1]
        }), 'base64')
        await imagePanel.getByLabel('Choose recipe image').setInputFiles({
          name: 'replacement.png',
          mimeType: 'image/png',
          buffer: image,
        })
        await expect(imagePanel.getByRole('img', { name: 'Selected recipe image preview' })).toBeVisible()
        await imagePanel.getByRole('button', { name: 'Upload image' }).click()
        await expect(imagePanel.getByRole('alert')).toHaveText('Could not upload this image. Try again.')
        await expect(imagePanel.getByRole('img', { name: 'Ginger rice photo' })).toHaveAttribute('src', oldImageUrl)
        if (width >= 1100) await page.screenshot({ path: path.join(root, 'test-results', `recipe-image-upload-error-${browserName}-${width}.png`), animations: 'disabled' })
        await imagePanel.getByRole('button', { name: 'Retry upload' }).click()
        await expect(imagePanel.getByRole('status').filter({ hasText: 'Recipe image saved.' })).toBeVisible()
        await expect(imagePanel.getByRole('img', { name: 'Ginger rice photo' })).toHaveAttribute('src', newImageUrl)
        if (width >= 1100) await page.screenshot({ path: path.join(root, 'test-results', `recipe-image-upload-saved-${browserName}-${width}.png`), animations: 'disabled' })
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `Document overflow at ${width}px in ${browserName}`)
        assert.deepEqual(pageErrors, [], `Browser page errors at ${width}px in ${browserName}`)
        assert.equal(putAttempts, 2)
        await page.goto(`${appOrigin}/app/recipes/${recipeId}`)
        const identity = page.getByRole('region', { name: 'Recipe identity and details' })
        await expect(identity).toBeVisible()
        const bookmarks = page.getByRole('navigation', { name: 'Public pages' })
        await expect(bookmarks).toBeVisible()
        for (const name of ['Home', 'About', 'Demo recipe']) {
          const link = bookmarks.getByRole('link', { name, exact: true })
          await expect(link).toBeVisible()
          const box = await link.boundingBox()
          assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0, 'Public links must stay in the viewport')
          const bookBox = await page.locator('.mm-journal-book').boundingBox()
          assert.ok(bookBox && box.y + box.height <= bookBox.y, 'Public links must stay outside the book')
          assert.equal(await link.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return element.contains(globalThis.document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
          }), true, 'Public links must be clickable above the journal')
        }
        const frame = identity.locator('figure.mm-recipe-artwork--detail')
        const photo = frame.getByRole('img', { name: 'Ginger rice photo' })
        await expect(photo).toHaveAttribute('src', newImageUrl)
        await photo.scrollIntoViewIfNeeded()
        await expect(photo).toBeVisible()
        await expect(frame.locator('.mm-tape')).toHaveCount(2)
        await expect(frame.locator('figcaption')).toHaveText('No date recorded')
        await expect(page.getByRole('img', { name: /Illustrated placeholder/ })).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Recipe image' })).toHaveCount(0)
        const photoBox = await photo.boundingBox()
        assert.ok(photoBox && photoBox.width > 100 && Math.abs(photoBox.width - photoBox.height) < 2, 'Photo must fill the square placeholder')
        assert.ok(photoBox.x >= 0 && photoBox.x + photoBox.width <= width, 'Framed photo must stay inside the viewport')
        if (width >= 1100) {
          const titleBox = await identity.getByRole('heading', { name: 'Ginger rice' }).boundingBox()
          assert.ok(titleBox && photoBox.y + photoBox.height < titleBox.y, 'Desktop recipe title sits below the photo')
        }
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
        await mkdir(path.join(root, 'test-results'), { recursive: true })
        await page.screenshot({ path: path.join(root, 'test-results', `recipe-image-frame-${browserName}-${width}.png`) })
        noPhoto = true
        await page.reload()
        await expect(identity.getByRole('img', { name: /Illustrated placeholder for Ginger rice/ })).toBeVisible()
        await expect(identity.getByRole('img', { name: 'Ginger rice photo' })).toHaveCount(0)
        if (width >= 1100) await page.screenshot({ path: path.join(root, 'test-results', `recipe-image-unavailable-${browserName}-${width}.png`), animations: 'disabled' })
        await page.goto(`${appOrigin}/demo-recipe`)
        await expect(page.getByRole('heading', { name: demoFixture.recipe.title })).toBeVisible()
        const pages = page.getByRole('navigation', { name: 'Recipe reading pages', exact: true })
        await pages.scrollIntoViewIfNeeded()
        await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(1)
        await expect(page.getByRole('link', { name: 'Home →' })).toHaveCount(0)
        const actions = page.getByRole('navigation', { name: 'Recipe actions' })
        await expect(actions.getByRole('link', { name: 'Start a private journal' })).toHaveAttribute('href', '/signup')
        await expect(actions.getByRole('link', { name: 'Edit recipe' })).toHaveCount(0)
        await expect(actions.getByRole('button', { name: /Delete/ })).toHaveCount(0)
        assert.equal(await pages.evaluate((element) => {
          const footer = element.parentElement
          const rect = element.getBoundingClientRect()
          return footer.lastElementChild === element && Math.abs(rect.bottom - (footer.getBoundingClientRect().bottom - Number.parseFloat(globalThis.getComputedStyle(footer).paddingBottom))) < 2
        }), true, 'Pagination must be the bottom row of the footer')
        if (width >= 1100) {
          const next = pages.getByRole('button', { name: /^Next/ })
          if (await next.count()) {
            const corner = await next.evaluate(element => {
              const button = element.getBoundingClientRect()
              const paper = element.closest('.mm-journal-page').getBoundingClientRect()
              return { right: paper.right - button.right, bottom: paper.bottom - button.bottom, width: button.width, height: button.height }
            })
            assert.ok(Math.abs(corner.right) < 2 && Math.abs(corner.bottom) < 2, `Next fold must meet the paper corner: ${JSON.stringify(corner)}`)
            assert.ok(corner.width >= 44 && corner.height >= 44, 'Paper fold must retain a keyboard/touch target')
          }
        } else {
          const rowCenters = await pages.locator(':scope > *').evaluateAll((elements) => elements.map((element) => {
            const rect = element.getBoundingClientRect()
            return rect.y + rect.height / 2
          }))
          assert.ok(Math.max(...rowCenters) - Math.min(...rowCenters) < 2, 'Single-page controls must align on one row')
        }
        await page.screenshot({ path: path.join(root, 'test-results', `demo-reading-footer-${browserName}-${width}.png`) })
        assert.deepEqual(pageErrors, [])
        await context.close()
        process.stdout.write(`${browserName} ${browser.version()} at ${width}px (${imageType}): private image load, failed replacement recovery, retry, and layout passed.\n`)

        const otherContext = await browser.newContext({ viewport: { width, height } })
        const otherPage = await otherContext.newPage()
        const otherPageErrors = []
        let deniedImageDownloads = 0
        otherPage.on('pageerror', (error) => otherPageErrors.push(error.message))
        await otherContext.route('**/*', async (route) => {
          const request = route.request()
          const url = new URL(request.url())
          if (url.origin === appOrigin) {
            if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 })
            return route.continue()
          }
          assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
          if (url.pathname === '/auth/v1/user') {
            return route.fulfill({ json: { id: otherUserId, aud: 'authenticated', email: 'other-cook@example.test' } })
          }
          if (url.pathname === `/functions/v1/recipes/${recipeId}` && request.method() === 'GET') {
            // This mocked denial checks the browser UI; Deno lifecycle tests exercise the real handler.
            const accessToken = request.headers().authorization?.replace(/^Bearer /, '')
            assert.ok(accessToken, 'Second cook recipe request must include an authenticated session')
            const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'))
            assert.equal(claims.sub, otherUserId)
            return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Recipe not found.' } } })
          }
          if (url.pathname === '/functions/v1/recipe-image-download-url' && request.method() === 'POST') {
            deniedImageDownloads++
            return route.fulfill({ status: 404, json: { error: { code: 'RECIPE_NOT_FOUND', message: 'Recipe not found.' } } })
          }
          assert.fail(`Unexpected request from second cook: ${request.method()} ${url.pathname}`)
        })
        await otherPage.addInitScript(({ userId }) => {
          const expires_at = Math.floor(Date.now() / 1000) + 3600
          const user = { id: userId, aud: 'authenticated', email: 'other-cook@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
          const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: userId, exp: expires_at }))}.test-signature`
          globalThis.localStorage.setItem('sb-qa04-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa04-other-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
        }, { userId: otherUserId })
        await otherPage.goto(`${appOrigin}/app/recipes/${recipeId}`)
        await expect(otherPage.getByRole('heading', { name: 'Recipe unavailable' })).toBeVisible()
        await expect(otherPage.getByText('This recipe could not be found. It may have been removed or may not be available to you.')).toBeVisible()
        await expect(otherPage.getByRole('img', { name: 'Ginger rice photo' })).toHaveCount(0)
        await otherPage.waitForLoadState('networkidle')
        assert.equal(deniedImageDownloads, 0, `Second cook triggered ${deniedImageDownloads} image download requests`)
        assert.deepEqual(otherPageErrors, [])
        await otherContext.close()
        process.stdout.write(`${browserName} ${browser.version()} at ${width}px: second cook sees unavailable recipe with no image download.\n`)
      }
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}
