import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Mori } from './Mori'
import type { MoriMood } from './Mori'
import { PaperCard, Stamp } from './Scrapbook'

export type MoriDialogueStatus = 'ready' | 'pending' | 'error' | 'complete'

export interface MoriDialogueChoice {
  id: string
  label: string
  /** Advances to another supplied line. No line is synthesized by the component. */
  nextLineId?: string
}

export interface MoriDialogueLine {
  id: string
  speaker: string
  text: string
  expression?: MoriMood
  choices?: readonly MoriDialogueChoice[]
}

export interface MoriDialogueProps {
  id?: string
  lines: readonly MoriDialogueLine[]
  status?: MoriDialogueStatus
  pendingText?: string
  errorText?: string
  completionText?: string
  typewriterSpeedMs?: number
  typewriter?: boolean
  closing?: boolean
  onChoice?: (choice: MoriDialogueChoice, line: MoriDialogueLine) => void
  onContinue?: () => void
  onComplete?: () => void
  onRetry?: () => void
  onClose: () => void
}

interface DialogueFlow {
  lineKey: string
  lineId: string
  complete: boolean
  typedCount: number
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (event: MediaQueryListEvent) => setReduced(event.matches)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  return reduced
}

/** Reusable, non-modal dialogue surface. All copy and actions come from props. */
export function MoriDialogue({
  id,
  lines,
  status = 'ready',
  pendingText = 'Mori is getting the next note ready...',
  errorText = 'Mori could not finish this note. You can retry or close it.',
  completionText = 'That is all for now.',
  typewriterSpeedMs = 26,
  typewriter = true,
  closing = false,
  onChoice,
  onContinue,
  onComplete,
  onRetry,
  onClose,
}: MoriDialogueProps) {
  const titleId = useId()
  const lineKey = JSON.stringify(lines.map(({ id, text }) => [id, text]))
  const firstLineId = lines[0]?.id ?? ''
  const [flow, setFlow] = useState<DialogueFlow>({ lineKey, lineId: firstLineId, complete: false, typedCount: 0 })
  const activeLineId = flow.lineKey === lineKey ? flow.lineId : firstLineId
  const line = lines.find((item) => item.id === activeLineId) ?? lines[0]
  const currentLineId = line?.id
  const currentLineText = line?.text ?? ''
  const completed = status === 'complete' || (flow.lineKey === lineKey && flow.complete)
  const reducedMotion = useReducedMotionPreference()
  const characters = Array.from(currentLineText)
  const matchingType = flow.lineId === currentLineId && flow.lineKey === lineKey
  const typedCount = matchingType ? flow.typedCount : 0
  const isTyping = status === 'ready' && !completed && !!currentLineId && typewriter && !reducedMotion && typedCount < characters.length
  const shownText = !typewriter || reducedMotion ? currentLineText : characters.slice(0, typedCount).join('')
  const regionRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousLineId = useRef(currentLineId)
  const previousDisplayState = useRef(status)

  useLayoutEffect(() => {
    headingRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (currentLineId && previousLineId.current && previousLineId.current !== currentLineId && regionRef.current?.contains(document.activeElement)) {
      continueRef.current?.focus()
    }
    previousLineId.current = currentLineId
  }, [currentLineId])

  useLayoutEffect(() => {
    const displayState = completed ? 'complete' : status
    if (previousDisplayState.current !== displayState && regionRef.current?.contains(document.activeElement)) {
      if (displayState === 'complete') closeRef.current?.focus()
      else headingRef.current?.focus()
    }
    previousDisplayState.current = displayState
  }, [completed, status])

  useEffect(() => {
    if (!currentLineId || status !== 'ready' || completed || !typewriter || reducedMotion || typedCount >= characters.length) return
    const timer = window.setTimeout(() => {
      setFlow({ lineKey, lineId: currentLineId, complete: false, typedCount: Math.min(characters.length, typedCount + 2) })
    }, typewriterSpeedMs)
    return () => window.clearTimeout(timer)
  }, [characters.length, completed, currentLineId, lineKey, reducedMotion, status, typewriter, typewriterSpeedMs, typedCount])

  function revealAll() {
    if (!line) return
    setFlow({ lineKey, lineId: line.id, complete: false, typedCount: characters.length })
  }

  function continueDialogue() {
    if (isTyping) {
      revealAll()
      return
    }
    onContinue?.()
    const currentIndex = line ? lines.findIndex((item) => item.id === line.id) : -1
    const nextLine = lines[currentIndex + 1]
    if (nextLine) {
      setFlow({ lineKey, lineId: nextLine.id, complete: false, typedCount: 0 })
      return
    }
    setFlow({ lineKey, lineId: line?.id ?? '', complete: true, typedCount })
    onComplete?.()
  }

  function choose(choice: MoriDialogueChoice) {
    if (!line || !onChoice) return
    onChoice(choice, line)
    const nextLine = choice.nextLineId ? lines.find((item) => item.id === choice.nextLineId) : undefined
    if (nextLine) setFlow({ lineKey, lineId: nextLine.id, complete: false, typedCount: 0 })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  const speaker = line?.speaker || 'Mori'
  const mood = line?.expression ?? 'wave'

  return (
    <PaperCard
      ref={regionRef}
      id={id}
      role="region"
      aria-labelledby={titleId}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      tabIndex={-1}
      surface="fresh"
      tape="sage"
      className={`mm-mori-dialogue${closing ? ' mm-mori-dialogue--closing' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <div className="mm-mori-dialogue__portrait" aria-hidden="true">
        <Mori mood={mood} size={70} animated />
      </div>
      <div className="mm-mori-dialogue__content">
        <header className="mm-mori-dialogue__heading">
          <div>
            <Stamp tone="burgundy" className="mm-mori-dialogue__stamp">A note from your journal</Stamp>
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>{speaker}</h2>
          </div>
        </header>

        {status === 'pending' && <p className="mm-mori-dialogue__state" role="status">{pendingText}</p>}
        {status === 'error' && <div className="mm-mori-dialogue__state" role="alert"><p>{errorText}</p>{onRetry && <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>}</div>}
        {completed && <p className="mm-mori-dialogue__state" role="status">{completionText}</p>}

        {status === 'ready' && !completed && line && <>
          <p className="visually-hidden" role="status">{line.text}</p>
          <p className="mm-mori-dialogue__text" aria-hidden="true">
            {shownText}{isTyping && <span className="mm-mori-dialogue__caret" />}
          </p>
          {line.choices && line.choices.length > 0 && onChoice && <div className="mm-mori-dialogue__choices" role="group" aria-label="Choose a reply">
            {line.choices.map((choice) => <button key={choice.id} className="button button-secondary" type="button" onClick={() => choose(choice)}>{choice.label}</button>)}
          </div>}
        </>}

        <div className="mm-mori-dialogue__actions">
          {status === 'ready' && !completed && <button ref={continueRef} className="button button-primary" type="button" onClick={continueDialogue}>
            {isTyping ? 'Show full message' : 'Continue'}
          </button>}
          <button ref={closeRef} className="button button-secondary" type="button" onClick={onClose}>Close Mori's note</button>
        </div>
      </div>
    </PaperCard>
  )
}

export function MoriDialogueLauncher({
  lines,
  completionText,
  typewriterSpeedMs,
  onChoice,
}: Pick<MoriDialogueProps, 'lines' | 'completionText' | 'typewriterSpeedMs' | 'onChoice'>) {
  const navigate = useNavigate()
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | null>(null)
  const wasOpen = useRef(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)

  useLayoutEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  function finishClose() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setClosing(false)
    setOpen(false)
  }

  function requestClose() {
    if (!open || closing) return
    triggerRef.current?.focus()
    if (prefersReducedMotion()) {
      finishClose()
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(finishClose, 180)
  }

  function toggle() {
    if (open) requestClose()
    else {
      setClosing(false)
      setOpen(true)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      requestClose()
    }
  }

  function handleChoice(choice: MoriDialogueChoice, line: MoriDialogueLine) {
    onChoice?.(choice, line)
    if (choice.id === 'start-recipe') navigate('/app/recipes/new')
    if (choice.id === 'maybe-later') requestClose()
  }

  return (
    <div className="mm-mori-companion" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        className="button button-secondary mm-mori-companion__trigger"
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? 'Close the note from Mori' : 'Open a note from Mori'}
        onClick={toggle}
      >
        <Mori mood="wave" size={24} />
        <span>{open ? "Hide Mori's note" : 'A note from Mori'}</span>
      </button>
      {open && <MoriDialogue
        id={panelId}
        key={JSON.stringify(lines.map(({ id, text }) => [id, text]))}
        lines={lines}
        completionText={completionText}
        typewriterSpeedMs={typewriterSpeedMs}
        closing={closing}
        onChoice={handleChoice}
        onClose={requestClose}
      />}
    </div>
  )
}
