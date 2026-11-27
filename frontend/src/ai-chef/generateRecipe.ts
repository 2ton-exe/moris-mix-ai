import { z } from 'zod'
import { uniquePantryIngredients } from '../../../supabase/functions/_shared/ingredient-identity.ts'
import { apiClient } from '../api/config'
import { notifyAIUsageChanged } from '../api/aiUsage'
import { aiRateLimitReason } from '../api/aiRateLimit'
import { HttpError, httpErrorCode } from '../api/http'
import { retryAfterMessage } from '../api/retryAfter'
import { extractedRecipeSchema, storedExtractedRecipeSchema } from '../quick-ai/extractRecipe'
import type { RecipeRequest } from '../recipes/types'

/** Mirrors GenerateRecipeRequestSchema from supabase/functions/_shared/ai/schemas.ts. */
export const generateRecipeRequestSchema = z.object({
  pantryItems: z.array(z.string().trim().min(1).max(100)).min(1).max(100).transform(uniquePantryIngredients),
  preferences: z.string().trim().max(1000).optional(),
})

export const revisionNoteLimit = 1200
export const revisionRequestSchema = z.object({
  sourceRecipeId: z.string().uuid(),
  noteExcerpt: z.string().min(1).max(revisionNoteLimit).refine((note) => note.trim().length > 0),
})
const revisionAmountSchema = z.object({ quantity: z.number(), unit: z.string().nullable() })
const revisionEvidenceSchema = z.object({
  noteExcerpt: revisionRequestSchema.shape.noteExcerpt,
  ingredient: z.string().min(1),
  ingredientIndex: z.number().int().min(0).max(99).optional(),
  before: revisionAmountSchema,
  after: revisionAmountSchema,
  reason: z.string().min(1),
})

const substitutionSchema = z.object({
  original: z.string().trim().min(1),
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
  revision: revisionEvidenceSchema.optional(),
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

export const storedGenerateRecipeResponseSchema = generateRecipeResponseSchema.safeExtend({
  recipe: storedExtractedRecipeSchema,
})

export type GenerateRecipeRequest = z.infer<typeof generateRecipeRequestSchema>
export type RevisionRequest = z.infer<typeof revisionRequestSchema>
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
    async revise(sourceRecipeId: string, noteExcerpt: string, request: RecipeRequest): Promise<GenerateRecipeResponse> {
      const payload = revisionRequestSchema.parse({ sourceRecipeId, noteExcerpt })
      const response = await client.postAuthenticatedJson(GENERATE_RECIPE_PATH, payload, request).finally(() => notifyAIUsageChanged(request.userId))
      const parsed = generateRecipeResponseSchema.safeParse(response)
      if (!parsed.success || parsed.data.revision?.noteExcerpt !== noteExcerpt || parsed.data.parents.length !== 1 ||
        parsed.data.parents[0].id.toLowerCase() !== sourceRecipeId.toLowerCase()) {
        throw new InvalidGeneratedRecipeResponse()
      }
      return parsed.data
    },
    async generate(pantryItems: string[], preferences: string, request: RecipeRequest): Promise<GenerateRecipeResponse> {
      const payload = {
        pantryItems,
        ...(preferences.trim() ? { preferences: preferences.trim() } : {}),
      }
      const validatedRequest = generateRecipeRequestSchema.safeParse(payload)
      if (!validatedRequest.success) throw new InvalidGenerateRecipeRequest()

      const response = await client.postAuthenticatedJson(GENERATE_RECIPE_PATH, validatedRequest.data, request).finally(() => notifyAIUsageChanged(request.userId))
      const validatedResponse = generateRecipeResponseSchema.safeParse(response)
      if (!validatedResponse.success) throw new InvalidGeneratedRecipeResponse()
      return validatedResponse.data
    },
  }
}

export const generateRecipeApi = createGenerateRecipeApi()

/** User-safe messages for the documented AI-06 error envelope. */
export function generateRecipeErrorMessage(error: unknown, timedOut = false) {
  if (timedOut) return 'Mori took too long to answer. Your ingredients and preferences are still here; try again.'
  if (error instanceof InvalidGenerateRecipeRequest) return 'Check the pantry items and preferences, then try again.'
  if (error instanceof InvalidGeneratedRecipeResponse) return 'Mori returned a recipe that could not be checked safely. Your request is still here; try again.'
  if (!(error instanceof HttpError)) return 'AI Chef could not finish the request. Your ingredients and preferences are still here; try again.'

  const code = httpErrorCode(error)
  const rateLimitReason = aiRateLimitReason(code)
  if (rateLimitReason) return `${rateLimitReason} ${retryAfterMessage(error.retryAfter)}`
  if (error.status === 401 || code === 'UNAUTHORIZED') return 'Your session could not be verified. Sign in again before asking Mori. Your request is still here.'
  if (error.status === 403) return 'You do not have permission to use AI Chef. Your ingredients and preferences are still here.'
  if (code === 'QUOTA_EXCEEDED') return `You have reached today’s AI Chef limit. ${retryAfterMessage(error.retryAfter)}`
  if (code === 'QUOTA_UNAVAILABLE') return 'Mori could not check today’s AI usage limit. Your request is still here; try again shortly.'
  if (code === 'AI_RATE_LIMITED') return `AI Chef is briefly rate-limited. ${retryAfterMessage(error.retryAfter)}`
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
  if (error.status === 429) return `AI Chef is temporarily limited. ${retryAfterMessage(error.retryAfter)}`
  return 'AI Chef could not finish the request. Your ingredients and preferences are still here; try again.'
}

export function revisionErrorMessage(error: unknown, timedOut = false) {
  if (timedOut) return 'Mori took too long to answer. Your selected note is still here.'
  const code = error instanceof HttpError ? httpErrorCode(error) : undefined
  if (code === 'REVISION_SOURCE_TOO_LARGE') return 'This recipe is too long for a focused revision. You can edit it directly; your saved recipe and notes are unchanged, and no AI request was used.'
  if (code === 'REVISION_NOTE_CHANGED') return 'Your saved notes changed. Reload the recipe and select the note again.'
  if (code === 'NOT_FOUND') return 'The original recipe is unavailable.'
  if (code === 'REVISION_CHANGE_UNSUPPORTED' || code === 'AI_OUTPUT_INVALID' || error instanceof InvalidGeneratedRecipeResponse) {
    return 'Mori could not verify a quantity change from this note. Try a more specific note.'
  }
  const rateLimitReason = aiRateLimitReason(code)
  if (rateLimitReason && error instanceof HttpError) return `${rateLimitReason} ${retryAfterMessage(error.retryAfter)}`
  if (error instanceof HttpError && error.status === 401) return 'Sign in again before asking Mori.'
  if (code === 'AI_DISABLED') return 'AI Chef is temporarily unavailable. Your selected note is still here.'
  return 'Mori could not finish the revision. Your selected note is still here.'
}
