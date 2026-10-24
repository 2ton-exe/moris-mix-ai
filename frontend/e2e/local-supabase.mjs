import process from 'node:process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { URL } from 'node:url'

export function assertLocalSupabaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Authenticated recipe E2E requires a local Supabase URL.')
  }

  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Authenticated recipe E2E refuses non-loopback Supabase URLs.')
  }

  return url.origin
}

export function parseSupabaseStatus(output) {
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    const [, key, raw] = match
    if (!['API_URL', 'ANON_KEY', 'PUBLISHABLE_KEY', 'SERVICE_ROLE_KEY', 'SECRET_KEY'].includes(key)) continue
    if (raw.startsWith('"')) {
      values[key] = JSON.parse(raw)
    } else if (raw.startsWith("'") && raw.endsWith("'")) {
      values[key] = raw.slice(1, -1)
    } else {
      values[key] = raw
    }
  }
  return values
}

const safeProcessEnvironmentKeys = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'CI',
  'TERM',
  'PLAYWRIGHT_BROWSERS_PATH',
  'XDG_CACHE_HOME',
]

export function createPlaywrightEnvironment(apiUrl, publicKey, source = process.env) {
  const environment = Object.fromEntries(
    safeProcessEnvironmentKeys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  )

  environment.VITE_SUPABASE_URL = assertLocalSupabaseUrl(apiUrl)
  environment.VITE_SUPABASE_PUBLISHABLE_KEY = publicKey
  return environment
}

export function createSupabaseCliEnvironment(source = process.env) {
  const allowedKeys = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'CI',
    'TERM',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CERT_PATH',
    'DOCKER_TLS_VERIFY',
  ]
  const environment = Object.fromEntries(
    allowedKeys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  )
  environment.SUPABASE_EXPERIMENTAL_STACK = '1'
  return environment
}

async function readLocalE2eUserId(filePath) {
  try {
    const stored = JSON.parse(await readFile(filePath, 'utf8'))
    if (typeof stored.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(stored.userId)) {
      throw new Error('invalid fixture id')
    }
    return stored.userId
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error('Could not read the local E2E account fixture.')
  }
}

async function writeLocalE2eUserId(filePath, userId) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({ userId })}\n`, { mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export async function prepareLocalE2eAccount(admin, user, fixturePath) {
  const storedUserId = await readLocalE2eUserId(fixturePath)
  if (storedUserId) {
    const existing = await admin.auth.admin.getUserById(storedUserId)
    if (!existing.error) {
      if (existing.data?.user?.id !== storedUserId || existing.data.user.email?.toLowerCase() !== user.email) {
        throw new Error('The local E2E account fixture does not match the expected test user.')
      }

      const update = await admin.auth.admin.updateUserById(storedUserId, {
        password: user.password,
        email_confirm: true,
      })
      if (update.error || update.data?.user?.id !== storedUserId) {
        throw new Error('Could not prepare the local E2E account.')
      }
      return
    }
    if (existing.error.status !== 404) throw new Error('Could not inspect the local E2E account.')
  }

  const create = await admin.auth.admin.createUser({ ...user, email_confirm: true })
  const createdUserId = create.data?.user?.id
  if (create.error || typeof createdUserId !== 'string' || create.data.user.email?.toLowerCase() !== user.email) {
    throw new Error('Could not prepare the local E2E account.')
  }
  await writeLocalE2eUserId(fixturePath, createdUserId)
}
