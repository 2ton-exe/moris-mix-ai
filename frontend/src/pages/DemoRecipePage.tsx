import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getDemoRecipe } from '../api/demoRecipe'
import type { DemoRecipe, Ingredient } from '../api/demoRecipe'
import { HttpError } from '../api/http'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'

type RequestState =
  | { status: 'loading' }
  | { status: 'error'; message: string; canRetry: boolean }
  | { status: 'success'; recipe: DemoRecipe }

function errorState(error: unknown): RequestState {
  if (error instanceof HttpError && error.kind === 'configuration') {
    return { status: 'error', message: 'The recipe service is not configured. Please contact the site owner.', canRetry: false }
  }
  if (error instanceof HttpError && error.status === 404) {
    return { status: 'error', message: 'The demonstration recipe is currently unavailable.', canRetry: true }
  }
  return { status: 'error', message: 'Could not load the demonstration recipe. Please try again.', canRetry: true }
}

function ingredientLabel(ingredient: Ingredient) {
  const amount = ingredient.quantityText ?? [ingredient.quantity, ingredient.unit]
    .filter((part) => part !== null).join(' ')
  return amount ? `${amount} ${ingredient.name}` : ingredient.name
}

export default function DemoRecipePage() {
  const [attempt, setAttempt] = useState(0)
  const [request, setRequest] = useState<RequestState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    getDemoRecipe({ signal: controller.signal }).then(
      (recipe) => { if (!controller.signal.aborted) setRequest({ status: 'success', recipe }) },
      (error: unknown) => { if (!controller.signal.aborted) setRequest(errorState(error)) },
    )
    return () => controller.abort()
  }, [attempt])

  const retry = () => {
    setRequest({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <main className="page-shell">
      <div className="eyebrow"><span className="status-dot" /> Mori’s Mix</div>
      <h1>Demonstration recipe</h1>
      {request.status === 'loading' && <LoadingState message="Loading demonstration recipe…" />}
      {request.status === 'error' &&
        <ErrorState message={request.message} onRetry={request.canRetry ? retry : undefined} />}
      {request.status === 'success' && (
        <article className="recipe">
          <h2>{request.recipe.title}</h2>
          <section aria-labelledby="ingredients-heading">
            <h3 id="ingredients-heading">Ingredients</h3>
            {request.recipe.ingredients.length ? (
              <ul>{request.recipe.ingredients.map((ingredient, index) =>
                <li key={`${ingredient.name}-${index}`}>{ingredientLabel(ingredient)}</li>)}</ul>
            ) : <p>No ingredients listed.</p>}
          </section>
          <section aria-labelledby="instructions-heading">
            <h3 id="instructions-heading">Instructions</h3>
            {request.recipe.instructions.length ? (
              <ol>{request.recipe.instructions.map((instruction, index) =>
                <li key={`${instruction.step}-${index}`} value={instruction.step}>{instruction.text}</li>)}</ol>
            ) : <p>No instructions listed.</p>}
          </section>
          <section aria-labelledby="flavor-heading">
            <h3 id="flavor-heading">Flavor scores</h3>
            <dl className="flavor-scores">
              {Object.entries(request.recipe.flavor_scores).map(([name, score]) =>
                <div key={name}><dt>{name}</dt><dd>{score} / 5</dd></div>)}
            </dl>
          </section>
          <p className="recipe-meta">
            {request.recipe.star_rating === null ? 'Not rated' : `Rating: ${request.recipe.star_rating} / 5`}
            {request.recipe.cooked_at && <> · Cooked: <time dateTime={request.recipe.cooked_at}>{request.recipe.cooked_at}</time></>}
          </p>
        </article>
      )}
      <div className="actions"><Link className="button button-secondary" to="/home">Back home</Link></div>
    </main>
  )
}
