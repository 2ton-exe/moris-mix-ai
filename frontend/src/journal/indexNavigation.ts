import type { RecipeDiscoveryCriteria, RecipeDiscoverySource } from '../recipes/discoveryTypes'

export const journalEntriesPerPage = 2

export function journalReturnTo(state: unknown, fallback = '/app/recipes') {
  if (typeof state === 'object' && state !== null && 'journalReturn' in state &&
    typeof state.journalReturn === 'string' && /^\/app(?:\/recipes)?(?:\?|$)/.test(state.journalReturn)) return state.journalReturn
  return fallback
}

// Presentation parameters only; BE-08 continuations remain owned by its adapter.
export function readJournalCriteria(params: URLSearchParams, source?: Pick<RecipeDiscoverySource, 'searchModes' | 'sorts' | 'filters'>): RecipeDiscoveryCriteria {
  const scope = source?.searchModes.find((value) => value === params.get('scope')) ?? source?.searchModes[0] ?? 'title'
  const sort = source?.sorts.find((value) => value === params.get('sort')) ?? 'newest'
  const filters = Object.fromEntries((source?.filters ?? []).flatMap((filter) => {
    const value = params.get(`filter.${filter.id}`)
    return filter.options.some((option) => option.value === value) ? [[filter.id, value!]] : []
  }))
  return { search: params.get('q') ?? '', searchMode: scope, sort, filters }
}

export function writeJournalCriteria(criteria: RecipeDiscoveryCriteria): URLSearchParams {
  const params = new URLSearchParams()
  if (criteria.search) params.set('q', criteria.search)
  if (criteria.searchMode !== 'title') params.set('scope', criteria.searchMode)
  if (criteria.sort !== 'newest') params.set('sort', criteria.sort)
  for (const [key, value] of Object.entries(criteria.filters)) params.set(`filter.${key}`, value)
  return params
}

export function journalPage(params: URLSearchParams, count: number, { hasMore = false, perPage = journalEntriesPerPage } = {}) {
  const requested = Number(params.get('leaf') ?? 1)
  const last = Math.max(1, Math.ceil(count / perPage))
  return Number.isSafeInteger(requested) && requested > 0 ? hasMore ? requested : Math.min(requested, last) : 1
}
