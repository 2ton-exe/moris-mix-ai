import { render, screen } from '@testing-library/react'
import { createMemoryRouter, createRoutesFromElements, RouterProvider } from 'react-router'
import { expect, it } from 'vitest'
import { createAppRouteElements } from './App'

it('loads a public page through the shared route tree', async () => {
  const router = createMemoryRouter(createRoutesFromElements(createAppRouteElements()), { initialEntries: ['/about'] })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: 'Keep your recipes close.' })).toBeTruthy()
})
