// Isolated physical-turn acceptance and source comparison. All production API
// requests below are intercepted; the reference uses only its local mock store.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertReferencePrerequisites } from './reference-prerequisites.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const referenceRoot = path.resolve(root, '../../figma-make-reference')
await assertReferencePrerequisites(referenceRoot)
const output = path.join(root, 'test-results/ui01-step4')
const videoDir = path.join(output, 'video')
await mkdir(output, { recursive: true })
await mkdir(videoDir, { recursive: true })

const fixture = JSON.parse(await readFile(path.join(root, '../fixtures/demo-recipe.json'), 'utf8')).recipe
const user = { id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', email: 'step4@example.test', app_metadata: {}, user_metadata: { name: 'Cook' }, created_at: '2026-10-25T00:00:00Z' }
const ids = Array.from({ length: 8 }, (_, index) => `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`)
const list = ids.map((id, index) => ({ ...fixture, id, user_id: user.id, title: `Step 4 recipe ${index + 1}`, created_at: `2026-10-${String(30 - index).padStart(2, '0')}T00:00:00Z` }))
const readingRecipe = {
  ...fixture,
  id: ids[0],
  user_id: user.id,
  title: 'A many-page recipe for physical turns',
  ingredients: Array.from({ length: 24 }, (_, index) => ({ name: `Ingredient ${index + 1}`, quantity: index + 1, unit: 'cups', inferred: false })),
  instructions: Array.from({ length: 16 }, (_, index) => ({ step: index + 1, text: `Step ${index + 1}. Stir gently and taste before serving.` })),
  notes: Array.from({ length: 8 }, (_, index) => `Personal note ${index + 1}. Keep the pan warm.`).join('\n\n'),
}
const originalRecipes = list.map((recipe) => ({
  id: recipe.id, ownerId: user.id, title: recipe.title,
  ingredients: recipe.ingredients.map((item) => `${item.name} ${item.quantity ?? ''} ${item.unit ?? ''}`.trim()),
  steps: recipe.instructions.map((step) => step.text), rating: recipe.star_rating,
  cookedOn: recipe.cooked_at, notes: recipe.notes ?? '', photo: null,
  createdAt: recipe.created_at, updatedAt: recipe.created_at,
}))
const apiOrigin = 'https://step4-journal.example.test'
const server = await createServer({ root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error', define: {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-step4-key'),
  'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
  'import.meta.env.VITE_RECIPE_PREVIEW': JSON.stringify('false'),
}, server: { host: '127.0.0.1', port: 0 } })
const referenceImport = (name) => import(pathToFileURL(path.join(referenceRoot, `node_modules/${name}`)).href)
const [{ createServer: createReferenceServer }, { default: referenceReact }, { default: tailwind }] = await Promise.all([
  referenceImport('vite/dist/node/index.js'),
  referenceImport('@vitejs/plugin-react/dist/index.js'),
  referenceImport('@tailwindcss/vite/dist/index.mjs'),
])
const referenceServer = await createReferenceServer({ root: referenceRoot, configFile: false, plugins: [referenceReact(), tailwind()], logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })

let browser
let appContext
let originalContext
let appPage
const apiRequests = []
const writeRequests = []
const browserErrors = []
const comparison = []
const savedId = 'step4-created-recipe'

