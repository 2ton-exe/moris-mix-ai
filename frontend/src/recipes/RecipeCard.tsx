import { Link, useLocation, useNavigate } from 'react-router'
import type { RecipeSummary } from './types'
import { RecipeScrapArtwork } from './RecipeScrapArtwork'
import { formatCookedDate } from './recipePresentation'

export function RecipeMetadata({ recipe, showCookedAt = true }: { recipe: RecipeSummary; showCookedAt?: boolean }) {
  return (
    <dl className="recipe-metadata mm-recipe-metadata">
      {recipe.star_rating != null && <div><dt>Rating</dt><dd>
        <span className="mm-recipe-rating" role="img" aria-label={`${recipe.star_rating} out of 5 stars`}>
          <span aria-hidden="true">{'★'.repeat(recipe.star_rating)}{'☆'.repeat(5 - recipe.star_rating)}</span>
        </span>
        <span className="mm-recipe-rating__value" aria-hidden="true">{recipe.star_rating} / 5</span>
      </dd></div>}
      {showCookedAt && recipe.cooked_at && <div><dt>Cooked</dt><dd><time dateTime={recipe.cooked_at}>{formatCookedDate(recipe.cooked_at)}</time></dd></div>}
    </dl>
  )
}

export function RecipeCard({ recipe, folio, indexCard = false }: { recipe: RecipeSummary; folio: number; indexCard?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const number = String(folio).padStart(2, '0')
  const returnParams = new URLSearchParams(location.search)
  if (indexCard || folio > 1 || returnParams.has('entry')) returnParams.set('entry', String(folio - 1))
  const journalReturn = location.pathname + (returnParams.size ? `?${returnParams}` : '')
  return (
    <li className="mm-recipe-card-slot">
      <Link className={`${indexCard ? 'mm-index-card' : 'mm-collection-entry'}${folio % 2 === 0 ? ' is-flipped' : ''}`} data-recipe-id={recipe.id} to={`/app/recipes/${encodeURIComponent(recipe.id)}`} state={{ recipeFolio: folio, journalReturn }} aria-label={`Open recipe ${recipe.title}`} onClick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          navigate(journalReturn, { replace: true, state: { ...location.state, focusRecipe: recipe.id } })
        }
      }}>
        {!indexCard && <RecipeScrapArtwork title={recipe.title} cookedAt={recipe.cooked_at} />}
        <div className="mm-recipe-card__copy">
          {!indexCard && <span className="mm-recipe-card__folio" aria-hidden="true">No. {number}</span>}
          <h2>{recipe.title.length > 100 ? `${recipe.title.slice(0, 100)}…` : recipe.title}</h2>
          <RecipeMetadata recipe={recipe} />
          {!indexCard && <span className="recipe-card-link">Open scrap <span aria-hidden="true">→</span></span>}
        </div>
      </Link>
    </li>
  )
}
