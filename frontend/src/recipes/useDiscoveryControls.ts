import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/context'
import { recipeKeys } from './queryOptions'
import { initialDiscoveryCriteria } from './discoveryTypes'
import type { RecipeDiscoveryCriteria, RecipeDiscoverySource } from './discoveryTypes'

export function useDiscoveryControls(adapter?: RecipeDiscoverySource, persistence?: {
  draft: RecipeDiscoveryCriteria; onChange: (criteria: RecipeDiscoveryCriteria) => void
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  const defaults = { ...initialDiscoveryCriteria, searchMode: adapter?.searchModes[0] ?? 'title' }
  const [localDraft, setDraft] = useState<RecipeDiscoveryCriteria>(defaults)
  const draft = persistence?.draft ?? localDraft
  const [search, setSearch] = useState(() => draft.search.trim())
  const normalized = draft.search.trim()
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(normalized), 300)
    return () => window.clearTimeout(timer)
  }, [normalized])
  const change = (criteria: RecipeDiscoveryCriteria) => {
    // Returning to a previous search starts at its first page, too.
    client.removeQueries({ queryKey: recipeKeys.lists(user?.id ?? null), type: 'inactive', predicate: (query) => query.queryKey[3] === 'discovery' })
    if (persistence) persistence.onChange(criteria)
    else setDraft(criteria)
  }
  const reset = () => { change(defaults); setSearch('') }
  return { draft, criteria: { ...draft, search }, waiting: normalized !== search, change, reset }
}
