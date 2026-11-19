import { expect, it } from 'vitest'
import { promptLibrary, promptCaret, selectSuggestions, suggestionContext } from './suggestions'

it('selects five distinct contextual suggestions without repeating the previous set', () => {
  for (const context of ['general', 'pantry', 'notes', 'reading', 'writing', 'collection'] as const) {
    const first = selectSuggestions(context, [], () => .4)
    const next = selectSuggestions(context, first.map(p => p.id), () => .4)
    expect(first).toHaveLength(5)
    expect(new Set(first.map(p => p.id)).size).toBe(5)
    expect(next.some(p => first.some(previous => previous.id === p.id))).toBe(false)
    if (context !== 'general') expect(first.filter(p => p.contexts.includes(context)).length).toBeGreaterThanOrEqual(3)
  }
  expect(promptLibrary).toHaveLength(30)
})
it('resolves routes without loading additional data', () => {
  expect(suggestionContext('/app/recipes/new')).toBe('writing')
  expect(suggestionContext('/app/recipes/123/edit')).toBe('writing')
  expect(suggestionContext('/app/recipes/123')).toBe('reading')
  expect(suggestionContext('/app/chef')).toBe('pantry')
  expect(suggestionContext('/app/quick-entry')).toBe('notes')
  expect(suggestionContext('/unknown')).toBe('general')
})
it('inserts ingredients without losing template preferences', async () => {
  const { parsePantryPrompt } = await import('./chatFlow')
  for (const prompt of promptLibrary.filter(p => p.workflow === 'suggest')) {
    const caret = promptCaret(prompt.message)
    const parsed = parsePantryPrompt(prompt.message.slice(0, caret) + 'rice, eggs' + prompt.message.slice(caret))
    expect(parsed.preferences).toBe(prompt.message.split(';')[1]?.trim() ?? '')
    expect(parsed.pantryItems, prompt.label).toContain('rice')
    expect(parsed.pantryItems, prompt.label).toContain('eggs')
  }
})
