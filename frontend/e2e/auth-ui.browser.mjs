// Focused auth presentation and flow acceptance using synthetic Supabase replies.
// Requests are intercepted locally; this never contacts a hosted auth project.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { assertJournalSemantics } from './journal-accessibility-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiOrigin = 'https://auth-ui.example.test'
const userId = '22222222-2222-4222-8222-222222222222'
const user = {
  id: userId, aud: 'authenticated', role: 'authenticated', email: 'cook@example.test',
  app_metadata: {}, user_metadata: {}, created_at: '2026-10-19T00:00:00Z',
  email_confirmed_at: '2026-10-19T00:00:00Z',
}
const session = {
  access_token: 'auth-ui-test-access', refresh_token: 'auth-ui-test-refresh', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
}
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'moris-ui01-auth-'))
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('isolated-auth-ui-public-key'),
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

  async function newAuthContext(width, contextOptions = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...contextOptions })
    const authRequests = []
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin === new URL(origin).origin) return route.continue()
      assert.equal(url.origin, apiOrigin, `Unexpected external request: ${url.origin}`)
      const method = request.method()
      const body = method === 'GET' || method === 'HEAD' ? null : request.postDataJSON()
      authRequests.push({ method, path: url.pathname, search: url.search, body })
      if (url.pathname === '/auth/v1/user' && method === 'GET') return route.fulfill({ json: user })
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'pkce') return route.fulfill({ json: session })
        if (url.searchParams.get('grant_type') === 'password') {
          if (body.email === 'wrong@example.test') return route.fulfill({ status: 400, json: { code: 'invalid_credentials', message: 'private auth detail' } })
          return route.fulfill({ json: session })
        }
      }
      if (url.pathname === '/auth/v1/signup' && method === 'POST') {
        return route.fulfill({ json: { ...user, email: body.email, email_confirmed_at: null, identities: [{ id: userId, user_id: userId, identity_data: { email: body.email } }] } })
      }
      if (url.pathname === '/auth/v1/resend' && method === 'POST') {
        if (body.email === 'rate@example.test') return route.fulfill({ status: 429, json: { code: 'over_email_send_rate_limit', message: 'private rate detail' } })
        return route.fulfill({ json: {} })
      }
      if (url.pathname === '/auth/v1/logout' && method === 'POST') return route.fulfill({ status: 204 })
      if (url.pathname === '/functions/v1/recipes' && method === 'GET') return route.fulfill({ json: { recipes: [], has_more: false, next_cursor: null } })
      return route.fulfill({ status: 404, json: { code: 'unexpected_test_request', message: 'Unexpected isolated request' } })
    })
    return { context, page, authRequests, errors }
  }

  const desktop = await newAuthContext(1440)
  const { context, page, authRequests, errors } = desktop
  await page.goto(`${origin}app/recipes/new`)
  await expect(page).toHaveURL(`${origin}login`)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await assertJournalSemantics(page, 'login')
  await expect(page.locator('.mm-auth-brand')).toHaveAttribute('href', '/demo-recipe')
  await expect(page.locator('.mm-auth-cover')).toBeVisible()
  await expect(page.locator('.mm-auth-card')).toHaveCSS('opacity', '1')
  await expect(page.locator('.mm-auth-card__tape')).toBeVisible()
  await expect(page.locator('.mm-auth-card__clip')).toBeVisible()
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
  await page.screenshot({ path: path.join(outputDir, 'desktop-login.png') })

  // Validation, first-error focus, password visibility, safe auth errors, and return path.
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Enter your email address.')).toBeVisible()
  await expect(page.getByText('Enter your password.')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-describedby', /email-error/)
  await expect(page.getByLabel('Email')).toBeFocused()
  await assertJournalSemantics(page, 'login validation errors')
  await page.getByLabel('Email').fill('wrong@example.test')
  await page.getByRole('textbox', { name: 'Password' }).fill('example-password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(page.getByRole('textbox', { name: 'Password' })).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  assert.equal(await page.getByRole('alert').filter({ hasText: 'private auth detail' }).count(), 0)
  await page.getByLabel('Email').fill('cook@example.test')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(`${origin}app/recipes/new`)
  await expect(page.getByRole('heading', { name: 'A recipe of your own.' })).toBeVisible()
  assert.equal(authRequests.filter((request) => request.path === '/auth/v1/token').length, 2)
  assert.equal(authRequests.find((request) => request.path === '/auth/v1/token').body.email, 'wrong@example.test')
  await context.close()
  assert.deepEqual(errors, [])

  // Signup rules, password toggles and a safe email verification resend.
  const signup = await newAuthContext(390)
  await signup.page.goto(`${origin}signup`)
  await expect(signup.page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await assertJournalSemantics(signup.page, 'signup')
  await expect(signup.page.locator('.mm-auth-cover')).toBeHidden()
  await signup.page.getByLabel('Email').fill('new-cook@example.test')
  await signup.page.getByLabel('Password', { exact: true }).fill('short')
  await signup.page.getByRole('textbox', { name: 'Confirm password' }).fill('different')
  await signup.page.getByRole('button', { name: 'Create account' }).click()
  await expect(signup.page.getByText('Use at least 6 characters.', { exact: true })).toBeVisible()
  await expect(signup.page.getByText('Passwords do not match.')).toBeVisible()
  await assertJournalSemantics(signup.page, 'signup validation errors')
  await signup.page.getByLabel('Password', { exact: true }).fill('correct-horse-7')
  await signup.page.getByRole('textbox', { name: 'Confirm password' }).fill('correct-horse-7')
  await signup.page.getByRole('button', { name: 'Create account' }).click()
  await expect(signup.page).toHaveURL(`${origin}verify-email`)
  await expect(signup.page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await assertJournalSemantics(signup.page, 'verification pending')
  await expect(signup.page.getByRole('status')).toContainText('finish signing up')
  await signup.page.getByRole('button', { name: 'Send verification link' }).click()
  await expect(signup.page.getByRole('status').filter({ hasText: 'new link will arrive shortly' })).toBeVisible()
  await signup.page.getByLabel('Email').fill('rate@example.test')
  await signup.page.getByRole('button', { name: 'Send verification link' }).click()
  await expect(signup.page.getByRole('alert')).toBeVisible()
  await expect(signup.page.getByText('private rate detail')).toHaveCount(0)
  const signupFlowId = await signup.page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('sb-auth-ui-auth-token-flows-code-verifier') ?? '[]')[0])
  assert.equal(typeof signupFlowId, 'string')
  await signup.page.goto(`${origin}auth/callback?code=auth-ui-pkce-code&sb_flow_id=${encodeURIComponent(signupFlowId)}`)
  await expect(signup.page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  await assertJournalSemantics(signup.page, 'verification success')
  await expect(signup.page.getByRole('status')).toContainText('email is confirmed')
  assert.ok(signup.authRequests.some((request) => request.path === '/auth/v1/token' && request.search === '?grant_type=pkce'))
  await expect(signup.page).toHaveURL(`${origin}auth/callback`)
  assert.deepEqual(signup.errors, [])
  await signup.context.close()

  const verificationFailure = await newAuthContext(390)
  await verificationFailure.page.goto(`${origin}auth/callback#error=access_denied&error_code=otp_expired`)
  await expect(verificationFailure.page.getByRole('heading', { name: 'Check your verification link' })).toBeVisible()
  await assertJournalSemantics(verificationFailure.page, 'invalid verification link')
  await expect(verificationFailure.page.getByRole('status')).toContainText('expired, invalid, or already used')
  assert.equal(await verificationFailure.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
  await verificationFailure.page.screenshot({ path: path.join(outputDir, 'mobile-verification.png'), fullPage: true })
  await verificationFailure.page.getByRole('link', { name: 'Back to login' }).click()
  await expect(verificationFailure.page).toHaveURL(`${origin}login`)
  assert.deepEqual(verificationFailure.errors, [])
  await verificationFailure.context.close()

  // Session restoration, protected content, and logout retain the single SDK session.
  const restored = await newAuthContext(390)
  await restored.page.addInitScript(({ session }) => {
    globalThis.localStorage.setItem('sb-auth-ui-auth-token', JSON.stringify(session))
  }, { session })
  await restored.page.goto(`${origin}app`)
  await expect(restored.page.getByRole('heading', { name: 'Your cooking journal' })).toBeVisible()
  await assertJournalSemantics(restored.page, 'restored authenticated journal')
  await expect(restored.page.getByText('cook@example.test')).toBeVisible()
  assert.equal(await restored.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
  await restored.page.getByRole('button', { name: 'Log out' }).click()
  await expect(restored.page).toHaveURL(`${origin}login`)
  await expect(restored.page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  assert.ok(restored.authRequests.some((request) => request.path === '/auth/v1/logout' && request.search === '?scope=local'))
  await restored.context.close()
  assert.deepEqual(restored.errors, [])

  // Reflow at 200% and keyboard focus keep the login controls visible and operable.
  const zoom = await newAuthContext(1440)
  await zoom.page.goto(`${origin}login`)
  await zoom.page.evaluate(() => { globalThis.document.documentElement.style.zoom = '2' })
  assert.equal(await zoom.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
  await expect(zoom.page.locator('.mm-auth-cover')).toBeHidden()
  await zoom.page.getByLabel('Email').focus()
  assert.equal(await zoom.page.getByLabel('Email').evaluate((element) => globalThis.getComputedStyle(element).outlineStyle !== 'none'), true)
  await zoom.page.screenshot({ path: path.join(outputDir, 'zoom-200-login.png'), fullPage: true })
  await zoom.page.getByLabel('Email').press('Tab')
  await expect(zoom.page.getByRole('textbox', { name: 'Password' })).toBeFocused()
  await zoom.context.close()
  assert.deepEqual(zoom.errors, [])

  // The entry animation is removed when the operating system requests reduced motion.
  const reducedMotion = await newAuthContext(390, { reducedMotion: 'reduce' })
  await reducedMotion.page.goto(`${origin}login`)
  await expect(reducedMotion.page.locator('.mm-auth-card')).toHaveCSS('animation-name', 'none')
  await reducedMotion.context.close()
  assert.deepEqual(reducedMotion.errors, [])

  // Long safe errors wrap at a narrow width without pushing controls off-screen.
  const longError = await newAuthContext(320)
  await longError.page.goto(`${origin}login`)
  await longError.page.getByRole('button', { name: 'Log in' }).click()
  const alert = longError.page.getByRole('alert').first()
  await alert.evaluate((element) => { element.textContent = 'A long authentication message without a short line break. '.repeat(12) })
  assert.equal(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
  assert.equal(await longError.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
  await expect(longError.page.getByLabel('Email')).toBeVisible()
  await expect(longError.page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await longError.context.close()
  assert.deepEqual(longError.errors, [])

  process.stdout.write(`Login, signup, verification pending/success/expired, resend, protected return, session restoration, logout, keyboard/focus, mobile, long-error reflow, reduced motion and 200% zoom passed. Screenshots: ${outputDir}\n`)
} finally {
  await browser?.close()
  await server.close()
}
