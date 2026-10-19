import { Link } from 'react-router'
import type { RecipeSummary } from './types'

export function RecipeMetadata({ recipe }: { recipe: RecipeSummary }) {
  return (
    <dl className="recipe-metadata">
      {recipe.star_rating != null && <div><dt>Rating</dt><dd>{recipe.star_rating} / 5</dd></div>}
      {recipe.cooked_at && <div><dt>Cooked</dt><dd><time dateTime={recipe.cooked_at}>{recipe.cooked_at}</time></dd></div>}
    </dl>
  )
}

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  return (
    <li>
      <Link className="recipe-card" to={`/app/recipes/${encodeURIComponent(recipe.id)}`}>
        <span className="recipe-card-label">From your journal</span>
        <h2>{recipe.title}</h2>
        <RecipeMetadata recipe={recipe} />
        <span className="recipe-card-link">Open recipe <span aria-hidden="true">→</span></span>
      </Link>
    </li>
  )
}
