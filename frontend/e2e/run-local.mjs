import { spawn, spawnSync } from 'node:child_process'
import { cp, copyFile, mkdir, rm } from 'node:fs/promises'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { localE2eUser } from './local-user.mjs'
import {
  assertLocalSupabaseUrl,
  createPlaywrightEnvironment,
  createSupabaseCliEnvironment,
  parseSupabaseStatus,
  prepareLocalE2eAccount,
} from './local-supabase.mjs'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendDir, '..')
const e2eWorkdir = path.join(projectRoot, '.e2e-supabase')
const e2eSupabaseDir = path.join(e2eWorkdir, 'supabase')

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 20_000_000 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`)
  }
  return result.stdout
}

function redactFunctionServerLog(line) {
  return line
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[REDACTED KEY]')
    .replace(/((?:api|anon|publishable|secret|service[_-]?role|password|token)[a-z0-9_-]*["']?\s*[:=]\s*["']?)[^,\s"'}]+/gi, '$1[REDACTED]')
}

async function stopFunctionServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  let timeout
  const exited = new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    child.once('exit', onExit)
    timeout = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, 5_000)
  })

  try {
    child.kill('SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }

  await exited

  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

function startFunctionServer(frontendDir, e2eWorkdir, cliEnv) {
  const child = spawn('pnpm', [
    'exec',
    'supabase',
    '--workdir',
    e2eWorkdir,
    'functions',
    'serve',
    'recipes',
  ], {
    cwd: frontendDir,
    env: cliEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logTail = []
  let spawnError = ''
  const captureOutput = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      logTail.push(line.slice(-2_000))
      if (logTail.length > 12) logTail.shift()
    }
  }
  child.stdout.on('data', captureOutput)
  child.stderr.on('data', captureOutput)
  child.once('error', (error) => {
    spawnError = error.message
  })

  return {
    child,
    failureDetail() {
      const lines = [spawnError, ...logTail.slice(-5)].filter(Boolean)
      return lines.map(redactFunctionServerLog).join(' | ')
    },
  }
}

async function waitForRecipesHandler(apiUrl, publicKey, functionServer) {
  const { child } = functionServer
  const url = `${apiUrl}/functions/v1/recipes`
  const deadline = Date.now() + 60_000
  let lastStatus = 'no response'

  while (Date.now() < deadline) {
    if (child.pid === undefined) {
      const detail = functionServer.failureDetail()
      throw new Error(`Could not start the local recipes function server${detail ? `: ${detail}` : '.'}`)
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      const detail = functionServer.failureDetail()
      throw new Error(`The local recipes function server exited before its handler became ready.${detail ? ` ${detail}` : ''}`)
    }

    try {
      const response = await globalThis.fetch(url, {
        headers: { apikey: publicKey },
        signal: globalThis.AbortSignal.timeout(30_000),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 401 && body?.error?.code === 'UNAUTHORIZED') return
      lastStatus = `HTTP ${response.status}`
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('The local recipes handler did not answer its readiness request within 30 seconds.')
      }
      lastStatus = error instanceof Error ? error.name : 'request failed'
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  const detail = functionServer.failureDetail()
  throw new Error(`The local recipes handler did not become ready (${lastStatus}).${detail ? ` ${detail}` : ''}`)
}

async function prepareIsolatedProjectFiles() {
  await mkdir(e2eSupabaseDir, { recursive: true })
  await mkdir(path.join(e2eWorkdir, 'vite-env'), { recursive: true })
  await copyFile(path.join(frontendDir, 'e2e', 'supabase', 'config.toml'), path.join(e2eSupabaseDir, 'config.toml'))

  const functionsTarget = path.join(e2eSupabaseDir, 'functions')
  await rm(functionsTarget, { recursive: true, force: true })
  await mkdir(functionsTarget, { recursive: true })
  for (const directory of ['_shared', 'recipes']) {
    await cp(path.join(projectRoot, 'supabase', 'functions', directory), path.join(functionsTarget, directory), { recursive: true })
  }

  const migrationsTarget = path.join(e2eSupabaseDir, 'migrations')
  await rm(migrationsTarget, { recursive: true, force: true })
  await cp(path.join(projectRoot, 'supabase', 'migrations'), migrationsTarget, { recursive: true })

  await copyFile(path.join(projectRoot, 'supabase', 'seed.sql'), path.join(e2eSupabaseDir, 'seed.sql'))
}

async function prepareAccount(apiUrl, serviceRoleKey) {
  const admin = createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  await prepareLocalE2eAccount(admin, localE2eUser, path.join(e2eWorkdir, 'auth-user.json'))
}

async function main() {
  run(process.execPath, ['--test', 'e2e/local-supabase.test.mjs'], frontendDir)
  await prepareIsolatedProjectFiles()

  const cliEnv = createSupabaseCliEnvironment()
  const supabaseArgs = ['exec', 'supabase', '--workdir', e2eWorkdir]
  process.stdout.write('Starting the isolated local E2E Supabase project (CLI output is captured to keep local keys out of logs).\n')
  run('pnpm', [...supabaseArgs, 'start'], frontendDir, cliEnv)

  const status = parseSupabaseStatus(run('pnpm', [...supabaseArgs, 'status', '--env', '--output-format', 'text'], frontendDir, cliEnv))
  const apiUrl = assertLocalSupabaseUrl(status.API_URL)
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
  if (!publicKey || !serviceRoleKey) throw new Error('Supabase CLI did not return local Auth keys.')

  await prepareAccount(apiUrl, serviceRoleKey)
  process.stdout.write('Prepared the local-only E2E account. Starting the recipes function server.\n')

  const playwrightEnv = createPlaywrightEnvironment(apiUrl, publicKey)
  const functionServer = startFunctionServer(frontendDir, e2eWorkdir, cliEnv)
  try {
    await waitForRecipesHandler(apiUrl, publicKey, functionServer)
    process.stdout.write('Recipes handler is responding. Starting Playwright.\n')

    const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], {
      cwd: frontendDir,
      env: playwrightEnv,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    await stopFunctionServer(functionServer.child)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Could not run the authenticated recipe E2E journey.'}\n`)
  process.exitCode = 1
})
