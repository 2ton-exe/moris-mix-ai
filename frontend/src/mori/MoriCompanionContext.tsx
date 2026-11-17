import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react'

export type MoriActivity = { kind: 'idle' | 'hover' | 'dragging' | 'curious' | 'working' | 'thinking' | 'responding' | 'celebrating' | 'confused' | 'attention'; message: string }
const idle: MoriActivity = { kind: 'idle', message: 'A little inspiration, whenever you need it.' }
const priority = { idle: 0, hover: 1, curious: 2, responding: 2, working: 3, thinking: 3, dragging: 4, celebrating: 4, confused: 5, attention: 5 }
const MoriContext = createContext<{
  activity: MoriActivity
  setActivity: (id: string, value: MoriActivity | null) => void
} | null>(null)

export function MoriCompanionProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Record<string, MoriActivity>>({})
  const setActivity = useCallback((id: string, value: MoriActivity | null) => {
    setActivities((previous) => {
      const next = { ...previous }
      delete next[id]
      if (value && priority[value.kind] >= 2) {
        for (const owner of Object.keys(next)) if (next[owner].kind === 'celebrating') delete next[owner]
      }
      if (value && !(value.kind === 'celebrating' && Object.values(next).some((entry) => priority[entry.kind] >= 2))) next[id] = value
      return next
    })
  }, [])
  const activity = Object.values(activities).reduce((selected, entry) => priority[entry.kind] >= priority[selected.kind] ? entry : selected, idle)
  return <MoriContext.Provider value={{ activity, setActivity }}>{children}</MoriContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- optional activity hooks share the provider contract
export function useMoriActivity(activity: MoriActivity | null) {
  const context = useContext(MoriContext)
  const setActivity = context?.setActivity
  const id = useId()
  const kind = activity?.kind
  const message = activity?.message
  useEffect(() => {
    if (!setActivity || !kind || message === undefined) return
    setActivity(id, { kind, message })
    const timer = kind === 'celebrating' ? window.setTimeout(() => setActivity(id, null), 2500) : undefined
    return () => { window.clearTimeout(timer); setActivity(id, null) }
  }, [id, kind, message, setActivity])
}

// eslint-disable-next-line react-refresh/only-export-components -- read-only presentation hook
export function useMoriCompanionState() {
  const context = useContext(MoriContext)
  return { activity: context?.activity ?? idle }
}
