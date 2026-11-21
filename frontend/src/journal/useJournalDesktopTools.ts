import { useJournalMedia } from './useJournalMedia'

export const JOURNAL_DESKTOP_TOOLS_QUERY = '(min-width: 500px) and (pointer: fine) and (hover: hover)'

export function useJournalDesktopTools() {
  return useJournalMedia(JOURNAL_DESKTOP_TOOLS_QUERY)
}
