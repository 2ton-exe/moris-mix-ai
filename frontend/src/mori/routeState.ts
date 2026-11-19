import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useLocation } from 'react-router'

export type MoriFocusTarget = 'notes' | 'pantry'

export function moriReviewKeyFromState(state: unknown) {
  return typeof state === 'object' && state !== null &&
    'moriReviewKey' in state && typeof state.moriReviewKey === 'number'
    ? state.moriReviewKey
    : 'initial'
}

export function useMoriFieldFocus(target: MoriFocusTarget, element: RefObject<HTMLElement | null>, setGuided: Dispatch<SetStateAction<boolean>>) {
  const location = useLocation()
  const active = typeof location.state === 'object' && location.state !== null &&
    'moriFocus' in location.state && location.state.moriFocus === target

  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => { element.current?.focus(); setGuided(true) })
    const timeout = window.setTimeout(() => setGuided(false), 2200)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timeout) }
  }, [location.key, location.state, active, element, setGuided])

  return active
}
