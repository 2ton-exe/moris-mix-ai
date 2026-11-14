import { z } from 'zod'
import { apiClient } from '../api/config'
import { HttpError } from '../api/http'
import type { RecipeRequest } from '../recipes/types'

const uuidSchema = z.string().uuid()

const lineageRecordSchema = z.object({
  id: uuidSchema,
  parent_recipe_id: uuidSchema,
  child_recipe_id: uuidSchema,
  created_at: z.string().min(1),
})

const lineageResponseSchema = z.object({
  lineage: z.array(lineageRecordSchema),
})

const lineageRequestSchema = z.object({
  parent_recipe_ids: z.array(uuidSchema).min(1).max(10).refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
  ),
  candidate_token: z.string().min(1).max(2048),
}).strict()

export type LineageRecord = z.infer<typeof lineageRecordSchema>
export type LineageResponse = z.infer<typeof lineageResponseSchema>
export type LineageFailureReason =
  | 'expired-token'
  | 'invalid-token'
  | 'wrong-user'
  | 'not-candidate'
  | 'ownership'
  | 'unauthorized'
  | 'conflict'
  | 'validation'
  | 'unavailable'
  | 'invalid-response'

export class LineageApiError extends Error {
  constructor(readonly reason: LineageFailureReason, readonly ambiguous = false) {
    super('Recipe parent links could not be confirmed.')
    this.name = 'LineageApiError'
  }
}

type AuthenticatedLineageClient = Pick<typeof apiClient, 'postAuthenticatedJson' | 'getAuthenticatedJson'>

const lineagePath = (childRecipeId: string) =>
  '/functions/v1/recipes/' + encodeURIComponent(childRecipeId) + '/lineage'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function backendErrorCodes(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return { code: undefined, detailCode: undefined }
  const envelope = payload.error
  const details = Array.isArray(envelope.details) ? envelope.details : []
  const detailCode = details.map((detail) => isRecord(detail) ? detail.code : undefined)
    .find((code) => typeof code === 'string')
  return {
    code: typeof envelope.code === 'string' ? envelope.code : undefined,
    detailCode: typeof detailCode === 'string' ? detailCode : undefined,
  }
}

function mapApiError(error: unknown): LineageApiError {
  if (error instanceof LineageApiError) return error
  if (!(error instanceof HttpError)) return new LineageApiError('unavailable', true)
  if (error.kind === 'invalid-json') return new LineageApiError('invalid-response', true)
  if (error.kind === 'network' ||
    error.status === 408 || (error.status !== undefined && error.status >= 500)) {
    return new LineageApiError('unavailable', true)
  }
  if (error.kind === 'configuration') return new LineageApiError('unavailable')

  const codes = backendErrorCodes(error.payload)
  const code = codes.detailCode ?? codes.code
  if (code === 'expired_token') return new LineageApiError('expired-token')
  if (code === 'invalid_token') return new LineageApiError('invalid-token')
  if (code === 'wrong_user') return new LineageApiError('wrong-user')
  if (code === 'not_a_candidate') return new LineageApiError('not-candidate')
  if (error.status === 401 || code === 'UNAUTHORIZED') return new LineageApiError('unauthorized')
  if (error.status === 404 || code === 'NOT_FOUND') return new LineageApiError('ownership')
  if (error.status === 409 || code === 'CONFLICT') return new LineageApiError('conflict', true)
  if (error.status === 400 || error.status === 422 || code === 'VALIDATION_ERROR') {
    return new LineageApiError('validation')
  }
  return new LineageApiError('unavailable')
}

