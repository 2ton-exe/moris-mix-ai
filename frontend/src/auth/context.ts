import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthState {
  user: User | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  logoutNotice: string | null
  dismissLogoutNotice: () => void
  retryInitialization: () => void
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<'authenticated' | 'verification-required'>
  logout: () => Promise<void>
  resendVerification: (email: string) => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
