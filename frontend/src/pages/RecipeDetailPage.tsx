import { useContext, useEffect, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { RecipeError, RecipeSkeleton } from '../recipes/RecipeStates'
import { RecipeDeletionControl } from '../recipes/RecipeDeletionControl'
import { RecipeImagePanel } from '../recipes/RecipeImagePanel'
import { isRecipeAccessError } from '../recipes/errors'
import { useRecipe } from '../recipes/queries'
import { RecipeSourceContext } from '../recipes/source'
import { journalReturnTo } from '../journal/indexNavigation'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { RecipeReading } from '../recipes/RecipeReading'

export default function RecipeDetailPage() {
  const { recipeId = '' } = useParams()
  const location = useLocation()
  const source = useContext(RecipeSourceContext)
  const query = useRecipe(recipeId)
  const recipe = isRecipeAccessError(query.error) ? undefined : query.data
  const hasRecipe = recipe !== undefined
  const titleRef = useRef<HTMLHeadingElement>(null)
  const focusAfterRequest = useRef(true)
  const routeState: unknown = location.state
  const folio = typeof routeState === 'object' && routeState !== null && 'recipeFolio' in routeState &&
    typeof routeState.recipeFolio === 'number' && Number.isSafeInteger(routeState.recipeFolio) && routeState.recipeFolio > 0
    ? routeState.recipeFolio : undefined

  useEffect(() => { focusAfterRequest.current = true }, [recipeId])
  useEffect(() => {
    if (!focusAfterRequest.current || query.isPending || (!hasRecipe && !query.isError)) return
    titleRef.current?.focus()
    focusAfterRequest.current = false
  }, [query.isPending, query.isError, hasRecipe, recipe?.id])

  const journalReturn = journalReturnTo(routeState)

  const retry = () => { focusAfterRequest.current = true; void query.refetch() }

  return <div className="mm-recipe-detail mm-page-column">
    {!recipe && <JournalFacingPage className="mm-facing-content--recipe">
      <nav className="recipe-back mm-recipe-detail__back" aria-label="Recipe navigation">
        <Link to={journalReturn} state={{ focusRecipe: recipeId }}><span aria-hidden="true">←</span> Back to recipes</Link>
      </nav>
    </JournalFacingPage>}
    {query.isPending && <div className="mm-recipe-detail__loading"><h1 ref={titleRef} tabIndex={-1}>From your journal</h1><RecipeSkeleton detail /></div>}
    {query.isPaused && <p className="mm-recipe-detail__offline" role="status">You appear to be offline. This recipe will load when you reconnect.</p>}
    {!recipe && query.isError && <><h1 ref={titleRef} tabIndex={-1}>Recipe unavailable</h1><RecipeError detail error={query.error} onRetry={retry} /></>}
    {recipe && <RecipeReading recipe={recipe} titleRef={titleRef} folio={folio}
      supplement={<RecipeImagePanel key={`image-${recipe.id}`} recipeId={recipe.id} recipeTitle={recipe.title} showEmpty />}
      back={<Link to={journalReturn} state={{ focusRecipe: recipeId }}><span aria-hidden="true">←</span> Back to recipes</Link>}
      status={<>
        {query.isFetching && <p role="status" className="recipe-update">Updating recipe…</p>}
        {query.isError && <><RecipeError detail error={query.error} onRetry={retry} /><p className="recipe-update">Showing the last loaded recipe.</p></>}
      </>}
      actions={<>
        {source.mode === 'live' && <Link className="button button-secondary mm-button--small" to={`/app/recipes/${encodeURIComponent(recipe.id)}/edit`} state={{ journalReturn }}>Edit recipe</Link>}
        <RecipeDeletionControl recipeId={recipe.id} recipeTitle={recipe.title} />
        <Link className="button mm-button--page-turn" to={journalReturn} state={{ focusRecipe: recipeId }}>Collection →</Link>
      </>}
    />}
  </div>
}