function validateRequest(
  childRecipeId: string,
  candidateParentIds: string[],
  selectedParentIds: string[],
  candidateToken: string,
) {
  const child = uuidSchema.safeParse(childRecipeId)
  const candidates = z.array(uuidSchema).safeParse(candidateParentIds)
  const request = lineageRequestSchema.safeParse({
    parent_recipe_ids: selectedParentIds,
    candidate_token: candidateToken,
  })
  if (!child.success || !candidates.success || !request.success ||
    new Set(candidates.data.map((id) => id.toLowerCase())).size !== candidates.data.length ||
    request.data.parent_recipe_ids.some((id) => !candidates.data.some((candidate) => candidate.toLowerCase() === id.toLowerCase()))) {
    throw new LineageApiError('validation')
  }
  return { childRecipeId: child.data, request: request.data }
}

export function lineageMatchesSelection(
  response: LineageResponse,
  childRecipeId: string,
  selectedParentIds: string[],
) {
  const selected = new Set(selectedParentIds.map((id) => id.toLowerCase()))
  const returned = response.lineage.map((record) => record.parent_recipe_id.toLowerCase())
  return response.lineage.every((record) => record.child_recipe_id.toLowerCase() === childRecipeId.toLowerCase()) &&
    returned.length === selected.size &&
    new Set(returned).size === returned.length &&
    returned.every((id) => selected.has(id))
}

function parseResponse(value: unknown, childRecipeId: string, selectedParentIds?: string[]): LineageResponse {
  const parsed = lineageResponseSchema.safeParse(value)
  if (!parsed.success || parsed.data.lineage.some((record) =>
    record.child_recipe_id.toLowerCase() !== childRecipeId.toLowerCase()) ||
    (selectedParentIds !== undefined && !lineageMatchesSelection(parsed.data, childRecipeId, selectedParentIds))) {
    throw new LineageApiError('invalid-response', true)
  }
  return parsed.data
}

export function createLineageApi(client: AuthenticatedLineageClient = apiClient) {
  return {
    async save(
      childRecipeId: string,
      candidateParentIds: string[],
      selectedParentIds: string[],
      candidateToken: string,
      request: RecipeRequest,
    ): Promise<LineageResponse> {
      const validated = validateRequest(childRecipeId, candidateParentIds, selectedParentIds, candidateToken)
      let response: unknown
      try {
        response = await client.postAuthenticatedJson(
          lineagePath(validated.childRecipeId),
          validated.request,
          request,
        )
      } catch (error) {
        throw mapApiError(error)
      }
      return parseResponse(response, validated.childRecipeId, validated.request.parent_recipe_ids)
    },

    async get(childRecipeId: string, request: RecipeRequest): Promise<LineageResponse> {
      const parsedId = uuidSchema.safeParse(childRecipeId)
      if (!parsedId.success) throw new LineageApiError('validation')
      let response: unknown
      try {
        response = await client.getAuthenticatedJson(lineagePath(parsedId.data), request)
      } catch (error) {
        throw mapApiError(error)
      }
      return parseResponse(response, parsedId.data)
    },
  }
}

export const lineageApi = createLineageApi()

export function lineageFailureMessage(error: unknown) {
  const reason = error instanceof LineageApiError ? error.reason : 'unavailable'
  if (reason === 'expired-token') {
    return 'Your recipe was saved, but the authorization for its parent links expired. Your recipe is safe; this preview cannot be used to add those links now.'
  }
  if (reason === 'invalid-token' || reason === 'wrong-user' || reason === 'unauthorized') {
    return 'Your recipe was saved, but Mori could not verify permission to link the selected parents. Your recipe is safe, and the links were not confirmed.'
  }
  if (reason === 'not-candidate') {
    return 'Your recipe was saved, but Mori could not verify one of the selected parents for this suggestion. Your recipe is safe, and the links were not confirmed.'
  }
  if (reason === 'ownership') {
    return 'Your recipe was saved, but Mori could not verify access to the child or a selected parent recipe. Your recipe is safe, and the links were not confirmed.'
  }
  if (reason === 'validation') {
    return 'Your recipe was saved, but the selected parent links could not be checked. Your recipe is safe; review the suggestions before trying again.'
  }
  return 'Your recipe was saved, but Mori could not confirm its parent links. Your recipe is safe. You can check and retry the selected links.'
}
