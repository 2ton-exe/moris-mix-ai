import { useJournalMedia } from './useJournalMedia'

export function useJournalDesktopTools() {
  return useJournalMedia('(min-width: 500px) and (pointer: fine) and (hover: hover)')
}
