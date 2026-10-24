import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import { stopFunctionServer, withStackCleanup } from './runner-lifecycle.mjs'

test('does not stop an unstarted stack after preparation fails and installs signal cleanup first', async () => {
  const preparationError = new Error('file preparation failed')
  const emitter = new EventEmitter()
  let stops = 0

  await assert.rejects(
    withStackCleanup(async () => {
      assert.equal(emitter.listenerCount('SIGINT'), 1)
      assert.equal(emitter.listenerCount('SIGTERM'), 1)
      throw preparationError
    }, async () => { stops += 1 }, () => {}, emitter),
    (error) => error === preparationError,
  )

  assert.equal(stops, 0)
  assert.equal(emitter.listenerCount('SIGINT'), 0)
  assert.equal(emitter.listenerCount('SIGTERM'), 0)
})

test('stops once after a partial stack-start failure and preserves the startup error', async () => {
  const startupError = new Error('stack start failed after starting services')
  let stops = 0

  await assert.rejects(
    withStackCleanup(async (markStackMayHaveStarted) => {
      markStackMayHaveStarted()
      throw startupError
    }, async () => { stops += 1 }),
    (error) => error === startupError,
  )

  assert.equal(stops, 1)
})

test('cleans up after success and reports startup plus cleanup failures', async () => {
  let successfulStops = 0
  await withStackCleanup(async (markStackMayHaveStarted) => {
    markStackMayHaveStarted()
  }, async () => { successfulStops += 1 })
  assert.equal(successfulStops, 1)

  const startupError = new Error('stack start failed')
  const cleanupError = new Error('stack stop failed')
  let failedStops = 0
  await assert.rejects(
    withStackCleanup(async (markStackMayHaveStarted) => {
      markStackMayHaveStarted()
      throw startupError
    }, async () => {
      failedStops += 1
      throw cleanupError
    }),
    (error) => error instanceof AggregateError
      && error.errors[0] === startupError
      && error.errors[1] === cleanupError,
  )
  assert.equal(failedStops, 1)
})

test('runs stack cleanup once and exits with the signal code on SIGINT or SIGTERM', async () => {
  for (const [signal, expectedCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    let cleanups = 0
    const exitCodes = []
    const emitter = new EventEmitter()
    let finishTask
    let signalHandled
    const handledSignal = new Promise((resolve) => { signalHandled = resolve })
    const lifecycle = withStackCleanup(async (markStackMayHaveStarted) => {
      markStackMayHaveStarted()
      await new Promise((resolve) => { finishTask = resolve })
    }, async () => { cleanups += 1 }, (code) => {
      exitCodes.push(code)
      signalHandled()
    }, emitter)
    await new Promise((resolve) => setImmediate(resolve))

    emitter.emit(signal)
    emitter.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')
    await handledSignal
    finishTask()
    await lifecycle

    assert.equal(cleanups, 1)
    assert.deepEqual(exitCodes, [expectedCode])
    assert.equal(emitter.listenerCount('SIGINT'), 0)
    assert.equal(emitter.listenerCount('SIGTERM'), 0)
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
