import { expect, it } from 'vitest'
import { editorState, findOriginalIngredientIndex, moveRow, recipeDraftSchema, recipeEditorStateSchema, validateEditor } from './draft'
import { recipeFormFixture } from './testing/fixtures'

it('keeps the revised ingredient identity through duplicate names, reordering and draft storage', () => {
  const state = editorState({ ...recipeFormFixture, ingredients: [
    { name: 'soy sauce', quantity: 1, unit: 'tbsp', inferred: false },
    { name: 'soy sauce', quantity: 2, unit: 'tbsp', inferred: false },
  ] })
  state.ingredients = moveRow(state.ingredients, 1, -1)
  const restored = recipeEditorStateSchema.parse(JSON.parse(JSON.stringify(state)))
  expect(findOriginalIngredientIndex(restored.ingredients, 'soy sauce', 1)).toBe(0)
  expect(findOriginalIngredientIndex(restored.ingredients, 'soy sauce')).toBe(-1)
  restored.ingredients.splice(0, 1)
  expect(findOriginalIngredientIndex(restored.ingredients, 'soy sauce', 1)).toBe(-1)
  expect(findOriginalIngredientIndex(restored.ingredients, 'soy sauce')).toBe(0)
  const draft = validateEditor(restored)
  if (!draft.success) throw new Error('Fixture must remain a valid recipe')
  expect(draft.data.ingredients[0]).not.toHaveProperty('originalIndex')
})

it('normalizes editor fields and preserves nullable quantities and inferred metadata', () => {
  const state = editorState(recipeFormFixture)
  state.title = '  Ginger rice  '
  state.ingredients[0].name = ' rice '
  state.ingredients[0].quantity = '0.5'
  state.ingredients[0].unit = ' cups '
  const result = validateEditor(state)
  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.title).toBe('Ginger rice')
  expect(result.data.ingredients[0]).toMatchObject({ name: 'rice', quantity: 0.5, unit: 'cup' })
  expect(result.data.ingredients[1]).toMatchObject({ quantity: null, unit: null, inferred: true, quantityText: 'A small piece' })
})

it.each(['many', '0', '1/0', 'Infinity', 'NaN', '0x10', '1e999', '-2'])('rejects an invalid numeric quantity: %s', (quantity) => {
  const state = editorState(recipeFormFixture)
  state.ingredients[0].quantity = quantity
  const result = validateEditor(state)
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues[0].path).toEqual(['ingredients', 0, 'quantity'])
})

it.each(['1/2', '1 1/2', '½', '.5', '2.5', '1e2', ''])('accepts positive fractional, decimal or blank quantity: %s', (quantity) => {
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

it('honors the recipe API text and collection limits', () => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, ingredients: [], instructions: [], notes: '' }).success).toBe(true)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, instructions: [{ step: 1, text: '' }] }).success).toBe(true)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, title: 'a'.repeat(200), notes: 'n'.repeat(20000) }).success).toBe(true)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, ingredients: Array(101).fill(recipeFormFixture.ingredients[0]) }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, instructions: Array(101).fill(recipeFormFixture.instructions[0]) }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, title: 'a'.repeat(201) }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, notes: 'n'.repeat(20001) }).success).toBe(false)
})

it('rejects a blank title and malformed nested values', () => {
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, title: '  ' }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, ingredients: [{ name: 'rice', quantity: {}, unit: null }] }).success).toBe(false)
  expect(recipeDraftSchema.safeParse({ ...recipeFormFixture, notes: {} }).success).toBe(false)
})


it('keeps overridden structured values through save and edit and restores them when the description is removed', () => {
  const state = editorState(recipeFormFixture)
  state.ingredients[0].quantity = '1/2'
  state.ingredients[0].unit = 'tablespoons'
  state.ingredients[0].quantityText = 'as needed'
  const saved = validateEditor(state)
  expect(saved.success).toBe(true)
  if (!saved.success) return
  expect(saved.data.ingredients[0]).toMatchObject({ quantity: 0.5, unit: 'tbsp', quantityText: 'as needed' })
  const edited = editorState(saved.data)
  expect(edited.ingredients[0]).toMatchObject({ quantity: '0.5', unit: 'tbsp', quantityText: 'as needed' })
  edited.ingredients[0].quantityText = ''
  const restored = validateEditor(edited)
  expect(restored.success).toBe(true)
  if (!restored.success) return
  expect(restored.data.ingredients[0]).toMatchObject({ quantity: 0.5, unit: 'tbsp' })
  expect(restored.data.ingredients[0]).not.toHaveProperty('quantityText')
})

it('accepts a description-only ingredient and rejects malformed custom units', () => {
  const state = editorState(recipeFormFixture)
  state.ingredients[0].quantity = ''
  state.ingredients[0].unit = ''
  state.ingredients[0].quantityText = 'to taste'
  expect(validateEditor(state)).toMatchObject({ success: true, data: { ingredients: [
    { quantity: null, unit: null, quantityText: 'to taste' }, expect.anything(),
  ] } })
  for (const unit of ['x'.repeat(101), 'mug\nfull']) {
    state.ingredients[0].unit = unit
    const invalid = validateEditor(state)
    expect(invalid.success).toBe(false)
    if (!invalid.success) expect(invalid.error.issues[0].path).toEqual(['ingredients', 0, 'unit'])
  }
})
