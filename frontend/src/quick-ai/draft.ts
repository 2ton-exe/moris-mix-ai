import { extractRecipeResponseSchema } from './extractRecipe'
import type { QuickAiEntryHandoff } from './extractRecipe'

export type QuickAiBlockReason = 'quota' | 'provider-rate-limit' | 'auth-service-rate-limit'

export interface QuickAiEntryDraft {
  notes: string
  blockedUntil: number | null
  blockedReason: QuickAiBlockReason | null
  handoff: QuickAiEntryHandoff | null
}

const EMPTY_DRAFT: QuickAiEntryDraft = { notes: '', blockedUntil: null, blockedReason: null, handoff: null }
const storageKey = (userId: string) => `moris-mix:quick-ai-entry:v1:${encodeURIComponent(userId)}`

function resolveStorage(storage?: Storage): Storage | null {
  try {
    if (storage) return storage
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readQuickAiEntryDraft(userId: string, storage?: Storage): QuickAiEntryDraft {
  const target = resolveStorage(storage)
  if (!target || !userId) return { ...EMPTY_DRAFT }
  try {
    const value: unknown = JSON.parse(target.getItem(storageKey(userId)) ?? 'null')
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !('notes' in value) || typeof value.notes !== 'string') {
      return { ...EMPTY_DRAFT }
    }
    const blockedUntil = 'blockedUntil' in value && typeof value.blockedUntil === 'number' && Number.isFinite(value.blockedUntil) && value.blockedUntil > Date.now()
      ? value.blockedUntil
      : null
    const blockedReason = blockedUntil !== null && 'blockedReason' in value &&
      (value.blockedReason === 'quota' || value.blockedReason === 'provider-rate-limit' || value.blockedReason === 'auth-service-rate-limit')
      ? value.blockedReason
      : null
    let handoff: QuickAiEntryHandoff | null = null
    if ('handoff' in value && typeof value.handoff === 'object' && value.handoff !== null && !Array.isArray(value.handoff)) {
      const candidate = value.handoff as Record<string, unknown>
      const parsed = extractRecipeResponseSchema.safeParse({ recipe: candidate.recipe })
      if (candidate.saved === false && candidate.sourceNotes === value.notes && parsed.success) {
        handoff = { sourceNotes: value.notes, recipe: parsed.data.recipe, saved: false }
      }
    }
    return { notes: value.notes, blockedUntil: blockedReason ? blockedUntil : null, blockedReason, handoff }
  } catch {
    return { ...EMPTY_DRAFT }
  }
}

export function writeQuickAiEntryDraft(userId: string, draft: QuickAiEntryDraft, storage?: Storage) {
  const target = resolveStorage(storage)
  if (!target || !userId) return
  try {
    target.setItem(storageKey(userId), JSON.stringify(draft))
  } catch {
    // Keep the in-memory draft usable when session storage is unavailable/full.
  }
}
