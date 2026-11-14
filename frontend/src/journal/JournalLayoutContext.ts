import { createContext } from 'react'

// A stable DOM destination: changing the responsive layout never remounts controls.
export const JournalFacingPageContext = createContext<HTMLDivElement | null>(null)
export const JournalCompanionContext = createContext<HTMLDivElement | null>(null)
export const JournalPageFooterContext = createContext<HTMLDivElement | null>(null)
