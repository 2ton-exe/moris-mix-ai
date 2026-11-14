import { z } from 'zod'
import { apiClient } from '../api/config'
import type { RecipeRequest } from '../recipes/types'

const nullableToOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === null ? undefined : value, schema)

const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nonnegative().nullable().default(null),
  unit: z.string().nullable().default(null),
  quantityText: nullableToOptional(z.string().optional()),
  inferred: z.boolean().default(false),
})

const instructionSchema = z.object({ step: z.number().int().positive(), text: z.string().min(1) })

const sequentialInstructionsSchema = z.array(instructionSchema).superRefine((steps, context) => {
  steps.forEach((step, index) => {
    if (step.step !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'step'], message: `Expected step ${index + 1}.` })
    }
  })
})

const flavorScoresSchema = z.object({
  sweet: z.number().min(0).max(5),
  salty: z.number().min(0).max(5),
  sour: z.number().min(0).max(5),
  bitter: z.number().min(0).max(5),
  umami: z.number().min(0).max(5),
  spicy: z.number().min(0).max(5),
})

export const extractedRecipeSchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(ingredientSchema),
  instructions: sequentialInstructionsSchema,
  flavor_scores: nullableToOptional(flavorScoresSchema.optional()),
})

export const extractRecipeResponseSchema = z.object({ recipe: extractedRecipeSchema })

export type ExtractedRecipe = z.infer<typeof extractedRecipeSchema>

/** Unsaved FE-09 handoff. Keep source notes separate from recipe fields. */
export interface QuickAiEntryHandoff {
  sourceNotes: string
  recipe: ExtractedRecipe
  saved: false
}

export class InvalidExtractionResponse extends Error {
  constructor() {
    super('The extraction response did not match the recipe contract.')
    this.name = 'InvalidExtractionResponse'
  }
}

export const MAX_EXTRACTION_INPUT_CHARS = 10_000
export const EXTRACT_RECIPE_PATH = '/functions/v1/extract-recipe'

type ExtractionClient = Pick<typeof apiClient, 'postAuthenticatedJson'>

export function createExtractRecipeApi(client: ExtractionClient = apiClient) {
  return {
    async extract(notes: string, request: RecipeRequest): Promise<ExtractedRecipe> {
      const response = await client.postAuthenticatedJson(EXTRACT_RECIPE_PATH, { notes }, request)
      const validated = extractRecipeResponseSchema.safeParse(response)
      if (!validated.success) throw new InvalidExtractionResponse()
      return validated.data.recipe
    },
  }
}

export const extractRecipeApi = createExtractRecipeApi()
