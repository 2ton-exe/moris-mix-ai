import { spawn, spawnSync } from 'node:child_process'
import { cp, copyFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { localE2eOtherUser, localE2eUser } from './local-user.mjs'
import { stopFunctionServer, withStackCleanup } from './runner-lifecycle.mjs'
import {
  assertLocalSupabaseUrl,
  createPlaywrightEnvironment,
  createSupabaseCliEnvironment,
  parseSupabaseStatus,
  prepareLocalE2eAccount,
  waitForRecipesHandler,
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
    detached: process.platform !== 'win32',
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

async function prepareAccounts(apiUrl, serviceRoleKey) {
  const admin = createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  await Promise.all([
    prepareLocalE2eAccount(admin, localE2eUser, path.join(e2eWorkdir, 'auth-user.json')),
    prepareLocalE2eAccount(admin, localE2eOtherUser, path.join(e2eWorkdir, 'other-auth-user.json')),
  ])
}

async function main() {
  run(process.execPath, ['--test', 'e2e/local-supabase.test.mjs', 'e2e/runner-lifecycle.test.mjs'], frontendDir)

  const cliEnv = createSupabaseCliEnvironment()
  const supabaseArgs = ['exec', 'supabase', '--workdir', e2eWorkdir]
  let functionServer
  const task = async (markStackMayHaveStarted) => {
    await prepareIsolatedProjectFiles()
    process.stdout.write('Starting the isolated local E2E Supabase project with the native runtime.\n')
    markStackMayHaveStarted()
    run('pnpm', [...supabaseArgs, 'stack', 'start', '--runtime', 'native'], frontendDir, cliEnv)

    const status = parseSupabaseStatus(run('pnpm', [...supabaseArgs, 'status', '--env', '--output-format', 'text'], frontendDir, cliEnv))
    const apiUrl = assertLocalSupabaseUrl(status.API_URL)
    const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY
    const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
    if (!publicKey || !serviceRoleKey) throw new Error('Supabase CLI did not return local Auth keys.')

    await prepareAccounts(apiUrl, serviceRoleKey)
    process.stdout.write('Prepared the local-only E2E accounts. Starting the recipes function server.\n')

    const playwrightEnv = createPlaywrightEnvironment(apiUrl, publicKey)
    functionServer = startFunctionServer(frontendDir, e2eWorkdir, cliEnv)
    await waitForRecipesHandler(apiUrl, publicKey, functionServer)
    process.stdout.write('Recipes handler is responding. Starting Playwright.\n')

    const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], {
      cwd: frontendDir,
      env: playwrightEnv,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Playwright failed with exit code ${result.status ?? 1}.`)
  }
  const stopStackAndFunctionServer = async () => {
    const errors = []
    if (functionServer) {
      try {
        await stopFunctionServer(functionServer.child)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      run('pnpm', [...supabaseArgs, 'stack', 'stop'], frontendDir, cliEnv)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Could not fully clean up the isolated E2E Supabase project.')
  }
  await withStackCleanup(task, stopStackAndFunctionServer)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Could not run the authenticated recipe E2E journey.'}\n`)
  process.exitCode = 1
})
