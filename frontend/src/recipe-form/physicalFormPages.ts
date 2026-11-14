import type { RecipeEditorState } from './draft'

export const FORM_ROWS_PER_LEAF = 2

export type RecipeFormLeaf =
  | { key: 'identity'; kind: 'identity' }
  | { key: 'ingredients-empty'; kind: 'ingredients-empty'; rowKeys: [] }
  | { key: `ingredients:${number}`; kind: 'ingredients'; rowKeys: string[] }
  | { key: 'instructions-empty'; kind: 'instructions-empty'; rowKeys: [] }
  | { key: `instructions:${number}`; kind: 'instructions'; rowKeys: string[] }

function sectionLeaves(rows: { key: string }[], kind: 'ingredients' | 'instructions', groupSize: number): RecipeFormLeaf[] {
  if (kind === 'ingredients') {
    if (!rows.length) return [{ key: 'ingredients-empty', kind: 'ingredients-empty', rowKeys: [] }]
    return Array.from({ length: Math.ceil(rows.length / groupSize) }, (_, page) => ({
      key: `ingredients:${page}` as const,
      kind: 'ingredients' as const,
      rowKeys: rows.slice(page * groupSize, (page + 1) * groupSize).map((row) => row.key),
    }))
  }
  if (!rows.length) return [{ key: 'instructions-empty', kind: 'instructions-empty', rowKeys: [] }]
  return Array.from({ length: Math.ceil(rows.length / groupSize) }, (_, page) => ({
    key: `instructions:${page}` as const,
    kind: 'instructions' as const,
    rowKeys: rows.slice(page * groupSize, (page + 1) * groupSize).map((row) => row.key),
  }))
}

/** Keep identity fixed; wide leaves group two rows while single-page layouts give each row its own leaf. */
export function recipeFormLeaves(state: RecipeEditorState, single = false): RecipeFormLeaf[] {
  const groupSize = single ? 1 : FORM_ROWS_PER_LEAF
  return [
    { key: 'identity', kind: 'identity' },
    ...sectionLeaves(state.ingredients, 'ingredients', groupSize),
    ...sectionLeaves(state.instructions, 'instructions', groupSize),
  ]
}

/** Resolve a Zod or server field path to its stable row anchor. */
export function leafKeyForFieldPath(path: string, state: RecipeEditorState): RecipeFormLeaf['key'] | `ingredient:${string}` | `instruction:${string}` {
  const ingredient = /^ingredients\.(\d+)\./.exec(path)
  if (ingredient) {
    const row = state.ingredients[Number(ingredient[1])]
    return row ? `ingredient:${row.key}` : 'identity'
  }
  const instruction = /^instructions\.(\d+)\./.exec(path)
  if (instruction) {
    const row = state.instructions[Number(instruction[1])]
    return row ? `instruction:${row.key}` : 'identity'
  }
  return 'identity'
}

export function leafIndexForAnchor(leaves: RecipeFormLeaf[], anchor: string) {
  const index = leaves.findIndex((leaf) => leaf.key === anchor || ('rowKeys' in leaf && leaf.rowKeys.some((key) => anchor === `ingredient:${key}` || anchor === `instruction:${key}`)))
  return index < 0 ? 0 : index
}

export function leafAnchorForPage(leaf: RecipeFormLeaf): string {
  if (leaf.kind === 'ingredients') return `ingredient:${leaf.rowKeys[0]}`
  if (leaf.kind === 'instructions') return `instruction:${leaf.rowKeys[0]}`
  return leaf.key
}

export function visibleFormLeafIndices(pageIndex: number, leafCount: number, single: boolean) {
  if (single) return [Math.max(0, Math.min(pageIndex, leafCount - 1))]
  const first = Math.floor(pageIndex / 2) * 2
  return [first, ...(first + 1 < leafCount ? [first + 1] : [])]
}

export function formPagePosition(pageIndex: number, leafCount: number, single: boolean) {
  if (single) return { page: pageIndex, total: leafCount, text: `Page ${pageIndex + 1} of ${leafCount}` }
  const first = Math.floor(pageIndex / 2) * 2
  const last = Math.min(first + 1, leafCount - 1)
  return {
    page: Math.floor(pageIndex / 2),
    total: Math.ceil(leafCount / 2),
    text: first === last ? `Page ${first + 1} of ${leafCount}` : `Pages ${first + 1}–${last + 1} of ${leafCount}`,
  }
}
