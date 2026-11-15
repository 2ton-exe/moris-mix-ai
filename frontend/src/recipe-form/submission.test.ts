import { expect, it } from 'vitest'
import { HttpError } from '../api/http'
import { InvalidRecipeData } from '../recipes/validation'
import { RecipeSubmissionError, submissionMessage } from './submission'

it.each([
  new HttpError('network', 'private network details'),
  new HttpError('http', 'private server details', 503),
  new HttpError('invalid-json', 'private response', 201),
  new InvalidRecipeData(),
  new Error('private unknown failure'),
])('reports uncertain writes without encouraging a blind create retry', (error) => {
  const message = submissionMessage(error)
  expect(message).toContain('Could not confirm whether your recipe was saved')
  expect(message).toContain('Check your journal before retrying')
  expect(message).not.toContain('private')
  expect(message).not.toContain('nothing has been saved')
})

it('distinguishes conflicts, rate limits, and failures before submission', () => {
  expect(submissionMessage(new HttpError('http', 'private', 409))).toContain('conflicts')
  expect(submissionMessage(new HttpError('http', 'private', 429, undefined, '60'))).toContain('Wait at least 1 minute')
  expect(submissionMessage(new RecipeSubmissionError('unavailable'))).toContain('nothing has been saved')
  expect(submissionMessage(new HttpError('http', 'private', 401))).toContain('Sign in again')
})
