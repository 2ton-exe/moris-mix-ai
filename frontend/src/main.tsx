import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, createRoutesFromElements, RouterProvider } from 'react-router'
import { createAppRouteElements } from './App'
import './styles.css'

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
