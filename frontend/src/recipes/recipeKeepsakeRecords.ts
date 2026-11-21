import { z } from 'zod'
import { journalRecordKey, readJournalRecord, writeJournalRecord } from '../journal/journalRecord'

export const ribbonRecipeSchema = z.uuid()
export const stickerNames = ['Ingredient basket', 'Mixing bowl', 'Pantry bottle', 'Peppercorns', 'Hearts'] as const
export const stickerMemorySchema = z.object({ sticker: z.enum(stickerNames), label: z.string().trim().min(1).max(100) })

export function ribbonKey(userId: string) {
  return journalRecordKey(userId, 'ribbon')
}

export function stickerKey(userId: string, recipeId: string) {
  return journalRecordKey(userId, 'sticker', recipeId)
}

export function clearDeletedRecipeKeepsakes(userId: string, recipeId: string) {
  const key = ribbonKey(userId)
  if (readJournalRecord(key, ribbonRecipeSchema) === recipeId) writeJournalRecord(key, null)
  writeJournalRecord(stickerKey(userId, recipeId), null)
}
