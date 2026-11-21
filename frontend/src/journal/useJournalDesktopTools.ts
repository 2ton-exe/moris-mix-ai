import { useJournalMedia } from './useJournalMedia'

export function useJournalDesktopTools() {
  return useJournalMedia('(pointer: fine) and (hover: hover)')
}
