import { expect, it } from 'vitest'
import { editorState } from './draft'
import { FORM_ROWS_PER_LEAF, formPagePosition, formTextRows, leafAnchorForPage, leafIndexForAnchor, leafKeyForFieldPath, recipeFormLeaves, splitFormText, splitIdentityNotes, splitInstructionText, visibleFormLeafIndices } from './physicalFormPages'
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
  expect(leafKeyForFieldPath('notes', state)).toBe('identity')
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

  const desktopLeaves = recipeFormLeaves(withRows, false, null, false, true)
  const desktopIngredientLeaves = desktopLeaves.filter(({ kind }) => kind === 'ingredients')
  expect(desktopIngredientLeaves).toHaveLength(2)
  expect(desktopIngredientLeaves[0]).toMatchObject({ rowKeys: withRows.ingredients.slice(0, 4).map(({ key }) => key) })
  expect(desktopIngredientLeaves[1]).toMatchObject({ rowKeys: withRows.ingredients.slice(4).map(({ key }) => key) })

  const shortDesktop = recipeFormLeaves(withRows, false, null, true, true, undefined, undefined, undefined, { compactIngredientRows: 2 })
  expect(shortDesktop.filter(({ kind }) => kind === 'ingredients')).toMatchObject([
    { rowKeys: withRows.ingredients.slice(0, 2).map(({ key }) => key) },
    { rowKeys: withRows.ingredients.slice(2, 4).map(({ key }) => key) },
    { rowKeys: withRows.ingredients.slice(4).map(({ key }) => key) },
  ])
  expect(shortDesktop.filter(({ kind }) => kind === 'instructions')).toMatchObject(
    [{ rowKeys: withRows.instructions.map(({ key }) => key) }],
  )
  expect(leafIndexForAnchor(shortDesktop, `ingredient:${movedKey}`)).toBe(2)

  const withLongName = { ...withRows, ingredients: withRows.ingredients.map((row, index) => index === 2 ? { ...row, name: 'Long'.repeat(50) } : row) }
  expect(recipeFormLeaves(withLongName, false, null, true, true, undefined, undefined, undefined, { compactIngredientRows: 2 })
    .filter(({ kind }) => kind === 'ingredients')).toMatchObject([
    { rowKeys: withRows.ingredients.slice(0, 2).map(({ key }) => key) },
    { rowKeys: [withRows.ingredients[2].key] },
    { rowKeys: withRows.ingredients.slice(3).map(({ key }) => key) },
  ])
})

it('groups facing leaves on desktop and exposes one numbered leaf on narrow layouts', () => {
  expect(visibleFormLeafIndices(0, 5, false)).toEqual([0, 1])
  expect(visibleFormLeafIndices(3, 5, false)).toEqual([2, 3])
  expect(visibleFormLeafIndices(4, 5, false)).toEqual([4])
  expect(visibleFormLeafIndices(3, 5, true)).toEqual([3])
  expect(formPagePosition(3, 5, false)).toMatchObject({ page: 1, total: 3, text: 'Pages 3–4 of 5' })
  expect(formPagePosition(3, 5, true)).toMatchObject({ page: 3, total: 5, text: 'Page 4 of 5' })
})

it('keeps long notes and instruction text intact across writing leaves', () => {
  const notes = 'Keep every line.\n'.repeat(100)
  const instruction = 'Stir gently, then wait. '.repeat(70)
  const state = editorState({ ...recipeFormFixture, notes, instructions: [{ step: 1, text: instruction }] })
  const leaves = recipeFormLeaves(state, false, null, false, false, 300, 12, 40)
  const noteLeaves = leaves.filter((leaf) => leaf.kind === 'notes')
  const instructionLeaves = leaves.filter((leaf) => leaf.kind === 'instructions')
  expect(noteLeaves.length).toBeGreaterThan(5)
  expect(leaves.indexOf(noteLeaves[0])).toBe(1)
  expect(instructionLeaves).toHaveLength(6)
  const noteParts = splitIdentityNotes(notes, 300, 12, 40)
  const instructionParts = splitInstructionText(instruction, 300, 12, 40)
  expect(noteParts.every((part) => formTextRows(part, 40) <= 12)).toBe(true)
  expect(instructionParts[0].length).toBeLessThanOrEqual(300)
  expect(formTextRows(instructionParts[0], 40)).toBeLessThanOrEqual(8)
  expect(instructionParts.slice(1).every((part) => formTextRows(part, 40) <= 10)).toBe(true)
  expect(noteParts.join('')).toBe(notes)
  expect(instructionParts.join('')).toBe(instruction)
  expect(splitFormText('😀a', 1)).toEqual(['😀', 'a'])
  expect(leafIndexForAnchor(leaves, 'notes:0')).toBe(0)
  expect(leafIndexForAnchor(leaves, 'notes:5')).toBe(leaves.indexOf(noteLeaves[4]))
  expect(leafIndexForAnchor(recipeFormLeaves(editorState(recipeFormFixture)), 'notes:1')).toBe(0)
  expect(leafIndexForAnchor(leaves, 'instruction:' + state.instructions[0].key + ':part:5')).toBe(leaves.indexOf(instructionLeaves[5]))
  expect(leafKeyForFieldPath('notes', state)).toBe('identity')
})

it.each([223, 224, 225, 226])('splits emoji near the row boundary after %i ASCII characters', (length) => {
  const text = 'a'.repeat(length) + '😀😀'
  const parts = splitFormText(text, 600, 4, 56)
  expect(parts.join('')).toBe(text)
  expect(parts.length).toBeGreaterThan(1)
  for (const part of parts) {
    expect(part.length).toBeGreaterThan(0)
    expect(formTextRows(part, 56)).toBeLessThanOrEqual(4)
    expect(part).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
  }
})

it('packs three short desktop steps while keeping long continuations intact', () => {
  const state = editorState({ ...recipeFormFixture, instructions: Array.from({ length: 4 }, (_, index) => ({ step: index + 1, text: 'Stir gently.' })) })
  const pages = recipeFormLeaves(state, false, null, true, true, 600, 8, 40)
  expect(pages.filter(({ kind }) => kind === 'instructions').map(leaf => 'rowKeys' in leaf && leaf.rowKeys.length)).toEqual([3, 1])
  expect(recipeFormLeaves(state, true).filter(({ kind }) => kind === 'instructions')).toHaveLength(4)
  state.instructions[1].text = 'Keep stirring slowly. '.repeat(60)
  const longPages = recipeFormLeaves(state, false, null, true, true, 600, 8, 40)
  expect(longPages.filter(leaf => leaf.kind === 'instructions' && leaf.rowKeys.includes(state.instructions[1].key)).every(leaf => 'rowKeys' in leaf && leaf.rowKeys.length === 1)).toBe(true)
})
