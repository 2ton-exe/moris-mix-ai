import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'

const AUTH_ROUTES = new Set(['/login', '/signup', '/verify-email', '/auth/callback'])

export function useUnsavedChangesGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!dirty || AUTH_ROUTES.has(nextLocation.pathname)) return false
    return currentLocation.pathname !== nextLocation.pathname
  })
  const promptedLocation = useRef<string | null>(null)

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptedLocation.current = null
      return
    }

    const key = blocker.location.key
    if (promptedLocation.current === key) return
    promptedLocation.current = key

    if (window.confirm('Leave this recipe? Your unsaved changes will be lost.')) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker])
}
