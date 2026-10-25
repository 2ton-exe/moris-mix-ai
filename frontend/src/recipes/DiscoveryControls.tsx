import type { RecipeDiscoveryCriteria, RecipeDiscoverySource, RecipeSearchMode, RecipeSort } from './discoveryTypes'

const searchLabels = { title: 'Title', ingredients: 'Ingredients', both: 'Title and ingredients' }

export function DiscoveryControls({ adapter, criteria, onChange, onReset }: {
  adapter?: RecipeDiscoverySource
  criteria: RecipeDiscoveryCriteria
  onChange: (criteria: RecipeDiscoveryCriteria) => void
  onReset: () => void
}) {
  const canSearch = !!adapter?.searchModes.length
  const activeFilters = Object.keys(criteria.filters).length
  const active = !!criteria.search || activeFilters > 0 || criteria.sort !== 'newest'
  return <section className="discovery-controls" aria-label="Find saved recipes">
    <div className="discovery-fields">
      <label className="discovery-search">Search recipes
        <input type="search" value={criteria.search} disabled={!canSearch} aria-describedby={!canSearch ? 'discovery-availability' : undefined}
          placeholder="Find a recipe" onChange={(event) => onChange({ ...criteria, search: event.target.value })} />
      </label>
      <label>Search in
        <select value={criteria.searchMode} disabled={!canSearch} onChange={(event) => onChange({ ...criteria, searchMode: event.target.value as RecipeSearchMode })}>
          {(['title', 'ingredients', 'both'] as const).map((mode) => <option key={mode} value={mode} disabled={!adapter?.searchModes.includes(mode)}>{searchLabels[mode]}</option>)}
        </select>
      </label>
      <label>Sort recipes
        <select value={criteria.sort} disabled={!adapter} onChange={(event) => onChange({ ...criteria, sort: event.target.value as RecipeSort })}>
          <option value="newest" disabled={!adapter?.sorts.includes('newest')}>Newest first</option>
          <option value="rating" disabled={!adapter?.sorts.includes('rating')}>{adapter?.sorts.includes('rating') ? 'Rating' : 'Rating (unavailable)'}</option>
        </select>
      </label>
      {adapter?.filters.length ? adapter.filters.map((filter) => <label key={filter.id}>{filter.label}
        <select value={criteria.filters[filter.id] ?? ''} onChange={(event) => {
          const filters = { ...criteria.filters }
          if (event.target.value) filters[filter.id] = event.target.value
          else delete filters[filter.id]
          onChange({ ...criteria, filters })
        }}>
          <option value="">All</option>
          {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>) : <label>Filters<select disabled aria-describedby="discovery-availability"><option>No filters available</option></select></label>}
    </div>
    {(!canSearch || !adapter?.sorts.includes('rating') || !adapter.filters.length) &&
      <p id="discovery-availability" className="discovery-availability">{!canSearch && 'Title and ingredient search are unavailable. '}{!adapter?.sorts.includes('rating') && 'Rating sort is unavailable. '}{!adapter?.filters.length && 'No recipe filters are connected. '}{adapter && 'You can browse newest recipes and load more.'}</p>}
    {active && <div className="discovery-active">
      <p>{criteria.search && <>Search: <strong>{criteria.search}</strong>. </>}{activeFilters > 0 && <>{activeFilters} active {activeFilters === 1 ? 'filter' : 'filters'}. </>}{criteria.sort === 'rating' && 'Sorted by rating.'}</p>
      <button className="button button-secondary" type="button" onClick={onReset}>Reset search and filters</button>
    </div>}
  </section>
}
