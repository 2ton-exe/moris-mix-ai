import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Ingredient } from '../api/demoRecipe'
import type { RecipeDetail } from '../recipes/types'
import type { RecipeEditorState } from '../recipe-form/draft'
import type { ChefReviewHandoff } from './draft'

const ingredientKey = (name: string) => name.trim().toLowerCase()
function amount(quantity: number | string | null, unit: string | null) {
  if (quantity === null || quantity === '') return 'Amount unspecified'
  return [quantity, unit].filter((part) => part !== null && part !== '').join(' ')
}

export function ChefSourceRecipe({ parents, parentId, setParentId, source, unavailable, pending, children }: {
  parents: ChefReviewHandoff['response']['parents']
  parentId: string
  setParentId: (id: string) => void
  source: RecipeDetail | undefined
  unavailable: boolean
  pending: boolean
  children: ReactNode
}) {
  const id = useId()
  const parent = parents.find((entry) => entry.id === parentId)
  if (!parent) return null
  return <section className="mm-chef-review__source" aria-labelledby={id}>
    <h2 id={id} tabIndex={-1}>Original recipe</h2>
    {parents.length > 1 && <>
      <label htmlFor={id + '-choose'}>Recipe to compare</label>
      <select id={id + '-choose'} value={parentId} onChange={(event) => setParentId(event.target.value)}>
        {parents.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
      </select>
    </>}
    <h3>{source?.title ?? parent.title}</h3>
    {pending && <p role="status">Loading the original…</p>}
    {unavailable && <p>The original recipe is unavailable. You can still review this draft.</p>}
    {children}
    {source && <Link to={'/app/recipes/' + encodeURIComponent(source.id)} target="_blank" rel="noopener">Open original in a new tab</Link>}
  </section>
}

function sameAmount(left: Ingredient, right: Ingredient) {
  return left.quantity === right.quantity && left.unit === right.unit && left.quantityText === right.quantityText
}

export function ChefDraftComparison({ handoff, source, edited, editAmount }: {
  handoff: ChefReviewHandoff
  source: RecipeDetail | undefined
  edited: RecipeEditorState | null
  editAmount?: ReactNode
}) {
  const id = useId()
  const { request, response } = handoff
  const { revision } = response
  if (revision) {
    const current = edited?.ingredients.find((entry) => ingredientKey(entry.name) === ingredientKey(revision.ingredient))
    const currentAmount = current ? current.quantityText.trim() || amount(current.quantity, current.unit.trim()) : 'Ingredient removed'
    const proposedAmount = amount(revision.after.quantity, revision.after.unit)
    const changed = edited && currentAmount !== proposedAmount
    return <section className="mm-chef-review__change" aria-labelledby={id}>
      <h3 id={id}>Mori’s proposed change</h3>
      <p className="mm-chef-review__changed-ingredient">{revision.ingredient}</p>
      <dl className="mm-chef-review__amounts">
        <div><dt>Original amount</dt><dd>{amount(revision.before.quantity, revision.before.unit)}</dd></div>
        <div><dt>Mori’s suggestion</dt><dd>{proposedAmount}</dd></div>
      </dl>
      {changed && <p><strong>Your edited amount</strong> · {currentAmount}</p>}
      <div>
        <p className="mm-chef-review__note-label">Your Personal Note</p>
        <blockquote>{revision.noteExcerpt}</blockquote>
      </div>
      <p>{revision.reason}</p>
      {editAmount}
    </section>
  }

  if (!('pantryItems' in request)) return null
  const draft = response.recipe.ingredients
  const pantry = new Set(request.pantryItems.map(ingredientKey))
  const matches = [...new Set(draft.filter((entry) => pantry.has(ingredientKey(entry.name))).map((entry) => entry.name))]
  const original = source?.ingredients ?? []
  const originalNames = new Set(original.map((entry) => ingredientKey(entry.name)))
  const draftNames = new Set(draft.map((entry) => ingredientKey(entry.name)))
  const added = draft.find((entry) => !originalNames.has(ingredientKey(entry.name)))
  const removed = original.find((entry) => !draftNames.has(ingredientKey(entry.name)))
  const repeatedNames = originalNames.size !== original.length || draftNames.size !== draft.length
  const adjusted = repeatedNames ? undefined : draft.flatMap((entry) => {
    const item = original.find((originalEntry) => ingredientKey(originalEntry.name) === ingredientKey(entry.name))
    return item && !sameAmount(item, entry) ? [{ original: item, draft: entry }] : []
  })[0]
  const changedDirections = source && (source.instructions.length !== response.recipe.instructions.length ||
    source.instructions.some((step, index) => step.text !== response.recipe.instructions[index]?.text))
  return <section className="mm-chef-review__change" aria-labelledby={id}>
    <h2 id={id} tabIndex={-1}>{response.parents.length ? 'What changed in Mori’s draft' : 'From your pantry'}</h2>
    {matches.length > 0 && <p><strong>Uses from your pantry</strong> · {matches.join(', ')}</p>}
    {source && added && <p><strong>Added</strong> · {added.name}</p>}
    {source && !added && removed && <p><strong>Omitted</strong> · {removed.name}</p>}
    {source && !added && !removed && adjusted && <p><strong>{adjusted.draft.name}</strong> · {
      adjusted.original.quantityText || amount(adjusted.original.quantity, adjusted.original.unit)} → {
      adjusted.draft.quantityText || amount(adjusted.draft.quantity, adjusted.draft.unit)}</p>}
    {source && !added && !removed && !adjusted && <p>{changedDirections
      ? 'Mori revised the cooking instructions.'
      : repeatedNames ? 'Open the original to compare repeated ingredients.' : 'The ingredients and instructions match the original.'}</p>}
    {!source && !response.parents.length && <p>This draft starts with your pantry request.</p>}
  </section>
}
