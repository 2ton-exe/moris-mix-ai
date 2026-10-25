import type { RecipeRequest, RecipeSummary } from './types'

// Frontend adapter values only. A REST adapter must map these to a confirmed
// backend contract before advertising a capability; these are not URL params.
export type RecipeSearchMode = 'title' | 'ingredients' | 'both'
export type RecipeSort = 'newest' | 'rating'
export type RecipeContinuation = string | number

export interface RecipeDiscoveryCriteria {
  search: string
  searchMode: RecipeSearchMode
  sort: RecipeSort
  filters: Record<string, string>
}

export interface RecipeDiscoveryFilter {
  id: string
  label: string
  options: readonly { value: string; label: string }[]
}

export interface RecipeDiscoveryPage {
  recipes: RecipeSummary[]
  // Adapter-owned continuation, never constructed by the view or query hook.
  nextPage: RecipeContinuation | null
}

export interface RecipeDiscoverySource {
  searchModes: readonly RecipeSearchMode[]
  sorts: readonly RecipeSort[]
  filters: readonly RecipeDiscoveryFilter[]
  page: (request: RecipeRequest & {
    criteria: RecipeDiscoveryCriteria
    continuation: RecipeContinuation | null
  }) => Promise<RecipeDiscoveryPage>
}

export const initialDiscoveryCriteria: RecipeDiscoveryCriteria = {
  search: '', searchMode: 'title', sort: 'newest', filters: {},
}

export function supportsDiscovery(source: Pick<RecipeDiscoverySource, 'searchModes' | 'sorts' | 'filters'>, criteria: RecipeDiscoveryCriteria) {
  return (!criteria.search || source.searchModes.includes(criteria.searchMode)) &&
    source.sorts.includes(criteria.sort) && Object.entries(criteria.filters).every(([id, value]) =>
      source.filters.some((filter) => filter.id === id && filter.options.some((option) => option.value === value)))
}
