import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, SyntheticEvent } from 'react'
import { useNavigate } from 'react-router'
import { Mori } from './Mori'
import type { MoriMood } from './Mori'
import { PaperCard, Stamp } from './Scrapbook'
import { useReducedMotionPreference } from './useReducedMotionPreference'

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
  modal?: boolean
  numberedChoices?: boolean
  showContinue?: boolean
  eyebrow?: string
  closeLabel?: string
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

/** Reusable, non-modal dialogue surface. All copy and actions come from props. */
export function MoriDialogue({
  id,
  lines,
  modal = false,
  numberedChoices = false,
  showContinue = true,
  eyebrow = 'A note from your journal',
  closeLabel = "Close Mori's note",
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
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousLineId = useRef(currentLineId)
  const previousDisplayState = useRef(status)

  useLayoutEffect(() => {
    if (!modal) return
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [modal])

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
    if (nextLine) {
      // The reply button may disappear on this line; move focus before removal.
      continueRef.current?.focus()
      setFlow({ lineKey, lineId: nextLine.id, complete: false, typedCount: 0 })
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (modal && event.key === 'Tab') {
      const focusable = Array.from(regionRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault()
        focusable.at(-1)?.focus()
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1)) {
        event.preventDefault()
        focusable[0]?.focus()
      }
      return
    }
    if (!modal && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  const speaker = line?.speaker || 'Mori'
  const mood = line?.expression ?? 'wave'

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault()
    onClose()
  }

  const surface = (
    <PaperCard
      ref={regionRef}
      id={modal ? undefined : id}
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
            <Stamp tone="burgundy" className="mm-mori-dialogue__stamp">{eyebrow}</Stamp>
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
          {line.choices && line.choices.length > 0 && onChoice && <div className={`mm-mori-dialogue__choices${numberedChoices ? ' mm-mori-dialogue__choices--numbered' : ''}`} role="group" aria-label="Choose a reply">
            {line.choices.map((choice, index) => <button key={choice.id} className="button button-secondary" type="button" aria-label={numberedChoices ? `${index + 1}. ${choice.label}` : undefined} onClick={() => choose(choice)}>
              {numberedChoices && <span className="mm-mori-dialogue__choice-number" aria-hidden="true">{index + 1}</span>}
              <span>{choice.label}</span>
            </button>)}
          </div>}
        </>}

        <div className="mm-mori-dialogue__actions">
          {showContinue && status === 'ready' && !completed && <button ref={continueRef} className="button button-primary" type="button" onClick={continueDialogue}>
            {isTyping ? 'Show full message' : 'Continue'}
          </button>}
          <button ref={closeRef} className="button button-secondary" type="button" onClick={onClose}>{closeLabel}</button>
        </div>
      </div>
    </PaperCard>
  )

  if (modal) {
    return <dialog
      ref={dialogRef}
      id={id}
      className="mm-mori-dialogue-modal"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={handleCancel}
    >{surface}</dialog>
  }
  return surface
}

export function MoriDialogueLauncher({
  lines,
  completionText,
  typewriterSpeedMs,
  onChoice,
}: Pick<MoriDialogueProps, 'lines' | 'completionText' | 'typewriterSpeedMs' | 'onChoice'>) {
  const navigate = useNavigate()
  const reducedMotion = useReducedMotionPreference()
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | null>(null)
  const wasOpen = useRef(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  // Keep the current conversation intact while its choices update the page.
  // Newly supplied notes take effect the next time the launcher is opened.
  const [activeLines, setActiveLines] = useState(lines)

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
    if (reducedMotion) {
      finishClose()
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(finishClose, 180)
  }

  function toggle() {
    if (open) requestClose()
    else {
      setActiveLines(lines)
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
        lines={activeLines}
        completionText={completionText}
        typewriterSpeedMs={typewriterSpeedMs}
        closing={closing}
        onChoice={handleChoice}
        onClose={requestClose}
      />}
    </div>
  )
}
