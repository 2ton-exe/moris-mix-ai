import { useSyncExternalStore } from 'react'
import type { ZodType } from 'zod'

const changed = 'moris-mix:journal-record'
const unavailable = Symbol()

function read(key: string) {
  try { return window.localStorage.getItem(key) }
  catch { return unavailable }
}

export function journalRecordKey(userId: string, slot: string, recipeId?: string) {
  return ['moris-mix', 'journal', 'v1', userId, slot, ...(recipeId === undefined ? [] : [recipeId])]
    .map(encodeURIComponent).join(':')
}

export function writeJournalRecord<T>(key: string, value: T | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch { return false }
  window.dispatchEvent(new CustomEvent(changed, { detail: key }))
  return true
}

function parse<T>(raw: ReturnType<typeof read>, schema: ZodType<T>) {
  if (raw === unavailable || raw === null) return null
  try {
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch { return null }
}

export function readJournalRecord<T>(key: string, schema: ZodType<T>) {
  return parse(read(key), schema)
}

export function useJournalRecord<T>(key: string, schema: ZodType<T>) {
  const raw = useSyncExternalStore((notify) => {
    const onLocalChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === key) notify()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) notify()
    }
    window.addEventListener(changed, onLocalChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(changed, onLocalChange)
      window.removeEventListener('storage', onStorage)
    }
  }, () => read(key), () => null)
  const value = parse(raw, schema)
  return { value, unreadable: raw !== null && value === null, write: (next: T | null) => writeJournalRecord(key, next) }
}
