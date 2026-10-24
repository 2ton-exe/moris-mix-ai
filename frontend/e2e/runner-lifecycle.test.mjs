import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import { installSignalCleanup, stopFunctionServer, withCleanup } from './runner-lifecycle.mjs'

test('runs cleanup after a successful E2E task', async () => {
  let cleaned = false

  await withCleanup(async () => {}, async () => { cleaned = true })

  assert.equal(cleaned, true)
})

test('runs cleanup after setup or Playwright failure and preserves the original error', async () => {
  const taskError = new Error('account setup failed')
  let cleaned = false

  await assert.rejects(
    withCleanup(async () => { throw taskError }, async () => { cleaned = true }),
    (error) => error === taskError,
  )
  assert.equal(cleaned, true)
})

test('reports cleanup failure without hiding the E2E failure', async () => {
  await assert.rejects(
    withCleanup(
      async () => { throw new Error('Playwright failed') },
      async () => { throw new Error('stack stop failed') },
    ),
    (error) => error instanceof AggregateError
      && error.errors[0].message === 'Playwright failed'
      && error.errors[1].message === 'stack stop failed',
  )
})

test('runs cleanup once and exits with the signal code on SIGINT or SIGTERM', async (t) => {
  for (const [signal, expectedCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    let cleanups = 0
    const exitCodes = []
    const emitter = new EventEmitter()
    const uninstall = installSignalCleanup(async () => { cleanups += 1 }, (code) => exitCodes.push(code), emitter)
    t.after(uninstall)

    emitter.emit(signal)
    emitter.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(cleanups, 1)
    assert.deepEqual(exitCodes, [expectedCode])
    uninstall()
  }
})

const supportsProcessGroups = process.platform !== 'win32'

async function startTestProcessGroup(ignoreSigterm) {
  const childSignalHandler = ignoreSigterm
    ? 'process.on("SIGTERM", () => {})'
    : 'process.on("SIGTERM", () => process.exit(0))'
  const childScript = `${childSignalHandler}; setInterval(() => {}, 1000)`
  const script = [
    'const { spawn } = require("node:child_process")',
    `spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" })`,
    ignoreSigterm ? 'process.on("SIGTERM", () => {})' : 'process.on("SIGTERM", () => process.exit(0))',
    'process.stdout.write("ready")',
    'setInterval(() => {}, 1000)',
  ].join(';')
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve)
    child.once('error', reject)
  })
  return child
}

function assertProcessGroupStopped(pid) {
  assert.throws(() => process.kill(-pid, 0), (error) => error.code === 'ESRCH')
}

test('stops the recipes process group gracefully with SIGTERM', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(false)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })

  await stopFunctionServer(child)

  assert.equal(child.exitCode, 0)
  assertProcessGroupStopped(child.pid)
})

test('uses SIGKILL when the recipes process group ignores SIGTERM', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(true)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })

  await stopFunctionServer(child)

  assert.equal(child.signalCode, 'SIGKILL')
  assertProcessGroupStopped(child.pid)
})
