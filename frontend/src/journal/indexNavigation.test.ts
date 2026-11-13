import { expect, it } from 'vitest'
import { journalPage, journalReturnTo, readJournalCriteria, writeJournalCriteria } from './indexNavigation'
import type { RecipeDiscoverySource } from '../recipes/discoveryTypes'

const source: Pick<RecipeDiscoverySource, 'searchModes' | 'sorts' | 'filters'> = { searchModes: ['title', 'ingredients', 'both'], sorts: ['newest', 'rating'], filters: [
  { id: 'season', label: 'Season', options: [{ value: 'summer', label: 'Summer' }] },
] }

it('restores supported criteria without constructing a backend continuation', () => {
  const criteria = { search: 'rice & beans', searchMode: 'both', sort: 'rating', filters: { season: 'summer' } } as const
  const params = writeJournalCriteria(criteria)
  expect(readJournalCriteria(params, source)).toEqual(criteria)
  expect(params.has('cursor')).toBe(false)
  expect(readJournalCriteria(new URLSearchParams('scope=invalid&sort=invalid&filter.season=invalid'), source))
    .toEqual({ search: '', searchMode: 'title', sort: 'newest', filters: {} })
})

it.each(['-1', '0', 'NaN', '1.5', 'Infinity'])('uses the first page for invalid page %s', (leaf) => {
  expect(journalPage(new URLSearchParams({ leaf }), 25)).toBe(1)
})

it('clamps leaves after deletion or a shorter result set without hiding the remaining entry', () => {
  expect(journalPage(new URLSearchParams('leaf=13'), 25)).toBe(13)
  expect(journalPage(new URLSearchParams('leaf=13'), 24)).toBe(12)
  expect(journalPage(new URLSearchParams('leaf=13'), 0)).toBe(1)
})

it('keeps the journal return local and retains its search, sort and leaf', () => {
  const journalReturn = '/app/recipes?q=rice&sort=rating&leaf=2'
  expect(journalReturnTo({ journalReturn })).toBe(journalReturn)
  for (const target of ['https://other.test', '//other.test', '/app/recipes/new', '/app/recipes-elsewhere']) {
    expect(journalReturnTo({ journalReturn: target })).toBe('/app/recipes')
  }
})

it('keeps a requested unloaded page while the server has more results', () => {
  const requested = new URLSearchParams('leaf=4')
  expect(journalPage(requested, 2, { hasMore: true })).toBe(4)
  expect(journalPage(requested, 2, { hasMore: false })).toBe(1)
  expect(journalPage(requested, 4, { perPage: 1 })).toBe(4)
})
