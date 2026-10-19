import { Link, useParams } from 'react-router'
import type { Ingredient } from '../api/demoRecipe'
import { RecipeMetadata } from '../recipes/RecipeCard'
import { RecipeError, RecipeSkeleton } from '../recipes/RecipeStates'
import { isRecipeAccessError } from '../recipes/errors'
import { useRecipe } from '../recipes/queries'

function ingredientLabel(ingredient: Ingredient) {
  const amount = ingredient.quantityText ?? [ingredient.quantity, ingredient.unit]
    .filter((part) => part !== null).join(' ')
  return amount ? `${amount} ${ingredient.name}` : ingredient.name
}

export default function RecipeDetailPage() {
  const { recipeId = '' } = useParams()
  const query = useRecipe(recipeId)
  const recipe = isRecipeAccessError(query.error) ? undefined : query.data
  return (
    <>
      <nav className="recipe-back" aria-label="Recipe navigation"><Link to="/app/recipes">← Back to recipes</Link></nav>
      {query.isPending && <><h1>From your journal</h1><RecipeSkeleton detail /></>}
      {query.isPaused && <p role="status">You appear to be offline. This recipe will load when you reconnect.</p>}
      {query.isError && <>{!recipe && <h1>Recipe unavailable</h1>}<RecipeError detail error={query.error} onRetry={() => { void query.refetch() }} /></>}
      {recipe && <article className="journal-recipe">
        <header className="recipe-detail-header"><span className="recipe-card-label">Made to be remembered</span><h1>{recipe.title}</h1><RecipeMetadata recipe={recipe} /></header>
        {query.isFetching && <p role="status">Updating recipe…</p>}
        {query.isError && <p className="recipe-update">Showing the last loaded recipe.</p>}
        <div className="recipe-detail-columns">
          <section className="ingredient-panel" aria-labelledby="ingredients-heading">
            <h2 id="ingredients-heading">Ingredients</h2>
            {recipe.ingredients.length ? <ul>{recipe.ingredients.map((ingredient, index) => <li key={index}>{ingredientLabel(ingredient)}</li>)}</ul> : <p>No ingredients listed.</p>}
          </section>
          <section className="instruction-panel" aria-labelledby="instructions-heading">
            <h2 id="instructions-heading">In the kitchen</h2>
            {recipe.instructions.length ? <ol>{[...recipe.instructions].sort((a, b) => a.step - b.step).map((instruction, index) => <li key={`${instruction.step}-${index}`} value={instruction.step}>{instruction.text}</li>)}</ol> : <p>No cooking steps listed.</p>}
          </section>
        </div>
        {recipe.flavor_scores && <section className="recipe-flavors" aria-labelledby="flavors-heading"><h2 id="flavors-heading">Flavor notes</h2><dl className="flavor-scores">{Object.entries(recipe.flavor_scores).map(([name, score]) => <div key={name}><dt>{name}</dt><dd>{score} / 5</dd></div>)}</dl></section>}
      </article>}
    </>
  )
}
