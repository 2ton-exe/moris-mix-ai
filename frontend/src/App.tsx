import { isValidElement, lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { AuthReady, GuestRoute, ProtectedRoute } from './auth/AuthRoutes'
import { LoadingState } from './components/LoadingState'
import { RouteLoadBoundary } from './components/RouteLoadBoundary'
import { RecipeQueryProvider } from './recipes/RecipeQueryProvider'

const AuthPage = lazy(() => import('./pages/AuthPage'))
const EmailVerificationPage = lazy(() => import('./pages/EmailVerificationPage'))
const JournalPage = lazy(() => import('./pages/JournalPage'))
const DemoRecipePage = lazy(() => import('./pages/DemoRecipePage'))
const CreateRecipePage = lazy(() => import('./pages/CreateRecipePage'))
const EditRecipePage = lazy(() => import('./pages/EditRecipePage'))
const RecipeDashboardPage = lazy(() => import('./pages/RecipeDashboardPage'))
const RecipeDetailPage = lazy(() => import('./pages/RecipeDetailPage'))
const QuickAiEntryPage = lazy(() =>
  import('./quick-ai/QuickAiEntryPage').then(({ QuickAiEntryPage }) => ({ default: QuickAiEntryPage })),
)
const ExtractedRecipeReviewPage = lazy(() =>
  import('./quick-ai/ExtractedRecipeReviewPage').then(({ ExtractedRecipeReviewPage }) => ({ default: ExtractedRecipeReviewPage })),
)
const AIChefPage = lazy(() => import('./ai-chef/AIChefPage').then(({ AIChefPage }) => ({ default: AIChefPage })))
const ChefRecipeReviewPage = lazy(() =>
  import('./ai-chef/ChefRecipeReviewPage').then(({ ChefRecipeReviewPage }) => ({ default: ChefRecipeReviewPage })),
)
const HomePage = lazy(() => import('./pages/PublicJournalPages').then(({ HomePage }) => ({ default: HomePage })))
const AboutPage = lazy(() => import('./pages/PublicJournalPages').then(({ AboutPage }) => ({ default: AboutPage })))
const NotFoundPage = lazy(() => import('./pages/PublicJournalPages').then(({ NotFoundPage }) => ({ default: NotFoundPage })))

const routeElement = (element: ReactNode, message = 'Loading…') => (
  <RouteLoadBoundary resetKey={isValidElement(element) ? element.key ?? element.type : element}>
    <Suspense fallback={<LoadingState message={message} />}>{element}</Suspense>
  </RouteLoadBoundary>
)

// Keep BrowserRouter tests and the production data-router entry on one route tree.
// eslint-disable-next-line react-refresh/only-export-components -- route config is shared with main.tsx
export const createAppRouteElements = () => (
  <>
      <Route path="/" element={<Navigate to="/demo-recipe" replace />} />
      <Route path="/home" element={routeElement(<HomePage />)} />
      <Route path="/about" element={routeElement(<AboutPage />)} />
      <Route path="/demo-recipe" element={routeElement(<DemoRecipePage />, 'Loading demonstration recipe…')} />
      <Route element={<AuthProvider><Outlet /></AuthProvider>}>
        <Route path="/auth/callback" element={routeElement(<EmailVerificationPage callback />)} />
        <Route element={<AuthReady />}>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={routeElement(<AuthPage key="login" mode="login" />)} />
            <Route path="/signup" element={routeElement(<AuthPage key="signup" mode="signup" />)} />
          </Route>
          <Route path="/verify-email" element={routeElement(<EmailVerificationPage />)} />
          <Route element={<ProtectedRoute />}>
            <Route element={<RecipeQueryProvider><Outlet /></RecipeQueryProvider>}>
              <Route path="/app/recipes/new" element={routeElement(<CreateRecipePage />)} />
              <Route path="/app/quick-entry/review" element={routeElement(<ExtractedRecipeReviewPage />)} />
              <Route path="/app/chef/review" element={routeElement(<ChefRecipeReviewPage />)} />
              <Route path="/app/recipes/:recipeId/edit" element={routeElement(<EditRecipePage />)} />
              <Route path="/app" element={routeElement(<JournalPage />)}>
                <Route index element={routeElement(<RecipeDashboardPage />)} />
                <Route path="recipes" element={routeElement(<RecipeDashboardPage />)} />
                <Route path="recipes/:recipeId" element={routeElement(<RecipeDetailPage />)} />
                <Route path="quick-entry" element={routeElement(<QuickAiEntryPage />)} />
                <Route path="chef" element={routeElement(<AIChefPage />)} />
              </Route>
            </Route>
            <Route path="/app/*" element={routeElement(<NotFoundPage />)} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={routeElement(<NotFoundPage />)} />
  </>
)

export default function App() {
  return <Routes>{createAppRouteElements()}</Routes>
}
