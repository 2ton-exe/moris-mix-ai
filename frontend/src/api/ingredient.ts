import { z } from 'zod'
import { isValidIngredientUnit, normalizeIngredientUnit } from '../../../supabase/functions/_shared/ingredient-units.ts'
import type { Ingredient } from './demoRecipe'

/** Write/AI contract; legacy recipe reads remain permissive. */
export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().nullable().default(null),
  unit: z.string().trim().refine(isValidIngredientUnit, 'Use a unit of up to 100 characters without control characters.')
    .nullable().default(null).transform(normalizeIngredientUnit),
  quantityText: z.preprocess((value) => value === null ? undefined : value, z.string().trim().max(200).optional()),
  inferred: z.boolean().default(false),
}) satisfies z.ZodType<Ingredient>
