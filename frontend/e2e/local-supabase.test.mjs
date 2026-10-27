import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { URL } from 'node:url'
import test from 'node:test'
import {
  assertLocalSupabaseUrl,
  createPlaywrightEnvironment,
  createSupabaseCliEnvironment,
  parseSupabaseStatus,
  prepareLocalE2eAccount,
  waitForRecipesHandler,
} from './local-supabase.mjs'

test('local E2E target accepts only HTTP loopback Supabase URLs', () => {
  assert.equal(assertLocalSupabaseUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321')
  assert.equal(assertLocalSupabaseUrl('http://localhost:54321/functions/v1'), 'http://localhost:54321')
  assert.throws(() => assertLocalSupabaseUrl('https://project.supabase.co'), /non-loopback/)
  assert.throws(() => assertLocalSupabaseUrl('http://192.168.1.2:54321'), /non-loopback/)
})

test('Supabase CLI env parsing never evaluates values', () => {
  assert.deepEqual(parseSupabaseStatus('API_URL="http://127.0.0.1:54321"\nSERVICE_ROLE_KEY="local-key"'), {
    API_URL: 'http://127.0.0.1:54321',
    SERVICE_ROLE_KEY: 'local-key',
  })
  assert.deepEqual(parseSupabaseStatus('API_URL=$(touch /tmp/should-not-exist)'), {
    API_URL: '$(touch /tmp/should-not-exist)',
  })
  assert.deepEqual(parseSupabaseStatus("API_URL='http://127.0.0.1:23123'"), {
    API_URL: 'http://127.0.0.1:23123',
  })
})

test('passes only the minimal local browser environment', () => {
  const environment = createPlaywrightEnvironment('http://127.0.0.1:23123', 'local-publishable-key', {
    PATH: '/usr/bin',
    HOME: '/tmp/test-home',
    CI: 'true',
    SUPABASE_URL: 'https://hosted.example.test',
    DATABASE_URL: 'postgresql://remote',
    PGPASSWORD: 'remote-secret',
    NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL: 'https://hosted.example.test',
    BE06_TEST_SUPABASE_URL: 'https://hosted.example.test',
    SERVICE_ROLE_KEY: 'must-not-leak',
    VITE_SUPABASE_ANON_KEY: 'must-not-leak',
    VITE_SUPABASE_URL: 'https://hosted.example.test',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'hosted-publishable-key',
  })

  assert.deepEqual(environment, {
    PATH: '/usr/bin',
    HOME: '/tmp/test-home',
    CI: 'true',
    VITE_SUPABASE_URL: 'http://127.0.0.1:23123',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key',
  })
})

test('local Supabase CLI environment excludes hosted and Docker targets', () => {
  assert.deepEqual(createSupabaseCliEnvironment({
    PATH: '/usr/bin',
    HOME: '/tmp/test-home',
    TMPDIR: '/tmp',
    TERM: 'xterm',
    CI: 'true',
    DOCKER_HOST: 'unix:///var/run/docker.sock',
    DOCKER_CONTEXT: 'desktop-linux',
    DOCKER_CERT_PATH: '/tmp/docker-certs',
    DOCKER_TLS_VERIFY: '1',
    SUPABASE_URL: 'https://hosted.example.test',
    SUPABASE_ACCESS_TOKEN: 'hosted-secret',
    DATABASE_URL: 'postgresql://remote',
    PGPASSWORD: 'remote-secret',
    BE06_TEST_SUPABASE_URL: 'https://hosted.example.test',
  }), {
    PATH: '/usr/bin',
    HOME: '/tmp/test-home',
    TMPDIR: '/tmp',
    TERM: 'xterm',
    CI: 'true',
    SUPABASE_EXPERIMENTAL_STACK: '1',
  })
})

test('retries readiness timeouts while the native function server starts', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('startup timeout'), { name: 'TimeoutError' })
    return { status: 401, json: async () => ({ error: { code: 'UNAUTHORIZED' } }) }
  })

  await waitForRecipesHandler('http://127.0.0.1:23123', 'local-key', {
    child: { pid: 1, exitCode: null, signalCode: null },
    failureDetail: () => '',
  })

  assert.equal(calls, 2)
})

