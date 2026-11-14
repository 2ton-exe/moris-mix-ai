export const MAX_PANTRY_ITEMS = 100
export const MAX_PANTRY_ITEM_CHARS = 100
export const MAX_PREFERENCES_CHARS = 1000

export type PantryEntryError = 'empty' | 'too-long' | 'too-many'

export interface PantryEntryResult {
  items: string[]
  added: number
  duplicates: number
  error: PantryEntryError | null
}

/** Add trimmed, case-insensitive unique values while matching the backend limits. */
export function addPantryItems(current: readonly string[], entries: readonly string[]): PantryEntryResult {
  if (entries.length === 0 || entries.every((entry) => !entry.trim())) {
    return { items: [...current], added: 0, duplicates: 0, error: 'empty' }
  }

  const normalized = entries.map((entry) => entry.trim()).filter(Boolean)
  if (normalized.some((entry) => entry.length > MAX_PANTRY_ITEM_CHARS)) {
    return { items: [...current], added: 0, duplicates: 0, error: 'too-long' }
  }
  if (current.length > MAX_PANTRY_ITEMS) {
    return { items: [...current], added: 0, duplicates: 0, error: 'too-many' }
  }

  const seen = new Set(current.map((item) => item.trim().toLowerCase()))
  const next = [...current]
  let added = 0
  let duplicates = 0
  for (const entry of normalized) {
    const key = entry.toLowerCase()
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    next.push(entry)
    added++
  }

  if (next.length > MAX_PANTRY_ITEMS) return { items: [...current], added: 0, duplicates: 0, error: 'too-many' }
  return { items: next, added, duplicates, error: null }
}

/** Pasted shopping-list text can be split into pantry tokens. Typed text stays intact. */
export function splitPastedPantryText(value: string) {
  return /[,\r\n]/.test(value) ? value.split(/[,\r\n]+/).map((item) => item.trim()).filter(Boolean) : [value]
}

export function pantryEntryErrorMessage(error: PantryEntryError | null) {
  if (error === 'empty') return 'Enter a pantry ingredient before adding it.'
  if (error === 'too-long') return `Each pantry item must be ${MAX_PANTRY_ITEM_CHARS} characters or fewer.`
  if (error === 'too-many') return `You can add up to ${MAX_PANTRY_ITEMS} pantry items.`
  return undefined
}
