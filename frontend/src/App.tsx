import { isValidElement, lazy, Suspense, useRef, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './auth/context'
import { MoriCompanionProvider } from './mori/MoriCompanionContext'
import { MoriCompanion } from './mori/MoriCompanion'
import { AuthProvider } from './auth/AuthProvider'
import { AuthReady, GuestRoute, ProtectedRoute } from './auth/AuthRoutes'
import { JournalRouteLoading } from './journal/JournalRouteLoading'
import { RouteLoadBoundary } from './components/RouteLoadBoundary'
import { NavigationConfirmationContext, type RequestNavigationConfirmation } from './recipe-form/navigationConfirmation'
import { RecipeQueryProvider } from './recipes/RecipeQueryProvider'
import { JournalShell } from './journal/JournalShell'
import { JournalAuthCard, JournalAuthScene } from './journal/JournalAuth'
import { ErrorState } from './components/ErrorState'
import JournalPage from './pages/JournalPage'

function RecipeWorkspace() {
  const { user } = useAuth()
  const confirmation = useRef<RequestNavigationConfirmation>(null)
  return <NavigationConfirmationContext.Provider key={user?.id} value={confirmation}>
    <MoriCompanionProvider><Outlet /><MoriCompanion userId={user?.id} /></MoriCompanionProvider>
  </NavigationConfirmationContext.Provider>
}

const AuthPage = lazy(() => import('./pages/AuthPage'))
const EmailVerificationPage = lazy(() => import('./pages/EmailVerificationPage'))
const DemoRecipePage = lazy(() => import('./pages/DemoRecipePage'))
const RecipeRevisionSamplePage = lazy(() => import('./pages/RecipeRevisionSamplePage'))
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

function PublicJournalFrame() {
  const { pathname: routePath } = useLocation()
  const pathname = routePath.replace(/\/+$/, '') || '/'
  const demo = pathname.startsWith('/demo-recipe')
  return <JournalShell publicNavigation mode={demo ? 'demo' : 'journal'}
    pageClassName={pathname.endsWith('/try-a-revision') ? 'mm-revision-sample-sheet' : demo ? 'mm-demo-sheet' : 'mm-public-page'}><Outlet /></JournalShell>
}

function RouteFrame({ frame, children }: { frame: 'auth' | 'public' | 'mounted'; children: ReactNode }) {
  if (frame === 'mounted') return children
  if (frame === 'auth') return <JournalAuthScene><main className="mm-auth-main">
    <JournalAuthCard eyebrow="Your journal" mood="think">{children}</JournalAuthCard>
  </main></JournalAuthScene>
  return <JournalShell publicNavigation={frame === 'public'}>{children}</JournalShell>
}

const routeElement = (element: ReactNode, message: string, frame: Parameters<typeof RouteFrame>[0]['frame'] = 'mounted') => (
  <RouteLoadBoundary resetKey={isValidElement(element) ? element.key ?? element.type : element}
    wrapError={(error) => <RouteFrame frame={frame}>{error}</RouteFrame>}>
    <Suspense fallback={<RouteFrame frame={frame}><JournalRouteLoading message={message} /></RouteFrame>}>{element}</Suspense>
  </RouteLoadBoundary>
)

// Keep BrowserRouter tests and the production data-router entry on one route tree.
// eslint-disable-next-line react-refresh/only-export-components -- route config is shared with main.tsx
export const createAppRouteElements = () => (
  <Route errorElement={<RouteFrame frame="public">
    <ErrorState message="Could not open this page. Reload to try again." onRetry={() => window.location.reload()} />
  </RouteFrame>}>
      <Route path="/" element={<Navigate to="/demo-recipe" replace />} />
      <Route element={<PublicJournalFrame />}>
        <Route path="/home" element={routeElement(<HomePage />, 'Opening Mori’s Mix…')} />
        <Route path="/about" element={routeElement(<AboutPage />, 'Loading About Mori’s Mix…')} />
        <Route path="/demo-recipe" element={routeElement(<DemoRecipePage />, 'Loading demonstration recipe…')} />
        <Route path="/demo-recipe/try-a-revision" element={routeElement(<RecipeRevisionSamplePage />, 'Opening the recipe revision sample…')} />
        <Route path="*" element={routeElement(<NotFoundPage />, 'Opening Mori’s Mix…')} />
      </Route>
      <Route element={<AuthProvider><Outlet /></AuthProvider>}>
        <Route path="/auth/callback" element={routeElement(<EmailVerificationPage callback />, 'Opening your verification link…', 'auth')} />
        <Route element={<AuthReady />}>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={routeElement(<AuthPage key="login" mode="login" />, 'Opening sign-in…', 'auth')} />
            <Route path="/signup" element={routeElement(<AuthPage key="signup" mode="signup" />, 'Opening sign-up…', 'auth')} />
          </Route>
          <Route path="/verify-email" element={routeElement(<EmailVerificationPage />, 'Opening email verification…', 'auth')} />
          <Route element={<ProtectedRoute />}>
            <Route element={<RecipeQueryProvider><RecipeWorkspace /></RecipeQueryProvider>}>
              <Route path="/app" element={<JournalPage />}>
                <Route path="recipes/new" element={routeElement(<CreateRecipePage />, 'Opening a new recipe…')} />
                <Route path="quick-entry/review" element={routeElement(<ExtractedRecipeReviewPage />, 'Opening your recipe draft…')} />
                <Route path="chef/review" element={routeElement(<ChefRecipeReviewPage />, 'Opening your recipe idea…')} />
                <Route path="recipes/:recipeId/edit" element={routeElement(<EditRecipePage />, 'Opening the recipe editor…')} />
                <Route index element={routeElement(<RecipeDashboardPage />, 'Loading your recipes…')} />
                <Route path="recipes" element={routeElement(<RecipeDashboardPage />, 'Loading your recipes…')} />
                <Route path="recipes/:recipeId" element={routeElement(<RecipeDetailPage />, 'Opening your recipe…')} />
                <Route path="quick-entry" element={routeElement(<QuickAiEntryPage />, 'Opening Quick AI Entry…')} />
                <Route path="chef" element={routeElement(<AIChefPage />, 'Opening AI Chef…')} />
                <Route path="*" element={routeElement(<NotFoundPage journal />, 'Opening your journal…')} />
              </Route>
            </Route>
          </Route>
        </Route>
      </Route>
  </Route>
)

export default function App() {
  return <Routes>{createAppRouteElements()}</Routes>
}
