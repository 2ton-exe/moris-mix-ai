import { z } from 'zod'
import { parseIngredientQuantity } from '../../../supabase/functions/_shared/ingredient-units.ts'
import type { Instruction } from '../api/demoRecipe'
import { ingredientInputSchema } from '../api/ingredient'

const instructionSchema = z.object({ step: z.number().finite(), text: z.string().min(1, 'Enter a cooking step.').max(2_000) }) satisfies z.ZodType<Instruction>

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export const recipeDraftSchema = z.object({
  title: z.string().trim().min(1, 'Enter a recipe title.').max(200),
  ingredients: z.array(ingredientInputSchema).max(100),
  instructions: z.array(instructionSchema).max(100),
  star_rating: z.number().int().min(1).max(5).nullable(),
  cooked_at: z.string().refine(calendarDate, 'Enter a valid calendar date.').nullable(),
  notes: z.string().max(20_000).default(''),
})
// Load legacy values unchanged; saving still validates against the write schema.
export const recipeInitialDraftSchema = recipeDraftSchema.extend({
  ingredients: z.array(ingredientInputSchema.extend({
    quantity: z.number().finite().nonnegative().nullable().default(null),
    unit: z.string().nullable().default(null),
  })).max(100),
})
export type RecipeDraft = z.infer<typeof recipeDraftSchema>
export type RecipeDraftInput = z.input<typeof recipeDraftSchema>

export interface IngredientRow {
  key: string
  originalIndex?: number
  name: string
  quantity: string
  unit: string
  quantityText: string
  inferred: boolean
}
export interface StepRow { key: string; text: string }
export interface RecipeEditorState {
  title: string
  ingredients: IngredientRow[]
  instructions: StepRow[]
  rating: string
  cookedDate: string
  notes: string
}

export const recipeEditorStateSchema = z.object({
  title: z.string().max(200),
  ingredients: z.array(z.object({
    key: z.string().min(1), originalIndex: z.number().int().min(0).max(99).optional(), name: z.string().max(200), quantity: z.string(), unit: z.string().max(100), quantityText: z.string().max(200), inferred: z.boolean(),
  })).max(100),
  instructions: z.array(z.object({ key: z.string().min(1), text: z.string().max(2_000) })).max(100),
  rating: z.string(),
  cookedDate: z.string(),
  notes: z.string().max(20_000),
}) satisfies z.ZodType<RecipeEditorState>

export const emptyRecipeDraft = (): RecipeDraft => ({
  title: '', ingredients: [], instructions: [], star_rating: null, cooked_at: null, notes: '',
})

export function editorState(draft: RecipeDraft): RecipeEditorState {
  return {
    title: draft.title,
    ingredients: draft.ingredients.map((item, originalIndex) => ({
      key: crypto.randomUUID(), originalIndex, name: item.name, quantity: item.quantity === null ? '' : String(item.quantity),
      unit: item.unit ?? '', quantityText: item.quantityText ?? '', inferred: item.inferred,
    })),
    instructions: [...draft.instructions].sort((a, b) => a.step - b.step)
      .map((item) => ({ key: crypto.randomUUID(), text: item.text })),
    rating: draft.star_rating === null ? '' : String(draft.star_rating),
    cookedDate: draft.cooked_at ?? '', notes: draft.notes,
  }
}

export function findOriginalIngredientIndex(rows: IngredientRow[], name: string, originalIndex?: number): number {
  if (originalIndex !== undefined) return rows.findIndex(row => row.originalIndex === originalIndex)
  const matches = rows.flatMap((row, index) => row.name.trim().toLowerCase() === name.trim().toLowerCase() ? [index] : [])
  return matches.length === 1 ? matches[0] : -1
}

export function validateEditor(state: RecipeEditorState) {
  return recipeDraftSchema.safeParse({
    title: state.title,
    ingredients: state.ingredients.map((item) => ({
      name: item.name, quantity: parseIngredientQuantity(item.quantity), unit: item.unit.trim() || null,
      ...(item.quantityText.trim() ? { quantityText: item.quantityText.trim() } : {}), inferred: item.inferred,
    })),
    instructions: state.instructions.map((item, index) => ({ step: index + 1, text: item.text })),
    star_rating: state.rating === '' ? null : Number(state.rating),
    cooked_at: state.cookedDate || null,
    notes: state.notes,
  })
}

export function moveRow<T>(rows: T[], index: number, offset: number): T[] {
  const target = index + offset
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length || index === target) return rows
  const next = [...rows]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}
