import { useContext, useEffect, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { RecipeError, RecipeReadingSkeleton } from '../recipes/RecipeStates'
import { RecipeDeletionControl } from '../recipes/RecipeDeletionControl'
import { RecipeImagePanel } from '../recipes/RecipeImagePanel'
import { isRecipeAccessError } from '../recipes/errors'
import { useRecipe } from '../recipes/queries'
import { RecipeSourceContext } from '../recipes/source'
import { journalReturnTo } from '../journal/indexNavigation'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { RecipeReading } from '../recipes/RecipeReading'
import { useMoriHeadingFocusKey } from '../mori/routeState'
import { useAuth } from '../auth/context'
import { RecipeRevisionTools } from '../recipes/RecipeRevisionTools'
import { useJournalMedia } from '../journal/useJournalMedia'
import { focusLoadedJournalContent } from '../journal/focus'

export default function RecipeDetailPage() {
  const { recipeId = '' } = useParams()
  const location = useLocation()
  const moriFocusKey = useMoriHeadingFocusKey()
  const source = useContext(RecipeSourceContext)
  const { user } = useAuth()
  const desktopTools = useJournalMedia('(hover: hover) and (pointer: fine)')
  const single = useJournalMedia('(max-width: 1099.98px), (max-height: 639.98px)')
  const query = useRecipe(recipeId)
  const recipe = isRecipeAccessError(query.error) ? undefined : query.data
  const hasRecipe = recipe !== undefined
  const titleRef = useRef<HTMLHeadingElement>(null)
  const focusAfterRequest = useRef(true)
  const routeState: unknown = location.state
  const folio = typeof routeState === 'object' && routeState !== null && 'recipeFolio' in routeState &&
    typeof routeState.recipeFolio === 'number' && Number.isSafeInteger(routeState.recipeFolio) && routeState.recipeFolio > 0
    ? routeState.recipeFolio : undefined

  useEffect(() => { focusAfterRequest.current = true }, [recipeId, moriFocusKey])
  useEffect(() => {
    if (!focusAfterRequest.current || query.isPending || (!hasRecipe && !query.isError)) return
    if (moriFocusKey) titleRef.current?.focus()
    else focusLoadedJournalContent(titleRef.current)
    focusAfterRequest.current = false
  }, [query.isPending, query.isError, hasRecipe, recipe?.id, moriFocusKey])

  const journalReturn = journalReturnTo(routeState)

  const retry = () => { focusAfterRequest.current = !hasRecipe; void query.refetch() }

  return <div className="mm-recipe-detail mm-page-column">
    {query.isPending && <RecipeReadingSkeleton back={<Link to={journalReturn} state={{ focusRecipe: recipeId }}><span aria-hidden="true">←</span> Back to recipes</Link>} />}
    {query.isPaused && <p className="mm-recipe-detail__offline" role="status">You appear to be offline. This recipe will load when you reconnect.</p>}
    {!recipe && query.isError && single && <JournalFacingPage className="mm-facing-content--recipe">
      <nav className="recipe-back mm-recipe-detail__back" aria-label="Recipe navigation">
        <Link to={journalReturn} state={{ focusRecipe: recipeId }}><span aria-hidden="true">←</span> Back to recipes</Link>
      </nav>
    </JournalFacingPage>}
    {!recipe && query.isError && (single ? <>
      <h1 ref={titleRef} tabIndex={-1}>Recipe unavailable</h1>
      <RecipeError detail error={query.error} onRetry={retry} />
      {source.mode === 'unavailable' && <nav className="mm-recipe-recovery__actions" aria-label="Recipe recovery">
        <Link className="button button-primary" to="/demo-recipe">Explore the sample recipe</Link>
      </nav>}
    </> : <section className="mm-recipe-recovery" aria-labelledby="recipe-unavailable-heading">
      <h1 id="recipe-unavailable-heading" ref={titleRef} tabIndex={-1}>Recipe unavailable</h1>
      <RecipeError detail error={query.error} onRetry={retry} />
      <nav className="mm-recipe-recovery__actions" aria-label="Recipe recovery">
        <Link className="button button-primary" to={journalReturn} state={{ focusRecipe: recipeId }}>Browse your recipes</Link>
        {source.mode === 'live' && <Link className="button button-secondary" to="/app/recipes/new" state={{ journalReturn }}>Create a recipe</Link>}
        {source.mode === 'unavailable' && <Link className="button button-secondary" to="/demo-recipe">Explore the sample recipe</Link>}
      </nav>
    </section>)}
    {recipe && <RecipeReading recipe={recipe} titleRef={titleRef} folio={folio}
      artwork={<RecipeImagePanel key={`image-${recipe.id}`} recipeId={recipe.id} recipeTitle={recipe.title} cookedAt={recipe.cooked_at} framed />}
      back={<Link to={journalReturn} state={{ focusRecipe: recipeId }}><span aria-hidden="true">←</span> Back to recipes</Link>}
      status={<>
        {query.isFetching && <p role="status" className="recipe-update visually-hidden">Updating recipe…</p>}
        {query.isError && <><RecipeError detail error={query.error} onRetry={retry} /><p className="recipe-update" role="status">Showing the last loaded recipe. Its latest changes could not be checked.</p></>}
      </>}
      editable={source.mode === 'live'}
      cookingActions={desktopTools && user && source.mode === 'live' && <RecipeRevisionTools key={`${user.id}:${recipe.id}`} recipe={recipe} userId={user.id} onReload={() => { void query.refetch() }} />}
      actions={<>
        {source.mode === 'live' && <Link className={`button ${desktopTools ? 'button-secondary' : 'button-primary'} mm-button--small`} to={`/app/recipes/${encodeURIComponent(recipe.id)}/edit`} state={{ journalReturn, recipeFolio: folio }}>Edit recipe</Link>}
        <RecipeDeletionControl recipeId={recipe.id} recipeTitle={recipe.title} />
      </>}
    />}
  </div>
}
