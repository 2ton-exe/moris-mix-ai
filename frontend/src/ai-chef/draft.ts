import { z } from 'zod'
import { recipeEditorStateSchema } from '../recipe-form/draft'
import type { RecipeEditorState } from '../recipe-form/draft'
import { generateRecipeRequestSchema, generateRecipeResponseSchema } from './generateRecipe'
import type { GenerateRecipeRequest, GenerateRecipeResponse } from './generateRecipe'

const pantryInputSchema = z.object({
  pantryItems: z.array(z.string()),
  pantryInput: z.string(),
  preferences: z.string(),
})

const lineageStatusSchema = z.enum(['pending', 'expired', 'blocked', 'confirmed'])

const reviewHandoffSchema = z.object({
  request: generateRecipeRequestSchema,
  response: generateRecipeResponseSchema,
  reviewDraft: recipeEditorStateSchema.nullable().optional(),
  selectedParentIds: z.array(z.string().uuid()).max(10).default([]),
  savedRecipeId: z.string().uuid().optional(),
  lineageStatus: lineageStatusSchema.optional(),
  saved: z.literal(false),
}).transform((value) => {
  const candidates = new Set(value.response.parents.map((parent) => parent.id.toLowerCase()))
  const seen = new Set<string>()
  const selectedParentIds = value.selectedParentIds.filter((id) => {
    const normalized = id.toLowerCase()
    if (!candidates.has(normalized) || seen.has(normalized) || seen.size >= 10) return false
    seen.add(normalized)
    return true
  })
  return {
    ...value,
    selectedParentIds,
    ...(value.savedRecipeId
      ? { lineageStatus: value.lineageStatus ?? (selectedParentIds.length > 0 ? 'pending' : 'confirmed') }
      : { lineageStatus: undefined }),
  }
})

const chefDraftSchema = z.object({
  input: pantryInputSchema,
  handoff: reviewHandoffSchema.nullable(),
})

export interface ChefPantryInput {
  pantryItems: string[]
  pantryInput: string
  preferences: string
}

export interface ChefReviewHandoff {
  request: GenerateRecipeRequest
  response: GenerateRecipeResponse
  reviewDraft?: RecipeEditorState | null
  selectedParentIds: string[]
  savedRecipeId?: string
  lineageStatus?: z.infer<typeof lineageStatusSchema>
  saved: false
}

export interface ChefDraft {
  input: ChefPantryInput
  handoff: ChefReviewHandoff | null
}

export const emptyChefDraft = (): ChefDraft => ({
  input: { pantryItems: [], pantryInput: '', preferences: '' },
  handoff: null,
})

const memoryDrafts = new Map<string, ChefDraft>()
const storageKey = (userId: string) => `moris-mix:ai-chef:v1:${encodeURIComponent(userId)}`

function hasContent(draft: ChefDraft) {
  return draft.input.pantryItems.length > 0 || draft.input.pantryInput.length > 0 ||
    draft.input.preferences.length > 0 || draft.handoff !== null
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}

function updateUnloadWarning() {
  if (typeof window === 'undefined') return
  window.removeEventListener('beforeunload', warnBeforeUnload)
  if ([...memoryDrafts.values()].some(hasContent)) window.addEventListener('beforeunload', warnBeforeUnload)
}

export type ChefDraftReadStatus = 'available' | 'unavailable' | 'read-failed' | 'memory'
export interface ChefDraftReadResult { draft: ChefDraft; status: ChefDraftReadStatus }
export type ChefDraftWriteResult =
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

export function readChefDraftResult(userId: string, storage?: Storage): ChefDraftReadResult {
  const memoryDraft = memoryDrafts.get(userId)
  if (memoryDraft) {
    const parsed = chefDraftSchema.safeParse(memoryDraft)
    return parsed.success
      ? { draft: parsed.data, status: 'memory' }
      : { draft: emptyChefDraft(), status: 'read-failed' }
  }
  const target = resolveStorage(storage)
  if (!target || !userId) return { draft: emptyChefDraft(), status: 'unavailable' }

  let raw: string | null
  try {
    raw = target.getItem(storageKey(userId))
  } catch {
    return { draft: emptyChefDraft(), status: 'read-failed' }
  }
  if (raw === null) return { draft: emptyChefDraft(), status: 'available' }

  try {
    const parsed = chefDraftSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return { draft: emptyChefDraft(), status: 'read-failed' }
    return { draft: parsed.data, status: 'available' }
  } catch {
    return { draft: emptyChefDraft(), status: 'read-failed' }
  }
}

export function writeChefDraft(userId: string, draft: ChefDraft, storage?: Storage): ChefDraftWriteResult {
  const parsed = chefDraftSchema.safeParse(draft)
  if (!parsed.success) return { persisted: false, reason: 'write-failed' }
  const safeDraft = parsed.data
  if (userId) {
    memoryDrafts.set(userId, safeDraft)
    updateUnloadWarning()
  }
  const target = resolveStorage(storage)
  if (!target || !userId) return { persisted: false, reason: 'unavailable' }

  let serialized: string
  try {
    serialized = JSON.stringify(safeDraft)
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
