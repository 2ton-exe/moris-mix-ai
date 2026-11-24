import type { Ref } from 'react'
import type { RecipeDiscoveryCriteria, RecipeDiscoverySource, RecipeSearchMode, RecipeSort } from './discoveryTypes'

const searchLabels = { title: 'Title', ingredients: 'Ingredients', both: 'Title and ingredients' }

function discoveryGuidance(adapter?: RecipeDiscoverySource) {
  if (!adapter) return ''
  const modes = adapter.searchModes
  const searchesByTitle = modes.includes('title')
  const searchesByIngredient = modes.includes('ingredients')
  const searchesByBoth = modes.includes('both')
  if (searchesByTitle && searchesByIngredient && searchesByBoth) return 'Search recipe titles, ingredient names, or both.'
  if (searchesByTitle && searchesByIngredient) return 'Search recipe titles or ingredient names.'
  if (searchesByBoth) return 'Search recipe titles and ingredients together.'
  if (searchesByTitle) return 'Search recipe titles.'
  if (searchesByIngredient) return 'Search ingredient names.'
  return ''
}

export function DiscoveryControls({ adapter, criteria, onChange, onReset, searchInputRef, hideReset = false }: {
  adapter?: RecipeDiscoverySource
  criteria: RecipeDiscoveryCriteria
  onChange: (criteria: RecipeDiscoveryCriteria) => void
  onReset: () => void
  searchInputRef?: Ref<HTMLInputElement>
  hideReset?: boolean
}) {
  const canSearch = !!adapter?.searchModes.length
  const activeFilters = Object.keys(criteria.filters).length
  const active = !!criteria.search || activeFilters > 0 || criteria.sort !== 'newest'
  const guidance = discoveryGuidance(adapter)
  return <div role="search" className="discovery-controls" aria-label="Find saved recipes">
    <div className="discovery-fields">
      <label className="discovery-search">Search recipes
        <input ref={searchInputRef} type="search" value={criteria.search} disabled={!canSearch}
          aria-describedby={canSearch && guidance ? 'discovery-guidance' : 'discovery-availability'}
          placeholder="Find a recipe" onChange={(event) => onChange({ ...criteria, search: event.target.value })} />
      </label>
      <label>Search in
        <select name="search-mode" value={criteria.searchMode} disabled={!canSearch} onChange={(event) => onChange({ ...criteria, searchMode: event.target.value as RecipeSearchMode })}>
          {(['title', 'ingredients', 'both'] as const).map((mode) => <option key={mode} value={mode} disabled={!adapter?.searchModes.includes(mode)}>{searchLabels[mode]}</option>)}
        </select>
      </label>
      <label>Sort recipes
        <select name="recipe-sort" value={criteria.sort} disabled={!adapter} onChange={(event) => onChange({ ...criteria, sort: event.target.value as RecipeSort })}>
          <option value="newest" disabled={!adapter?.sorts.includes('newest')}>Newest first</option>
          <option value="rating" disabled={!adapter?.sorts.includes('rating')}>{adapter?.sorts.includes('rating') ? 'Highest rated' : 'Highest rated (unavailable)'}</option>
        </select>
      </label>
      {adapter?.filters.map((filter) => <label key={filter.id}>{filter.label}
        <select name={filter.id} value={criteria.filters[filter.id] ?? ''} onChange={(event) => {
          const filters = { ...criteria.filters }
          if (event.target.value) filters[filter.id] = event.target.value
          else delete filters[filter.id]
          onChange({ ...criteria, filters })
        }}>
          <option value="">All</option>
          {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>)}
    </div>
    {guidance && <p id="discovery-guidance" className="discovery-guidance">{guidance}</p>}
    {!canSearch && <p id="discovery-availability" className="discovery-availability">Recipe search is unavailable.</p>}
    {active && !hideReset && <div className="discovery-active">
      {(criteria.search || activeFilters > 0) && <p>{criteria.search && <>Search: <strong>{criteria.search}</strong>. </>}{activeFilters > 0 && <>{activeFilters} active {activeFilters === 1 ? 'filter' : 'filters'}.</>}</p>}
      <button className="button button-secondary" type="button" onClick={onReset}>Reset search, sort, and filters</button>
    </div>}
  </div>
}
