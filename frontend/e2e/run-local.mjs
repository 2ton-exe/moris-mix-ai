import { spawnSync } from 'node:child_process'
import { cp, copyFile, mkdir, rm } from 'node:fs/promises'
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
  run('pnpm', [...supabaseArgs, 'start'], projectRoot, cliEnv)

  const status = parseSupabaseStatus(run('pnpm', [...supabaseArgs, 'status', '--env', '--output-format', 'text'], projectRoot, cliEnv))
  const apiUrl = assertLocalSupabaseUrl(status.API_URL)
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY
  const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
  if (!publicKey || !serviceRoleKey) throw new Error('Supabase CLI did not return local Auth keys.')

  await prepareAccount(apiUrl, serviceRoleKey)
  process.stdout.write('Prepared the local-only E2E account. Starting Playwright.\n')

  const playwrightEnv = createPlaywrightEnvironment(apiUrl, publicKey)

  const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], {
    cwd: frontendDir,
    env: playwrightEnv,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Could not run the authenticated recipe E2E journey.'}\n`)
  process.exitCode = 1
})
