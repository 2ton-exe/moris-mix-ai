import { useLayoutEffect, useRef, useState } from 'react'
import { useBlocker, useLocation } from 'react-router'
import { useNavigationConfirmation, type RequestNavigationConfirmation } from './navigationConfirmation'

const AUTH_ROUTES = new Set(['/login', '/signup', '/verify-email', '/auth/callback'])

export function useUnsavedChangesGuard(dirty: boolean, { warnOnUnload = false }: { warnOnUnload?: boolean } = {}) {
  const confirmation = useNavigationConfirmation()
  const { pathname } = useLocation()
  const currentDirty = useRef(dirty)
  const approvedPath = useRef<string | null>(null)
  const [pending, setPending] = useState<{
    path: string
    proceed: Parameters<RequestNavigationConfirmation>[1]
    cancel: Parameters<RequestNavigationConfirmation>[2]
  } | null>(null)
  const approvedRequest = useRef<typeof pending>(null)
  useLayoutEffect(() => { currentDirty.current = dirty }, [dirty])

  function willBlock(from: string, to: string) {
    return currentDirty.current && from !== to && !AUTH_ROUTES.has(to)
  }

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return approvedPath.current !== nextLocation.pathname && willBlock(currentLocation.pathname, nextLocation.pathname)
  })
  useLayoutEffect(() => {
    if (!confirmation) return
    const requestConfirmation: RequestNavigationConfirmation = (path, proceed, cancel) => {
      if (!willBlock(pathname, path)) return false
      setPending({ path, proceed, cancel })
      return true
    }
    confirmation.current = requestConfirmation
    return () => { if (confirmation.current === requestConfirmation) confirmation.current = null }
  }, [confirmation, pathname])
  useLayoutEffect(() => {
    if (blocker.state !== 'blocked') return
    approvedRequest.current?.cancel()
    approvedRequest.current = null
    if (pending) {
      pending.cancel()
      setPending(null)
    }
  }, [blocker.state, pending])
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
    open: blocker.state === 'blocked' || pending !== null,
    keepEditing: () => {
      if (blocker.state === 'blocked') blocker.reset()
      if (pending) {
        setPending(null)
        pending.cancel()
      }
    },
    discardChanges: () => {
      if (blocker.state === 'blocked') blocker.proceed()
      if (!pending) return
      setPending(null)
      approvedRequest.current = pending
      pending.proceed((navigate) => {
        if (approvedRequest.current !== pending) return
        approvedRequest.current = null
        approvedPath.current = pending.path
        try { navigate() }
        finally { approvedPath.current = null }
      })
    },
  }
}
