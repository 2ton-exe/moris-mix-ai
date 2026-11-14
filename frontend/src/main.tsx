import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, createRoutesFromElements } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createAppRouteElements } from './App'
import './styles.css'
import './journal/foundation.css'
import './journal/journal-shell.css'
import './journal/journal-auth.css'
import './journal/recipe-journal.css'
import './journal/journal-compositions.css'
import './journal/page-compositions.css'
import './journal/folio.css'
import './journal/reading-pages.css'
import './journal/page-turn.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root was not found')
}

// Keep App's existing route declarations while enabling data-router features
// such as useBlocker for the recipe editor's unsaved-change protection.
const router = createBrowserRouter(createRoutesFromElements(createAppRouteElements()))

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
