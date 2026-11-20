import { createContext, useContext, type RefObject } from 'react'

export type RequestNavigationConfirmation = (
  path: string,
  proceed: (navigate: (action: () => void) => void) => void,
  cancel: () => void,
) => boolean

export const NavigationConfirmationContext = createContext<RefObject<RequestNavigationConfirmation | null> | null>(null)

export function useNavigationConfirmation() {
  return useContext(NavigationConfirmationContext)
}
