import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

export type MoriActivity = { kind: 'idle' | 'curious' | 'working' | 'thinking' | 'celebrating' | 'confused' | 'attention'; message: string; source?: 'chat' }
type Guidance = { message: string; action?: { label: string; onClick: () => void } }
const idle: MoriActivity = { kind: 'idle', message: 'A little inspiration, whenever you need it.' }
const priority = { idle: 0, celebrating: 1, curious: 2, working: 2, thinking: 2, confused: 3, attention: 3 }
const noCompletedReviewKeys: ReadonlySet<number> = new Set()
const ignoreReviewCompletion: (key: number) => void = () => {}
const MoriContext = createContext<{
  activity: MoriActivity; guidance: Guidance | null
  setActivity: (id: string, value: MoriActivity | null) => void
  setGuidance: (id: string, value: Guidance | null) => void
  completedReviewKeys: ReadonlySet<number>
  markReviewCompleted: (key: number) => void
} | null>(null)

export function MoriCompanionProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Record<string, MoriActivity>>({})
  const [guidances, setGuidances] = useState<Record<string, Guidance>>({})
  const [completedReviewKeys, setCompletedReviewKeys] = useState<ReadonlySet<number>>(() => new Set())
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
  const setGuidance = useCallback((id: string, value: Guidance | null) => {
    setGuidances((previous) => {
      const next = { ...previous }
      delete next[id]
      if (value) next[id] = value
      return next
    })
  }, [])
  const markReviewCompleted = useCallback((key: number) => {
    setCompletedReviewKeys((previous) => previous.has(key) ? previous : new Set([...previous, key]))
  }, [])
  const activity = Object.values(activities).reduce((selected, entry) => priority[entry.kind] >= priority[selected.kind] ? entry : selected, idle)
  const guidance = Object.values(guidances).at(-1) ?? null
  return <MoriContext.Provider value={{ activity, guidance, setActivity, setGuidance, completedReviewKeys, markReviewCompleted }}>{children}</MoriContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- optional activity hooks share the provider contract
export function useMoriActivity(activity: MoriActivity | null) {
  const context = useContext(MoriContext)
  const setActivity = context?.setActivity
  const id = useId()
  const kind = activity?.kind
  const message = activity?.message
  const source = activity?.source
  useEffect(() => {
    if (!setActivity || !kind || message === undefined) return
    setActivity(id, { kind, message, source })
    const timer = kind === 'celebrating' ? window.setTimeout(() => setActivity(id, null), 2500) : undefined
    return () => { window.clearTimeout(timer); setActivity(id, null) }
  }, [id, kind, message, source, setActivity])
}

// eslint-disable-next-line react-refresh/only-export-components -- optional guidance hooks share the provider contract
export function useMoriGuidance(guidance: Guidance | null) {
  const setGuidance = useContext(MoriContext)?.setGuidance
  const id = useId()
  const callback = useRef(guidance?.action?.onClick)
  useEffect(() => { callback.current = guidance?.action?.onClick })
  const message = guidance?.message
  const label = guidance?.action?.label
  useEffect(() => {
    if (!setGuidance || message === undefined) return
    setGuidance(id, { message, ...(label ? { action: { label, onClick: () => callback.current?.() } } : {}) })
    return () => setGuidance(id, null)
  }, [id, message, label, setGuidance])
}

// eslint-disable-next-line react-refresh/only-export-components -- read-only presentation hook
export function useMoriCompanionState() {
  const context = useContext(MoriContext)
  return { activity: context?.activity ?? idle, guidance: context?.guidance ?? null }
}

// eslint-disable-next-line react-refresh/only-export-components -- review completion is shared by route pages and the companion chat
export function useMoriReviewCompletion() {
  const context = useContext(MoriContext)
  return {
    completedReviewKeys: context?.completedReviewKeys ?? noCompletedReviewKeys,
    markReviewCompleted: context?.markReviewCompleted ?? ignoreReviewCompletion,
  }
}
