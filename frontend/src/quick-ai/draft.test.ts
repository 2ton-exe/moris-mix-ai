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
    })

    expect(readQuickAiEntryDraft('cook-a').handoff).toEqual(handoff)

    sessionStorage.setItem('moris-mix:quick-ai-entry:v1:cook-a', JSON.stringify({
      notes: handoff.sourceNotes,
      handoff: { ...handoff, saved: true },
    }))
    expect(readQuickAiEntryDraft('cook-a').handoff).toBeNull()
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
})
