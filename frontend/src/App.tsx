import { Link, Navigate, Outlet, Route, Routes } from 'react-router'
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
import { RecipeQueryProvider } from './recipes/RecipeQueryProvider'

function HomePage() {
  return (
    <main className="page-shell">
      <div className="eyebrow"><span className="status-dot" /> Frontend starter</div>
      <h1>A clean start<br />for what comes next.</h1>
      <p className="intro">
        Your React app is ready. Build a page, add a route, and make this space your own.
      </p>
      <div className="actions">
        <Link className="button button-primary" to="/app">Your cooking journal</Link>
        <Link className="button button-primary" to="/demo-recipe">Demonstration recipe</Link>
        <Link className="button button-primary" to="/about">Explore the app <span aria-hidden="true">→</span></Link>
        <a className="button button-secondary" href="https://vite.dev/guide/">Read the Vite guide</a>
      </div>
      <div className="starter-card">
        <div className="card-icon" aria-hidden="true">⌘</div>
        <div>
          <strong>Everything is connected</strong>
          <p>TypeScript, routing, linting, and production builds are set up.</p>
        </div>
        <span className="card-check" aria-label="Ready">✓</span>
      </div>
      <footer>React <span>·</span> Vite <span>·</span> TypeScript</footer>
    </main>
  )
}

function AboutPage() {
  return (
    <main className="page-shell">
      <div className="eyebrow"><span className="status-dot" /> Second route</div>
      <h1>One small step<br />beyond the home page.</h1>
      <p className="intro">This page confirms client-side routing is in place. Add your own routes in <code>src/App.tsx</code>.</p>
      <div className="actions">
        <Link className="button button-primary" to="/home">Back home <span aria-hidden="true">→</span></Link>
      </div>
      <footer>React <span>·</span> Vite <span>·</span> TypeScript</footer>
    </main>
  )
}

function NotFoundPage() {
  return (
    <main className="page-shell">
      <div className="eyebrow"><span className="status-dot" /> 404 · Page not found</div>
      <h1>This route<br />is still unwritten.</h1>
      <p className="intro">The page you’re looking for doesn’t exist yet.</p>
      <div className="actions"><Link className="button button-primary" to="/home">Return home <span aria-hidden="true">→</span></Link></div>
    </main>
  )
}

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
            <Route path="/app/recipes/new" element={<CreateRecipePage />} />
            <Route path="/app/recipes/:recipeId/edit" element={<EditRecipePage />} />
            <Route path="/app" element={<RecipeQueryProvider><JournalPage /></RecipeQueryProvider>}>
              <Route index element={<RecipeDashboardPage />} />
              <Route path="recipes" element={<RecipeDashboardPage />} />
              <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
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
