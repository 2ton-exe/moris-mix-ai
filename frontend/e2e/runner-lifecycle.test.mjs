import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { clearTimeout, setImmediate, setTimeout } from 'node:timers'
import test from 'node:test'
import {
  formatCommandFailure,
  redactSensitiveOutput,
  retryInterruptedCleanup,
  stopProcessGroup,
  withStackCleanup,
} from './runner-lifecycle.mjs'

const supportsProcessGroups = process.platform !== 'win32'

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

test('forwards a signal to the active command before the stack starts', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(false)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })
  const emitter = new EventEmitter()
  let finishTask
  let finishSignal
  let cleanups = 0
  const taskFinished = new Promise((resolve) => { finishTask = resolve })
  const signalHandled = new Promise((resolve) => { finishSignal = resolve })
  const lifecycle = withStackCleanup(async () => {
    await taskFinished
  }, async () => { cleanups += 1 }, () => finishSignal(), emitter, async (signal) => {
    await stopProcessGroup(child, signal)
  })

  await new Promise((resolve) => setImmediate(resolve))
  emitter.emit('SIGTERM')
  await signalHandled
  finishTask()
  await lifecycle

  assert.equal(cleanups, 0)
  assert.equal(child.exitCode, 0)
})

test('retries cleanup only after its command was interrupted by a signal', async () => {
  const stopError = new Error('stop command interrupted')
  let attempts = 0
  let interrupted = true
  let signalFinished = false

  await retryInterruptedCleanup(async () => {
    attempts += 1
    if (attempts === 1) throw stopError
  }, () => {
    const wasInterrupted = interrupted
    interrupted = false
    return wasInterrupted
  }, async () => {
    signalFinished = true
  })

  assert.equal(attempts, 2)
  assert.equal(signalFinished, true)

  await assert.rejects(
    retryInterruptedCleanup(async () => { throw stopError }, () => false, async () => {}),
    (error) => error === stopError,
  )

  let failedAttempts = 0
  await assert.rejects(
    retryInterruptedCleanup(async () => {
      failedAttempts += 1
      throw stopError
    }, () => true, async () => {}),
    (error) => error.message === `Cleanup retry failed after interruption: ${stopError.message}`
      && error.cause === stopError,
  )
  assert.equal(failedAttempts, 2)
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

test('forwards a received signal to the active process group before cleanup completes', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(false)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })
  const emitter = new EventEmitter()
  let cleanupSignal
  let finishTask
  let signalHandled
  const handledSignal = new Promise((resolve) => { signalHandled = resolve })
  const lifecycle = withStackCleanup(async (markStackMayHaveStarted) => {
    markStackMayHaveStarted()
    await new Promise((resolve) => { finishTask = resolve })
  }, async (signal) => {
    cleanupSignal = signal
    await stopProcessGroup(child, signal)
  }, () => signalHandled(), emitter)
  await new Promise((resolve) => setImmediate(resolve))

  emitter.emit('SIGTERM')
  await handledSignal
  finishTask()
  await lifecycle

  assert.equal(cleanupSignal, 'SIGTERM')
  assert.equal(child.exitCode, 0)
})

