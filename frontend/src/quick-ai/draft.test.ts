import { beforeEach, describe, expect, it } from 'vitest'
import { readQuickAiEntryDraft, readQuickAiEntryDraftResult, writeQuickAiEntryDraft } from './draft'

describe('Quick AI Entry session draft storage', () => {
  beforeEach(() => {
    writeQuickAiEntryDraft('cook-a', { notes: '', blockedUntil: null, blockedReason: null, handoff: null })
    sessionStorage.clear()
  })

  it('preserves exact source notes and cooldown state for the same account', () => {
    const draft = {
      notes: '  rice + eggs\n   soy sauce  ',
      blockedUntil: Date.now() + 30_000,
      blockedReason: 'provider-rate-limit' as const,
      handoff: null,
    }
    writeQuickAiEntryDraft('cook-a', draft)

    expect(readQuickAiEntryDraft('cook-a')).toEqual(draft)
  })

  it('keeps drafts isolated between accounts and drops expired cooldowns', () => {
    writeQuickAiEntryDraft('cook-a', {
      notes: 'Account A private notes',
      blockedUntil: Date.now() - 1000,
      blockedReason: 'quota',
      handoff: null,
    })

    expect(readQuickAiEntryDraft('cook-a')).toEqual({ notes: 'Account A private notes', blockedUntil: null, blockedReason: null, handoff: null })
    expect(readQuickAiEntryDraft('cook-b')).toEqual({ notes: '', blockedUntil: null, blockedReason: null, handoff: null })
  })

  it('persists only a validated unsaved extraction paired with its exact source notes', () => {
    const handoff = {
      sourceNotes: 'rice and eggs, fry with soy sauce',
      recipe: {
        title: 'Egg fried rice',
        ingredients: [{ name: 'rice', quantity: null, unit: null, quantityText: 'some', inferred: true }],
        instructions: [{ step: 1, text: 'Fry the rice.' }],
      },
      saved: false as const,
    }
    writeQuickAiEntryDraft('cook-a', {
      notes: handoff.sourceNotes,
      blockedUntil: null,
      blockedReason: null,
      handoff,
      reviewDraft: {
        title: 'Garlic soy rice',
        ingredients: [{ key: 'row-1', name: 'rice', quantity: '2', unit: 'cups', quantityText: '', inferred: false }],
        instructions: [{ key: 'step-1', text: 'Warm the rice.' }],
        rating: '',
        cookedDate: '',
        notes: '',
      },
    })

    expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)
    expect(readQuickAiEntryDraft('cook-a').reviewDraft?.ingredients[0].quantity).toBe('2')

    sessionStorage.setItem('moris-mix:quick-ai-entry:v1:cook-a', JSON.stringify({
      notes: handoff.sourceNotes,
      handoff: { ...handoff, saved: true },
    }))
    expect(readQuickAiEntryDraft('cook-a').handoff).toBeNull()
    expect(readQuickAiEntryDraft('cook-a').reviewDraft).toBeUndefined()
  })

  it('fails safely when session storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => { throw new Error('storage blocked') },
    } as unknown as Storage

    expect(readQuickAiEntryDraft('cook-a', unavailable).notes).toBe('')
    expect(readQuickAiEntryDraftResult('cook-a', unavailable)).toMatchObject({ status: 'read-failed' })
    expect(writeQuickAiEntryDraft('cook-a', { notes: 'kept in component state', blockedUntil: null, blockedReason: null, handoff: null }, unavailable))
      .toEqual({ persisted: false, reason: 'write-failed' })
  })

  it('distinguishes a genuinely empty draft from an unavailable store or a failed read', () => {
    expect(readQuickAiEntryDraftResult('cook-a')).toMatchObject({ status: 'available', draft: { notes: '' } })

    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    try {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError') } })
      expect(readQuickAiEntryDraftResult('cook-a')).toMatchObject({ status: 'unavailable', draft: { notes: '' } })
      expect(writeQuickAiEntryDraft('cook-a', { notes: 'draft', blockedUntil: null, blockedReason: null, handoff: null }))
        .toEqual({ persisted: false, reason: 'unavailable' })
    } finally {
      if (descriptor) Object.defineProperty(window, 'sessionStorage', descriptor)
    }
  })

  it('reports malformed stored data as a read failure instead of an empty draft', () => {
    sessionStorage.setItem('moris-mix:quick-ai-entry:v1:cook-a', '{not-json')
    expect(readQuickAiEntryDraftResult('cook-a')).toMatchObject({ status: 'read-failed', draft: { notes: '' } })
  })

  it('reports quota failures and verifies that a successful write can be read back', () => {
    const quotaStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    } as unknown as Storage
    const draft = { notes: 'kept in component state', blockedUntil: null, blockedReason: null, handoff: null }

    expect(writeQuickAiEntryDraft('cook-a', draft, quotaStorage)).toEqual({ persisted: false, reason: 'write-failed' })

    const silentStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
    expect(writeQuickAiEntryDraft('cook-a', draft, silentStorage)).toEqual({ persisted: false, reason: 'verification-failed' })

    expect(writeQuickAiEntryDraft('cook-a', draft)).toEqual({ persisted: true })
  })

  it('keeps failed FE-09 review writes account-scoped in memory and warns until storage recovers', () => {
    const failingStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    } as unknown as Storage
    const handoff = {
      sourceNotes: 'rice and eggs',
      recipe: { title: 'Egg rice', ingredients: [], instructions: [] },
      saved: false as const,
    }
    const draft = {
      notes: handoff.sourceNotes, blockedUntil: null, blockedReason: null, handoff,
      reviewDraft: { title: 'Corrected rice', ingredients: [], instructions: [], rating: '', cookedDate: '', notes: '' },
    }

    expect(writeQuickAiEntryDraft('cook-a', draft, failingStorage)).toEqual({ persisted: false, reason: 'write-failed' })
    expect(readQuickAiEntryDraftResult('cook-a')).toMatchObject({ status: 'memory', draft: { reviewDraft: { title: 'Corrected rice' } } })
    expect(readQuickAiEntryDraftResult('cook-b')).toMatchObject({ status: 'available', draft: { notes: '', handoff: null } })

    const volatileUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(volatileUnload)
    expect(volatileUnload.defaultPrevented).toBe(true)

    expect(writeQuickAiEntryDraft('cook-b', { notes: '', blockedUntil: null, blockedReason: null, handoff: null }).persisted).toBe(true)
    const otherAccountUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(otherAccountUnload)
    expect(otherAccountUnload.defaultPrevented).toBe(true)

    expect(writeQuickAiEntryDraft('cook-a', draft)).toEqual({ persisted: true })
    const persistedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(persistedUnload)
    expect(persistedUnload.defaultPrevented).toBe(false)
  })

  it('keeps corrected review drafts account-scoped and drops malformed editor state', () => {
    const handoff = {
      sourceNotes: 'rice and eggs',
      recipe: { title: 'Egg rice', ingredients: [], instructions: [] },
      saved: false as const,
    }
    const reviewDraft = {
      title: 'My corrected rice', ingredients: [], instructions: [], rating: '', cookedDate: '', notes: '',
    }
    writeQuickAiEntryDraft('cook-a', { notes: handoff.sourceNotes, blockedUntil: null, blockedReason: null, handoff, reviewDraft })
    expect(readQuickAiEntryDraft('cook-a').reviewDraft).toEqual(reviewDraft)
    expect(readQuickAiEntryDraft('cook-b').reviewDraft).toBeUndefined()

    sessionStorage.setItem('moris-mix:quick-ai-entry:v1:cook-a', JSON.stringify({
      notes: handoff.sourceNotes, handoff, reviewDraft: { title: 12 },
    }))
    expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)
    expect(readQuickAiEntryDraft('cook-a').reviewDraft).toBeNull()
  })
})