test('E2E Supabase configuration uses an isolated project and dynamically assigned ports', async () => {
  const config = await readFile(new URL('./supabase/config.toml', import.meta.url), 'utf8')

  assert.match(config, /^project_id = "moris-mix-fs03-e2e"$/m)
  assert.match(config, /^stack = true$/m)
  assert.doesNotMatch(config, /^\s*(?:port|shadow_port)\s*=/m)
})

test('creates the E2E Auth user with a documented payload and persists its returned ID', async (t) => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'fs03-e2e-'))
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const calls = []
  const fixturePath = path.join(fixtureDirectory, 'auth-user.json')
  const user = { email: 'fs03-playwright@example.test', password: 'local-only' }
  const userId = '3ce7f76a-efad-4f18-9d2f-25fc9bb2e1fc'
  const admin = {
    auth: {
      admin: {
        createUser: async (...args) => {
          calls.push(['create', ...args])
          return { data: { user: { id: userId, email: user.email } }, error: null }
        },
      },
    },
  }

  await prepareLocalE2eAccount(admin, user, fixturePath)

  assert.deepEqual(calls, [
    ['create', { ...user, email_confirm: true }],
  ])
  assert.deepEqual(JSON.parse(await readFile(fixturePath, 'utf8')), { userId })
})

test('recovers an existing E2E Auth user when its fixture file is missing', async (t) => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'fs03-e2e-'))
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const fixturePath = path.join(fixtureDirectory, 'auth-user.json')
  const user = { email: 'fs03-playwright@example.test', password: 'local-only' }
  const userId = '3ce7f76a-efad-4f18-9d2f-25fc9bb2e1fc'
  const calls = []
  const admin = {
    auth: {
      admin: {
        createUser: async (...args) => {
          calls.push(['create', ...args])
          return { data: { user: null }, error: { code: 'email_exists' } }
        },
        listUsers: async (...args) => {
          calls.push(['list', ...args])
          return { data: { users: [{ id: userId, email: user.email }] }, error: null }
        },
        updateUserById: async (...args) => {
          calls.push(['update', ...args])
          return { data: { user: { id: userId, email: user.email } }, error: null }
        },
      },
    },
  }

  await prepareLocalE2eAccount(admin, user, fixturePath)

  assert.deepEqual(calls, [
    ['create', { ...user, email_confirm: true }],
    ['list'],
    ['update', userId, { password: user.password, email_confirm: true }],
  ])
  assert.deepEqual(JSON.parse(await readFile(fixturePath, 'utf8')), { userId })
})

test('reuses only the persisted E2E Auth user without listing other seeded users', async (t) => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'fs03-e2e-'))
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const fixturePath = path.join(fixtureDirectory, 'auth-user.json')
  const userId = '3ce7f76a-efad-4f18-9d2f-25fc9bb2e1fc'
  await writeFile(fixturePath, JSON.stringify({ userId }))
  const user = { email: 'fs03-playwright@example.test', password: 'local-only' }
  const calls = []
  const admin = {
    auth: {
      admin: {
        getUserById: async (...args) => {
          calls.push(['get', ...args])
          return { data: { user: { id: userId, email: user.email } }, error: null }
        },
        updateUserById: async (...args) => {
          calls.push(['update', ...args])
          return { data: { user: { id: userId, email: user.email } }, error: null }
        },
      },
    },
  }

  await prepareLocalE2eAccount(admin, user, fixturePath)

  assert.deepEqual(calls, [
    ['get', userId],
    ['update', userId, { password: 'local-only', email_confirm: true }],
  ])
})

test('refuses to update a stored Auth user when its email does not match the fixture', async (t) => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'fs03-e2e-'))
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const fixturePath = path.join(fixtureDirectory, 'auth-user.json')
  const userId = '3ce7f76a-efad-4f18-9d2f-25fc9bb2e1fc'
  await writeFile(fixturePath, JSON.stringify({ userId }))
  const admin = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: userId, email: 'someone-else@example.test' } }, error: null }),
      },
    },
  }

  await assert.rejects(
    prepareLocalE2eAccount(admin, { email: 'fs03-playwright@example.test', password: 'local-only' }, fixturePath),
    /does not match the expected test user/,
  )
})
