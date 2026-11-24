import type { RecipeDiscoveryCriteria, RecipeDiscoverySource, RecipeSearchMode, RecipeSort } from './discoveryTypes'

const searchLabels = { title: 'Title', ingredients: 'Ingredients', both: 'Title and ingredients' }

function discoveryGuidance(adapter?: RecipeDiscoverySource) {
  if (!adapter) return ''
  const modes = adapter.searchModes
  const searchesByTitle = modes.includes('title')
  const searchesByIngredient = modes.includes('ingredients')
  const searchesByBoth = modes.includes('both')
  const search = searchesByTitle && searchesByIngredient ? 'Search titles or ingredients'
    : searchesByBoth ? 'Search titles and ingredients together'
      : searchesByTitle ? 'Search titles'
        : searchesByIngredient ? 'Search ingredients' : ''
  if (search && adapter.sorts.length) return `${search}, then choose how to sort.`
  if (search) return `${search}.`
  return adapter.sorts.length ? 'Choose how to sort.' : ''
}

export function DiscoveryControls({ adapter, criteria, onChange, onReset }: {
  adapter?: RecipeDiscoverySource
  criteria: RecipeDiscoveryCriteria
  onChange: (criteria: RecipeDiscoveryCriteria) => void
  onReset: () => void
}) {
  const canSearch = !!adapter?.searchModes.length
  const activeFilters = Object.keys(criteria.filters).length
  const active = !!criteria.search || activeFilters > 0 || criteria.sort !== 'newest'
  const guidance = discoveryGuidance(adapter)
  return <div role="search" className="discovery-controls" aria-label="Find saved recipes">
    <div className="discovery-fields">
      <label className="discovery-search">Search recipes
        <input type="search" value={criteria.search} disabled={!canSearch}
          aria-describedby={canSearch && guidance ? 'discovery-guidance' : 'discovery-availability'}
          placeholder="Find a recipe" onChange={(event) => onChange({ ...criteria, search: event.target.value })} />
      </label>
      <label>Search in
        <select name="search-mode" value={criteria.searchMode} disabled={!canSearch} onChange={(event) => onChange({ ...criteria, searchMode: event.target.value as RecipeSearchMode })}>
          {(['title', 'ingredients', 'both'] as const).map((mode) => <option key={mode} value={mode} disabled={!adapter?.searchModes.includes(mode)}>{searchLabels[mode]}</option>)}
        </select>
      </label>
      <label>Sort recipes
        <select name="recipe-sort" value={criteria.sort} disabled={!adapter} aria-describedby={guidance ? 'discovery-guidance' : undefined} onChange={(event) => onChange({ ...criteria, sort: event.target.value as RecipeSort })}>
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
    {active && <div className="discovery-active">
      <p>{criteria.search && <>Search: <strong>{criteria.search}</strong>. </>}{activeFilters > 0 && <>{activeFilters} active {activeFilters === 1 ? 'filter' : 'filters'}. </>}{criteria.sort === 'rating' && 'Sorted by highest rating.'}</p>
      <button className="button button-secondary" type="button" onClick={onReset}>Reset search and filters</button>
    </div>}
  </div>
}
