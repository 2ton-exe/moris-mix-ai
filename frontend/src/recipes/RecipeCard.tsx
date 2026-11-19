import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ArrowRight, CookingPot } from 'lucide-react'
import { useAuth } from '../auth/context'
import type { RecipeSummary } from './types'
import { recipeImageApi } from './imageApi'
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

export function RecipeIndexCardContent({ recipe }: { recipe?: RecipeSummary }) {
  return <>
    <CookingPot className="mm-index-card__icon" size={32} aria-hidden="true" />
    <div className="mm-recipe-card__copy">
      <h2>{recipe ? recipe.title : <span className="mm-skeleton-line" />}</h2>
      {recipe ? <RecipeMetadata recipe={recipe} /> : <div className="mm-recipe-metadata"><span className="mm-skeleton-line mm-skeleton-line--short" /></div>}
    </div>
    <ArrowRight className="mm-index-card__arrow" size={16} aria-hidden="true" />
  </>
}

export function RecipeCollectionCardContent({ recipe, folio, image }: { recipe?: RecipeSummary; folio: number; image?: ReactNode }) {
  return <>
    <RecipeScrapArtwork title={recipe?.title ?? ''} cookedAt={recipe?.cooked_at} loading={!recipe} image={image} />
    <div className="mm-recipe-card__copy">
      <span className="mm-recipe-card__folio" aria-hidden="true">No. {String(folio).padStart(2, '0')}</span>
      <h2>{recipe ? recipe.title : <span className="mm-skeleton-line" />}</h2>
      {recipe ? <RecipeMetadata recipe={recipe} /> : <div className="mm-recipe-metadata"><span className="mm-skeleton-line mm-skeleton-line--short" /></div>}
    </div>
  </>
}

export function RecipeCollectionCardMeasure({ recipe, folio }: { recipe: RecipeSummary; folio: number }) {
  return <li className="mm-recipe-card-slot">
    <div className={`mm-collection-entry${folio % 2 === 0 ? ' is-flipped' : ''}`}>
      <RecipeCollectionCardContent recipe={recipe} folio={folio} />
    </div>
  </li>
}

export function RecipeCard({ recipe, folio, indexCard = false }: { recipe: RecipeSummary; folio: number; indexCard?: boolean }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const imageEnabled = import.meta.env.VITE_RECIPE_IMAGES === 'true'
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const photoRequest = useRef<AbortController | null>(null)
  const refreshAttempted = useRef(false)
  const returnParams = new URLSearchParams(location.search)
  if (indexCard || folio > 1 || returnParams.has('entry')) returnParams.set('entry', String(folio - 1))
  const returnSearch = returnParams.toString()
  const journalReturn = location.pathname + (returnSearch ? `?${returnSearch}` : '')

  useEffect(() => {
    setPhotoUrl(null)
    refreshAttempted.current = false
    photoRequest.current?.abort()
    if (indexCard || !imageEnabled || !user?.id) return
    const controller = new AbortController()
    photoRequest.current = controller
    void recipeImageApi.getDownload(recipe.id, { userId: user.id, signal: controller.signal })
      .then((download) => { if (!controller.signal.aborted) setPhotoUrl(download?.url ?? null) })
      .catch(() => undefined)
    return () => {
      controller.abort()
      photoRequest.current?.abort()
      photoRequest.current = null
    }
  }, [imageEnabled, indexCard, recipe.id, user?.id])

  function refreshPhoto() {
    if (!photoUrl || refreshAttempted.current || !user?.id) {
      if (refreshAttempted.current || !user?.id) setPhotoUrl(null)
      return
    }
    refreshAttempted.current = true
    const controller = new AbortController()
    photoRequest.current?.abort()
    photoRequest.current = controller
    void recipeImageApi.getDownload(recipe.id, { userId: user.id, signal: controller.signal }, true)
      .then((download) => {
        if (!controller.signal.aborted) setPhotoUrl(download?.url === photoUrl ? null : download?.url ?? null)
      })
      .catch(() => { if (!controller.signal.aborted) setPhotoUrl(null) })
  }

  return (
    <li className="mm-recipe-card-slot">
      <Link className={`${indexCard ? 'mm-index-card' : 'mm-collection-entry'}${folio % 2 === 0 ? ' is-flipped' : ''}`} data-recipe-id={recipe.id} to={`/app/recipes/${encodeURIComponent(recipe.id)}`} state={{ recipeFolio: folio, journalReturn }} aria-label={`Open recipe ${recipe.title}`} onClick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          navigate(journalReturn, { replace: true, state: { ...location.state, focusRecipe: recipe.id } })
        }
      }}>
        {indexCard ? <RecipeIndexCardContent recipe={recipe} /> : <RecipeCollectionCardContent recipe={recipe} folio={folio}
          image={photoUrl ? <img className="recipe-image" src={photoUrl} alt={`${recipe.title} photo`} onError={refreshPhoto} /> : undefined} />}
      </Link>
    </li>
  )
}
