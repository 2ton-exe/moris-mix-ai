import { useContext, useEffect, useRef, useState } from 'react'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { useDiscoveryControls } from './useDiscoveryControls'
import { useRecipeDiscovery } from './useRecipeDiscovery'
import { RecipeSourceContext } from './source'
import { useRecipe } from './queries'
import { isRecipeAccessError } from './errors'
import type { RecipeDetail, RecipeSummary } from './types'
import { formatCookedDate } from './recipePresentation'

const flavors = [
  { key: 'sweet', label: 'Sweet' }, { key: 'salty', label: 'Salty' },
  { key: 'sour', label: 'Sour' }, { key: 'bitter', label: 'Bitter' },
  { key: 'umami', label: 'Umami' }, { key: 'spicy', label: 'Spicy' },
] as const

export function RecipeComparison({ onClose }: { onClose: () => void }) {
  const source = useContext(RecipeSourceContext)
  const controls = useDiscoveryControls(source.discovery)
  const discovery = useRecipeDiscovery(controls.criteria, controls.waiting)
  const [first, setFirst] = useState<RecipeSummary | null>(null)
  const [second, setSecond] = useState<RecipeSummary | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const firstDetail = useRecipe(first?.id ?? '')
  const secondDetail = useRecipe(second?.id ?? '')
  const a = !isRecipeAccessError(firstDetail.error) ? firstDetail.data : undefined
  const b = !isRecipeAccessError(secondDetail.error) ? secondDetail.data : undefined
  const choices = controls.waiting || isRecipeAccessError(discovery.error) ? [] : discovery.recipes ?? []

  useEffect(() => { title.current?.focus() }, [])

  function pick(id: string, selected: RecipeSummary | null, other: RecipeSummary | null) {
    if (!id || id === other?.id) return null
    return choices.find((recipe) => recipe.id === id) ?? (selected?.id === id ? selected : null)
  }

  return <>
    <JournalFacingPage className="mm-page-column mm-facing-content--comparison">
      <h1 ref={title} tabIndex={-1}>Compare two recipes</h1>
      <div className="mm-page-body mm-recipe-comparison" role="region" aria-label="First recipe and search" tabIndex={0}>
        <button type="button" className="button button-secondary mm-button--small" onClick={onClose}>Back to My Recipes</button>
        {source.discovery?.searchModes.includes('title') && <label className="mm-journal-tool__field">Search saved recipes by title
          <input type="search" maxLength={200} value={controls.draft.search}
            onChange={(event) => controls.change({ ...controls.draft, search: event.currentTarget.value, searchMode: 'title' })} />
        </label>}
        {discovery.isError ? <div>
          <p role="status">Could not load recipe choices.</p>
          <button type="button" onClick={() => void discovery.refetch()}>Retry recipe choices</button>
        </div> : <p role="status">{controls.waiting || discovery.isFetching ? 'Finding saved recipes…'
          : choices.length === 0 ? 'No saved recipes match.' : ''}</p>}
        {discovery.hasNextPage && <button type="button" className="button button-secondary mm-button--small"
          disabled={controls.waiting || discovery.isFetching} onClick={() => void discovery.loadMore()}>
          {discovery.isFetchNextPageError ? 'Retry more choices' : 'Load more choices'}
        </button>}
        <RecipeChoice label="First recipe" choices={choices} selection={first} otherId={second?.id}
          onSelect={(id) => setFirst(pick(id, first, second))} />
        <RecipeComparisonEntry key={first?.id} position="first" selected={first}
          recipe={a} query={firstDetail} />
      </div>
    </JournalFacingPage>
    <section className="mm-page-column mm-recipe-comparison-page" aria-label="Second recipe and flavor comparison">
      <div className="mm-page-body mm-recipe-comparison" role="region" aria-label="Second recipe and flavor scores" tabIndex={0}>
        <RecipeChoice label="Second recipe" choices={choices} selection={second} otherId={first?.id}
          onSelect={(id) => setSecond(pick(id, second, first))} />
        <RecipeComparisonEntry key={second?.id} position="second" selected={second}
          recipe={b} query={secondDetail} />
        {a && b && <FlavorComparison first={a} second={b} />}
      </div>
    </section>
  </>
}

function RecipeChoice({ choices, selection, otherId, label, onSelect }: {
  choices: readonly RecipeSummary[]; selection: RecipeSummary | null; otherId?: string
  label: string; onSelect: (id: string) => void
}) {
  const options = selection && !choices.some((recipe) => recipe.id === selection.id)
    ? [selection, ...choices] : choices
  return <label className="mm-journal-tool__field">{label}
    <select value={selection?.id ?? ''} onChange={(event) => onSelect(event.currentTarget.value)}>
      <option value="">Choose a saved recipe</option>
      {options.filter((recipe) => recipe.id !== otherId).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.title}</option>)}
    </select>
  </label>
}

function RecipeComparisonEntry({ recipe, selected, position, query }: {
  recipe?: RecipeDetail; selected: RecipeSummary | null; position: 'first' | 'second'; query: ReturnType<typeof useRecipe>
}) {
  if (!selected) return null
  return <div className="mm-recipe-comparison__entry">
    {query.isError && <p role="status">{recipe ? 'Showing the last loaded recipe.' : 'This recipe could not be loaded.'}{' '}
      <button type="button" onClick={() => void query.refetch()}>Retry {position} recipe</button>
    </p>}
    {query.isPending && <p role="status">{query.isPaused ? 'Waiting for a connection.' : 'Opening recipe…'}</p>}
    {recipe && <>
      <h2>{recipe.title}</h2>
      {recipe.cooked_at && <p>Last cooked {formatCookedDate(recipe.cooked_at)}</p>}
      {recipe.star_rating != null && <p>Rating {recipe.star_rating} / 5</p>}
      <details>
        <summary>Ingredients ({recipe.ingredients.length})</summary>
        <ul>{recipe.ingredients.map((ingredient, index) => <li key={index}>{ingredient.name}</li>)}</ul>
      </details>
      <label className="mm-journal-tool__field">Tradeoffs for the {position} recipe
        <textarea rows={2} maxLength={240} />
      </label>
    </>}
  </div>
}

function FlavorComparison({ first, second }: { first: RecipeDetail; second: RecipeDetail }) {
  const differences = flavors.filter(({ key }) => first.flavor_scores && second.flavor_scores &&
    first.flavor_scores[key] !== second.flavor_scores[key])
  return <div className="mm-flavor-comparison">
    <table>
      <caption>Saved flavor scores (0–5)</caption>
      <thead><tr><th scope="col">Flavor</th><th scope="col">{first.title}</th><th scope="col">{second.title}</th></tr></thead>
      <tbody>{flavors.map(({ key, label }) => <tr key={key}>
        <th scope="row">{label}</th>
        <td>{first.flavor_scores?.[key] ?? 'Unavailable'}</td>
        <td>{second.flavor_scores?.[key] ?? 'Unavailable'}</td>
      </tr>)}</tbody>
    </table>
    <p>{!first.flavor_scores || !second.flavor_scores ? 'A comparison needs saved scores for both recipes.'
      : differences.length === 0 ? 'The two recipes have the same saved flavor scores.'
        : 'The saved scores differ for ' + new Intl.ListFormat(undefined, { type: 'conjunction' }).format(differences.map(({ label }) => label.toLowerCase())) + '.'}</p>
  </div>
}
