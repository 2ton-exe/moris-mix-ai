import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../App'

afterEach(() => vi.unstubAllGlobals())

it('reveals two different sample revisions with their exact notes and no requests', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<MemoryRouter initialEntries={['/demo-recipe/try-a-revision']}><App /></MemoryRouter>)

  await screen.findByRole('heading', { name: 'Chicken Adobo' })
  const original = screen.getByRole('region', { name: 'Original recipe' })
  expect(within(original).getByText('¼ cup soy sauce')).toBeTruthy()
  expect(within(original).getByText('3 tablespoons vinegar')).toBeTruthy()
  expect(screen.getByText('Pick a cooking note to see what Mori would change.')).toBeTruthy()

  const salty = 'Too salty with ¼ cup soy sauce. Loved the extra vinegar.'
  fireEvent.click(screen.getByRole('button', { name: salty }))
  const review = screen.getByRole('region', { name: 'Sample draft' })
  expect(within(review).getByText('2 tablespoons soy sauce')).toBeTruthy()
  expect(within(review).getByText('3 tablespoons vinegar')).toBeTruthy()
  expect(within(review).getByText(salty)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Needed more tang.' }))
  expect(within(review).getByText('¼ cup soy sauce')).toBeTruthy()
  expect(within(review).getByText('4 tablespoons vinegar')).toBeTruthy()
  expect(within(review).getByText('Needed more tang.')).toBeTruthy()
  expect(within(review).queryByText(salty)).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})
