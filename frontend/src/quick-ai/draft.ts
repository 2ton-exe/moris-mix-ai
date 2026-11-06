import { extractRecipeResponseSchema } from './extractRecipe'
import type { QuickAiEntryHandoff } from './extractRecipe'
import { recipeEditorStateSchema } from '../recipe-form/draft'
import type { RecipeEditorState } from '../recipe-form/draft'

export type QuickAiBlockReason = 'quota' | 'provider-rate-limit' | 'auth-service-rate-limit'

export interface QuickAiEntryDraft {
  notes: string
  blockedUntil: number | null
  blockedReason: QuickAiBlockReason | null
  handoff: QuickAiEntryHandoff | null
  /** Present only for an editable FE-09 draft paired with a validated handoff. */
  reviewDraft?: RecipeEditorState | null
}

const EMPTY_DRAFT: QuickAiEntryDraft = { notes: '', blockedUntil: null, blockedReason: null, handoff: null }
const memoryDrafts = new Map<string, QuickAiEntryDraft>()
const storageKey = (userId: string) => `moris-mix:quick-ai-entry:v1:${encodeURIComponent(userId)}`

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}

function updateUnloadWarning() {
  if (typeof window === 'undefined') return
  window.removeEventListener('beforeunload', warnBeforeUnload)
  if ([...memoryDrafts.values()].some((draft) => draft.notes.length > 0 || draft.handoff !== null || draft.reviewDraft != null)) {
    window.addEventListener('beforeunload', warnBeforeUnload)
  }
}

export type QuickAiDraftReadStatus = 'available' | 'unavailable' | 'read-failed' | 'memory'

export interface QuickAiEntryDraftReadResult {
  draft: QuickAiEntryDraft
  status: QuickAiDraftReadStatus
}

export type QuickAiDraftWriteResult =
  | { persisted: true }
  | { persisted: false; reason: 'unavailable' | 'write-failed' | 'verification-failed' }

function resolveStorage(storage?: Storage): Storage | null {
  try {
    if (storage) return storage
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readQuickAiEntryDraftResult(userId: string, storage?: Storage): QuickAiEntryDraftReadResult {
  const memoryDraft = memoryDrafts.get(userId)
  if (memoryDraft) return { draft: memoryDraft, status: 'memory' }
  const target = resolveStorage(storage)
  if (!target || !userId) return { draft: { ...EMPTY_DRAFT }, status: 'unavailable' }

  let raw: string | null
  try {
    raw = target.getItem(storageKey(userId))
  } catch {
    return { draft: { ...EMPTY_DRAFT }, status: 'read-failed' }
  }
  if (raw === null) return { draft: { ...EMPTY_DRAFT }, status: 'available' }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { draft: { ...EMPTY_DRAFT }, status: 'read-failed' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('notes' in value) || typeof value.notes !== 'string') {
    return { draft: { ...EMPTY_DRAFT }, status: 'read-failed' }
  }

  const blockedUntil = 'blockedUntil' in value && typeof value.blockedUntil === 'number' && Number.isFinite(value.blockedUntil) && value.blockedUntil > Date.now()
    ? value.blockedUntil
    : null
  const blockedReason = blockedUntil !== null && 'blockedReason' in value &&
    (value.blockedReason === 'quota' || value.blockedReason === 'provider-rate-limit' || value.blockedReason === 'auth-service-rate-limit')
    ? value.blockedReason
    : null
  let handoff: QuickAiEntryHandoff | null = null
  let reviewDraft: RecipeEditorState | null | undefined
  if ('handoff' in value && typeof value.handoff === 'object' && value.handoff !== null && !Array.isArray(value.handoff)) {
    const candidate = value.handoff as Record<string, unknown>
    const parsed = extractRecipeResponseSchema.safeParse({ recipe: candidate.recipe })
    if (candidate.saved === false && candidate.sourceNotes === value.notes && parsed.success) {
      handoff = { sourceNotes: value.notes, recipe: parsed.data.recipe, saved: false }
      if ('reviewDraft' in value) {
        const parsedReviewDraft = recipeEditorStateSchema.safeParse(value.reviewDraft)
        reviewDraft = parsedReviewDraft.success ? parsedReviewDraft.data : null
      }
    }
  }

  const draft: QuickAiEntryDraft = { notes: value.notes, blockedUntil: blockedReason ? blockedUntil : null, blockedReason, handoff }
  if (reviewDraft !== undefined) draft.reviewDraft = reviewDraft
  return { draft, status: 'available' }
}

/** Reads a draft without changing the existing consumer-facing return type. */
export function readQuickAiEntryDraft(userId: string, storage?: Storage): QuickAiEntryDraft {
  return readQuickAiEntryDraftResult(userId, storage).draft
}

export function writeQuickAiEntryDraft(userId: string, draft: QuickAiEntryDraft, storage?: Storage): QuickAiDraftWriteResult {
  if (userId) {
    memoryDrafts.set(userId, draft)
    updateUnloadWarning()
  }
  const target = resolveStorage(storage)
  if (!target || !userId) return { persisted: false, reason: 'unavailable' }

  let serialized: string
  try {
    serialized = JSON.stringify(draft)
    target.setItem(storageKey(userId), serialized)
  } catch {
    return { persisted: false, reason: 'write-failed' }
  }

  try {
    if (target.getItem(storageKey(userId)) !== serialized) return { persisted: false, reason: 'verification-failed' }
  } catch {
    return { persisted: false, reason: 'verification-failed' }
  }
  memoryDrafts.delete(userId)
  updateUnloadWarning()
  return { persisted: true }
}
