import { describe, expect, it } from 'vitest'
import { emptyChefDraft, readChefDraftResult, writeChefDraft } from './draft'
import type { ChefReviewHandoff } from './draft'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const handoff: ChefReviewHandoff = {
  request: { pantryItems: ['rice'], preferences: 'quick' },
  response: {
    recipe: {
      title: 'Rice bowl',
      ingredients: [{ name: 'rice', quantity: null, unit: null, quantityText: 'some', inferred: true }],
      instructions: [{ step: 1, text: 'Warm the rice.' }],
    },
    substitutions: [],
    parents: [],
    candidate_token: null,
    context: { status: 'NO_SAVED_RECIPES', matchedCandidateCount: 0, totalCandidateCount: 0 },
  },
  selectedParentIds: [],
  saved: false as const,
}

describe('account-scoped AI Chef session drafts', () => {
  it('round-trips pantry input and a validated unsaved generation handoff', () => {
    const storage = new MemoryStorage()
    const draft = { input: { pantryItems: ['rice'], pantryInput: '', preferences: 'quick' }, handoff }

    expect(writeChefDraft('chef-roundtrip', draft, storage)).toEqual({ persisted: true })
    expect(readChefDraftResult('chef-roundtrip', storage)).toEqual({ draft, status: 'available' })
  })

  it('uses distinct per-account keys and does not expose one cook’s pantry to another', () => {
    const storage = new MemoryStorage()
    writeChefDraft('chef-account-a', { input: { pantryItems: ['rice'], pantryInput: '', preferences: '' }, handoff: null }, storage)

    expect(readChefDraftResult('chef-account-b', storage).draft).toEqual(emptyChefDraft())
    expect([...Array(storage.length)].map((_, index) => storage.key(index))).toContain('moris-mix:ai-chef:v1:chef-account-a')
  })

  it('keeps the current account draft in memory when storage is unavailable', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    } as unknown as Storage
    const draft = { input: { pantryItems: ['beans'], pantryInput: '', preferences: 'spicy' }, handoff }

    expect(writeChefDraft('chef-memory-only', draft, storage)).toEqual({ persisted: false, reason: 'write-failed' })
    expect(readChefDraftResult('chef-memory-only', new MemoryStorage())).toEqual({ draft, status: 'memory' })
  })

  it('rejects malformed saved data rather than using an unchecked recipe response', () => {
    const storage = new MemoryStorage()
    storage.setItem('moris-mix:ai-chef:v1:chef-corrupt', JSON.stringify({
      input: { pantryItems: [], pantryInput: '', preferences: '' },
      handoff: { ...handoff, response: { recipe: { title: 3 } } },
    }))
    expect(readChefDraftResult('chef-corrupt', storage)).toMatchObject({ status: 'read-failed' })
  })

  it('restores only distinct selected IDs from the generated candidate set and keeps saved recovery state', () => {
    const storage = new MemoryStorage()
    const candidate = { id: '123e4567-e89b-42d3-a456-426614174000', title: 'Garden rice', star_rating: 4 }
    const foreign = '223e4567-e89b-42d3-a456-426614174000'
    const savedId = '323e4567-e89b-42d3-a456-426614174000'
    storage.setItem('moris-mix:ai-chef:v1:chef-recovery', JSON.stringify({
      input: { pantryItems: [], pantryInput: '', preferences: '' },
      handoff: {
        ...handoff,
        response: { ...handoff.response, parents: [candidate], candidate_token: 'opaque-token' },
        selectedParentIds: [candidate.id, candidate.id, foreign],
        savedRecipeId: savedId,
        lineageStatus: 'pending',
      },
    }))

    const restored = readChefDraftResult('chef-recovery', storage)
    expect(restored.status).toBe('available')
    expect(restored.draft.handoff?.selectedParentIds).toEqual([candidate.id])
    expect(restored.draft.handoff?.savedRecipeId).toBe(savedId)
    expect(restored.draft.handoff?.lineageStatus).toBe('pending')
    expect(restored.draft.handoff?.response.candidate_token).toBe('opaque-token')
  })
})
