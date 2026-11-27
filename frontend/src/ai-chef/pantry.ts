import { normalizePantryIngredient, uniquePantryIngredients } from '../../../supabase/functions/_shared/ingredient-identity.ts'

export const MAX_PANTRY_ITEMS = 100
export const MAX_PANTRY_ITEM_CHARS = 100
export const MAX_PREFERENCES_CHARS = 1000

export type PantryEntryError = 'empty' | 'too-long' | 'too-many'

export interface PantryEntryResult {
  items: string[]
  added: number
  duplicates: number
  duplicateIdentities: string[]
  error: PantryEntryError | null
}

/** Add unique pantry identities while retaining the first label and backend limits. */
export function addPantryItems(current: readonly string[], entries: readonly string[]): PantryEntryResult {
  const unchanged = { items: [...current], added: 0, duplicates: 0, duplicateIdentities: [] }
  if (entries.length === 0 || entries.every((entry) => !entry.trim())) {
    return { ...unchanged, error: 'empty' }
  }

  const normalized = entries.map(normalizePantryIngredient).filter(({ label }) => label)
  if (normalized.some(({ label }) => label.length > MAX_PANTRY_ITEM_CHARS)) {
    return { ...unchanged, error: 'too-long' }
  }
  if (current.length > MAX_PANTRY_ITEMS) {
    return { ...unchanged, error: 'too-many' }
  }

  const next = uniquePantryIngredients(current)
  const seen = new Set(next.map((item) => normalizePantryIngredient(item).identity))
  const duplicateIdentities = new Set<string>()
  let added = 0
  let duplicates = 0
  for (const { identity: key, label } of normalized) {
    if (seen.has(key)) {
      duplicates++
      duplicateIdentities.add(key)
      continue
    }
    seen.add(key)
    next.push(label)
    added++
  }

  if (next.length > MAX_PANTRY_ITEMS) return { ...unchanged, error: 'too-many' }
  return { items: next, added, duplicates, duplicateIdentities: [...duplicateIdentities], error: null }
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
