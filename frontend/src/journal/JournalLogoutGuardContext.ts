import { createContext } from 'react'

export type JournalLogoutGuard = () => boolean
export type RegisterJournalLogoutGuard = (guard: JournalLogoutGuard) => () => void

export const JournalLogoutGuardContext = createContext<RegisterJournalLogoutGuard | null>(null)
