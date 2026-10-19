import { useContext } from 'react'
import { Link } from 'react-router'
import { RecipeCard } from '../recipes/RecipeCard'
import { RecipeError, RecipeSkeleton } from '../recipes/RecipeStates'
import { isRecipeAccessError } from '../recipes/errors'
import { useRecipes } from '../recipes/queries'
import { RecipeSourceContext } from '../recipes/source'

export default function RecipeDashboardPage() {
  const query = useRecipes()
  const source = useContext(RecipeSourceContext)
  const recipes = isRecipeAccessError(query.error) ? undefined : query.data
  return (
    <>
      <div className="journal-heading">
        <div><h1>Your cooking journal</h1><p className="intro">A little inspiration, a few ingredients, and the meals you make your own.</p></div>
        {source.mode !== 'unavailable' && !isRecipeAccessError(query.error) && <button className="button button-secondary" type="button" disabled={query.isFetching} onClick={() => { void query.refetch() }}>
          {query.isFetching ? 'Refreshing…' : 'Refresh recipes'}
        </button>}
      </div>
      {query.isPending && <RecipeSkeleton />}
      {query.isPaused && <p role="status">You appear to be offline. Your recipes will load when you reconnect.</p>}
      {query.isError && <RecipeError error={query.error} onRetry={() => { void query.refetch() }} />}
      {recipes && <>
        {query.isFetching && <p className="recipe-update" role="status">Updating your collection…</p>}
        {query.isError && <p className="recipe-update">Showing your last loaded collection. Refresh to try again.</p>}
        {recipes.length > 0 ? (
          <section className="recipe-collection" aria-labelledby="collection-heading">
            <h2 id="collection-heading" className="collection-heading">Saved recipes <span>({recipes.length})</span></h2>
            <ul className="recipe-grid">{recipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} />)}</ul>
          </section>
        ) : (
          <section className="journal-empty" aria-labelledby="empty-heading">
            <span className="empty-mark" aria-hidden="true">✧</span>
            <h2 id="empty-heading">A fresh page for your next favorite.</h2>
            <p>You haven’t saved any recipes yet. Start with a dish you love and make a little room for discovery.</p>
            <details className="recipe-start"><summary>Plan your first recipe</summary><p>Gather your ingredients and jot down the steps you want to remember. Recipe creation is coming soon; you’ll be able to save them here.</p></details>
            <Link className="button button-primary" to="/demo-recipe">Explore a demonstration recipe</Link>
          </section>
        )}
      </>}
    </>
  )
}
