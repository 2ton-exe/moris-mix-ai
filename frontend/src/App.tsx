import { Navigate, Outlet, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { AuthReady, GuestRoute, ProtectedRoute } from './auth/AuthRoutes'
import AuthPage from './pages/AuthPage'
import EmailVerificationPage from './pages/EmailVerificationPage'
import JournalPage from './pages/JournalPage'
import DemoRecipePage from './pages/DemoRecipePage'
import CreateRecipePage from './pages/CreateRecipePage'
import EditRecipePage from './pages/EditRecipePage'
import RecipeDashboardPage from './pages/RecipeDashboardPage'
import RecipeDetailPage from './pages/RecipeDetailPage'
import { QuickAiEntryPage } from './quick-ai/QuickAiEntryPage'
import { ExtractedRecipeReviewPage } from './quick-ai/ExtractedRecipeReviewPage'
import { HomePage, AboutPage, NotFoundPage } from './pages/PublicJournalPages'
import { RecipeQueryProvider } from './recipes/RecipeQueryProvider'

// Keep BrowserRouter tests and the production data-router entry on one route tree.
// eslint-disable-next-line react-refresh/only-export-components -- route config is shared with main.tsx
export const createAppRouteElements = () => (
  <>
      <Route path="/" element={<Navigate to="/demo-recipe" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/demo-recipe" element={<DemoRecipePage />} />
      <Route element={<AuthProvider><Outlet /></AuthProvider>}>
        <Route path="/auth/callback" element={<EmailVerificationPage callback />} />
        <Route element={<AuthReady />}>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<AuthPage key="login" mode="login" />} />
            <Route path="/signup" element={<AuthPage key="signup" mode="signup" />} />
          </Route>
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<RecipeQueryProvider><Outlet /></RecipeQueryProvider>}>
              <Route path="/app/recipes/new" element={<CreateRecipePage />} />
              <Route path="/app/quick-entry/review" element={<ExtractedRecipeReviewPage />} />
              <Route path="/app/recipes/:recipeId/edit" element={<EditRecipePage />} />
              <Route path="/app" element={<JournalPage />}>
                <Route index element={<RecipeDashboardPage />} />
                <Route path="recipes" element={<RecipeDashboardPage />} />
                <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
                <Route path="quick-entry" element={<QuickAiEntryPage />} />
              </Route>
            </Route>
            <Route path="/app/*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
  </>
)

export default function App() {
  return <Routes>{createAppRouteElements()}</Routes>
}
