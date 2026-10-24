import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'

const processExitTimeoutMs = 5_000

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function signalChild(child, signal) {
  try {
    if (process.platform === 'win32') {
      if (!hasExited(child)) child.kill(signal)
    } else if (child.pid !== undefined) {
      process.kill(-child.pid, signal)
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function isProcessGroupRunning(child) {
  if (child.pid === undefined) return false
  if (process.platform === 'win32') return !hasExited(child)

  try {
    process.kill(-child.pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function waitForChildExit(child) {
  if (hasExited(child)) return Promise.resolve(true)

  return new Promise((resolve) => {
    let timeout
    const finish = (exited) => {
      clearTimeout(timeout)
      child.off('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    timeout = setTimeout(() => finish(false), processExitTimeoutMs)
    child.once('exit', onExit)
    if (hasExited(child)) finish(true)
  })
}

async function waitForProcessGroupExit(child) {
  if (process.platform === 'win32') return

  const deadline = Date.now() + processExitTimeoutMs
  while (isProcessGroupRunning(child)) {
    if (Date.now() >= deadline) throw new Error('The recipes function server process group did not exit after SIGKILL.')
    await delay(25)
  }
}

export async function stopFunctionServer(child) {
  if (child.pid === undefined) return

  signalChild(child, 'SIGTERM')
  const exited = await waitForChildExit(child)
  if (!exited || isProcessGroupRunning(child)) signalChild(child, 'SIGKILL')
  if (!await waitForChildExit(child)) throw new Error('The recipes function server did not exit after SIGKILL.')
  await waitForProcessGroupExit(child)
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function withCleanup(task, cleanup) {
  let taskError
  let taskFailed = false
  let cleanupError
  let cleanupFailed = false

  try {
    await task()
  } catch (error) {
    taskError = error
    taskFailed = true
  }

  try {
    await cleanup()
  } catch (error) {
    cleanupError = error
    cleanupFailed = true
  }

  if (taskFailed && cleanupFailed) {
    throw new AggregateError(
      [taskError, cleanupError],
      `E2E run failed: ${describe(taskError)}; cleanup also failed: ${describe(cleanupError)}`,
      { cause: taskError },
    )
  }
  if (taskFailed) throw taskError
  if (cleanupFailed) throw cleanupError
}

export async function withStackCleanup(task, cleanup, exit, emitter) {
  let stackMayHaveStarted = false
  let cleanupPromise
  const cleanupOnce = () => {
    if (!stackMayHaveStarted) return Promise.resolve()
    cleanupPromise ??= Promise.resolve().then(cleanup)
    return cleanupPromise
  }
  const uninstallSignalCleanup = installSignalCleanup(cleanupOnce, exit, emitter)

  try {
    await withCleanup(() => task(() => { stackMayHaveStarted = true }), cleanupOnce)
  } finally {
    uninstallSignalCleanup()
  }
}

export function installSignalCleanup(cleanup, exit = (code) => process.exit(code), emitter = process) {
  let signalReceived = false
  const handlers = new Map()

  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = async () => {
      if (signalReceived) return
      signalReceived = true
      try {
        await cleanup()
      } catch (error) {
        process.stderr.write(`Cleanup failed after ${signal}: ${describe(error)}\n`)
      }
      exit(signal === 'SIGINT' ? 130 : 143)
    }
    handlers.set(signal, handler)
    emitter.on(signal, handler)
  }

  return () => {
    for (const [signal, handler] of handlers) emitter.off(signal, handler)
  }
}
