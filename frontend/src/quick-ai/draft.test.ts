import { beforeEach, describe, expect, it } from 'vitest'
import { readQuickAiEntryDraft, writeQuickAiEntryDraft } from './draft'

describe('Quick AI Entry session draft storage', () => {
  beforeEach(() => sessionStorage.clear())

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
    expect(() => writeQuickAiEntryDraft('cook-a', { notes: 'kept in component state', blockedUntil: null, blockedReason: null, handoff: null }, unavailable)).not.toThrow()
  })
})
