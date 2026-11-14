import { z } from 'zod'
import { apiClient } from '../api/config'
import { HttpError } from '../api/http'
import { extractedRecipeSchema } from '../quick-ai/extractRecipe'
import type { RecipeRequest } from '../recipes/types'

/** Mirrors GenerateRecipeRequestSchema from supabase/functions/_shared/ai/schemas.ts. */
export const generateRecipeRequestSchema = z.object({
  pantryItems: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  preferences: z.string().trim().max(1000).optional(),
})

const substitutionSchema = z.object({
  original: z.string().min(1),
  replacement: z.string().min(1),
  reason: z.string().min(1).optional(),
})

const suggestedParentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  star_rating: z.number().int().min(1).max(5).nullable(),
})

const contextSchema = z.object({
  status: z.enum(['MATCHED', 'NO_PANTRY_OVERLAP', 'NO_SAVED_RECIPES', 'EMPTY_PANTRY']),
  matchedCandidateCount: z.number().int().min(0).max(1000),
  totalCandidateCount: z.number().int().min(0).max(1000),
}).refine((value) => value.matchedCandidateCount <= value.totalCandidateCount, {
  path: ['matchedCandidateCount'],
  message: 'matchedCandidateCount cannot exceed totalCandidateCount.',
})

/** Mirrors GenerateRecipeResponseSchema; recipe parsing is shared with FE-09. */
export const generateRecipeResponseSchema = z.object({
  recipe: extractedRecipeSchema,
  substitutions: z.array(substitutionSchema),
  parents: z.array(suggestedParentSchema),
  candidate_token: z.string().min(1).nullable(),
  context: contextSchema,
}).superRefine((value, context) => {
  const ingredientNames = new Set(value.recipe.ingredients.map((ingredient) => ingredient.name))
  value.substitutions.forEach((substitution, index) => {
    if (!ingredientNames.has(substitution.original)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['substitutions', index, 'original'],
        message: 'A substitution must identify an ingredient in the generated recipe.',
      })
    }
  })
  if (value.parents.length > 0 && value.candidate_token === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidate_token'], message: 'A candidate token is required for suggested parents.' })
  }
  if (value.parents.length === 0 && value.candidate_token !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidate_token'], message: 'A candidate token must be null without suggested parents.' })
  }
})

export type GenerateRecipeRequest = z.infer<typeof generateRecipeRequestSchema>
export type GenerateRecipeResponse = z.infer<typeof generateRecipeResponseSchema>
export type ChefContextStatus = GenerateRecipeResponse['context']['status']

export const GENERATE_RECIPE_PATH = '/functions/v1/generate-recipe'

export class InvalidGenerateRecipeRequest extends Error {
  constructor() {
    super('The pantry request does not match the AI Chef contract.')
    this.name = 'InvalidGenerateRecipeRequest'
  }
}

export class InvalidGeneratedRecipeResponse extends Error {
  constructor() {
    super('The AI Chef response did not match the generation contract.')
    this.name = 'InvalidGeneratedRecipeResponse'
  }
}

type GenerateRecipeClient = Pick<typeof apiClient, 'postAuthenticatedJson'>

export function createGenerateRecipeApi(client: GenerateRecipeClient = apiClient) {
  return {
    async generate(pantryItems: string[], preferences: string, request: RecipeRequest): Promise<GenerateRecipeResponse> {
      const payload = {
        pantryItems,
        ...(preferences.trim() ? { preferences: preferences.trim() } : {}),
      }
      const validatedRequest = generateRecipeRequestSchema.safeParse(payload)
      if (!validatedRequest.success) throw new InvalidGenerateRecipeRequest()

      const response = await client.postAuthenticatedJson(GENERATE_RECIPE_PATH, validatedRequest.data, request)
      const validatedResponse = generateRecipeResponseSchema.safeParse(response)
      if (!validatedResponse.success) throw new InvalidGeneratedRecipeResponse()
      return validatedResponse.data
    },
  }
}

export const generateRecipeApi = createGenerateRecipeApi()

function apiErrorCode(error: HttpError): string | undefined {
  if (typeof error.payload !== 'object' || error.payload === null || Array.isArray(error.payload)) return undefined
  const envelope = (error.payload as Record<string, unknown>).error
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return undefined
  const code = (envelope as Record<string, unknown>).code
  return typeof code === 'string' ? code : undefined
}

function retryAfterCopy(value?: string) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Try again later.'
  const rounded = Math.ceil(seconds)
  if (rounded < 60) return `Try again in ${rounded} ${rounded === 1 ? 'second' : 'seconds'}.`
  const minutes = Math.ceil(rounded / 60)
  if (minutes < 60) return `Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
  const hours = Math.ceil(minutes / 60)
  return `Try again in about ${hours} ${hours === 1 ? 'hour' : 'hours'}.`
}

/** User-safe messages for the documented AI-06 error envelope. */
export function generateRecipeErrorMessage(error: unknown, timedOut = false) {
  if (timedOut) return 'Mori took too long to answer. Your ingredients and preferences are still here; try again.'
  if (error instanceof InvalidGenerateRecipeRequest) return 'Check the pantry items and preferences, then try again.'
  if (error instanceof InvalidGeneratedRecipeResponse) return 'Mori returned a recipe that could not be checked safely. Your request is still here; try again.'
  if (!(error instanceof HttpError)) return 'AI Chef could not finish the request. Your ingredients and preferences are still here; try again.'

  const code = apiErrorCode(error)
  if (error.status === 401 || code === 'UNAUTHORIZED') return 'Your session could not be verified. Sign in again before asking Mori. Your request is still here.'
  if (code === 'QUOTA_EXCEEDED') return `You have reached today’s AI Chef limit. ${retryAfterCopy(error.retryAfter)}`
  if (code === 'QUOTA_UNAVAILABLE') return 'Mori could not check today’s AI usage limit. Your request is still here; try again shortly.'
  if (code === 'AI_RATE_LIMITED') return `AI Chef is briefly rate-limited. ${retryAfterCopy(error.retryAfter)}`
  if (code === 'AI_DISABLED') return 'AI Chef is temporarily unavailable. Your ingredients and preferences are still here.'
  if (code === 'AI_TIMEOUT' || error.status === 408 || error.status === 504) return 'The AI service took too long to answer. Your request is still here; try again.'
  if (code === 'AI_OUTPUT_INVALID' || error.kind === 'invalid-json') return 'Mori returned a recipe that could not be checked safely. Your request is still here; try again.'
  if (code === 'AI_PROVIDER_REJECTED') return 'The AI service could not accept this request. Your pantry details are still here; try again later.'
  if (code === 'AI_UNAVAILABLE') return 'The AI service is temporarily unavailable. Your pantry details are still here; try again shortly.'
  if (code === 'AUTH_SERVICE_RATE_LIMITED') return 'Sign-in is temporarily rate-limited. Wait a moment, then try AI Chef again.'
  if (code === 'VALIDATION_ERROR') return 'The server could not use these pantry details. Check them and try again.'
  if (code === 'INPUT_TOO_LARGE') return 'This pantry request is too large. Shorten a pantry item or preference and try again.'
  if (error.kind === 'network') return 'Mori could not reach the service. Your ingredients and preferences are still here; check your connection and retry.'
  if (error.kind === 'configuration') return 'AI Chef is not connected in this environment. Your request is still here.'
  if (error.status === 429) return `AI Chef is temporarily limited. ${retryAfterCopy(error.retryAfter)}`
  return 'AI Chef could not finish the request. Your ingredients and preferences are still here; try again.'
}
