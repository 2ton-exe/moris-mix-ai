import { expect, it } from 'vitest'
import { editorState, moveRow, recipeDraftSchema, validateEditor } from './draft'
import { recipeFormFixture } from './testing/fixtures'

it('normalizes editor fields and preserves nullable quantities and inferred metadata', () => {
  const state = editorState(recipeFormFixture)
  state.title = '  Ginger rice  '
  state.ingredients[0].name = ' rice '
  state.ingredients[0].quantity = '0'
  state.ingredients[0].unit = ' cups '
  const result = validateEditor(state)
  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.title).toBe('Ginger rice')
  expect(result.data.ingredients[0]).toMatchObject({ name: 'rice', quantity: 0, unit: 'cups' })
  expect(result.data.ingredients[1]).toMatchObject({ quantity: null, unit: null, inferred: true, quantityText: 'A small piece' })
})

it.each(['many', '1/2', 'Infinity', 'NaN', '0x10', '1e999'])('rejects an invalid numeric quantity: %s', (quantity) => {
  const state = editorState(recipeFormFixture)
  state.ingredients[0].quantity = quantity
  const result = validateEditor(state)
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues[0].path).toEqual(['ingredients', 0, 'quantity'])
})

it.each(['0', '-2', '.5', '2.5', '1e2', ''])('accepts finite or blank quantity without inventing bounds: %s', (quantity) => {
  const state = editorState(recipeFormFixture)
  state.ingredients[0].quantity = quantity
  expect(validateEditor(state).success).toBe(true)
})

it.each([-1, 0, 6, 1.5, NaN])('rejects unsupported rating %s', (star_rating) => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, star_rating }).success).toBe(false)
})

it.each([null, 1, 2, 3, 4, 5])('accepts the shared nullable rating scale: %s', (star_rating) => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, star_rating }).success).toBe(true)
})

it.each(['2026-02-30', '2026-13-01', '2026-01-00', '19/10/2026', '2026-10-19T00:00:00Z'])('rejects invalid calendar date %s', (cooked_at) => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, cooked_at }).success).toBe(false)
})

it('preserves calendar dates and multiline notes without timezone conversions', () => {
  const state = editorState(recipeFormFixture)
  expect(validateEditor(state)).toMatchObject({ success: true, data: { cooked_at: '2026-10-19', notes: recipeFormFixture.notes } })
  state.cookedDate = ''
  state.rating = ''
  expect(validateEditor(state)).toMatchObject({ success: true, data: { cooked_at: null, star_rating: null } })
})

it('keeps stable row identities and regenerates contiguous step numbers after edits', () => {
  const state = editorState(recipeFormFixture)
  const first = state.instructions[0]
  state.instructions = moveRow(state.instructions, 0, 1)
  expect(state.instructions[1]).toBe(first)
  expect(validateEditor(state)).toMatchObject({ success: true, data: { instructions: [
    { step: 1, text: recipeFormFixture.instructions[1].text }, { step: 2, text: recipeFormFixture.instructions[0].text },
  ] } })
})

it('honors shared empty arrays/text and has no invented text-length caps', () => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, ingredients: [], instructions: [], notes: '' }).success).toBe(true)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, instructions: [{ step: 1, text: '' }] }).success).toBe(true)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, title: 'a'.repeat(2000), notes: 'n'.repeat(20000) }).success).toBe(true)
})

it('rejects a blank title and malformed nested values', () => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, title: '  ' }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, ingredients: [{ name: 'rice', quantity: {}, unit: null }] }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, notes: {} }).success).toBe(false)
})
