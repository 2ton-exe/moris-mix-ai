import { expect, it } from 'vitest'
import { HttpError } from '../api/http'
import { retryRecipeQuery } from './queryOptions'
import { RecipeIntegrationUnavailable } from './source'

it.each([401, 403, 404, 400, 422])('never automatically retries HTTP %s', (status) => {
  expect(retryRecipeQuery(0, new HttpError('http', 'Request failed', status))).toBe(false)
})

it.each([408, 429, 500, 502, 503])('bounds retryable HTTP %s to two retries', (status) => {
  const error = new HttpError('http', 'Request failed', status)
  expect(retryRecipeQuery(0, error)).toBe(true)
  expect(retryRecipeQuery(1, error)).toBe(true)
  expect(retryRecipeQuery(2, error)).toBe(false)
})

it('retries network failures but not configuration, parsing, or integration errors', () => {
  expect(retryRecipeQuery(0, new HttpError('network', 'Offline'))).toBe(true)
  expect(retryRecipeQuery(2, new HttpError('network', 'Offline'))).toBe(false)
  for (const error of [new HttpError('configuration', 'Missing config'), new HttpError('invalid-json', 'Invalid response'), new RecipeIntegrationUnavailable(), new Error('Invalid contract')]) {
    expect(retryRecipeQuery(0, error)).toBe(false)
  }
})