test('forwards a signal received during cleanup to the active command without repeating stack cleanup', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(false)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })
  const emitter = new EventEmitter()
  let cleanups = 0
  let startCleanup
  let finishSignal
  const cleanupStarted = new Promise((resolve) => { startCleanup = resolve })
  const signalHandled = new Promise((resolve) => { finishSignal = resolve })
  const childExited = new Promise((resolve) => child.once('exit', resolve))
  const lifecycle = withStackCleanup(async (markStackMayHaveStarted) => {
    markStackMayHaveStarted()
  }, async () => {
    cleanups += 1
    startCleanup()
    await childExited
  }, () => finishSignal(), emitter, async (signal) => {
    await stopProcessGroup(child, signal)
  })

  await cleanupStarted
  emitter.emit('SIGTERM')
  let timeout
  try {
    await Promise.race([
      signalHandled,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The signal was not forwarded to the active command.')), 1_000) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await lifecycle

  assert.equal(cleanups, 1)
  assert.equal(child.exitCode, 0)
})

test('forwards a second signal to the retrying cleanup command without repeating stack cleanup', { skip: !supportsProcessGroups }, async (t) => {
  const firstCommand = await startTestProcessGroup(false, 1)
  const retryCommand = await startTestProcessGroup(false, 1)
  t.after(() => {
    for (const child of [firstCommand, retryCommand]) {
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
  })

  const emitter = new EventEmitter()
  let startFirstAttempt
  let startRetry
  let finishSignal
  const firstAttemptStarted = new Promise((resolve) => { startFirstAttempt = resolve })
  const retryStarted = new Promise((resolve) => { startRetry = resolve })
  const signalHandled = new Promise((resolve) => { finishSignal = resolve })
  const forwardedSignals = []
  const exitCodes = []
  const firstStopError = new Error('first stop command was interrupted')
  const retryStopError = new Error('retry stop command exited unsuccessfully after SIGINT')
  let activeCommand
  let attempts = 0
  let cleanups = 0
  let stackStopInProgress = false
  let stackStopInterrupted = false
  let stackStopSignalForwarding = Promise.resolve()

  const lifecycle = withStackCleanup(async (markStackMayHaveStarted) => {
    markStackMayHaveStarted()
  }, async () => {
    cleanups += 1
    await retryInterruptedCleanup(async () => {
      attempts += 1
      activeCommand = attempts === 1 ? firstCommand : retryCommand
      stackStopInProgress = true
      if (attempts === 1) startFirstAttempt()
      else startRetry()
      try {
        await waitForChildExit(activeCommand)
        if (attempts === 1 && activeCommand.exitCode !== 0) throw firstStopError
        if (attempts === 2 && (activeCommand.exitCode !== 0 || activeCommand.signalCode !== null)) throw retryStopError
      } finally {
        stackStopInProgress = false
      }
    }, () => {
      if (!stackStopInterrupted) return false
      stackStopInterrupted = false
      return true
    }, () => stackStopSignalForwarding)
  }, (code) => {
    exitCodes.push(code)
    finishSignal()
  }, emitter, async (signal) => {
    forwardedSignals.push(signal)
    if (stackStopInProgress) {
      stackStopInterrupted = true
      stackStopSignalForwarding = stopProcessGroup(activeCommand, signal)
      await stackStopSignalForwarding
      return
    }
    await stopProcessGroup(activeCommand, signal)
  })
  const lifecycleFailure = assert.rejects(
    lifecycle,
    (error) => error.message === `Cleanup retry failed after interruption: ${retryStopError.message}`
      && error.cause === retryStopError,
  )

  await firstAttemptStarted
  emitter.emit('SIGTERM')
  await retryStarted
  emitter.emit('SIGINT')
  let timeout
  try {
    await Promise.race([
      signalHandled,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The second signal was not forwarded to the retry command.')), 1_000) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await lifecycleFailure

  assert.deepEqual(forwardedSignals, ['SIGTERM', 'SIGINT'])
  assert.equal(cleanups, 1)
  assert.equal(attempts, 2)
  assert.deepEqual(exitCodes, [143])
  assert.equal(firstCommand.exitCode, 1)
  assert.equal(retryCommand.signalCode, 'SIGINT')
})

test('redacts credentials from command diagnostics', () => {
  const output = 'Authorization: Bearer local-token\nSERVICE_ROLE_KEY=server-secret\nDATABASE_URL=postgresql://postgres:secret@127.0.0.1\nsb_secret_local-key'
  const detail = redactSensitiveOutput(output)

  assert.equal(detail, 'Authorization: Bearer [REDACTED]\nSERVICE_ROLE_KEY=[REDACTED]\nDATABASE_URL=[REDACTED]\n[REDACTED KEY]')
  assert.equal(formatCommandFailure('supabase stack start', 1, output), 'supabase stack start failed with exit code 1.\nAuthorization: Bearer [REDACTED]\nSERVICE_ROLE_KEY=[REDACTED]\nDATABASE_URL=[REDACTED]\n[REDACTED KEY]')
})

async function startTestProcessGroup(ignoreSigterm, exitCodeOnSigterm = 0) {
  const childSignalHandler = ignoreSigterm
    ? 'process.on("SIGTERM", () => {})'
    : 'process.on("SIGTERM", () => process.exit(0))'
  const childScript = `${childSignalHandler}; setInterval(() => {}, 1000)`
  const script = [
    'const { spawn } = require("node:child_process")',
    `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" })`,
    ignoreSigterm
      ? 'process.on("SIGTERM", () => {})'
      : `process.on("SIGTERM", () => { descendant.once("exit", () => process.exit(${exitCodeOnSigterm})); if (descendant.exitCode !== null || descendant.signalCode !== null) process.exit(${exitCodeOnSigterm}); descendant.kill("SIGTERM") })`,
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

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', resolve))
}

test('stops a process group gracefully with SIGTERM', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(false)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })

  await stopProcessGroup(child)

  assert.equal(child.exitCode, 0)
})

test('uses SIGKILL when a process group ignores SIGTERM', { skip: !supportsProcessGroups }, async (t) => {
  const child = await startTestProcessGroup(true)
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  })

  await stopProcessGroup(child)

  assert.equal(child.signalCode, 'SIGKILL')
})
