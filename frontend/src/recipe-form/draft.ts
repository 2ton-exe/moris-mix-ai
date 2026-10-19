import { z } from 'zod'
import type { Ingredient, Instruction } from '../api/demoRecipe'

// Frontend draft, NOT a POST/PATCH contract. Field shapes follow the published
// Deno Zod schemas in _shared/ai/schemas.ts; npm: imports cannot run in Vite.
// Keep this bridge aligned until a browser-compatible shared package exists.
const ingredientSchema = z.object({
  name: z.string().trim(),
  quantity: z.number().finite().nullable(),
  unit: z.string().nullable(),
  quantityText: z.string().optional(),
  inferred: z.boolean().default(false),
}) satisfies z.ZodType<Ingredient, z.ZodTypeDef, unknown>
const instructionSchema = z.object({ step: z.number().finite(), text: z.string() }) satisfies z.ZodType<Instruction, z.ZodTypeDef, unknown>

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export const recipeDraftSchema = z.object({
  title: z.string().trim().min(1, 'Enter a recipe title.'),
  ingredients: z.array(ingredientSchema),
  instructions: z.array(instructionSchema),
  star_rating: z.number().int().min(1).max(5).nullable(),
  cooked_at: z.string().refine(calendarDate, 'Enter a valid calendar date.').nullable(),
  // No published notes column/contract or length limit. Local draft only until
  // the host's REST adapter explicitly supports it; never silently drop notes.
  notes: z.string().default(''),
})
export type RecipeDraft = z.infer<typeof recipeDraftSchema>
export type RecipeDraftInput = z.input<typeof recipeDraftSchema>

export interface IngredientRow {
  key: string
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

export const emptyRecipeDraft = (): RecipeDraft => ({
  title: '', ingredients: [], instructions: [], star_rating: null, cooked_at: null, notes: '',
})

export function editorState(draft: RecipeDraft): RecipeEditorState {
  return {
    title: draft.title,
    ingredients: draft.ingredients.map((item) => ({
      key: crypto.randomUUID(), name: item.name, quantity: item.quantity === null ? '' : String(item.quantity),
      unit: item.unit ?? '', quantityText: item.quantityText ?? '', inferred: item.inferred,
    })),
    instructions: [...draft.instructions].sort((a, b) => a.step - b.step)
      .map((item) => ({ key: crypto.randomUUID(), text: item.text })),
    rating: draft.star_rating === null ? '' : String(draft.star_rating),
    cookedDate: draft.cooked_at ?? '', notes: draft.notes,
  }
}

function quantity(value: string) {
  if (!value.trim()) return null
  // Decimal notation, including scientific notation; no unit/fraction guessing.
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN
}

export function validateEditor(state: RecipeEditorState) {
  return recipeDraftSchema.safeParse({
    title: state.title,
    ingredients: state.ingredients.map((item) => ({
      name: item.name, quantity: quantity(item.quantity), unit: item.unit.trim() || null,
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
  if (target < 0 || target >= rows.length) return rows
  const next = [...rows]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
