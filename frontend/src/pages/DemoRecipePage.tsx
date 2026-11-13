import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getDemoRecipe } from '../api/demoRecipe'
import type { DemoRecipe } from '../api/demoRecipe'
import { HttpError } from '../api/http'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'

import { JournalShell } from '../journal/JournalShell'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { RecipeReading } from '../recipes/RecipeReading'

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
    <JournalShell mode="demo" publicNavigation pageClassName="mm-demo-sheet">
      {request.status !== 'success' && <JournalFacingPage className="mm-facing-content--demo">
        <h1 tabIndex={-1}>Demonstration recipe</h1>
        <Link className="button button-secondary" to="/home">Back home</Link>
      </JournalFacingPage>}
      {request.status === 'loading' && <LoadingState message="Loading demonstration recipe…" />}
      {request.status === 'error' &&
        <ErrorState message={request.message} onRetry={request.canRetry ? retry : undefined} />}
      {request.status === 'success' && <RecipeReading recipe={request.recipe} publicDemo
        back={<Link to="/home"><span aria-hidden="true">←</span> Back home</Link>}
      />}
    </JournalShell>
  )
}
