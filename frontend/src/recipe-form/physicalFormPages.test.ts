import { expect, it } from 'vitest'
import { editorState } from './draft'
import { FORM_ROWS_PER_LEAF, formPagePosition, leafAnchorForPage, leafIndexForAnchor, leafKeyForFieldPath, recipeFormLeaves, visibleFormLeafIndices } from './physicalFormPages'
import { recipeFormFixture } from './testing/fixtures'

it('keeps identity first and groups complete ordered rows by section', () => {
  const state = editorState(recipeFormFixture)
  const leaves = recipeFormLeaves(state)
  expect(FORM_ROWS_PER_LEAF).toBe(2)
  expect(leaves.map(({ key }) => key)).toEqual(['identity', 'ingredients:0', 'instructions:0'])
  expect(leaves[1]).toMatchObject({ rowKeys: state.ingredients.map((row) => row.key) })
  expect(leaves[2]).toMatchObject({ rowKeys: state.instructions.map((row) => row.key) })
  expect(leafKeyForFieldPath('ingredients.1.quantity', state)).toBe(`ingredient:${state.ingredients[1].key}`)
  expect(leafKeyForFieldPath('instructions.0.text', state)).toBe(`instruction:${state.instructions[0].key}`)
  expect(leafKeyForFieldPath('title', state)).toBe('identity')
})

it('creates empty section leaves and follows a row across grouped page boundaries', () => {
  const state = editorState({ ...recipeFormFixture, ingredients: [], instructions: [] })
  expect(recipeFormLeaves(state).map(({ key }) => key)).toEqual(['identity', 'ingredients-empty', 'instructions-empty'])

  const withRows = editorState({
    ...recipeFormFixture,
    ingredients: Array.from({ length: 5 }, (_, index) => ({ name: `Item ${index + 1}`, quantity: null, unit: null, inferred: false })),
  })
  const movedKey = withRows.ingredients[2].key
  withRows.ingredients.splice(2, 1)
  withRows.ingredients.splice(3, 0, { ...withRows.ingredients[2], key: movedKey })
  const leaves = recipeFormLeaves(withRows)
  expect(leafIndexForAnchor(leaves, `ingredient:${movedKey}`)).toBe(2)
  expect(leafKeyForFieldPath('ingredients.3.name', withRows)).toBe(`ingredient:${movedKey}`)
  const narrowLeaves = recipeFormLeaves(withRows, true)
  expect(narrowLeaves).toHaveLength(1 + 5 + 2)
  expect(leafIndexForAnchor(narrowLeaves, `ingredient:${movedKey}`)).toBe(4)
  expect(leafAnchorForPage(leaves[2])).toBe(`ingredient:${withRows.ingredients[2].key}`)
})

it('groups facing leaves on desktop and exposes one numbered leaf on narrow layouts', () => {
  expect(visibleFormLeafIndices(0, 5, false)).toEqual([0, 1])
  expect(visibleFormLeafIndices(3, 5, false)).toEqual([2, 3])
  expect(visibleFormLeafIndices(4, 5, false)).toEqual([4])
  expect(visibleFormLeafIndices(3, 5, true)).toEqual([3])
  expect(formPagePosition(3, 5, false)).toMatchObject({ page: 1, total: 3, text: 'Pages 3–4 of 5' })
  expect(formPagePosition(3, 5, true)).toMatchObject({ page: 3, total: 5, text: 'Page 4 of 5' })
})
