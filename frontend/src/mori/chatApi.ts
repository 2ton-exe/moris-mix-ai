import { z } from 'zod'
import { apiClient } from '../api/config'

export type MoriChatTurn = { role: 'user' | 'assistant'; content: string }
export type MoriChatPage = 'recipes' | 'recipe' | 'new-recipe' | 'quick-entry' | 'chef' | 'other'

const responseSchema = z.object({ reply: z.string().trim().min(1).max(2400) })

export async function sendMoriChat({
  messages,
  page,
  recipeId,
  userId,
  signal,
}: {
  messages: MoriChatTurn[]
  page: MoriChatPage
  recipeId?: string
  userId: string
  signal: AbortSignal
}): Promise<string> {
  const result = await apiClient.postAuthenticatedJson('/functions/v1/mori-chat', {
    messages,
    page,
    ...(recipeId ? { recipeId } : {}),
  }, { userId, signal })
  const parsed = responseSchema.safeParse(result)
  if (!parsed.success) throw new Error('Mori returned a reply that could not be read.')
  return parsed.data.reply
}