async function addAppMocks(context, origin) {
  const appOrigin = new URL(origin).origin
  context.on('page', (page) => page.on('pageerror', (error) => {
    if (page.url().startsWith(appOrigin)) browserErrors.push(error.message)
  }))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === new URL(origin).origin) return route.continue()
    assert.equal(url.origin, apiOrigin, `Unexpected app network request ${url.origin}`)
    apiRequests.push({ method: route.request().method(), path: url.pathname + url.search })
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 })
    if (url.pathname === '/functions/v1/recipes' && route.request().method() === 'GET') {
      return route.fulfill({ json: { recipes: list.map(({ id, title, user_id, star_rating, cooked_at }) => ({ id, title, user_id, star_rating, cooked_at })), has_more: false, next_cursor: null } })
    }
    if (url.pathname === `/functions/v1/recipes/${readingRecipe.id}` && route.request().method() === 'GET') return route.fulfill({ json: { recipe: readingRecipe } })
    if (url.pathname === '/functions/v1/recipes' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      writeRequests.push({ method: 'POST', body })
      return route.fulfill({ json: { recipe: {
        ...readingRecipe, ...body, id: savedId, user_id: user.id,
        ingredients: body.ingredients.map(({ name, quantity, unit, quantityText, inferred }) => ({ name, quantity, unit, quantityText, inferred })),
        instructions: body.instructions.map(({ text }, index) => ({ step: index + 1, text })),
      } } })
    }
    if (url.pathname === `/functions/v1/recipes/${readingRecipe.id}` && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      writeRequests.push({ method: 'PATCH', body })
      return route.fulfill({ json: { recipe: { ...readingRecipe, ...body } } })
    }
    return route.fulfill({ status: 404, json: {} })
  })
  await context.addInitScript(({ user }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600
    const token = `${globalThis.btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${globalThis.btoa(JSON.stringify({ sub: user.id, exp: expires_at }))}.signature`
    globalThis.localStorage.setItem('sb-step4-journal-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at, expires_in: 3600, token_type: 'bearer', user }))
  }, { user })
}

async function addReferenceMocks(context, appOrigin, referenceOrigin) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if ([new URL(appOrigin).origin, new URL(referenceOrigin).origin].includes(url.origin)) return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: ['Figtree', 'Fraunces', 'Caveat'].map((family) => `@font-face{font-family:'${family}';font-weight:300 800;src:url('${appOrigin}src/assets/journal/fonts/${family.toLowerCase()}-latin.woff2') format('woff2')}`).join('\n') })
    return route.abort()
  })
  await context.addInitScript(({ user, recipes }) => {
    globalThis.localStorage.setItem('pans-scraps:db:v3', JSON.stringify({
      version: 3,
      users: [{ id: user.id, name: 'Cook', email: user.email, verified: true, createdAt: user.created_at, password: 'reference-only' }],
      recipes, tokens: [], mail: [], sessionUserId: user.id,
    }))
  }, { user, recipes: originalRecipes })
}

async function snapshot(page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) })
}

async function turnDiagnostics(page, reference = false) {
  return page.evaluate((reference) => {
    const leaf = globalThis.document.querySelector(reference ? '.turn-layer .leaf' : '.mm-turn-leaf')
    if (!leaf) return null
    const css = globalThis.getComputedStyle(leaf)
    const rect = leaf.getBoundingClientRect()
    const parent = leaf.parentElement?.parentElement
    const parentCss = parent ? globalThis.getComputedStyle(parent) : null
    return {
      transform: css.transform,
      transformOrigin: css.transformOrigin,
      animationName: css.animationName,
      animationDuration: css.animationDuration,
      animationTimingFunction: css.animationTimingFunction,
      currentTime: leaf.getAnimations()[0]?.currentTime ?? null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      box: { width: css.width, height: css.height, offsetWidth: leaf.offsetWidth, offsetHeight: leaf.offsetHeight, boxSizing: css.boxSizing, left: css.left, top: css.top },
      perspective: parentCss ? { name: parent?.className, perspective: parentCss.perspective, perspectiveOrigin: parentCss.perspectiveOrigin, transform: parentCss.transform, transformStyle: parentCss.transformStyle, width: parentCss.width, height: parentCss.height } : null,
      pageDimensions: parentCss ? (reference ? { pageWidth: parentCss.getPropertyValue('--pw'), pageHeight: parentCss.getPropertyValue('--ph'), overhang: parentCss.getPropertyValue('--oh') } : { pageWidth: parentCss.getPropertyValue('--mm-page-width'), pageHeight: parentCss.getPropertyValue('--mm-page-height'), overhang: parentCss.getPropertyValue('--mm-overhang') }) : null,
      faces: leaf.querySelectorAll(reference ? '.leaf-face' : '.mm-turn-face').length,
      snapshotCount: leaf.querySelectorAll('[data-page], [data-journal-turn-snapshot]').length,
    }
  }, reference)
}

async function holdTurnAtMidpoint(page, reference = false, animationTime = 410) {
  const selector = reference ? '.turn-layer' : '[data-journal-page-turn]'
  return page.evaluate(({ selector, animationTime }) => {
    const layer = globalThis.document.querySelector(selector)
    const animations = layer?.getAnimations({ subtree: true }) ?? []
    animations.forEach((animation) => {
      animation.pause()
      animation.currentTime = animationTime
    })
    return animations.map((animation) => animation.currentTime)
  }, { selector, animationTime })
}

