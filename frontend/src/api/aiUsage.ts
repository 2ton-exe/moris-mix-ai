import { z } from 'zod'
import { apiClient } from './config'

const timestamp = z.string().datetime({ offset: true })
const allowance = z.object({
  limit: z.number().int().positive(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
})

export const aiUsageSchema = z.object({
  observedAt: timestamp,
  daily: allowance.extend({ resetAt: timestamp }),
  shortTerm: allowance.extend({
    mode: z.enum(['fixed', 'rolling']),
    nextChangeAt: timestamp.nullable(),
    retryAt: timestamp.nullable(),
  }),
}).refine(({ daily, shortTerm }) => [daily, shortTerm].every(({ limit, used, remaining }) =>
  remaining === Math.max(0, limit - used)), 'Usage remaining must match its allowance')

export type AIUsage = z.infer<typeof aiUsageSchema>
export const aiUsageKey = (userId: string) => ['ai-usage', userId] as const

export async function getAIUsage({ userId, signal, client = apiClient }: {
  userId: string
  signal?: AbortSignal
  client?: Pick<typeof apiClient, 'getAuthenticatedJson'>
}): Promise<AIUsage> {
  return aiUsageSchema.parse(await client.getAuthenticatedJson('/functions/v1/recipes/ai-usage', { userId, signal }))
}

const listeners = new Set<(userId: string) => void>()

export function notifyAIUsageChanged(userId: string) {
  for (const listener of listeners) listener(userId)
}

export function subscribeAIUsageChanged(listener: (userId: string) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
