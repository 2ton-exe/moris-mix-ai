export function retryAfterSeconds(value?: string, now = Date.now()): number | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw)
    return Number.isSafeInteger(seconds) && seconds <= (Number.MAX_SAFE_INTEGER - now) / 1000 ? seconds : undefined
  }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) return undefined
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined
}

export function retryAfterMessage(value?: string) {
  const seconds = retryAfterSeconds(value)
  if (seconds === undefined || seconds === 0) return 'Try again later.'
  if (seconds < 60) return `Wait at least ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before retrying.`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `Wait at least ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} before retrying.`
  const hours = Math.ceil(minutes / 60)
  return `Wait about ${hours} ${hours === 1 ? 'hour' : 'hours'} before retrying.`
}
