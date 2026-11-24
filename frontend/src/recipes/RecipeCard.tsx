import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ArrowRight, CookingPot } from 'lucide-react'
import { useAuth } from '../auth/context'
import type { RecipeSummary } from './types'
import { recipeImageApi } from './imageApi'
import { RecipeScrapArtwork } from './RecipeScrapArtwork'
import { formatCookedDate } from './recipePresentation'

export function RecipeMetadata({ recipe, showCookedAt = true, compact = false }: { recipe: RecipeSummary; showCookedAt?: boolean; compact?: boolean }) {
  return (
    <dl className="recipe-metadata mm-recipe-metadata">
      {recipe.star_rating != null && <div><dt className={compact ? 'visually-hidden' : undefined}>Rating</dt><dd>
        <span className="mm-recipe-rating" role="img" aria-label={`${recipe.star_rating} out of 5 stars`}>
          <span aria-hidden="true">{'★'.repeat(recipe.star_rating)}{'☆'.repeat(5 - recipe.star_rating)}</span>
        </span>
        <span className="mm-recipe-rating__value" aria-hidden="true">{recipe.star_rating} / 5</span>
      </dd></div>}
      {showCookedAt && recipe.cooked_at && <div><dt className={compact ? 'visually-hidden' : undefined}>Cooked</dt><dd><time dateTime={recipe.cooked_at}>{formatCookedDate(recipe.cooked_at)}</time></dd></div>}
    </dl>
  )
}

export function RecipeIndexCardContent({ recipe, folio, duplicateTitle = false }: { recipe?: RecipeSummary; folio?: number; duplicateTitle?: boolean }) {
  return <>
    {folio === undefined
      ? <CookingPot className="mm-index-card__icon" size={32} aria-hidden="true" />
      : <span className="mm-index-card__number">No. {String(folio).padStart(2, '0')}</span>}
    <div className="mm-recipe-card__copy">
      <h2>{recipe ? recipe.title : <span className="mm-skeleton-line" />}</h2>
      {recipe ? <RecipeMetadata recipe={recipe} /> : <div className="mm-recipe-metadata"><span className="mm-skeleton-line mm-skeleton-line--short" /></div>}
      {duplicateTitle && recipe?.notes?.trim() && <p className="mm-recipe-card__disambiguator">Note: {recipe.notes.trim().length > 128 ? `${recipe.notes.trim().slice(0, 128).trimEnd()}…` : recipe.notes.trim()}</p>}
    </div>
    <ArrowRight className="mm-index-card__arrow" size={16} aria-hidden="true" />
  </>
}

export function RecipeCollectionCardContent({ recipe, folio, image, editorial = false, duplicateTitle = false }: { recipe?: RecipeSummary; folio: number; image?: ReactNode; editorial?: boolean; duplicateTitle?: boolean }) {
  const notes = (editorial || duplicateTitle) && recipe?.notes?.trim()
  return <>
    <RecipeScrapArtwork title={recipe?.title ?? ''} cookedAt={recipe?.cooked_at} loading={!recipe} image={image} />
    <div className="mm-recipe-card__copy">
      <span className="mm-recipe-card__folio" aria-hidden="true">No. {String(folio).padStart(2, '0')}</span>
      <p className="mm-collection-entry__title">{recipe ? recipe.title : <span className="mm-skeleton-line" />}</p>
      {recipe ? <RecipeMetadata recipe={recipe} compact={editorial} /> : <div className="mm-recipe-metadata"><span className="mm-skeleton-line mm-skeleton-line--short" /></div>}
      {notes && <p className={`mm-collection-entry__notes${duplicateTitle ? ' mm-recipe-card__disambiguator' : ''}`}>{notes.length > 128 ? `${notes.slice(0, 128).trimEnd()}…` : notes}</p>}
      {editorial && <span className="mm-collection-entry__open" aria-hidden="true">Open recipe <ArrowRight size={16} /></span>}
    </div>
  </>
}

export function RecipeCollectionCardMeasure({ recipe, folio, editorial, duplicateTitle = false }: { recipe: RecipeSummary; folio: number; editorial: boolean; duplicateTitle?: boolean }) {
  return <li className="mm-recipe-card-slot">
    <div className={`mm-collection-entry${folio % 2 === 0 ? ' is-flipped' : ''}`}>
      <RecipeCollectionCardContent recipe={recipe} folio={folio} editorial={editorial} duplicateTitle={duplicateTitle} />
    </div>
  </li>
}

export function RecipeCard({ recipe, folio, indexCard = false, editorial = false, duplicateTitle = false }: { recipe: RecipeSummary; folio: number; indexCard?: boolean; editorial?: boolean; duplicateTitle?: boolean }) {
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
  const duplicateContext = duplicateTitle
    ? `${recipe.cooked_at ? `, cooked ${formatCookedDate(recipe.cooked_at)}` : ''}, entry ${folio}`
    : indexCard ? `, entry ${folio}` : ''

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
      <Link className={`${indexCard ? 'mm-index-card' : 'mm-collection-entry'}${folio % 2 === 0 ? ' is-flipped' : ''}`} data-recipe-id={recipe.id} to={`/app/recipes/${encodeURIComponent(recipe.id)}`} state={{ recipeFolio: folio, journalReturn }} aria-label={`Open recipe ${recipe.title}${duplicateContext}`} onClick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          navigate(journalReturn, { replace: true, state: { ...location.state, focusRecipe: recipe.id } })
        }
      }}>
        {indexCard ? <RecipeIndexCardContent recipe={recipe} folio={folio} duplicateTitle={duplicateTitle} /> : <RecipeCollectionCardContent recipe={recipe} folio={folio} editorial={editorial} duplicateTitle={duplicateTitle}
          image={photoUrl ? <img className="recipe-image" src={photoUrl} alt={`${recipe.title} photo`} onError={refreshPhoto} /> : undefined} />}
      </Link>
    </li>
  )
}
