import { useLayoutEffect, useRef } from 'react'
import { useBlocker } from 'react-router'

const AUTH_ROUTES = new Set(['/login', '/signup', '/verify-email', '/auth/callback'])

export function useUnsavedChangesGuard(dirty: boolean, { warnOnUnload = false }: { warnOnUnload?: boolean } = {}) {
  const currentDirty = useRef(dirty)
  useLayoutEffect(() => { currentDirty.current = dirty }, [dirty])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!currentDirty.current || AUTH_ROUTES.has(nextLocation.pathname)) return false
    return currentLocation.pathname !== nextLocation.pathname
  })
  useLayoutEffect(() => {
    if (!warnOnUnload || !dirty || typeof window === 'undefined') return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirty, warnOnUnload])

  return {
    open: blocker.state === 'blocked',
    keepEditing: () => { if (blocker.state === 'blocked') blocker.reset() },
    discardChanges: () => { if (blocker.state === 'blocked') blocker.proceed() },
  }
}