async function resumeTurn(page, reference = false) {
  const selector = reference ? '.turn-layer' : '[data-journal-page-turn]'
  await page.evaluate((selector) => {
    globalThis.document.querySelector(selector)?.getAnimations({ subtree: true }).forEach((animation) => animation.play())
  }, selector)
}

async function finishTurn(page) {
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-journal-page-turn]'), null, { timeout: 3000 })
}

try {
  await Promise.all([server.listen(), referenceServer.listen()])
  const origin = server.resolvedUrls.local[0]
  const referenceOrigin = referenceServer.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  appContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } })
  originalContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await addAppMocks(appContext, origin)
  await addReferenceMocks(originalContext, origin, referenceOrigin)
  appPage = await appContext.newPage()
  const referencePage = await originalContext.newPage()
  appPage.setDefaultTimeout(12_000)
  referencePage.setDefaultTimeout(12_000)
  await Promise.all([appPage.goto(`${origin}app/recipes`), referencePage.goto(`${referenceOrigin}journal/scraps`)])
  await expect(appPage.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
  await expect(referencePage.locator('.book')).toHaveAttribute('data-cover', 'open')
  await expect(referencePage.getByRole('button', { name: 'Turn to older scraps' })).toBeVisible()
  await expect(appPage.getByRole('link', { name: /Previous page/ })).toHaveCount(0, 'Collection cannot turn before its first available page')
  await expect(appPage.getByRole('link', { name: /Next page/ })).toBeEnabled()
  await Promise.all([appPage.evaluate(() => globalThis.document.fonts.ready), referencePage.evaluate(() => globalThis.document.fonts.ready)])
  const referenceFonts = await referencePage.evaluate(async () => {
    return Promise.all(['Figtree', 'Fraunces', 'Caveat'].map(async (family) => {
      const faces = await globalThis.document.fonts.load(`400 16px "${family}"`)
      return { family, loaded: faces.length > 0 && faces.every((face) => face.status === 'loaded') }
    }))
  })
  assert.ok(referenceFonts.every((font) => font.loaded), `Reference fonts must load without fallback: ${JSON.stringify(referenceFonts)}`)
  process.stdout.write(`Reference fonts loaded: ${referenceFonts.map((font) => font.family).join(', ')}.\n`)

  await snapshot(appPage, 'current-1440-before-forward')
  await snapshot(referencePage, 'reference-1440-before-forward')
  await appPage.getByRole('link', { name: /Next page/ }).click()
  await referencePage.getByRole('button', { name: 'Turn to older scraps' }).click()
  await expect(appPage.locator('[data-journal-page-turn]')).toBeVisible()
  await expect(referencePage.locator('.turn-layer .leaf')).toBeVisible()
  const forwardTimes = await Promise.all([holdTurnAtMidpoint(appPage), holdTurnAtMidpoint(referencePage, true)])
  assert.ok(forwardTimes.flat().length >= 2, 'Both spread turns expose leaf and lighting animations')
  const forwardMidCurrent = await turnDiagnostics(appPage)
  const forwardMidReference = await turnDiagnostics(referencePage, true)
  assert.ok(forwardMidCurrent, 'The current leaf remains active at the 410ms midpoint')
  assert.ok(forwardMidReference, 'The reference leaf remains active at the 410ms midpoint')
  assert.equal(forwardMidCurrent.animationDuration, '0.82s')
  assert.equal(forwardMidReference.animationDuration, '0.82s')
  assert.notEqual(forwardMidCurrent.transform, 'none')
  assert.notEqual(forwardMidReference.transform, 'none')
  assert.equal(forwardMidCurrent.transform, forwardMidReference.transform, 'Forward spread transform matches the reference at the same animation time')
  assert.equal(forwardMidCurrent.transformOrigin, forwardMidReference.transformOrigin)
  assert.ok(Math.abs(Number(forwardMidCurrent.currentTime) - 410) < 1)
  assert.ok(Math.abs(Number(forwardMidReference.currentTime) - 410) < 1)
  await snapshot(appPage, 'current-1440-forward-midpoint')
  await snapshot(referencePage, 'reference-1440-forward-midpoint')
  await Promise.all([resumeTurn(appPage), resumeTurn(referencePage, true)])
  await finishTurn(appPage)
  await referencePage.waitForFunction(() => !globalThis.document.querySelector('.turn-layer .leaf'))
  await snapshot(appPage, 'current-1440-forward-complete')
  await snapshot(referencePage, 'reference-1440-forward-complete')
  await expect(appPage.getByRole('link', { name: /Previous page/ })).toBeVisible()
  await expect(appPage.locator('.mm-journal-flyleaf [data-recipe-id], .mm-journal-page [data-recipe-id]')).toHaveCount(4)
  await expect(referencePage.getByRole('button', { name: 'Turn back to newer scraps' })).toBeVisible()

  await appPage.getByRole('link', { name: /Previous page/ }).click()
  await referencePage.getByRole('button', { name: 'Turn back to newer scraps' }).click()
  await expect(appPage.locator('[data-journal-page-turn]')).toBeVisible()
  await expect(referencePage.locator('.turn-layer .leaf')).toBeVisible()
  const backwardTimes = await Promise.all([holdTurnAtMidpoint(appPage), holdTurnAtMidpoint(referencePage, true)])
  assert.ok(backwardTimes.flat().length >= 2, 'Both backward spread turns expose leaf and lighting animations')
  const backwardMidCurrent = await turnDiagnostics(appPage)
  const backwardMidReference = await turnDiagnostics(referencePage, true)
  assert.equal(backwardMidCurrent.animationDuration, '0.82s')
  assert.equal(backwardMidReference.animationDuration, '0.82s')
  assert.notEqual(backwardMidCurrent.transform, 'none')
  assert.notEqual(backwardMidReference.transform, 'none')
  assert.equal(backwardMidCurrent.transform, backwardMidReference.transform, 'Backward spread transform matches the reference at the same animation time')
  assert.equal(backwardMidCurrent.transformOrigin, backwardMidReference.transformOrigin)
  assert.ok(Math.abs(Number(backwardMidCurrent.currentTime) - 410) < 1)
  assert.ok(Math.abs(Number(backwardMidReference.currentTime) - 410) < 1)
  await snapshot(appPage, 'current-1440-backward-midpoint')
  await snapshot(referencePage, 'reference-1440-backward-midpoint')
  await Promise.all([resumeTurn(appPage), resumeTurn(referencePage, true)])
  await finishTurn(appPage)
  await referencePage.waitForFunction(() => !globalThis.document.querySelector('.turn-layer .leaf'))
  await snapshot(appPage, 'current-1440-backward-complete')
  await snapshot(referencePage, 'reference-1440-backward-complete')
  comparison.push({ scene: 'collection', viewport: '1440x900', forwardMidCurrent, forwardMidReference, backwardMidCurrent, backwardMidReference })

  // Walk the real collection pagination to both bounds, then return to the first spread.
  await appPage.goto(`${origin}app/recipes`)
  await expect(appPage.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
  const previousAtStart = appPage.getByRole('link', { name: /Previous page/ })
  await expect(previousAtStart).toHaveCount(0)
  const nextPage = appPage.getByRole('link', { name: /Next page/ })
  let forwardTurns = 0
  while (await nextPage.count()) {
    await nextPage.click()
    await finishTurn(appPage)
    forwardTurns++
    assert.ok(forwardTurns < 10, 'Collection pagination must reach its last available page')
  }
  assert.ok(forwardTurns > 0)
  await expect(appPage.getByRole('link', { name: /Next page/ })).toHaveCount(0)
  const previousPage = appPage.getByRole('link', { name: /Previous page/ })
  let backwardTurns = 0
  while (await previousPage.count()) {
    await previousPage.click()
    await finishTurn(appPage)
    backwardTurns++
    assert.ok(backwardTurns < 10, 'Backward pagination must reach its first available page')
  }
  assert.equal(backwardTurns, forwardTurns, 'Returning to the start uses one backward turn per forward turn')
  await expect(appPage.getByRole('link', { name: /Previous page/ })).toHaveCount(0)
  await expect(appPage.getByRole('link', { name: /Next page/ })).toBeVisible()

  // Match the original single-page choreography at its 1100px breakpoint.
  await Promise.all([
    appPage.setViewportSize({ width: 390, height: 900 }),
    referencePage.setViewportSize({ width: 390, height: 900 }),
  ])
  await expect(referencePage.locator('.page--single, .folio-col--single').first()).toBeVisible()
  await expect(appPage.getByRole('link', { name: /Next page/ })).toBeEnabled()
  await appPage.getByRole('link', { name: /Next page/ }).click()
  await referencePage.getByRole('button', { name: 'Turn to older scraps' }).click()
  await expect(appPage.locator('[data-journal-page-turn]')).toHaveAttribute('data-layout', 'single')
  await expect(appPage.locator('[data-journal-page-turn]')).toHaveAttribute('data-duration', '620')
  await expect(referencePage.locator('.turn-layer .leaf')).toBeVisible()
  const singleTimes = await Promise.all([
    holdTurnAtMidpoint(appPage, false, 480),
    holdTurnAtMidpoint(referencePage, true, 480),
  ])
  const singleCurrent = await turnDiagnostics(appPage)
  const singleReference = await turnDiagnostics(referencePage, true)
  assert.ok(singleTimes.flat().length >= 2)
  assert.equal(singleCurrent.animationDuration, '0.62s')
  assert.equal(singleReference.animationDuration, '0.62s')
  assert.equal(singleCurrent.animationName, 'mm-turn-single-forward')
  assert.equal(singleReference.animationName, 'leaf-fwd-single')
  assert.equal(singleCurrent.transform, singleReference.transform, 'Single-page transform matches the reference at the same animation time')
  assert.equal(singleCurrent.transformOrigin.split(' ')[0], singleReference.transformOrigin.split(' ')[0], 'Single-page leaf turns around the same binding-side edge')
  assert.ok(Math.abs(Number(singleCurrent.currentTime) - 480) < 1)
  assert.ok(Math.abs(Number(singleReference.currentTime) - 480) < 1)
  await snapshot(appPage, 'current-390-single-midpoint')
  await snapshot(referencePage, 'reference-390-single-midpoint')
  await Promise.all([resumeTurn(appPage), resumeTurn(referencePage, true)])
  await Promise.all([
    finishTurn(appPage),
    referencePage.waitForFunction(() => !globalThis.document.querySelector('.turn-layer .leaf')),
  ])
  comparison.push({ scene: 'single-page', viewport: '390x900', singleCurrent, singleReference })
  await appPage.setViewportSize({ width: 1440, height: 900 })

  const readingRequestsBefore = apiRequests.filter((request) => request.path.startsWith('/functions/v1/')).length
  await appPage.goto(`${origin}app/recipes/${readingRecipe.id}`)
  await expect(appPage.locator('[data-reading-ready="true"]')).toBeVisible()
  await expect(appPage.getByRole('button', { name: 'Next Page' })).toBeEnabled()
  await appPage.getByRole('button', { name: 'Next Page' }).focus()
  await appPage.keyboard.press('Enter')
  await expect(appPage.locator('[data-journal-page-turn]')).toBeVisible()
  const readForward = await turnDiagnostics(appPage)
  assert.equal(readForward.animationDuration, '0.82s')
  const snapshotCopy = appPage.locator('.mm-page-turn-layer [data-journal-turn-snapshot]')
  await expect(snapshotCopy.first()).toHaveAttribute('aria-hidden', 'true')
  await expect(snapshotCopy.first()).toHaveAttribute('inert', '')
  const liveAndCopy = await appPage.evaluate(() => {
    const copies = [...globalThis.document.querySelectorAll('.mm-page-turn-layer [data-journal-turn-snapshot]')]
    const interactiveCopies = copies.flatMap((node) => [...node.querySelectorAll('a,button,input,textarea,select,[tabindex]')])
    const copiesAreInert = interactiveCopies.every((element) => {
      const tag = element.tagName
      const nativeControl = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(tag)
      return element.tabIndex === -1 && (!nativeControl || element.disabled) && (tag !== 'A' || !element.hasAttribute('href'))
    })
    const duplicateIds = [...globalThis.document.querySelectorAll('[id]')].map((node) => node.id).filter((id, index, all) => all.indexOf(id) !== index)
    return { copies: copies.length, interactiveCopies: interactiveCopies.length, copiesAreInert, duplicateIds, focusedInSnapshot: !!globalThis.document.activeElement?.closest('.mm-page-turn-layer') }
  })
  assert.ok(liveAndCopy.copies > 0)
  assert.equal(liveAndCopy.copiesAreInert, true)
  assert.equal(liveAndCopy.duplicateIds.length, 0)
  assert.equal(liveAndCopy.focusedInSnapshot, false)
  await finishTurn(appPage)
  await expect.poll(() => appPage.evaluate(() => !!globalThis.document.activeElement?.closest('.mm-continuation-body, .mm-continuation-title'))).toBe(true)
  await appPage.getByRole('button', { name: 'Next Page' }).click()
  await finishTurn(appPage)
  await appPage.getByRole('button', { name: 'Previous Page' }).click()
  await expect(appPage.locator('[data-journal-page-turn]')).toHaveAttribute('data-direction', 'backward')
  await finishTurn(appPage)
  assert.equal(apiRequests.filter((request) => request.path.startsWith('/functions/v1/')).length, readingRequestsBefore + 1, 'Reading turns must not issue recipe or cursor requests')

  await appPage.goto(`${origin}app/recipes/new`)
  await expect(appPage.getByRole('form', { name: 'Create recipe' })).toBeVisible()
  const form = appPage.getByRole('form', { name: 'Create recipe' })
  const title = appPage.getByLabel('Recipe title')
  await title.fill('A persistent animated draft')
  await appPage.getByRole('link', { name: 'My recipes' }).click()
  await expect(appPage.getByRole('alertdialog')).toBeVisible()
  await expect(appPage.locator('[data-journal-page-turn]')).toHaveCount(0)
  await appPage.getByRole('button', { name: /Keep editing/i }).click()
  await expect(appPage).toHaveURL(/\/app\/recipes\/new$/)
  await expect(appPage.getByLabel('Recipe title')).toHaveValue('A persistent animated draft')

  await appPage.getByRole('button', { name: 'Next Pages' }).click()
  await expect(appPage.locator('[data-journal-page-turn]')).toBeVisible()
  const formLayer = appPage.locator('[data-journal-page-turn]')
  assert.equal(await appPage.locator('form').count(), 1)
  await expect(form).toHaveCount(1)
  const liveFormCount = await appPage.evaluate(() => [...globalThis.document.querySelectorAll('form')].filter((candidate) => !candidate.closest('[inert]')).length)
  assert.equal(liveFormCount, 1)
  await finishTurn(appPage)
  await expect(appPage.getByRole('heading', { name: /Ingredients|Cooking method/ }).first()).toBeFocused()
  await appPage.getByRole('button', { name: 'Previous Pages' }).click()
  await finishTurn(appPage)
  await expect(appPage.getByLabel('Recipe title')).toHaveValue('A persistent animated draft')
  await appPage.getByRole('button', { name: 'Next Pages' }).click()
  await finishTurn(appPage)
  await expect(appPage.getByRole('button', { name: 'Save recipe' })).toBeEnabled()
  await appPage.getByRole('button', { name: 'Save recipe' }).click()
  await expect(appPage.getByText('Recipe saved.')).toBeVisible()
  assert.equal(writeRequests.filter((request) => request.method === 'POST').length, 1, 'Save from a continuation leaf performs one intercepted API write')
  assert.equal(await formLayer.count(), 0, 'Transition snapshots must be removed after completion')

  for (const width of [1024, 390, 320]) {
    await appPage.setViewportSize({ width, height: 900 })
    await appPage.goto(`${origin}app/recipes/${readingRecipe.id}`)
    await expect(appPage.locator('[data-reading-ready="true"]')).toBeVisible()
    const startCount = apiRequests.filter((request) => request.path.startsWith('/functions/v1/')).length
    await appPage.getByRole('button', { name: 'Next Page' }).click()
    const layer = appPage.locator('[data-journal-page-turn]')
    await expect(layer).toHaveAttribute('data-layout', 'single')
    await expect(layer).toHaveAttribute('data-duration', '620')
    await expect(layer.locator('.mm-turn-cast')).toHaveCount(0)
    await finishTurn(appPage)
    const bounds = await appPage.evaluate(() => ({ width: globalThis.innerWidth, documentWidth: globalThis.document.documentElement.scrollWidth }))
    assert.equal(bounds.documentWidth, bounds.width, `${width}px layout must not overflow horizontally`)
    assert.equal(apiRequests.filter((request) => request.path.startsWith('/functions/v1/')).length, startCount, `${width}px read turns must not refetch recipe data`)
  }

  const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await addAppMocks(reducedContext, origin)
  const reducedPage = await reducedContext.newPage()
  reducedPage.setDefaultTimeout(12_000)
  await reducedPage.goto(`${origin}app/recipes/${readingRecipe.id}`)
  await expect(reducedPage.locator('[data-reading-ready="true"]')).toBeVisible()
  await reducedPage.getByRole('button', { name: 'Next Page' }).click()
  await expect(reducedPage.locator('[data-journal-page-turn]')).toHaveCount(0)
  await expect(reducedPage.locator('.mm-reading-indicator')).toContainText('Page 2')
  await snapshot(reducedPage, 'current-1440-reduced-motion')
  await reducedContext.close()

  const video = appPage.video()
  await appContext.close()
  await video?.saveAs(path.join(output, 'mori-forward-backward.webm'))
  await originalContext.close()
  await browser.close()
  browser = undefined

  assert.deepEqual(browserErrors, [])
  await writeFile(path.join(output, 'measurements.json'), `${JSON.stringify({ comparison, requests: apiRequests, writes: writeRequests.map(({ method, body }) => ({ method, title: body.title, ingredients: body.ingredients.length, instructions: body.instructions.length })) }, null, 2)}\n`)
  const scenes = [
    'before-forward', 'forward-midpoint', 'forward-complete', 'backward-midpoint', 'backward-complete',
  ]
  const frame = (side, scene) => `<figure><figcaption>${side} · ${scene.replaceAll('-', ' ')}</figcaption><img src="${side}-1440-${scene}.png" alt="${side} ${scene}"></figure>`
  await writeFile(path.join(output, 'comparison.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>UI-01 Step 4 physical page turns</title><style>body{font:15px system-ui;background:#f8f1e1;color:#2b211b;margin:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}figure{margin:0 0 20px}img{display:block;width:100%;height:auto}figcaption{padding:6px 0}@media(max-width:900px){main{grid-template-columns:1fr}}</style><h1>UI-01 Step 4 · original and current physical turns</h1><p>Chromium captures at 1440×900, 100% zoom. Both applications use the same six-recipe collection and the original source CSS. The production API is isolated and intercepted. Midpoint frames were captured 410ms into each 820ms spread turn. See <a href="measurements.json">turn measurements</a> and <a href="mori-forward-backward.webm">MORI'S MIX recording</a>.</p><main>${scenes.map((scene) => frame('reference', scene) + frame('current', scene)).join('')}</main><h2>Single-page and reduced motion</h2><main><figure><figcaption>Current · single-page midpoint, 390×900</figcaption><img src="current-390-single-midpoint.png" alt="Single page midpoint"></figure><figure><figcaption>Current · reduced motion, 1440×900</figcaption><img src="current-1440-reduced-motion.png" alt="Reduced motion page result"></figure></main></html>`)
  await writeFile(path.join(output, 'single-page-comparison.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Single-page turn comparison</title><style>body{font:15px system-ui;background:#f8f1e1;color:#2b211b;margin:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{padding:6px 0}@media(max-width:900px){main{grid-template-columns:1fr}}</style><h1>Single-page turn at 390×900</h1><p>The original Make and MORI'S MIX use the same six-recipe collection. Both animation timelines are held at 480ms of the 620ms single-page turn.</p><main><figure><figcaption>Original Make</figcaption><img src="reference-390-single-midpoint.png" alt="Original Make single-page midpoint"></figure><figure><figcaption>MORI'S MIX</figcaption><img src="current-390-single-midpoint.png" alt="MORI'S MIX single-page midpoint"></figure></main><p><a href="comparison.html">Spread turns</a> · <a href="measurements.json">Measurements</a></p></html>`)
  process.stdout.write(`Step 4 animation acceptance passed. Evidence: ${output}\n`)
} finally {
  await appContext?.close().catch(() => undefined)
  await originalContext?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await server.close().catch(() => undefined)
  await referenceServer.close().catch(() => undefined)
}
