import type { RecipeEditorState } from './draft'

export const FORM_ROWS_PER_LEAF = 2
export const DEFAULT_FORM_TEXT_CHARS_PER_LEAF = 600

export function replaceFormTextPart(parts: string[], index: number, value: string) {
  return [...parts.slice(0, index), value, ...parts.slice(index + 1)].join('')
}

export function formTextRows(text: string, columns = Number.POSITIVE_INFINITY) {
  const charsPerRow = columns > 0 ? columns : 1
  return text.split(/\r\n|\r|\n/).reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length / charsPerRow)), 0)
}

export function splitFormText(text: string, limit = DEFAULT_FORM_TEXT_CHARS_PER_LEAF, maxRows = Number.POSITIVE_INFINITY, columns = Number.POSITIVE_INFINITY): string[] {
  if (!text) return ['']
  if (!Number.isFinite(limit) || limit < 1) return [text]
  const rows = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : Number.POSITIVE_INFINITY
  if (text.length <= limit && formTextRows(text, columns) <= rows) return [text]
  const parts: string[] = []
  let offset = 0
  while (offset < text.length) {
    let end = Math.min(offset + limit, text.length)
    if (end < text.length && end > offset && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end++
    if (formTextRows(text.slice(offset, end), columns) > rows) {
      let low = offset + 1
      let high = end
      while (low < high) {
        const midpoint = Math.ceil((low + high) / 2)
        let middle = midpoint
        if (middle < text.length && /[\uD800-\uDBFF]/.test(text[middle - 1]) && /[\uDC00-\uDFFF]/.test(text[middle])) middle++
        if (formTextRows(text.slice(offset, middle), columns) <= rows) low = midpoint
        else high = midpoint - 1
      }
      end = low
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end++
    }
    if (end === text.length) {
      parts.push(text.slice(offset))
      break
    }
    const candidate = text.slice(offset, end)
    const boundary = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'), candidate.lastIndexOf('\t'))
    const cut = boundary >= Math.floor(limit * .6) ? offset + boundary + 1 : end
    parts.push(text.slice(offset, cut))
    offset = cut
  }
  return parts
}

export function splitIdentityNotes(text: string, limit: number, maxRows: number, columns: number) {
  const [first = '', ...rest] = splitFormText(text, limit, Math.min(4, maxRows), columns)
  return [first, ...splitFormText(rest.join(''), limit, maxRows, columns).filter(Boolean)]
}

export function splitInstructionText(text: string, limit: number, maxRows: number, columns: number) {
  const [first = '', ...rest] = splitFormText(text, limit, Math.max(1, maxRows - 4), columns)
  return [first, ...splitFormText(rest.join(''), limit, Math.max(1, maxRows - 2), columns).filter(Boolean)]
}

export function formTextPageLimit(width: number, height: number, fontSize = 16) {
  if (width <= 0 || height <= 0 || fontSize <= 0) return DEFAULT_FORM_TEXT_CHARS_PER_LEAF
  return Math.max(80, Math.min(1_600, Math.floor(width * Math.max(80, height - 170) / (fontSize * fontSize * 1.2))))
}

export function formTextPageRows(height: number) {
  return height <= 0 ? 12 : Math.max(3, Math.floor((height - 190) / 32))
}

export function formTextPageColumns(width: number, fontSize = 16) {
  return width <= 0 || fontSize <= 0 ? 56 : Math.max(1, Math.floor(width / (fontSize * .56)))
}

export type RecipeFormLeaf =
  | { key: 'identity'; kind: 'identity' }
  | { key: 'supplement'; kind: 'supplement' }
  | { key: `notes:${number}`; kind: 'notes'; part: number }
  | { key: 'review:0'; kind: 'review'; title: string }
  | { key: 'ingredients-empty'; kind: 'ingredients-empty'; rowKeys: [] }
  | { key: `ingredients:${number}`; kind: 'ingredients'; rowKeys: string[] }
  | { key: 'instructions-empty'; kind: 'instructions-empty'; rowKeys: [] }
  | { key: `instructions:${number}`; kind: 'instructions'; rowKeys: string[]; textParts: { rowKey: string; part: number }[] }

function ingredientLeaves(rows: { key: string }[], groupSize: number): RecipeFormLeaf[] {
  if (!rows.length) return [{ key: 'ingredients-empty', kind: 'ingredients-empty', rowKeys: [] }]
  return Array.from({ length: Math.ceil(rows.length / groupSize) }, (_, page) => ({
    key: `ingredients:${page}` as const,
    kind: 'ingredients' as const,
    rowKeys: rows.slice(page * groupSize, (page + 1) * groupSize).map((row) => row.key),
  }))
}

/** Keep identity fixed and group rows only when the paper can fit them. */
export function recipeFormLeaves(state: RecipeEditorState, single = false, reviewTitle: string | null = null, compact = false, desktop = false, textPageLength = DEFAULT_FORM_TEXT_CHARS_PER_LEAF, textPageRows = Number.POSITIVE_INFINITY, textPageColumns = Number.POSITIVE_INFINITY, expandedNotes = false): RecipeFormLeaf[] {
  const groupSize = single || compact ? 1 : desktop ? FORM_ROWS_PER_LEAF * 2 : FORM_ROWS_PER_LEAF
  const instructionGroupSize = single || compact ? 1 : FORM_ROWS_PER_LEAF
  const instructionTextRows = Math.max(1, textPageRows - instructionGroupSize * 4)
  const noteParts = reviewTitle === null && !expandedNotes ? splitIdentityNotes(state.notes, textPageLength, textPageRows, textPageColumns) : []
  const instructionLeaves: RecipeFormLeaf[] = []
  for (const row of state.instructions) {
    const parts = splitInstructionText(row.text, textPageLength, textPageRows, textPageColumns)
    for (const [part] of parts.entries()) {
      const previous = instructionLeaves.at(-1)
      const previousLength = previous?.kind === 'instructions' ? previous.textParts.reduce((sum, item) => sum + (state.instructions.find((candidate) => candidate.key === item.rowKey)?.text.length ?? 0), 0) : Infinity
      const previousRows = previous?.kind === 'instructions' ? previous.rowKeys.reduce((sum, key) => sum + formTextRows(state.instructions.find((candidate) => candidate.key === key)?.text ?? '', textPageColumns), 0) : Infinity
      const rowRows = formTextRows(row.text, textPageColumns)
      if (part === 0 && parts.length === 1 && previous?.kind === 'instructions' && previous.textParts.every((item) => item.part === 0) && previous.rowKeys.length < instructionGroupSize && previousLength + row.text.length <= textPageLength && previousRows + rowRows <= instructionTextRows) {
        instructionLeaves[instructionLeaves.length - 1] = { ...previous, rowKeys: [...previous.rowKeys, row.key], textParts: [...previous.textParts, { rowKey: row.key, part }] }
      } else instructionLeaves.push({ key: `instructions:${instructionLeaves.length}`, kind: 'instructions', rowKeys: [row.key], textParts: [{ rowKey: row.key, part }] })
    }
  }
  const instructionPages: RecipeFormLeaf[] = instructionLeaves.length ? instructionLeaves : [{ key: 'instructions-empty', kind: 'instructions-empty', rowKeys: [] }]
  return [
    { key: 'identity', kind: 'identity' },
    ...noteParts.slice(1).map((_, index): RecipeFormLeaf => {
      const part = index + 1
      return { key: `notes:${part}`, kind: 'notes', part }
    }),
    ...(reviewTitle === null ? [] : [{ key: 'review:0', kind: 'review', title: reviewTitle } satisfies RecipeFormLeaf]),
    ...ingredientLeaves(state.ingredients, groupSize),
    ...instructionPages,
  ]
}

/** Resolve a Zod or server field path to its stable row anchor. */
export function leafKeyForFieldPath(path: string, state: RecipeEditorState): RecipeFormLeaf['key'] | `ingredient:${string}` | `instruction:${string}` {
  if (path === 'notes') return 'identity'
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
  const instructionKey = /^instruction:([^:]+)(?::part:(\d+))?$/.exec(anchor)
  const noteAnchor = /^notes:(\d+)$/.exec(anchor)
  const index = leaves.findIndex((leaf) => leaf.key === anchor || ('rowKeys' in leaf && leaf.rowKeys.some((key) => anchor === `ingredient:${key}` || instructionKey?.[1] === key && (instructionKey[2] === undefined || leaf.kind === 'instructions' && leaf.textParts.some((part) => part.rowKey === key && part.part === Number(instructionKey[2]))))))
  if (index < 0 && noteAnchor) {
    const identityIndex = leaves.findIndex((leaf) => leaf.kind === 'identity')
    const notesIndex = leaves.findIndex((leaf) => leaf.kind === 'notes')
    return noteAnchor[1] === '0' || notesIndex < 0 ? identityIndex : notesIndex
  }
  if (index < 0 && instructionKey) return leaves.findIndex((leaf) => leaf.kind === 'instructions' && leaf.rowKeys.includes(instructionKey[1]))
  return index < 0 ? 0 : index
}

export function leafAnchorForPage(leaf: RecipeFormLeaf): string {
  if (leaf.kind === 'ingredients') return `ingredient:${leaf.rowKeys[0]}`
  if (leaf.kind === 'instructions') {
    const first = leaf.textParts[0]
    return `instruction:${first.rowKey}:part:${first.part}`
  }
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

export function recipeFormSection(leaf: RecipeFormLeaf) {
  if (leaf.kind === 'supplement') return 'Recipe image'
  if (leaf.kind === 'identity') return 'Recipe details'
  if (leaf.kind === 'notes') return 'Personal notes'
  if (leaf.kind === 'review') return leaf.title
  return leaf.kind.startsWith('ingredient') ? 'Ingredients' : 'Instructions'
}
